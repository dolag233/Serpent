import type { PreviewResolution } from "../shared/library-api";
import { resolveLivePreviewMedia } from "./asset-card-hover-preview";

interface AssetCardMediaProps {
  alt: string;
  /** Static thumbnail; shown whenever live preview is inactive or not ready. */
  coverUrl: string | null;
  isActive: boolean;
  preview: PreviewResolution | null;
}

/**
 * Grid card media: static cover by default; GIF/video play in-place when this
 * card is the single active hover/selection preview.
 */
export function AssetCardMedia({
  alt,
  coverUrl,
  isActive,
  preview,
}: AssetCardMediaProps) {
  const live = resolveLivePreviewMedia(isActive, preview);

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
