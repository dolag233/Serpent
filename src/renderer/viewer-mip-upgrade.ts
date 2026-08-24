/**
 * Viewer mip-style placeholder → full-image upgrade (Serpent-eh07).
 *
 * When left/right switching, IO for the original may lag. If a ready thumbnail
 * exists, present it immediately, then quietly swap once the full source has
 * actually decoded (naturalWidth > 0).
 */

import type { AssetSummary } from "../shared/asset-types";

export function resolveViewerPlaceholderUrl(
  asset: Pick<
    AssetSummary,
    "displayName" | "mediaType" | "thumbnailStatus" | "thumbnailArtifactId"
  >,
  libraryId: string,
): string | null {
  // Documents use the same ready thumbnail artifact as images. Keeping the
  // policy here lets the PDF surface paint an existing page thumbnail while
  // pdf.js is still importing and reading the source document.
  if (asset.mediaType === "document") {
    // The document media type also covers HTML, whose thumbnail must stay on
    // the HTML viewer path. The extension is the only document discriminator
    // available before requestPreview resolves its MIME type.
    if (!asset.displayName.toLowerCase().endsWith(".pdf")) return null;
  } else if (asset.mediaType !== "image") {
    return null;
  }
  if (asset.thumbnailStatus !== "ready" || !asset.thumbnailArtifactId) {
    return null;
  }
  return `serpent://preview/${libraryId}/${asset.thumbnailArtifactId}`;
}

export type ViewerImageDisplay = {
  /** URL currently shown in the viewport. */
  readonly displayUrl: string | null;
  /** Full URL is loading while placeholder remains visible. */
  readonly upgrading: boolean;
  /** Which layer is on screen. */
  readonly layer: "none" | "placeholder" | "full";
};

/**
 * Pick what to paint. Prefer a decoded full image; otherwise keep the
 * placeholder so navigation never flashes an empty pane.
 */
export function resolveViewerImageDisplay(input: {
  readonly placeholderUrl: string | null;
  readonly fullUrl: string | null | undefined;
  readonly fullDecoded: boolean;
}): ViewerImageDisplay {
  const full = input.fullUrl?.trim() ? input.fullUrl : null;
  const placeholder = input.placeholderUrl?.trim()
    ? input.placeholderUrl
    : null;

  if (full && input.fullDecoded) {
    return { displayUrl: full, upgrading: false, layer: "full" };
  }
  if (placeholder) {
    return {
      displayUrl: placeholder,
      upgrading: Boolean(full && full !== placeholder),
      layer: "placeholder",
    };
  }
  if (full) {
    // No thumbnail — show full URL while it decodes (may briefly blank).
    return { displayUrl: full, upgrading: !input.fullDecoded, layer: "full" };
  }
  return { displayUrl: null, upgrading: false, layer: "none" };
}

/** True when an HTMLImageElement has proven pixel decode. */
export function isDecodedImage(image: {
  readonly complete: boolean;
  readonly naturalWidth: number;
}): boolean {
  return image.complete && image.naturalWidth > 0;
}

/**
 * Whether the viewer should treat the surface as presentable before the
 * full `requestPreview` round-trip returns (image + ready thumbnail).
 */
export function canPresentViewerPlaceholder(
  asset: Pick<AssetSummary, "displayName" | "mediaType" | "thumbnailStatus" | "thumbnailArtifactId">,
  libraryId: string,
): boolean {
  return resolveViewerPlaceholderUrl(asset, libraryId) !== null;
}
