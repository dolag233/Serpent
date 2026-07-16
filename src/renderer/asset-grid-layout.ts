/** Gap between asset cards / masonry columns (matches `.asset-grid` CSS). */
export const ASSET_GRID_GAP_PX = 12;

export type AssetViewMode = "grid" | "masonry";

export type AssetGridLayoutStyle =
  | { gridTemplateColumns: string }
  | Record<string, never>;

export interface DistributedMasonryColumn<T> {
  items: T[];
  estimatedHeightPx: number;
}

/** Keep card size and the number of grid/masonry columns driven by one value. */
export function assetGridLayoutStyle(
  viewMode: AssetViewMode,
  cardSize: number,
): AssetGridLayoutStyle {
  const size = Math.round(cardSize);
  if (viewMode === "masonry") return {};
  return {
    gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))`,
  };
}

export function countFittingColumns(
  availableWidthPx: number,
  cardSize: number,
  gapPx: number = ASSET_GRID_GAP_PX,
): number {
  const size = Math.round(cardSize);
  if (availableWidthPx <= 0 || size <= 0) return 1;
  return Math.max(1, Math.floor((availableWidthPx + gapPx) / (size + gapPx)));
}

export function leftoverWidthPx(
  availableWidthPx: number,
  cardSize: number,
  gapPx: number = ASSET_GRID_GAP_PX,
): number {
  const size = Math.round(cardSize);
  const columns = countFittingColumns(availableWidthPx, size, gapPx);
  const used = columns * size + Math.max(0, columns - 1) * gapPx;
  return availableWidthPx - used;
}

/**
 * Partitions masonry items into explicit columns while preserving the visual
 * expectation that the first row fills from left to right.
 *
 * CSS multi-column layout flows top-to-bottom before it advances horizontally,
 * which is why a small folder can appear as one tall stack at the far left.
 * An explicit-column renderer can use this result instead: the first
 * `columnCount` items seed consecutive columns, then later items go to the
 * currently shortest column (ties resolve left-to-right).
 *
 * `estimateHeightPx` should include the whole card height (preview, optional
 * caption, and any vertical gap the renderer wants to account for). Keeping
 * that estimate injectable makes this helper independent from React and from
 * the current card presentation.
 */
export function distributeMasonryItems<T>(
  items: readonly T[],
  columnCount: number,
  estimateHeightPx: (item: T, index: number) => number,
): DistributedMasonryColumn<T>[] {
  const safeColumnCount = Number.isFinite(columnCount)
    ? Math.max(1, Math.floor(columnCount))
    : 1;
  const columns = Array.from({ length: safeColumnCount }, () => ({
    items: [] as T[],
    estimatedHeightPx: 0,
  }));

  items.forEach((item, index) => {
    let targetColumnIndex = index;
    if (targetColumnIndex >= safeColumnCount) {
      targetColumnIndex = 0;
      for (let candidate = 1; candidate < safeColumnCount; candidate += 1) {
        if (
          columns[candidate]!.estimatedHeightPx <
          columns[targetColumnIndex]!.estimatedHeightPx
        ) {
          targetColumnIndex = candidate;
        }
      }
    }

    const target = columns[targetColumnIndex]!;
    target.items.push(item);
    const estimatedHeight = estimateHeightPx(item, index);
    if (Number.isFinite(estimatedHeight) && estimatedHeight > 0) {
      target.estimatedHeightPx += estimatedHeight;
    }
  });

  return columns;
}
