/**
 * Justified (flat/tiled) row height must reserve the real caption band.
 * If the reserved band is shorter than the rendered caption, flex shrinks the
 * preview while slot widths still assume the full image height — causing
 * horizontal letterboxing (Serpent-omn / CANVAS-026).
 *
 * Values mirror `.justified-card-slot .asset-caption` in styles.css.
 */

/** Padding-top override on justified captions (base caption uses 7px). */
export const JUSTIFIED_CAPTION_PAD_TOP_PX = 4;
export const JUSTIFIED_CAPTION_PAD_BOTTOM_PX = 8;
export const JUSTIFIED_CAPTION_GAP_PX = 3;

/** `.asset-dimensions`: 11px / line-height 1.2 */
export const JUSTIFIED_CAPTION_DIMENSIONS_LINE_PX = Math.ceil(11 * 1.2);
/** `.asset-caption strong`: 11px, nowrap name */
export const JUSTIFIED_CAPTION_NAME_LINE_PX = Math.ceil(11 * 1.2);
/** `.asset-caption span` meta (size · date): 9px; ~1.25 effective line box */
export const JUSTIFIED_CAPTION_SECONDARY_LINE_PX = Math.ceil(9 * 1.25);

export type JustifiedCaptionLines = {
  /** Grid mode always shows「宽 × 高」when metadata exists. */
  dimensions: boolean;
  name: boolean;
  /** Size/date row, search snippet, or trashed-from path. */
  secondary: boolean;
};

/**
 * Pixel height to add under the justified image row so preview flex space
 * matches `layoutJustifiedRows` placement heights.
 */
export function resolveJustifiedCaptionBandPx(
  lines: JustifiedCaptionLines,
): number {
  const heights: number[] = [];
  if (lines.dimensions) heights.push(JUSTIFIED_CAPTION_DIMENSIONS_LINE_PX);
  if (lines.name) heights.push(JUSTIFIED_CAPTION_NAME_LINE_PX);
  if (lines.secondary) heights.push(JUSTIFIED_CAPTION_SECONDARY_LINE_PX);
  if (heights.length === 0) return 0;

  const content = heights.reduce((sum, h) => sum + h, 0);
  const gaps = (heights.length - 1) * JUSTIFIED_CAPTION_GAP_PX;
  return (
    JUSTIFIED_CAPTION_PAD_TOP_PX +
    content +
    gaps +
    JUSTIFIED_CAPTION_PAD_BOTTOM_PX
  );
}
