import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
  type SyntheticEvent,
} from "react";

import {
  nextTrailParticleId,
  pruneTrailParticles,
  shouldEmitTrailParticle,
  trailParticleOpacity,
  type TrailParticle,
} from "./audio-playhead-trail";
import {
  playheadLeftPercent,
  playheadRatioFromTime,
  seekRatioFromWaveformClientX,
} from "./audio-waveform-timeline";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { createMediaSeekSession, type MediaSeekSession } from "./media-seek-session";
import {
  clampScrubTime,
  formatVideoClockTime,
  applyMediaAutoplayIntent,
  matchVideoPlaybackSeekKey,
  nextPlaybackIntent,
  scrubRatioFromClientX,
  shouldAutoStartMediaPlayback,
  scrubRatioFromTime,
  scrubTimeFromRatio,
  shouldHandleVideoSpaceKey,
  videoSeekDeltaSeconds,
  videoWheelSeekTime,
  nextKeyboardSeekBase,
} from "./video-player-controls";
import { loadVideoSeekJumpPreferences } from "./video-seek-jump-preferences";
import { bindVerticalWheelSteps } from "./viewer-wheel-intent";
import { ViewerVolumeControls } from "./ViewerVolumeControls";
import { VIEWER_CHROME_TAB_INDEX } from "./viewer-focus-policy";
import { applyViewerVolumeToMedia } from "./viewer-volume-preferences";
import { listenForShortcutInputs } from "./shortcut-runtime";
import { hasActiveModalDialog } from "./use-dialog-focus-trap";
import { isTypingKeyboardTarget } from "./video-player-controls";
import type { ShortcutEventLike } from "../shared/shortcut-resolution";
import type { SerpentShellApi } from "../shared/external-url";
import type { ViewerVideoShortcutAction } from "../shared/viewer-video-shortcuts";
import type { ViewerPlaybackHandle } from "./video-player-controls";
import type { VideoSeekJumpMode } from "./video-seek-jump-preferences";

type RendererWindow = Window & {
  serpent?: { shell?: SerpentShellApi };
};

export interface AudioPlayerControlsProps {
  /** Keep preloaded navigation surfaces from capturing global shortcuts. */
  keyboardShortcutsDisabled?: boolean;
  /** Preloaded audio must decode without starting playback or producing sound. */
  autoPlay?: boolean;
  muted: boolean;
  onError(event: SyntheticEvent<HTMLAudioElement>): void;
  onMutedChange(muted: boolean): void;
  onPresentationReady?(): void;
  onReady?(): void;
  onUserActivity?: () => void;
  onVolumeChange(volume: number): void;
  src: string;
  volume: number;
  /** Wide viewer waveform strip (audio `video_poster`), optional until ready. */
  waveformUrl?: string;
  playbackHandleRef?: RefObject<ViewerPlaybackHandle | null>;
}

const SCRUB_STEP_SECONDS = 5;

/**
 * Viewer chrome for audio (Serpent-0x5 / 13v / vlx / r8a):
 * full-bleed waveform; full-height star-yellow playhead; particle trail that
 * deposits samples while playing and fades in place (pause → trail dissipates;
 * faster rate → longer trail span).
 */
export function AudioPlayerControls({
  autoPlay = true,
  keyboardShortcutsDisabled = false,
  muted,
  onError,
  onMutedChange,
  onPresentationReady,
  onReady,
  onUserActivity,
  onVolumeChange,
  src,
  volume,
  waveformUrl,
  playbackHandleRef,
}: AudioPlayerControlsProps) {
  const t = useT();
  const audioRef = useRef<HTMLAudioElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const scrubbingPointerId = useRef<number | null>(null);
  const waveformScrubbingPointerId = useRef<number | null>(null);
  const trailLastEmitAtRef = useRef<number | null>(null);
  const trailNextIdRef = useRef(0);
  const trailParticlesRef = useRef<TrailParticle[]>([]);
  // Create the seek session in an effect (not render) so react-hooks/refs
  // doesn't flag the ref-reading closures. createMediaSeekSession stores
  // them and only calls them during seek events; all session access here is
  // event/effect time (after mount), so null-safe ?. is just for TypeScript.
  const seekSessionRef = useRef<MediaSeekSession | null>(null);
  const wheelHoldUntilRef = useRef(0);
  const wheelTargetRef = useRef<number | null>(null);
  const keyboardSeekRef = useRef<{ time: number; at: number } | null>(null);
  useEffect(() => {
    seekSessionRef.current = createMediaSeekSession(
      () => audioRef.current,
      (time: number) => {
        const audio = audioRef.current;
        if (audio) audio.currentTime = time;
      },
    );
    return () => {
      seekSessionRef.current?.cancel();
    };
  }, []);
  const [paused, setPaused] = useState(true);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [scrubRatio, setScrubRatio] = useState<number | null>(null);
  const [trailParticles, setTrailParticles] = useState<TrailParticle[]>([]);
  const [trailNowMs, setTrailNowMs] = useState(0);
  const autoPlayRef = useRef(autoPlay);
  const userPausedRef = useRef(false);
  useEffect(() => {
    autoPlayRef.current = autoPlay;
  }, [autoPlay]);

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (nextPlaybackIntent(audio.paused) === "play") {
      userPausedRef.current = false;
      void audio.play().catch(() => undefined);
    } else {
      userPausedRef.current = true;
      audio.pause();
    }
  }, []);

  const seekByConfiguredJump = useCallback((
    direction: 1 | -1,
    unit?: VideoSeekJumpMode,
  ) => {
    const audio = audioRef.current;
    if (!audio) return;
    const mediaDuration = audio.duration || duration;
    const now = Date.now();
    const base = nextKeyboardSeekBase(
      audio.currentTime,
      keyboardSeekRef.current,
      now,
    );
    const stored = loadVideoSeekJumpPreferences();
    const nextTime = clampScrubTime(
      base + videoSeekDeltaSeconds(
        { kind: "skip", direction },
        undefined,
        unit === undefined ? stored : { ...stored, mode: unit },
        mediaDuration,
      ),
      mediaDuration,
    );
    keyboardSeekRef.current = { time: nextTime, at: now };
    seekSessionRef.current?.commit(nextTime);
    setCurrentTime(nextTime);
    trailParticlesRef.current = [];
    trailLastEmitAtRef.current = null;
    setTrailParticles([]);
  }, [duration]);

  useEffect(() => {
    const slot = playbackHandleRef;
    if (!slot) return;
    slot.current = {
      stepRate: () => undefined,
      seekBy(direction, unit) {
        seekByConfiguredJump(direction, unit);
      },
    };
    return () => {
      slot.current = null;
    };
  }, [playbackHandleRef, seekByConfiguredJump]);

  useEffect(() => {
    if (keyboardShortcutsDisabled) return;
    const onShortcutInput = (input: ShortcutEventLike, event: KeyboardEvent | MouseEvent) => {
      if (hasActiveModalDialog()) return;
      const withTarget = { ...input, target: event.target };
      if (shouldHandleVideoSpaceKey(withTarget)) {
        event.preventDefault();
        event.stopPropagation();
        togglePlayback();
        return;
      }
      const action = matchVideoPlaybackSeekKey(withTarget);
      if (!action || action.kind !== "skip") return;
      event.preventDefault();
      event.stopPropagation();
      seekByConfiguredJump(action.direction);
    };
    return listenForShortcutInputs(window, onShortcutInput, true);
  }, [keyboardShortcutsDisabled, seekByConfiguredJump, togglePlayback]);

  useEffect(() => {
    if (keyboardShortcutsDisabled) return;
    const shell = (window as RendererWindow).serpent?.shell;
    if (!shell?.setViewerVideoShortcutsActive || !shell.onViewerVideoShortcut) return;

    const syncArmed = () => {
      const typing = isTypingKeyboardTarget(document.activeElement);
      shell.setViewerVideoShortcutsActive(
        !typing && !hasActiveModalDialog(),
        "viewer.audio",
      );
    };
    shell.setViewerVideoShortcutsActive(true, "viewer.audio");
    syncArmed();
    document.addEventListener("focusin", syncArmed, true);
    document.addEventListener("focusout", syncArmed, true);
    window.addEventListener("keyup", syncArmed, true);

    const applyMainAction = (action: ViewerVideoShortcutAction) => {
      if (isTypingKeyboardTarget(document.activeElement) || hasActiveModalDialog()) return;
      if (action === "play-pause") {
        onUserActivity?.();
        togglePlayback();
        return;
      }
      if (action === "seek-back" || action === "seek-forward") {
        onUserActivity?.();
        seekByConfiguredJump(action === "seek-back" ? -1 : 1);
      }
    };
    const unsubscribe = shell.onViewerVideoShortcut(applyMainAction);
    return () => {
      shell.setViewerVideoShortcutsActive(false, "viewer.audio");
      document.removeEventListener("focusin", syncArmed, true);
      document.removeEventListener("focusout", syncArmed, true);
      window.removeEventListener("keyup", syncArmed, true);
      unsubscribe();
    };
  }, [keyboardShortcutsDisabled, onUserActivity, seekByConfiguredJump, togglePlayback]);

  // Parent remounts with key={src}; only cancel in-flight seek on unmount/src change.
  useEffect(() => {
    seekSessionRef.current?.cancel();
    return () => seekSessionRef.current?.cancel();
  }, [src]);

  useEffect(() => {
    const nodes = [trackRef.current, waveformRef.current].filter(
      (node): node is HTMLDivElement => node !== null,
    );
    if (nodes.length === 0) return;
    let holdTimer = 0;
    const unbind = nodes.map((node) => bindVerticalWheelSteps(node, (steps) => {
      onUserActivity?.();
      const audio = audioRef.current;
      if (!audio) return;
      const mediaDuration = Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : duration;
      const base = wheelTargetRef.current ?? audio.currentTime;
      const next = videoWheelSeekTime(
        base,
        mediaDuration,
        steps,
        loadVideoSeekJumpPreferences(),
      );
      wheelTargetRef.current = next;
      wheelHoldUntilRef.current = Date.now() + 400;
      window.clearTimeout(holdTimer);
      holdTimer = window.setTimeout(() => {
        wheelTargetRef.current = null;
      }, 400);
      setCurrentTime(next);
      seekSessionRef.current?.request(next);
    }));
    return () => {
      window.clearTimeout(holdTimer);
      for (const stop of unbind) stop();
    };
  }, [duration, onUserActivity, src]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    applyViewerVolumeToMedia(audio, { volume, muted });
  }, [volume, muted, src]);

  useEffect(() => {
    userPausedRef.current = false;
    const audio = audioRef.current;
    if (!audio) return;
    applyMediaAutoplayIntent(
      audio,
      shouldAutoStartMediaPlayback({
        autoPlay,
        userPaused: userPausedRef.current,
      }),
    );
  }, [autoPlay, src]);

  // Particle trail pump: emit while playing; always prune/fade (incl. pause).
  // Serpent-mrsm: the pump only runs while there is something to draw — the
  // audio is active (playing, even while scrubbing) or trail particles are
  // still fading out. Once paused AND the trail has fully dissipated the
  // loop stops scheduling frames (no more per-frame setState); playback
  // resuming (paused → false) restarts the pump via the dependency.
  useEffect(() => {
    const audio = audioRef.current;
    const audioActive = Boolean(audio && !audio.paused && !audio.ended);
    if (!audioActive && trailParticlesRef.current.length === 0) return;
    let frameId = 0;
    const tick = (nowMs: number) => {
      const current = audioRef.current;
      const scrubbing =
        scrubbingPointerId.current !== null ||
        waveformScrubbingPointerId.current !== null;
      const playing = Boolean(
        current && !current.paused && !current.ended && !scrubbing,
      );
      const ratio = current
        ? playheadRatioFromTime(current.currentTime, current.duration || 0)
        : 0;

      let particles = pruneTrailParticles(trailParticlesRef.current, nowMs);
      if (
        shouldEmitTrailParticle(trailLastEmitAtRef.current, nowMs, playing)
      ) {
        trailLastEmitAtRef.current = nowMs;
        const id = nextTrailParticleId(trailNextIdRef.current);
        trailNextIdRef.current = id;
        particles = [...particles, { id, ratio, bornAtMs: nowMs }];
      }
      trailParticlesRef.current = particles;
      setTrailParticles(particles);
      setTrailNowMs(nowMs);
      const stillActive = Boolean(
        current && !current.paused && !current.ended,
      );
      if (!stillActive && particles.length === 0) return;
      frameId = window.requestAnimationFrame(tick);
    };
    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [paused]);

  const seekToRatio = useCallback((ratio: number, mode: "coalesce" | "commit") => {
    const audio = audioRef.current;
    if (!audio) return;
    const time = scrubTimeFromRatio(ratio, audio.duration);
    if (mode === "commit") {
      seekSessionRef.current?.commit(time);
      return;
    }
    seekSessionRef.current?.request(time);
  }, []);

  const ratioFromPointer = useCallback((clientX: number): number => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    return scrubRatioFromClientX(clientX, { left: rect.left, width: rect.width });
  }, []);

  const ratioFromWaveformPointer = useCallback((clientX: number): number => {
    const waveform = waveformRef.current;
    if (!waveform) return 0;
    const rect = waveform.getBoundingClientRect();
    return seekRatioFromWaveformClientX(clientX, {
      left: rect.left,
      width: rect.width,
    });
  }, []);

  const displayRatio =
    scrubRatio ?? scrubRatioFromTime(currentTime, duration);
  const displayTime =
    scrubRatio !== null ? scrubTimeFromRatio(scrubRatio, duration) : currentTime;
  const playheadPercent = playheadLeftPercent(
    scrubRatio ?? playheadRatioFromTime(currentTime, duration),
  );

  const applyKeySeek = (nextTime: number) => {
    seekSessionRef.current?.commit(nextTime);
    setCurrentTime(nextTime);
    trailParticlesRef.current = [];
    trailLastEmitAtRef.current = null;
    setTrailParticles([]);
  };

  return (
    <div className="preview-audio-stage">
      <div
        aria-label={t("preview.videoScrubAria")}
        aria-valuemax={Math.round(duration)}
        aria-valuemin={0}
        aria-valuenow={Math.round(displayTime)}
        className="preview-audio-waveform-shell"
        onKeyDown={(event) => {
          const audio = audioRef.current;
          if (!audio) return;
          let nextTime: number | null = null;
          if (event.key === "ArrowLeft" && !event.ctrlKey && !event.metaKey && !event.altKey) {
            nextTime = clampScrubTime(
              audio.currentTime - SCRUB_STEP_SECONDS,
              duration,
            );
          } else if (event.key === "ArrowRight" && !event.ctrlKey && !event.metaKey && !event.altKey) {
            nextTime = clampScrubTime(
              audio.currentTime + SCRUB_STEP_SECONDS,
              duration,
            );
          } else if (event.key === "Home") {
            nextTime = 0;
          } else if (event.key === "End") {
            nextTime = clampScrubTime(duration, duration);
          }
          if (nextTime === null) return;
          event.preventDefault();
          applyKeySeek(nextTime);
        }}
        onPointerDown={(event) => {
          keyboardSeekRef.current = null;
          event.preventDefault();
          event.currentTarget.focus();
          waveformScrubbingPointerId.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          trailParticlesRef.current = [];
          trailLastEmitAtRef.current = null;
          setTrailParticles([]);
          const ratio = ratioFromWaveformPointer(event.clientX);
          setScrubRatio(ratio);
          seekToRatio(ratio, "coalesce");
        }}
        onPointerMove={(event) => {
          if (waveformScrubbingPointerId.current !== event.pointerId) return;
          const ratio = ratioFromWaveformPointer(event.clientX);
          setScrubRatio(ratio);
          seekToRatio(ratio, "coalesce");
        }}
        onPointerUp={(event) => {
          if (waveformScrubbingPointerId.current !== event.pointerId) return;
          waveformScrubbingPointerId.current = null;
          const ratio = ratioFromWaveformPointer(event.clientX);
          setScrubRatio(null);
          seekToRatio(ratio, "commit");
          setCurrentTime(audioRef.current?.currentTime ?? 0);
        }}
        ref={waveformRef}
        role="slider"
        tabIndex={VIEWER_CHROME_TAB_INDEX}
      >
        {waveformUrl ? (
          <img
            alt=""
            className="preview-audio-waveform"
            draggable={false}
            src={waveformUrl}
          />
        ) : (
          <div aria-hidden="true" className="preview-audio-waveform is-placeholder" />
        )}
        <div aria-hidden="true" className="preview-audio-trail">
          {trailParticles.map((particle) => (
            <div
              className="preview-audio-trail-particle"
              key={particle.id}
              style={{
                left: `${playheadLeftPercent(particle.ratio)}%`,
                opacity: trailParticleOpacity(particle.bornAtMs, trailNowMs),
              }}
            />
          ))}
        </div>
        <div
          aria-hidden="true"
          className="preview-audio-playhead"
          style={{ left: `${playheadPercent}%` }}
        />
      </div>
      <audio
        autoPlay={autoPlay}
        className="preview-audio"
        onDurationChange={(event) =>
          setDuration(event.currentTarget.duration || 0)
        }
        onEnded={() => setPaused(true)}
        onError={onError}
        onLoadedMetadata={(event) => {
          const audio = event.currentTarget;
          setDuration(audio.duration || 0);
          onReady?.();
          onPresentationReady?.();
          if (
            shouldAutoStartMediaPlayback({
              autoPlay: autoPlayRef.current,
              userPaused: userPausedRef.current,
            })
          ) {
            applyMediaAutoplayIntent(audio, true);
          }
        }}
        onPause={() => setPaused(true)}
        onPlay={() => setPaused(false)}
        onSeeked={() => {
          seekSessionRef.current?.onSeeked();
          if (Date.now() < wheelHoldUntilRef.current) return;
          if (
            scrubbingPointerId.current === null &&
            waveformScrubbingPointerId.current === null &&
            audioRef.current
          ) {
            setCurrentTime(audioRef.current.currentTime);
          }
        }}
        onTimeUpdate={(event) => {
          if (Date.now() < wheelHoldUntilRef.current) return;
          if (
            scrubbingPointerId.current !== null ||
            waveformScrubbingPointerId.current !== null
          ) {
            return;
          }
          setCurrentTime(event.currentTarget.currentTime);
        }}
        preload="auto"
        ref={audioRef}
        src={src}
      >
        {t("preview.videoUnsupported")}
      </audio>
      <div className="preview-video-controls preview-audio-controls preview-chrome-fade">
        <button
          className="preview-video-playpause"
          onClick={togglePlayback}
          tabIndex={VIEWER_CHROME_TAB_INDEX}
          type="button"
          {...iconActionAttrs(
            paused ? t("preview.videoPlay") : t("preview.videoPause"),
          )}
        >
          <span aria-hidden="true">{paused ? "▶" : "❚❚"}</span>
        </button>
        <span aria-hidden="true" className="preview-video-time">
          {formatVideoClockTime(displayTime)} / {formatVideoClockTime(duration)}
        </span>
        <div
          aria-label={t("preview.videoScrubAria")}
          aria-valuemax={Math.round(duration)}
          aria-valuemin={0}
          aria-valuenow={Math.round(displayTime)}
          className="preview-video-track"
          onKeyDown={(event) => {
            const audio = audioRef.current;
            if (!audio) return;
            let nextTime: number | null = null;
            if (event.key === "ArrowLeft" && !event.ctrlKey && !event.metaKey && !event.altKey) {
              nextTime = clampScrubTime(
                audio.currentTime - SCRUB_STEP_SECONDS,
                duration,
              );
            } else if (event.key === "ArrowRight" && !event.ctrlKey && !event.metaKey && !event.altKey) {
              nextTime = clampScrubTime(
                audio.currentTime + SCRUB_STEP_SECONDS,
                duration,
              );
            } else if (event.key === "Home") {
              nextTime = 0;
            } else if (event.key === "End") {
              nextTime = clampScrubTime(duration, duration);
            }
            if (nextTime === null) return;
            event.preventDefault();
            applyKeySeek(nextTime);
          }}
          onPointerDown={(event) => {
            keyboardSeekRef.current = null;
            event.preventDefault();
            event.currentTarget.focus();
            scrubbingPointerId.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
            trailParticlesRef.current = [];
            trailLastEmitAtRef.current = null;
            setTrailParticles([]);
            const ratio = ratioFromPointer(event.clientX);
            setScrubRatio(ratio);
            seekToRatio(ratio, "coalesce");
          }}
          onPointerMove={(event) => {
            if (scrubbingPointerId.current !== event.pointerId) return;
            const ratio = ratioFromPointer(event.clientX);
            setScrubRatio(ratio);
            seekToRatio(ratio, "coalesce");
          }}
          onPointerUp={(event) => {
            if (scrubbingPointerId.current !== event.pointerId) return;
            scrubbingPointerId.current = null;
            const ratio = ratioFromPointer(event.clientX);
            setScrubRatio(null);
            seekToRatio(ratio, "commit");
            setCurrentTime(audioRef.current?.currentTime ?? 0);
          }}
          ref={trackRef}
          role="slider"
          tabIndex={VIEWER_CHROME_TAB_INDEX}
        >
          <div
            className="preview-video-track-fill"
            style={{ width: `${displayRatio * 100}%` }}
          />
          <div
            className="preview-video-track-thumb"
            style={{ left: `${displayRatio * 100}%` }}
          />
        </div>
        <ViewerVolumeControls
          muted={muted}
          onInteract={onUserActivity}
          onMutedChange={onMutedChange}
          onVolumeChange={onVolumeChange}
          volume={volume}
        />
      </div>
    </div>
  );
}
