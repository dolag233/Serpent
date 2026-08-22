/**
 * Auto-palette eligibility for assets that have visual content.
 * Documents are currently PDF/HTML, and models are the supported 3D formats.
 */

export type AssetMediaType = "image" | "video" | "audio" | "text" | "model" | "document" | "other";

/** True when a single asset media kind may produce or show an auto palette. */
export function mediaTypeSupportsAutoPalette(
  mediaType: AssetMediaType | null | undefined,
): boolean {
  return (
    mediaType === "image"
    || mediaType === "video"
    || mediaType === "model"
    || mediaType === "document"
  );
}

/**
 * True when the Inspector (or any palette entry) should render the palette section.
 * Empty selection or any non-visual member hides chrome — including pending-extract help.
 */
export function shouldShowAutoPaletteSection(
  mediaTypes: readonly (AssetMediaType | null | undefined)[],
): boolean {
  if (mediaTypes.length === 0) {
    return false;
  }
  return mediaTypes.every((mediaType) => mediaTypeSupportsAutoPalette(mediaType));
}
