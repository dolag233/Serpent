import { useEffect, useState } from "react";

import type { ImageSequenceSummary } from "../shared/asset-types";
import type { PreviewResolution } from "../shared/library-api";
import {
  resolveLivePreviewMedia,
  resolveLiveVideoMuted,
  shouldPlayLiveAudio,
} from "./asset-card-hover-preview";
import { Icon } from "./Icons";
import { SequenceFrameCanvas } from "./SequenceFrameCanvas";
import { resolveSequenceFrameUrl } from "./sequence-frame-preview";

interface AssetCardMediaProps {
  alt: string;
  /** Static thumbnail; shown whenever live preview is inactive or not ready. */
  coverUrl: string | null;
  /**
   * Virtual browse windows render only the current viewport and its small
   * overscan band. Those cards can ask Chromium to start decoding immediately
   * without recreating the old eager-load storm from the full-page layout.
   */
  loadImmediately?: boolean;
  /**
   * Virtual windows keep a large scroll-continuity runway mounted. Do not put
   * a media URL on those off-screen cards: Chromium's native lazy threshold is
   * large enough to start source-direct requests several screens early.
   */
  deferUntilVisible?: boolean;
  isActive: boolean;
  /**
   * Whether this card is under the pointer. Sound-bearing live previews
   * (audio play, video sound) only run on hover — primary selection keeps
   * the silent video preview and never plays audio (Serpent hover 音频工单).
   */
  hovering?: boolean;
  preview: PreviewResolution | null;
  libraryId?: string;
  sequence?: ImageSequenceSummary | null;
  /** Serpent-2ajm: generation failed — show the cracked-file icon fallback. */
  failed?: boolean;
  /** Audio assets play in-place on hover (Serpent hover 音频工单). */
  hoverAudioPlay?: boolean;
  /** Video hover preview plays sound (defaults to muted). */
  hoverVideoSound?: boolean;
  /** Linear gain 0..1, carried over from the viewer volume preference. */
  mediaVolume?: number;
  /** Muted flag carried over from the viewer volume preference. */
  mediaMuted?: boolean;
  /**
   * Live video failed to play in-place (Serpent-c8a1a3). The card calls this
   * so the hover controller can request a WebM proxy fallback; the failed
   * source stays mounted with its poster until the next hover resolves.
   */
  onLiveVideoError?: () => void;
}

/**
 * Grid card media: static cover by default; GIF/video/audio play in-place when
 * active. Image sequences paint decoded thumbnails to a canvas so changing
 * frames never exposes an image loading gap.
 */
export function AssetCardMedia({
  alt,
  coverUrl,
  loadImmediately = false,
  deferUntilVisible = false,
  isActive,
  hovering = false,
  libraryId,
  preview,
  sequence,
  failed = false,
  hoverAudioPlay = true,
  hoverVideoSound = false,
  mediaVolume = 1,
  mediaMuted = false,
  onLiveVideoError,
}: AssetCardMediaProps) {
  const isSequence =
    Boolean(sequence) && (sequence?.frameCount ?? 0) >= 3 && Boolean(libraryId);
  const shouldLoadCover =
    !deferUntilVisible || loadImmediately || isActive || hovering;
  const live = resolveLivePreviewMedia(isActive && !isSequence, preview);
  const [sequenceFrame, setSequenceFrame] = useState(0);
  // Serpent-2ajm: a failed image load must never paint the browser's broken
  // image glyph — fall back to the themed file/cracked icon instead.
  const [errored, setErrored] = useState(false);
  const fallbackIcon = (
    <Icon name={failed ? "broken-file" : "file"} size={28} />
  );

  useEffect(() => {
    if (!isActive || !isSequence || !sequence) return;
    const timer = window.setInterval(
      () =>
        setSequenceFrame((current) => (current + 1) % sequence.frames.length),
      1000 / Math.max(1, sequence.fps),
    );
    return () => window.clearInterval(timer);
  }, [isActive, isSequence, sequence]);

  if (isSequence && sequence && libraryId) {
    const sequenceUrl = sequence.frames[0]
      ? (resolveSequenceFrameUrl(libraryId, sequence.frames[0]) ?? coverUrl)
      : coverUrl;
    const visibleSequenceUrl = shouldLoadCover ? sequenceUrl : null;
    if (!isActive) {
      return (
        <div className="asset-card-media">
          {visibleSequenceUrl && !errored ? (
            <img
              alt={alt}
              className="asset-thumbnail"
              decoding="async"
              fetchPriority={loadImmediately ? "high" : "auto"}
              loading={loadImmediately ? "eager" : "lazy"}
              onError={() => setErrored(true)}
              src={visibleSequenceUrl}
            />
          ) : (
            fallbackIcon
          )}
        </div>
      );
    }
    return (
      <div className="asset-card-media">
        {visibleSequenceUrl && !errored ? (
          <img
            alt={alt}
            className="asset-thumbnail sequence-card-cover-hidden"
            onError={() => setErrored(true)}
            src={visibleSequenceUrl}
          />
        ) : (
          fallbackIcon
        )}
        <SequenceFrameCanvas
          alt={alt}
          fallbackUrl={visibleSequenceUrl}
          frameIndex={sequenceFrame % sequence.frames.length}
          frames={sequence.frames}
          libraryId={libraryId}
        />
      </div>
    );
  }

  const visibleCoverUrl = shouldLoadCover ? coverUrl : null;
  return (
    <div className="asset-card-media">
      {visibleCoverUrl && !errored ? (
        <img
          alt={alt}
          className="asset-thumbnail"
          decoding="async"
          fetchPriority={loadImmediately ? "high" : "auto"}
          loading={loadImmediately ? "eager" : "lazy"}
          onError={() => setErrored(true)}
          src={visibleCoverUrl}
        />
      ) : (
        fallbackIcon
      )}
      {live.kind === "gif" && live.url ? (
        <img
          alt=""
          className="asset-card-media-live"
          decoding="async"
          src={live.url}
        />
      ) : null}
      {live.kind === "video" && live.url ? (
        <video
          autoPlay
          className="asset-card-media-live"
          loop
          muted={resolveLiveVideoMuted({
            hovering,
            hoverVideoSound,
            mediaMuted,
          })}
          onError={() => onLiveVideoError?.()}
          playsInline
          poster={preview?.posterUrl}
          preload="metadata"
          // volume is a DOM property, not a JSX attribute — set it via ref.
          ref={(element) => {
            if (element) element.volume = mediaVolume;
          }}
          src={live.url}
        />
      ) : null}
      {live.kind === "audio" && live.url && shouldPlayLiveAudio({ hovering, hoverAudioPlay }) ? (
        <audio
          autoPlay
          className="asset-card-media-live"
          loop
          muted={mediaMuted}
          preload="metadata"
          ref={(element) => {
            if (element) element.volume = mediaVolume;
          }}
          src={live.url}
        />
      ) : null}
    </div>
  );
}
