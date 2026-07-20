import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";

import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { createMediaSeekSession, type MediaSeekSession } from "./media-seek-session";
import { useViewerZoomPan } from "./use-viewer-zoom-pan";
import {
  clampScrubTime,
  formatVideoClockTime,
  nextPlaybackIntent,
  parsePlaybackRate,
  scrubRatioFromClientX,
  scrubRatioFromTime,
  scrubTimeFromRatio,
  shouldHandleVideoSpaceKey,
  VIDEO_PLAYBACK_RATES,
  type VideoPlaybackRate,
} from "./video-player-controls";

export interface VideoPlayerControlsProps {
  isFullscreen?: boolean;
  onError(event: SyntheticEvent<HTMLVideoElement>): void;
  onFullscreen(): void;
  onReady?(): void;
  onSwipeNext?: () => void;
  onSwipePrevious?: () => void;
  posterUrl?: string;
  src: string;
}

const SCRUB_STEP_SECONDS = 5;

/**
 * Fully custom chrome around `HTMLVideoElement` (REQ-VIEW-005 / Serpent-60k):
 * - Space play/pause when the viewer is focused (not in text fields)
 * - scrubbable progress track (mousedown / drag / click / arrow keys)
 * - playback rate select
 *
 * See `video-player-controls.ts` for why this replaced native
 * `<video controls>` rather than layering on top of it.
 * Seek/scrub uses `createMediaSeekSession` so Range fetches are not cancelled
 * on every pointermove (Serpent-jh2).
 */
export function VideoPlayerControls({
  isFullscreen = false,
  onError,
  onFullscreen,
  onReady,
  onSwipeNext,
  onSwipePrevious,
  posterUrl,
  src,
}: VideoPlayerControlsProps) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  // Zoom/pan/fit mirrors the image viewer (Serpent-190). No F/Space fit
  // keybind here: Space toggles playback, and D/F are reserved for video
  // frame stepping (Serpent-sk1).
  const {
    fitToWindow,
    measureAndFit,
    natural,
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
  const [scrubRatio, setScrubRatio] = useState<number | null>(null);

  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (nextPlaybackIntent(video.paused) === "play") {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
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

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = playbackRate;
  }, [playbackRate, src]);

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

  const displayW = natural.w > 0 ? natural.w * view.scale : undefined;
  const displayH = natural.h > 0 ? natural.h * view.scale : undefined;
  const videoStyle =
    displayW !== undefined && displayH !== undefined
      ? {
          width: displayW,
          height: displayH,
          maxWidth: "none",
          maxHeight: "none",
          transform: `translate(${view.x}px, ${view.y}px)`,
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
            measureAndFit("reset", {
              w: video.videoWidth,
              h: video.videoHeight,
            });
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
        <span aria-hidden="true" className="preview-video-time">
          {formatVideoClockTime(duration)}
        </span>
        <label className="preview-video-rate">
          {t("preview.playbackRate")}
          <select
            aria-label={t("preview.playbackRateAria")}
            onChange={(event) => {
              setPlaybackRate(parsePlaybackRate(event.target.value));
            }}
            value={playbackRate}
          >
            {VIDEO_PLAYBACK_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {t("preview.playbackRateOption", { rate })}
              </option>
            ))}
          </select>
        </label>
        {natural.w > 0 && (
          <span aria-hidden="true" className="preview-video-zoom-label">
            {Math.round(view.scale * 100)}%
          </span>
        )}
        <button
          className="preview-video-fit"
          onClick={fitToWindow}
          type="button"
          {...iconActionAttrs(t("preview.fitWindow"))}
        >
          <Icon name="fit-window" size={14} />
        </button>
        <button
          className="preview-video-fullscreen"
          onClick={onFullscreen}
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
