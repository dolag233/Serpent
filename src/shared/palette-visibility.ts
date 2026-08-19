/**
 * Auto-palette UI eligibility (Serpent-uz1).
 * Extraction may still run for cover-like artifacts; product chrome is image/video only.
 */

export type AssetMediaType = "image" | "video" | "audio" | "text" | "model" | "document" | "other";

/** True when a single asset media kind may show auto-palette chrome. */
export function mediaTypeSupportsAutoPalette(
  mediaType: AssetMediaType | null | undefined,
): boolean {
  return mediaType === "image" || mediaType === "video";
}

/**
 * True when the Inspector (or any palette entry) should render the palette section.
 * Empty selection or any non-image/video member hides chrome — including pending-extract help.
 */
export function shouldShowAutoPaletteSection(
  mediaTypes: readonly (AssetMediaType | null | undefined)[],
): boolean {
  if (mediaTypes.length === 0) {
    return false;
  }
  return mediaTypes.every((mediaType) => mediaTypeSupportsAutoPalette(mediaType));
}
