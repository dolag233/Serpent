/** Gap between asset cards / masonry columns (matches `.asset-grid` CSS). */
export const ASSET_GRID_GAP_PX = 14;

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
  // Grid mode uses justified rows (JustifiedAssetRows); masonry uses
  // explicit columns. Neither relies on CSS auto-fill tracks anymore.
  void cardSize;
  void viewMode;
  return {};
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

export type JustifiedLayoutItem = {
  id: string;
  /** width / height; missing metadata uses 1. */
  aspectRatio: number;
};

export type JustifiedPlacement = {
  id: string;
  width: number;
  height: number;
};

export type JustifiedRow = {
  height: number;
  items: JustifiedPlacement[];
};

const DEFAULT_ASPECT = 1;
/** Single leftover card: do not stretch to full width (looks like a banner). */
const LAST_ROW_MAX_STRETCH = 1.18;

export function aspectRatioForAsset(width: number | null, height: number | null): number {
  if (
    typeof width === "number" &&
    typeof height === "number" &&
    width > 0 &&
    height > 0
  ) {
    return width / height;
  }
  return DEFAULT_ASPECT;
}

/**
 * Justified contact-sheet rows: equal height within a row, preserve aspect
 * ratios, fill the container width (REQ-CANVAS-004 / Serpent-8nj).
 */
export function layoutJustifiedRows(
  items: readonly JustifiedLayoutItem[],
  containerWidthPx: number,
  targetRowHeightPx: number,
  gapPx: number = ASSET_GRID_GAP_PX,
): JustifiedRow[] {
  const width = Math.max(0, containerWidthPx);
  const targetH = Math.max(1, Math.round(targetRowHeightPx));
  if (width <= 0 || items.length === 0) return [];

  const rows: JustifiedRow[] = [];
  let pending: JustifiedLayoutItem[] = [];
  let aspectSum = 0;

  const flush = (isLast: boolean) => {
    if (pending.length === 0) return;
    const gaps = Math.max(0, pending.length - 1) * gapPx;
    const usable = Math.max(1, width - gaps);
    const naturalWidth = aspectSum * targetH;
    let scale = usable / naturalWidth;
    // Only withhold stretch for a lone leftover card; multi-item last rows
    // still fill the row like the contact-sheet reference.
    if (isLast && pending.length === 1 && scale > LAST_ROW_MAX_STRETCH) {
      scale = 1;
    }
    const height = Math.max(1, targetH * scale);
    rows.push({
      height,
      items: pending.map((item) => ({
        id: item.id,
        width: item.aspectRatio * height,
        height,
      })),
    });
    pending = [];
    aspectSum = 0;
  };

  for (const item of items) {
    const aspect =
      Number.isFinite(item.aspectRatio) && item.aspectRatio > 0
        ? item.aspectRatio
        : DEFAULT_ASPECT;
    const next = { id: item.id, aspectRatio: aspect };
    const nextAspectSum = aspectSum + aspect;
    const nextGaps = pending.length * gapPx;
    const nextNatural = nextAspectSum * targetH + nextGaps;

    if (pending.length > 0 && nextNatural > width) {
      flush(false);
    }
    pending.push(next);
    aspectSum += aspect;
  }
  flush(true);
  return rows;
}
