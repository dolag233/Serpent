import type { AssetSummary, BrowseLayoutEntry } from "../shared/asset-types";
import {
  ASSET_GRID_GAP_PX,
  aspectRatioForAsset,
  countFittingColumns,
  distributeMasonryItems,
  layoutJustifiedRows,
} from "./asset-grid-layout";
import {
  resolveJustifiedCaptionBandPx,
} from "./justified-caption-band";
import type {
  CanvasScrollOffset,
  CanvasViewport,
  MarqueeRect,
} from "./marquee-geometry";
import {
  rectsIntersect,
  viewportRectToContent,
} from "./marquee-geometry";
import { estimateMasonryPreviewHeightPx } from "./masonry-preview-frame";
import type { MasonryCardCenter } from "./masonry-selection-range";

const DEFAULT_JUSTIFIED_CAPTION_BAND_PX = resolveJustifiedCaptionBandPx({
  dimensions: true,
  name: true,
  secondary: true,
});

/**
 * Browse-session geometry is a snapshot. Live AssetSummary patches (image
 * header probe, video ffprobe) must win so cards reflow without a full reload
 * (Serpent-9c9f97).
 */
export function overlayLiveAssetGeometry(
  layout: readonly BrowseLayoutEntry[],
  assetsById: ReadonlyMap<string, Pick<AssetSummary, "width" | "height">>,
): BrowseLayoutEntry[] {
  if (layout.length === 0 || assetsById.size === 0) {
    return layout as BrowseLayoutEntry[];
  }
  let changed = false;
  const next = layout.map((entry) => {
    const asset = assetsById.get(entry.assetId);
    if (!asset) return entry;
    const width = asset.width ?? entry.width;
    const height = asset.height ?? entry.height;
    if (width === entry.width && height === entry.height) return entry;
    changed = true;
    return { ...entry, width, height };
  });
  return changed ? next : (layout as BrowseLayoutEntry[]);
}

export type CanvasAssetLayoutRect = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Sparse layout index used by very large BrowseSessions. It can enumerate all
 * centers for shift-selection, but marquee hits are restricted to the box's
 * local geometry range so no 100k-element rect array is retained.
 */
export type CanvasAssetLayoutIndex = {
  total: number;
  forEachIntersecting: (
    localBox: MarqueeRect,
    visit: (item: CanvasAssetLayoutRect) => void,
  ) => void;
  forEachAll: (visit: (item: CanvasAssetLayoutRect) => void) => void;
};

export const MASONRY_CAPTION_BAND_PX = 42;
/** Three caption rows: resolution, filename, and size/date. */
export const MASONRY_DIMENSIONS_CAPTION_BAND_PX = 56;

const publishedLayouts = new WeakMap<HTMLElement, readonly CanvasAssetLayoutRect[]>();
const publishedLayoutIndexes = new WeakMap<HTMLElement, CanvasAssetLayoutIndex>();

export function publishCanvasAssetLayout(
  element: HTMLElement,
  rects: readonly CanvasAssetLayoutRect[],
): void {
  publishedLayouts.set(element, rects);
  publishedLayoutIndexes.delete(element);
}

export function readPublishedCanvasAssetLayout(
  element: HTMLElement,
): readonly CanvasAssetLayoutRect[] | undefined {
  return publishedLayouts.get(element);
}

export function publishCanvasAssetLayoutIndex(
  element: HTMLElement,
  index: CanvasAssetLayoutIndex,
): void {
  publishedLayouts.delete(element);
  publishedLayoutIndexes.set(element, index);
}

export function readPublishedCanvasAssetLayoutIndex(
  element: HTMLElement,
): CanvasAssetLayoutIndex | undefined {
  return publishedLayoutIndexes.get(element);
}

export function masonryColumnWidthPx(
  availableWidth: number,
  columnCount: number,
  gapPx: number = ASSET_GRID_GAP_PX,
): number {
  const columns = Math.max(1, columnCount);
  if (!(availableWidth > 0)) return 0;
  return Math.max(1, (availableWidth - gapPx * (columns - 1)) / columns);
}

export function estimateMasonryCardBodyPx(
  asset: Pick<AssetSummary, "width" | "height">,
  columnWidthPx: number,
  showCaption: boolean,
  captionBandPx: number = MASONRY_CAPTION_BAND_PX,
): number {
  return (
    estimateMasonryPreviewHeightPx(asset.width, asset.height, columnWidthPx) +
    (showCaption ? Math.max(0, captionBandPx) : 0)
  );
}

export function stackItemHeights(bodies: readonly number[]): number[] {
  return bodies.map((body, index) =>
    index < bodies.length - 1
      ? body + ASSET_GRID_GAP_PX
      : Number.isFinite(body) && body > 0
        ? body
        : 1,
  );
}

export function layoutMasonryAssetRects(
  assets: readonly BrowseLayoutEntry[],
  availableWidth: number,
  cardSize: number,
  showCaption: boolean,
  captionBandPx: number = MASONRY_CAPTION_BAND_PX,
): CanvasAssetLayoutRect[] {
  const columnCount = countFittingColumns(availableWidth, cardSize);
  const columnWidth = masonryColumnWidthPx(availableWidth, columnCount);
  if (columnWidth <= 0 || assets.length === 0) return [];

  const columns = distributeMasonryItems(assets, columnCount, (asset) =>
    estimateMasonryCardBodyPx(asset, columnWidth, showCaption, captionBandPx),
  );

  const rects: CanvasAssetLayoutRect[] = [];
  columns.forEach((column, columnIndex) => {
    let y = 0;
    const x = columnIndex * (columnWidth + ASSET_GRID_GAP_PX);
    for (const asset of column.items) {
      const height = estimateMasonryCardBodyPx(
        asset,
        columnWidth,
        showCaption,
        captionBandPx,
      );
      rects.push({
        id: asset.assetId,
        x,
        y,
        width: columnWidth,
        height,
      });
      y += height + ASSET_GRID_GAP_PX;
    }
  });
  return rects;
}

export function layoutJustifiedAssetRects(
  assets: readonly BrowseLayoutEntry[],
  availableWidth: number,
  cardSize: number,
  captionBandPx: number = DEFAULT_JUSTIFIED_CAPTION_BAND_PX,
): CanvasAssetLayoutRect[] {
  if (!(availableWidth > 0) || assets.length === 0) return [];
  const rows = layoutJustifiedRows(
    assets.map((asset) => ({
      id: asset.assetId,
      aspectRatio: aspectRatioForAsset(asset.width, asset.height),
    })),
    availableWidth,
    cardSize,
    ASSET_GRID_GAP_PX,
  );
  const caption = Math.max(0, captionBandPx);
  const rects: CanvasAssetLayoutRect[] = [];
  let y = 0;
  for (const row of rows) {
    let x = 0;
    const height = row.height + caption;
    for (const item of row.items) {
      rects.push({
        id: item.id,
        x,
        y,
        width: item.width,
        height,
      });
      x += item.width + ASSET_GRID_GAP_PX;
    }
    y += height + ASSET_GRID_GAP_PX;
  }
  return rects;
}

export function hitTestCanvasAssetLayout(
  rects: readonly CanvasAssetLayoutRect[],
  box: MarqueeRect,
): string[] {
  const hits: string[] = [];
  for (const item of rects) {
    if (
      item.x < box.right &&
      item.x + item.width > box.left &&
      item.y < box.bottom &&
      item.y + item.height > box.top
    ) {
      hits.push(item.id);
    }
  }
  return hits;
}

export function layoutRectToContent(
  item: CanvasAssetLayoutRect,
  originLeft: number,
  originTop: number,
): MarqueeRect {
  return {
    left: originLeft + item.x,
    top: originTop + item.y,
    right: originLeft + item.x + item.width,
    bottom: originTop + item.y + item.height,
  };
}

function eachPublishedGridLayout(
  canvas: HTMLElement,
  viewport: CanvasViewport,
  scroll: CanvasScrollOffset,
  box: MarqueeRect | null,
  visit: (item: CanvasAssetLayoutRect, originLeft: number, originTop: number) => void,
): boolean {
  const grids = canvas.querySelectorAll<HTMLElement>(
    ".masonry-columns, .justified-rows",
  );
  if (grids.length === 0) return false;
  let published = false;
  for (const grid of grids) {
    const layout = readPublishedCanvasAssetLayout(grid);
    const rect = grid.getBoundingClientRect();
    const origin = viewportRectToContent(
      {
        left: rect.left,
        top: rect.top,
        right: rect.left,
        bottom: rect.top,
      },
      viewport,
      scroll,
    );
    if (layout && layout.length > 0) {
      published = true;
      for (const item of layout) {
        visit(item, origin.left, origin.top);
      }
      continue;
    }
    const layoutIndex = readPublishedCanvasAssetLayoutIndex(grid);
    if (!layoutIndex || layoutIndex.total <= 0) continue;
    published = true;
    if (box) {
      const localBox = {
        left: box.left - origin.left,
        top: box.top - origin.top,
        right: box.right - origin.left,
        bottom: box.bottom - origin.top,
      };
      layoutIndex.forEachIntersecting(localBox, (item) =>
        visit(item, origin.left, origin.top),
      );
    } else {
      layoutIndex.forEachAll((item) => visit(item, origin.left, origin.top));
    }
  }
  return published;
}

/** Content-space hits for every laid-out card, including unmounted ones. */
export function collectPublishedAssetHits(
  canvas: HTMLElement,
  box: MarqueeRect,
  viewport: CanvasViewport,
  scroll: CanvasScrollOffset,
): string[] | null {
  const hits: string[] = [];
  const published = eachPublishedGridLayout(
    canvas,
    viewport,
    scroll,
    box,
    (item, originLeft, originTop) => {
      if (rectsIntersect(layoutRectToContent(item, originLeft, originTop), box)) {
        hits.push(item.id);
      }
    },
  );
  return published ? hits : null;
}

export function collectPublishedAssetCenters(
  canvas: HTMLElement,
  viewport: CanvasViewport,
  scroll: CanvasScrollOffset,
): MasonryCardCenter[] | null {
  const items: MasonryCardCenter[] = [];
  const published = eachPublishedGridLayout(
    canvas,
    viewport,
    scroll,
    null,
    (item, originLeft, originTop) => {
      items.push({
        id: item.id,
        x: originLeft + item.x + item.width / 2,
        y: originTop + item.y + item.height / 2,
      });
    },
  );
  return published ? items : null;
}
