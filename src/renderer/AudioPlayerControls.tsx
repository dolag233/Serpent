import {
  useCallback,
  useEffect,
  useRef,
  useState,
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
  nextPlaybackIntent,
  scrubRatioFromClientX,
  scrubRatioFromTime,
  scrubTimeFromRatio,
  shouldHandleVideoSpaceKey,
} from "./video-player-controls";
import { ViewerVolumeControls } from "./ViewerVolumeControls";
import { applyViewerVolumeToMedia } from "./viewer-volume-preferences";

export interface AudioPlayerControlsProps {
  muted: boolean;
  onError(event: SyntheticEvent<HTMLAudioElement>): void;
  onMutedChange(muted: boolean): void;
  onReady?(): void;
  onVolumeChange(volume: number): void;
  src: string;
  volume: number;
  /** Wide viewer waveform strip (audio `video_poster`), optional until ready. */
  waveformUrl?: string;
}

const SCRUB_STEP_SECONDS = 5;

/**
 * Viewer chrome for audio (Serpent-0x5 / 13v / vlx / r8a):
 * full-bleed waveform; full-height star-yellow playhead; particle trail that
 * deposits samples while playing and fades in place (pause → trail dissipates;
 * faster rate → longer trail span).
 */
export function AudioPlayerControls({
  muted,
  onError,
  onMutedChange,
  onReady,
  onVolumeChange,
  src,
  volume,
  waveformUrl,
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

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (nextPlaybackIntent(audio.paused) === "play") {
      void audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!shouldHandleVideoSpaceKey(event)) return;
      event.preventDefault();
      event.stopPropagation();
      togglePlayback();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [togglePlayback]);

  // Parent remounts with key={src}; only cancel in-flight seek on unmount/src change.
  useEffect(() => {
    seekSessionRef.current?.cancel();
    return () => seekSessionRef.current?.cancel();
  }, [src]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    applyViewerVolumeToMedia(audio, { volume, muted });
  }, [volume, muted, src]);

  // Particle trail pump: emit while playing; always prune/fade (incl. pause).
  useEffect(() => {
    let frameId = 0;
    const tick = (nowMs: number) => {
      const audio = audioRef.current;
      const scrubbing =
        scrubbingPointerId.current !== null ||
        waveformScrubbingPointerId.current !== null;
      const playing = Boolean(audio && !audio.paused && !audio.ended && !scrubbing);
      const ratio = audio
        ? playheadRatioFromTime(audio.currentTime, audio.duration || 0)
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
      frameId = window.requestAnimationFrame(tick);
    };
    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, []);

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
          if (event.key === "ArrowLeft") {
            nextTime = clampScrubTime(
              audio.currentTime - SCRUB_STEP_SECONDS,
              duration,
            );
          } else if (event.key === "ArrowRight") {
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
        tabIndex={0}
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
        autoPlay
        className="preview-audio"
        onDurationChange={(event) =>
          setDuration(event.currentTarget.duration || 0)
        }
        onEnded={() => setPaused(true)}
        onError={onError}
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration || 0);
          onReady?.();
        }}
        onPause={() => setPaused(true)}
        onPlay={() => setPaused(false)}
        onSeeked={() => {
          seekSessionRef.current?.onSeeked();
          if (
            scrubbingPointerId.current === null &&
            waveformScrubbingPointerId.current === null &&
            audioRef.current
          ) {
            setCurrentTime(audioRef.current.currentTime);
          }
        }}
        onTimeUpdate={(event) => {
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
            if (event.key === "ArrowLeft") {
              nextTime = clampScrubTime(
                audio.currentTime - SCRUB_STEP_SECONDS,
                duration,
              );
            } else if (event.key === "ArrowRight") {
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
          tabIndex={0}
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
          onMutedChange={onMutedChange}
          onVolumeChange={onVolumeChange}
          volume={volume}
        />
      </div>
    </div>
  );
}
