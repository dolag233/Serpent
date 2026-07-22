/**
 * Folder card width aligned to masonry column tracks (Serpent-l67w).
 *
 * Masonry uses `repeat(N, minmax(0, 1fr))` after choosing N from the preferred
 * card size, so the painted column width is the flush-packed size — not the
 * raw slider value (which may leave leftover distributed by `1fr`).
 */

import {
  ASSET_GRID_GAP_PX,
  countFittingColumns,
} from "./asset-grid-layout";
import { cardSizeFillingColumns } from "./card-size-stops";

/** Horizontal padding on `.folder-card-row` / `.asset-grid` (each side). */
export const FOLDER_CARD_ROW_INLINE_PADDING_PX = 16;

export function masonryAlignedFolderWidthPx(
  availableWidthPx: number,
  preferredCardSizePx: number,
  gapPx: number = ASSET_GRID_GAP_PX,
): number {
  if (!(availableWidthPx > 0) || !(preferredCardSizePx > 0)) {
    return Math.max(1, Math.round(preferredCardSizePx) || 1);
  }
  const columns = countFittingColumns(
    availableWidthPx,
    preferredCardSizePx,
    gapPx,
  );
  return cardSizeFillingColumns(availableWidthPx, columns, gapPx);
}

/** Content-box width for a padded row (matches masonry measure inside `.asset-grid`). */
export function elementContentBoxWidthPx(element: HTMLElement): number {
  const style = getComputedStyle(element);
  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(style.paddingRight) || 0;
  return Math.max(0, element.clientWidth - paddingLeft - paddingRight);
}
