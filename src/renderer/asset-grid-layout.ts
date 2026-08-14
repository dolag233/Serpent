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
 * Partitions masonry items into explicit columns using shortest-column
 * packing. A round-robin split preserves array order in the columns, but
 * mixed portrait/landscape media can make one column several screens shorter
 * than its neighbours; at the bottom of the viewport that appears as a large
 * white slice (Serpent-1s3d). Stable shortest-column packing keeps the
 * columns visually balanced while the original asset array remains the
 * selection/browse order (Serpent-1jnp / SELECT-014).
 *
 * `estimateHeightPx` should include the whole card height (preview and
 * optional caption). The fixed inter-card gap is included when comparing
 * column loads, so a column with more cards is not systematically favoured.
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
    const target = columns.reduce((shortest, column) => {
      const shortestLoad =
        shortest.estimatedHeightPx +
        shortest.items.length * ASSET_GRID_GAP_PX;
      const columnLoad =
        column.estimatedHeightPx + column.items.length * ASSET_GRID_GAP_PX;
      return columnLoad < shortestLoad ? column : shortest;
    }, columns[0]!);
    target.items.push(item);
    const estimatedHeight = estimateHeightPx(item, index);
    if (Number.isFinite(estimatedHeight) && estimatedHeight > 0) {
      target.estimatedHeightPx += estimatedHeight;
    }
  });

  return columns;
}

/**
 * Shift-range ids for masonry: identical to asset array order (Serpent-1jnp).
 * Kept as a helper so callers/tests stay explicit about the 良序 contract.
 */
export function masonryVisualReadingOrderIds<T>(
  items: readonly T[],
  columnCount: number,
  estimateHeightPx: (item: T, index: number) => number,
  getId: (item: T) => string,
): string[] {
  // Distribution is round-robin; selection must follow the same array order
  // as 平铺 — do not re-sort by estimated geometry.
  void columnCount;
  void estimateHeightPx;
  return items.map((item) => getId(item));
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

/**
 * Pack aspect-ratio widths into integer CSS pixels that sum exactly to
 * `usableWidthPx` (Hamilton / largest-remainder). Fractional justified
 * slots jitter on Windows: Chromium re-snaps object-fit and glyph
 * baselines every frame at 125%/150% DPI (Serpent-oq86).
 */
export function distributeIntegerRowWidths(
  aspectRatios: readonly number[],
  rowHeightPx: number,
  usableWidthPx: number,
): number[] {
  const count = aspectRatios.length;
  if (count === 0) return [];
  const height = Math.max(1, Math.round(rowHeightPx));
  const usable = Math.max(count, Math.round(usableWidthPx));
  const raw = aspectRatios.map((aspect) => {
    const ratio =
      Number.isFinite(aspect) && aspect > 0 ? aspect : DEFAULT_ASPECT;
    return ratio * height;
  });
  const rawSum = raw.reduce((sum, width) => sum + width, 0);
  if (!(rawSum > 0)) {
    const widths = Array.from({ length: count }, () => 1);
    widths[count - 1] = Math.max(1, usable - (count - 1));
    return widths;
  }
  const scaled = raw.map((width) => (width / rawSum) * usable);
  const widths = scaled.map((width) => Math.max(0, Math.floor(width)));
  let leftover = usable - widths.reduce((sum, width) => sum + width, 0);
  const order = scaled
    .map((width, index) => ({ index, frac: width - Math.floor(width) }))
    .sort((left, right) => right.frac - left.frac);
  for (const { index } of order) {
    if (leftover <= 0) break;
    widths[index]! += 1;
    leftover -= 1;
  }
  for (let index = 0; index < count; index += 1) {
    if (widths[index]! >= 1) continue;
    const donor = widths.reduce(
      (best, width, candidate) => (width > widths[best]! ? candidate : best),
      0,
    );
    if (widths[donor]! > 1) {
      widths[donor]! -= 1;
      widths[index] = 1;
    } else {
      widths[index] = 1;
    }
  }
  return widths;
}

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
  const width = Math.max(0, Math.round(containerWidthPx));
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
    const withholdStretch =
      isLast && pending.length === 1 && scale > LAST_ROW_MAX_STRETCH;
    if (withholdStretch) {
      scale = 1;
    }
    const height = Math.max(1, Math.round(targetH * scale));
    const widths = withholdStretch
      ? pending.map((item) =>
          Math.max(1, Math.round(item.aspectRatio * height)),
        )
      : distributeIntegerRowWidths(
          pending.map((item) => item.aspectRatio),
          height,
          usable,
        );
    rows.push({
      height,
      items: pending.map((item, index) => ({
        id: item.id,
        width: widths[index] ?? 1,
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
