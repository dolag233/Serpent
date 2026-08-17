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

export type CanvasAssetLayoutRect = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export const MASONRY_CAPTION_BAND_PX = 42;

const publishedLayouts = new WeakMap<HTMLElement, readonly CanvasAssetLayoutRect[]>();

export function publishCanvasAssetLayout(
  element: HTMLElement,
  rects: readonly CanvasAssetLayoutRect[],
): void {
  publishedLayouts.set(element, rects);
}

export function readPublishedCanvasAssetLayout(
  element: HTMLElement,
): readonly CanvasAssetLayoutRect[] | undefined {
  return publishedLayouts.get(element);
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
): number {
  return (
    estimateMasonryPreviewHeightPx(asset.width, asset.height, columnWidthPx) +
    (showCaption ? MASONRY_CAPTION_BAND_PX : 0)
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
): CanvasAssetLayoutRect[] {
  const columnCount = countFittingColumns(availableWidth, cardSize);
  const columnWidth = masonryColumnWidthPx(availableWidth, columnCount);
  if (columnWidth <= 0 || assets.length === 0) return [];

  const columns = distributeMasonryItems(assets, columnCount, (asset) =>
    estimateMasonryCardBodyPx(asset, columnWidth, showCaption),
  );

  const rects: CanvasAssetLayoutRect[] = [];
  columns.forEach((column, columnIndex) => {
    let y = 0;
    const x = columnIndex * (columnWidth + ASSET_GRID_GAP_PX);
    for (const asset of column.items) {
      const height = estimateMasonryCardBodyPx(asset, columnWidth, showCaption);
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
  visit: (item: CanvasAssetLayoutRect, originLeft: number, originTop: number) => void,
): boolean {
  const grids = canvas.querySelectorAll<HTMLElement>(
    ".masonry-columns, .justified-rows",
  );
  if (grids.length === 0) return false;
  let published = false;
  for (const grid of grids) {
    const layout = readPublishedCanvasAssetLayout(grid);
    if (!layout || layout.length === 0) continue;
    published = true;
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
    for (const item of layout) {
      visit(item, origin.left, origin.top);
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
