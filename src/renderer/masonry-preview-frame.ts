/**
 * Masonry card preview sizing for portrait assets (Serpent-woa / Serpent-5p45).
 *
 * A masonry card owns the full width of its column. The preview must therefore
 * grow to the natural aspect-ratio height. Applying a fixed max-height while
 * keeping the column width creates a wider frame than the image; `contain`
 * then paints the exact horizontal letterbox reported on Windows.
 */

export function estimateMasonryPreviewHeightPx(
  width: number | null | undefined,
  height: number | null | undefined,
  columnWidthPx: number,
): number {
  const col = Number.isFinite(columnWidthPx) && columnWidthPx > 0 ? columnWidthPx : 0;
  if (col <= 0) return 1;
  if (!width || !height || width <= 0 || height <= 0) {
    return col * 0.72;
  }
  return col * (height / width);
}

/** Inline style for `.asset-preview` in masonry with usable dimensions. */
export function resolveMasonryPreviewStyle(
  width: number | null | undefined,
  height: number | null | undefined,
): { aspectRatio: string; maxHeight: "none" } | undefined {
  if (!width || !height || width <= 0 || height <= 0) return undefined;
  return {
    aspectRatio: `${width} / ${height}`,
    maxHeight: "none",
  };
}
