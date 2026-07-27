import { useEffect, useState } from "react";

import type { ImageSequenceSummary } from "../shared/asset-types";
import type { PreviewResolution } from "../shared/library-api";
import { coverSrc } from "./asset-card-hover-preview";
import { resolveLivePreviewMedia } from "./asset-card-hover-preview";
import { SequenceFrameCanvas } from "./SequenceFrameCanvas";

interface AssetCardMediaProps {
  alt: string;
  /** Static thumbnail; shown whenever live preview is inactive or not ready. */
  coverUrl: string | null;
  isActive: boolean;
  preview: PreviewResolution | null;
  libraryId?: string;
  sequence?: ImageSequenceSummary | null;
}

/**
 * Grid card media: static cover by default; GIF/video play in-place when
 * active. Image sequences paint decoded thumbnails to a canvas so changing
 * frames never exposes an image loading gap.
 */
export function AssetCardMedia({
  alt,
  coverUrl,
  isActive,
  libraryId,
  preview,
  sequence,
}: AssetCardMediaProps) {
  const isSequence =
    Boolean(sequence) && (sequence?.frameCount ?? 0) >= 3 && Boolean(libraryId);
  const live = resolveLivePreviewMedia(isActive && !isSequence, preview);
  const [sequenceFrame, setSequenceFrame] = useState(0);

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
    const sequenceUrl = sequence.frames[0]?.thumbnailArtifactId
      ? coverSrc(libraryId, sequence.frames[0].thumbnailArtifactId)
      : coverUrl;
    if (!isActive) {
      return (
        <div className="asset-card-media">
          {sequenceUrl ? (
            <img
              alt={alt}
              className="asset-thumbnail"
              loading="lazy"
              src={sequenceUrl}
            />
          ) : null}
        </div>
      );
    }
    return (
      <div className="asset-card-media">
        {sequenceUrl ? (
          <img
            alt={alt}
            className="asset-thumbnail sequence-card-cover-hidden"
            src={sequenceUrl}
          />
        ) : null}
        <SequenceFrameCanvas
          alt={alt}
          fallbackUrl={sequenceUrl}
          frameIndex={sequenceFrame % sequence.frames.length}
          frames={sequence.frames}
          libraryId={libraryId}
        />
      </div>
    );
  }

  return (
    <div className="asset-card-media">
      {coverUrl ? (
        <img
          alt={alt}
          className="asset-thumbnail"
          loading="lazy"
          src={coverUrl}
        />
      ) : null}
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
          muted
          playsInline
          poster={preview?.posterUrl}
          preload="metadata"
          src={live.url}
        />
      ) : null}
    </div>
  );
}
