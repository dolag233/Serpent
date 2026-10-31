import {
  collectPublishedMasonryAssetRects,
  type CanvasAssetLayoutRect,
} from "./canvas-asset-layout";
import { isGeometryPlaceholder } from "./browse/virtual-browse-layout";

function uniqueKnownAssetIds(assetIds: readonly string[]): string[] {
  return [...new Set(assetIds)].filter(
    (id) => id.length > 0 && !isGeometryPlaceholder({ assetId: id }),
  );
}

/**
 * Return the latest masonry top-edge reading order when every known asset has
 * unambiguous geometry. If the layout is incomplete, preserve the stable
 * browse order so a known endpoint is never silently dropped.
 */
export function orderMasonryShiftAssetIds(
  assetIds: readonly string[],
  rects: readonly CanvasAssetLayoutRect[] | null,
): string[] {
  const stableIds = uniqueKnownAssetIds(assetIds);
  if (!rects || stableIds.length === 0) return stableIds;

  const knownIds = new Set(stableIds);
  const rectById = new Map<string, CanvasAssetLayoutRect>();
  for (const rect of rects) {
    if (!knownIds.has(rect.id)) continue;
    if (rectById.has(rect.id)) return stableIds;
    if (
      !Number.isFinite(rect.x) ||
      !Number.isFinite(rect.y) ||
      !Number.isFinite(rect.width) ||
      !Number.isFinite(rect.height) ||
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      return stableIds;
    }
    rectById.set(rect.id, rect);
  }

  if (rectById.size !== stableIds.length) return stableIds;

  const browseRank = new Map(stableIds.map((id, index) => [id, index] as const));
  return [...stableIds].sort((firstId, secondId) => {
    const first = rectById.get(firstId)!;
    const second = rectById.get(secondId)!;
    return (
      first.y - second.y ||
      first.x - second.x ||
      browseRank.get(firstId)! - browseRank.get(secondId)!
    );
  });
}

/**
 * Read geometry at the time of the click. Published layout covers unmounted
 * cards; DOM rectangles are only a fallback while no layout has been published.
 */
export function readMasonryShiftAssetOrder(
  canvas: HTMLElement | null,
  assetIds: readonly string[],
): string[] {
  const stableIds = uniqueKnownAssetIds(assetIds);
  if (!canvas) return stableIds;
  const knownAssetIds = new Set(stableIds);

  const published = collectPublishedMasonryAssetRects(canvas, knownAssetIds);
  if (published) return orderMasonryShiftAssetIds(stableIds, published);

  const domRects = [...canvas.querySelectorAll<HTMLElement>(
    ".asset-card[data-asset-id]",
  )].flatMap((card) => {
    const id = card.dataset.assetId;
    if (!id || !knownAssetIds.has(id)) return [];
    const rect = card.getBoundingClientRect();
    return [{
      id,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    }];
  });
  return orderMasonryShiftAssetIds(stableIds, domRects);
}
