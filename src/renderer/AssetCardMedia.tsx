import type { PreviewResolution } from "../shared/library-api";

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
  const playUrl =
    isActive && preview?.status === "ready" ? preview.url : undefined;
  const showGif = Boolean(playUrl) && preview?.mediaType === "image";
  const showVideo = Boolean(playUrl) && preview?.mediaType === "video";

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
      {showGif && playUrl ? (
        <img
          alt=""
          className="asset-card-media-live"
          decoding="async"
          src={playUrl}
        />
      ) : null}
      {showVideo && playUrl && preview ? (
        <video
          autoPlay
          className="asset-card-media-live"
          loop
          muted
          playsInline
          poster={preview.posterUrl}
          preload="metadata"
          src={playUrl}
        />
      ) : null}
    </div>
  );
}
