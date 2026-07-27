import { useEffect, useState } from "react";

import type { ImageSequenceSummary } from "../shared/asset-types";
import type { PreviewResolution } from "../shared/library-api";
import { coverSrc } from "./asset-card-hover-preview";
import { resolveLivePreviewMedia } from "./asset-card-hover-preview";

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
 * Grid card media: static cover by default; GIF/video play in-place when this
 * card is the single active hover/selection preview.
 */
export function AssetCardMedia({
  alt,
  coverUrl,
  isActive,
  libraryId,
  preview,
  sequence,
}: AssetCardMediaProps) {
  const live = resolveLivePreviewMedia(isActive, preview);
  const [sequenceFrame, setSequenceFrame] = useState(0);
  useEffect(() => {
    if (!isActive || !sequence) return;
    const timer = window.setInterval(
      () =>
        setSequenceFrame((current) => (current + 1) % sequence.frames.length),
      1000 / sequence.fps,
    );
    return () => window.clearInterval(timer);
  }, [isActive, sequence]);
  const visibleSequenceFrame =
    isActive && sequence ? sequenceFrame % sequence.frames.length : 0;
  const sequenceArtifact =
    isActive && sequence
      ? sequence.frames[visibleSequenceFrame]?.thumbnailArtifactId
      : null;
  const sequenceUrl =
    sequenceArtifact && libraryId
      ? coverSrc(libraryId, sequenceArtifact)
      : null;

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
      {sequenceUrl ? (
        <img
          alt=""
          className="asset-card-media-live"
          decoding="async"
          src={sequenceUrl}
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
