/**
 * Masonry card preview sizing for extreme portrait assets (Serpent-woa).
 *
 * Natural width/height aspect is preserved via CSS `aspect-ratio`, but without a
 * max height a 230×512 card in a ~160–280px column becomes hundreds of px tall,
 * visually crowding the caption and making rounded corners harder to read.
 * Cap the preview box; `object-fit: contain` keeps the full frame visible.
 */

/** Matches the visual budget used in styles for tall masonry previews. */
export const MASONRY_PREVIEW_MAX_HEIGHT_PX = 420;

export function estimateMasonryPreviewHeightPx(
  width: number | null | undefined,
  height: number | null | undefined,
  columnWidthPx: number,
  maxHeightPx: number = MASONRY_PREVIEW_MAX_HEIGHT_PX,
): number {
  const col = Number.isFinite(columnWidthPx) && columnWidthPx > 0 ? columnWidthPx : 0;
  const maxH = Number.isFinite(maxHeightPx) && maxHeightPx > 0 ? maxHeightPx : MASONRY_PREVIEW_MAX_HEIGHT_PX;
  if (!width || !height || width <= 0 || height <= 0 || col <= 0) {
    return Math.min(col > 0 ? col * 0.72 : maxH * 0.72, maxH);
  }
  return Math.min(col * (height / width), maxH);
}

/** Inline style for `.asset-preview` in masonry when pixel dimensions exist. */
export function resolveMasonryPreviewStyle(
  width: number | null | undefined,
  height: number | null | undefined,
  maxHeightPx: number = MASONRY_PREVIEW_MAX_HEIGHT_PX,
): { aspectRatio: string; maxHeight: number } | undefined {
  if (!width || !height || width <= 0 || height <= 0) return undefined;
  return {
    aspectRatio: `${width} / ${height}`,
    maxHeight: maxHeightPx,
  };
}
