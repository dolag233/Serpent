import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";

import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { createMediaSeekSession, type MediaSeekSession } from "./media-seek-session";
import { useViewerZoomPan } from "./use-viewer-zoom-pan";
import {
  clampScrubTime,
  formatVideoClockTime,
  matchVideoPlaybackSeekKey,
  matchVideoPlaybackRateKey,
  nextFrameSeekTime,
  nextPlaybackIntent,
  resolveFrameStepSeconds,
  scrubRatioFromClientX,
  scrubRatioFromTime,
  scrubTimeFromRatio,
  shouldHandleVideoSpaceKey,
  stepVideoPlaybackRate,
  videoSeekDeltaSeconds,
  isTypingKeyboardTarget,
  type VideoPlaybackRate,
} from "./video-player-controls";
import { ViewerVolumeControls } from "./ViewerVolumeControls";
import { VIEWER_CHROME_TAB_INDEX } from "./viewer-focus-policy";
import { applyViewerVolumeToMedia } from "./viewer-volume-preferences";
import type { SerpentShellApi } from "../shared/external-url";
import type { ViewerVideoShortcutAction } from "../shared/viewer-video-shortcuts";
import {
  IDENTITY_VIEWER_DISPLAY_TRANSFORM,
  viewerDisplaySize,
  viewerDisplayTransformCss,
  type ViewerDisplayTransform,
} from "./viewer-display-transform";

type RendererWindow = Window & {
  serpent?: { shell?: SerpentShellApi };
};

export interface VideoPlayerControlsProps {
  /** Optional probe fps for editorial frame steps (falls back to 30). */
  frameRateFps?: number | null;
  isFullscreen?: boolean;
  muted: boolean;
  onError(event: SyntheticEvent<HTMLVideoElement>): void;
  onFullscreen(): void;
  onMutedChange(muted: boolean): void;
  onReady?(): void;
  onSwipeNext?: () => void;
  onSwipePrevious?: () => void;
  /** Wake viewer chrome (e.g. Main-forwarded IME letter shortcuts). */
  onUserActivity?: () => void;
  onVolumeChange(volume: number): void;
  posterUrl?: string;
  src: string;
  volume: number;
  displayTransform?: ViewerDisplayTransform;
}

const SCRUB_STEP_SECONDS = 5;

function waitForVideoSeeked(video: HTMLVideoElement): Promise<void> {
  if (!video.seeking) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      window.clearTimeout(timer);
      video.removeEventListener("seeked", done);
      resolve();
    };
    const timer = window.setTimeout(done, 250);
    video.addEventListener("seeked", done, { once: true });
  });
}

/**
 * Fully custom chrome around `HTMLVideoElement` (REQ-VIEW-005 / Serpent-60k):
 * - Space play/pause when the viewer is focused (not in text fields)
 * - D / F frame step (D=back, F=forward) and Ctrl+←/→ ±2s skip (Serpent-sk1 / soii)
 * - X / C step playback rate within VIDEO_PLAYBACK_RATES (Serpent-soii)
 * - scrubbable progress track (mousedown / drag / click / arrow keys)
 * - playback rate button (cycles; no native select focus trap)
 *
 * See `video-player-controls.ts` for why this replaced native
 * `<video controls>` rather than layering on top of it.
 * Seek/scrub uses `createMediaSeekSession` so Range fetches are not cancelled
 * on every pointermove (Serpent-jh2).
 */
export function VideoPlayerControls({
  frameRateFps = null,
  isFullscreen = false,
  muted,
  onError,
  onFullscreen,
  onMutedChange,
  onReady,
  onSwipeNext,
  onSwipePrevious,
  onUserActivity,
  onVolumeChange,
  posterUrl,
  src,
  volume,
  displayTransform = IDENTITY_VIEWER_DISPLAY_TRANSFORM,
}: VideoPlayerControlsProps) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  // Zoom/pan/fit mirrors the image viewer (Serpent-190). No F/Space fit
  // keybind here: Space toggles playback; D/F step frames; Ctrl+arrows skip.
  const {
    fitToWindow,
    measureAndFit,
    view,
    viewportPointerHandlers,
    viewportRef,
  } = useViewerZoomPan({ onSwipeNext, onSwipePrevious });
  const scrubbingPointerId = useRef<number | null>(null);
  // Create the seek session in an effect (not render) so react-hooks/refs
  // doesn't flag the ref-reading closures. createMediaSeekSession stores
  // them and only calls them during seek events; all session access here is
  // event/effect time (after mount), so null-safe ?. is just for TypeScript.
  const seekSessionRef = useRef<MediaSeekSession | null>(null);
  useEffect(() => {
    seekSessionRef.current = createMediaSeekSession(
      () => videoRef.current,
      (time: number) => {
        const video = videoRef.current;
        if (video) video.currentTime = time;
      },
    );
    return () => {
      seekSessionRef.current?.cancel();
    };
  }, []);
  const [playbackRate, setPlaybackRate] = useState<VideoPlaybackRate>(1);
  const [paused, setPaused] = useState(true);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [sourceNatural, setSourceNatural] = useState({ w: 0, h: 0 });
  const [scrubRatio, setScrubRatio] = useState<number | null>(null);
  const playbackRateRef = useRef(playbackRate);
  const durationRef = useRef(duration);
  const frameRateFpsRef = useRef(frameRateFps);
  useEffect(() => {
    playbackRateRef.current = playbackRate;
    durationRef.current = duration;
    frameRateFpsRef.current = frameRateFps;
  }, [playbackRate, duration, frameRateFps]);
  const frameSeekGeneration = useRef(0);

  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (nextPlaybackIntent(video.paused) === "play") {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, []);

  const applyPlaybackRate = useCallback((next: VideoPlaybackRate) => {
    setPlaybackRate(next);
    playbackRateRef.current = next;
    const video = videoRef.current;
    if (video) video.playbackRate = next;
  }, []);

  const stepFrame = useCallback(async (direction: 1 | -1) => {
    const video = videoRef.current;
    if (!video) return;
    const generation = ++frameSeekGeneration.current;
    video.pause();
    setPaused(true);
    const mediaDuration = video.duration || durationRef.current;
    const frameStep = resolveFrameStepSeconds(frameRateFpsRef.current);
    const start = video.currentTime;
    // HTMLVideoElement often snaps to the nearest keyframe. Advance by
    // additional frame increments until the clock moves enough to paint a
    // new frame — otherwise D/F feel broken on typical GOP-encoded MP4s.
    let multiple = 1;
    for (let attempt = 0; attempt < 48; attempt += 1) {
      if (generation !== frameSeekGeneration.current) return;
      const target = nextFrameSeekTime(
        start,
        mediaDuration,
        direction,
        frameStep * multiple,
      );
      if (Math.abs(target - start) < 1e-4) {
        setCurrentTime(start);
        return;
      }
      video.currentTime = target;
      await waitForVideoSeeked(video);
      if (generation !== frameSeekGeneration.current) return;
      const moved = Math.abs(video.currentTime - start);
      if (
        moved >= frameStep * 0.45 ||
        video.currentTime <= 1e-4 ||
        video.currentTime >= mediaDuration - 1e-3
      ) {
        setCurrentTime(video.currentTime);
        return;
      }
      multiple += 1;
    }
    setCurrentTime(video.currentTime);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
        return;
      }
      if (shouldHandleVideoSpaceKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        togglePlayback();
        return;
      }
      const action = matchVideoPlaybackSeekKey(event);
      if (action) {
        const video = videoRef.current;
        if (!video) return;
        event.preventDefault();
        event.stopPropagation();
        if (action.kind === "frame") {
          void stepFrame(action.direction);
          return;
        }
        const mediaDuration = video.duration || durationRef.current;
        const nextTime = clampScrubTime(
          video.currentTime + videoSeekDeltaSeconds(action),
          mediaDuration,
        );
        seekSessionRef.current?.commit(nextTime);
        setCurrentTime(nextTime);
        return;
      }
      const rateStep = matchVideoPlaybackRateKey(event);
      if (!rateStep) return;
      event.preventDefault();
      event.stopPropagation();
      applyPlaybackRate(
        stepVideoPlaybackRate(playbackRateRef.current, rateStep),
      );
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [applyPlaybackRate, stepFrame, togglePlayback]);

  // Main path: Windows Menu accelerators + IMM32 IME suspend while armed;
  // before-input remains a fallback. Ctrl+Arrow still arrives via the listener above.
  useEffect(() => {
    const shell = (window as RendererWindow).serpent?.shell;
    if (!shell?.setViewerVideoShortcutsActive || !shell.onViewerVideoShortcut) {
      return;
    }

    const syncArmed = () => {
      // Only true typing surfaces disarm capture — keep armed under Chinese
      // IME while focus is on the viewer / chrome (product: any IME works).
      const typing = isTypingKeyboardTarget(document.activeElement);
      const modalOpen = Boolean(
        document.querySelector('[role="dialog"][aria-modal="true"]'),
      );
      shell.setViewerVideoShortcutsActive(!typing && !modalOpen);
    };
    // Arm immediately so the first key after open is not lost to IME.
    shell.setViewerVideoShortcutsActive(true);
    syncArmed();
    document.addEventListener("focusin", syncArmed, true);
    document.addEventListener("focusout", syncArmed, true);
    // Some IMEs flip composition without a focus change; re-check on keyup.
    window.addEventListener("keyup", syncArmed, true);

    const applyMainAction = (action: ViewerVideoShortcutAction) => {
      if (isTypingKeyboardTarget(document.activeElement)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      onUserActivity?.();
      if (action === "frame-prev") {
        void stepFrame(-1);
        return;
      }
      if (action === "frame-next") {
        void stepFrame(1);
        return;
      }
      applyPlaybackRate(
        stepVideoPlaybackRate(
          playbackRateRef.current,
          action === "rate-slower" ? "slower" : "faster",
        ),
      );
    };
    const unsubscribe = shell.onViewerVideoShortcut(applyMainAction);

    return () => {
      shell.setViewerVideoShortcutsActive(false);
      document.removeEventListener("focusin", syncArmed, true);
      document.removeEventListener("focusout", syncArmed, true);
      window.removeEventListener("keyup", syncArmed, true);
      unsubscribe();
    };
  }, [applyPlaybackRate, onUserActivity, stepFrame]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = playbackRate;
  }, [playbackRate, src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    applyViewerVolumeToMedia(video, { volume, muted });
  }, [volume, muted, src]);

  useEffect(() => {
    seekSessionRef.current?.cancel();
    return () => seekSessionRef.current?.cancel();
  }, [src]);

  const seekToRatio = useCallback((ratio: number, mode: "coalesce" | "commit") => {
    const video = videoRef.current;
    if (!video) return;
    const time = scrubTimeFromRatio(ratio, video.duration);
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

  const displayRatio =
    scrubRatio ?? scrubRatioFromTime(currentTime, duration);
  const displayTime =
    scrubRatio !== null ? scrubTimeFromRatio(scrubRatio, duration) : currentTime;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) return;
    const size = viewerDisplaySize(
      video.videoWidth,
      video.videoHeight,
      displayTransform.quarterTurns,
    );
    measureAndFit("reset", { w: size.width, h: size.height });
  }, [displayTransform.quarterTurns, measureAndFit]);

  // The video keeps its source dimensions; rotation itself swaps the visual
  // bounding box. The rotated dimensions are used only by the fit calculation.
  const displayW =
    sourceNatural.w > 0 ? sourceNatural.w * view.scale : undefined;
  const displayH =
    sourceNatural.h > 0 ? sourceNatural.h * view.scale : undefined;
  const videoStyle =
    displayW !== undefined && displayH !== undefined
      ? {
          width: displayW,
          height: displayH,
          maxWidth: "none",
          maxHeight: "none",
          transform: `translate(${view.x}px, ${view.y}px) ${viewerDisplayTransformCss(displayTransform)}`,
          transformOrigin: "center center",
        }
      : undefined;

  return (
    <div className="preview-video-stage">
      <div
        className="preview-video-viewport is-pannable"
        ref={viewportRef}
        {...viewportPointerHandlers}
      >
        <video
          autoPlay
          className="preview-video"
          onDurationChange={(event) =>
            setDuration(event.currentTarget.duration || 0)
          }
          onEnded={() => setPaused(true)}
          onError={onError}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            video.playbackRate = playbackRate;
            setDuration(video.duration || 0);
            setSourceNatural({ w: video.videoWidth, h: video.videoHeight });
            const size = viewerDisplaySize(
              video.videoWidth,
              video.videoHeight,
              displayTransform.quarterTurns,
            );
            measureAndFit("reset", { w: size.width, h: size.height });
            onReady?.();
          }}
          onPause={() => setPaused(true)}
          onPlay={() => setPaused(false)}
          onSeeked={() => {
            seekSessionRef.current?.onSeeked();
            if (scrubbingPointerId.current === null && videoRef.current) {
              setCurrentTime(videoRef.current.currentTime);
            }
          }}
          onTimeUpdate={(event) => {
            if (scrubbingPointerId.current !== null) return;
            setCurrentTime(event.currentTarget.currentTime);
          }}
          poster={posterUrl}
          preload="auto"
          ref={videoRef}
          src={src}
          style={videoStyle}
        >
          {t("preview.videoUnsupported")}
        </video>
      </div>
      <div className="preview-video-controls preview-chrome-fade">
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
          {formatVideoClockTime(displayTime)}
        </span>
        <div
          aria-label={t("preview.videoScrubAria")}
          aria-valuemax={Math.round(duration)}
          aria-valuemin={0}
          aria-valuenow={Math.round(displayTime)}
          className="preview-video-track"
          onKeyDown={(event) => {
            const video = videoRef.current;
            if (!video) return;
            let nextTime: number | null = null;
            if (event.key === "ArrowLeft") {
              nextTime = clampScrubTime(
                video.currentTime - SCRUB_STEP_SECONDS,
                duration,
              );
            } else if (event.key === "ArrowRight") {
              nextTime = clampScrubTime(
                video.currentTime + SCRUB_STEP_SECONDS,
                duration,
              );
            } else if (event.key === "Home") {
              nextTime = 0;
            } else if (event.key === "End") {
              nextTime = clampScrubTime(duration, duration);
            }
            if (nextTime === null) return;
            event.preventDefault();
            seekSessionRef.current?.commit(nextTime);
            setCurrentTime(nextTime);
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            // preventDefault suppresses the browser's implicit mousedown
            // focus, so focus explicitly to keep arrow-key seeking working.
            event.currentTarget.focus();
            scrubbingPointerId.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
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
            // Sync display state immediately so the thumb doesn't flicker
            // back to the pre-drag position while waiting for the next
            // native `timeupdate` tick.
            if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onPointerCancel={(event) => {
            if (scrubbingPointerId.current !== event.pointerId) return;
            scrubbingPointerId.current = null;
            setScrubRatio(null);
            seekSessionRef.current?.flush();
            if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
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
        <span aria-hidden="true" className="preview-video-time">
          {formatVideoClockTime(duration)}
        </span>
        <button
          className="preview-video-rate"
          onClick={() => {
            applyPlaybackRate(
              stepVideoPlaybackRate(playbackRateRef.current, "faster"),
            );
          }}
          tabIndex={VIEWER_CHROME_TAB_INDEX}
          type="button"
          {...iconActionAttrs(
            `${t("preview.playbackRate")}: ${t("preview.playbackRateOption", {
              rate: playbackRate,
            })}`,
          )}
        >
          {t("preview.playbackRateOption", { rate: playbackRate })}
        </button>
        <ViewerVolumeControls
          muted={muted}
          onInteract={onUserActivity}
          onMutedChange={onMutedChange}
          onVolumeChange={onVolumeChange}
          volume={volume}
        />
        <button
          className="preview-video-fit"
          onClick={fitToWindow}
          tabIndex={VIEWER_CHROME_TAB_INDEX}
          type="button"
          {...iconActionAttrs(t("preview.fitWindow"))}
        >
          <Icon name="fit-window" size={14} />
        </button>
        <button
          className="preview-video-fullscreen"
          onClick={onFullscreen}
          tabIndex={VIEWER_CHROME_TAB_INDEX}
          type="button"
          {...iconActionAttrs(
            isFullscreen ? t("preview.exitFullscreen") : t("preview.fullscreen"),
          )}
        >
          <Icon name={isFullscreen ? "fullscreen-exit" : "fullscreen"} size={14} />
        </button>
      </div>
    </div>
  );
}
