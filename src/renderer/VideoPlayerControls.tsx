import { useEffect, useRef, useState, type SyntheticEvent } from "react";

import { useT } from "./i18n";
import {
  nextPlaybackIntent,
  parsePlaybackRate,
  shouldHandleVideoSpaceKey,
  VIDEO_PLAYBACK_RATES,
  type VideoPlaybackRate,
} from "./video-player-controls";

export interface VideoPlayerControlsProps {
  onError(event: SyntheticEvent<HTMLVideoElement>): void;
  onFullscreen(): void;
  onReady?(): void;
  posterUrl?: string;
  src: string;
}

/**
 * Thin custom chrome around native HTMLVideoElement controls:
 * - native transport + scrubber (Chromium scrub is reliable in Electron)
 * - Space play/pause when the viewer is focused (not in text fields)
 * - playback rate select
 */
export function VideoPlayerControls({
  onError,
  onFullscreen,
  onReady,
  posterUrl,
  src,
}: VideoPlayerControlsProps) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackRate, setPlaybackRate] = useState<VideoPlaybackRate>(1);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!shouldHandleVideoSpaceKey(event)) return;
      const video = videoRef.current;
      if (!video) return;
      event.preventDefault();
      event.stopPropagation();
      if (nextPlaybackIntent(video.paused) === "play") {
        void video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = playbackRate;
  }, [playbackRate, src]);

  return (
    <div className="preview-video-stage">
      <video
        autoPlay
        className="preview-video"
        controls
        onError={onError}
        onLoadedMetadata={() => {
          if (videoRef.current) videoRef.current.playbackRate = playbackRate;
          onReady?.();
        }}
        poster={posterUrl}
        preload="metadata"
        ref={videoRef}
        src={src}
      >
        {t("preview.videoUnsupported")}
      </video>
      <label className="preview-speed-control preview-chrome-fade">
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
      <button
        className="preview-fullscreen-chip preview-chrome-fade"
        onClick={onFullscreen}
        type="button"
      >
        {t("preview.fullscreen")}
      </button>
    </div>
  );
}
