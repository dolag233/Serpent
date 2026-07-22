/**
 * Masonry visual order for Shift-range selection (Serpent-oz1t).
 */

import type { AssetSummary } from '../shared/asset-types';
import {
  countFittingColumns,
  masonryVisualReadingOrderIds,
} from './asset-grid-layout';
import { estimateMasonryPreviewHeightPx } from './masonry-preview-frame';

export function computeMasonrySelectionAssetIds(
  assets: readonly AssetSummary[],
  availableWidthPx: number,
  cardSize: number,
  showCaption: boolean,
): string[] {
  if (assets.length === 0) return [];
  if (availableWidthPx <= 0) {
    return assets.map((asset) => asset.assetId);
  }
  const columnCount = countFittingColumns(availableWidthPx, cardSize);
  return masonryVisualReadingOrderIds(
    assets,
    columnCount,
    (asset) => {
      const previewHeight = estimateMasonryPreviewHeightPx(
        asset.width,
        asset.height,
        cardSize,
      );
      return previewHeight + (showCaption ? 42 : 0) + 12;
    },
    (asset) => asset.assetId,
  );
}
