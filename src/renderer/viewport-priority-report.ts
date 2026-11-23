import {
  VIEWPORT_NEAR_FORWARD_LIMIT,
  buildViewportPriorityBands,
  detectViewportScrollDirection,
  orderedIdsAroundVisible,
  type ViewportPriorityBands,
} from "../shared/viewport-priority";
import { preserveVisibleWindowAssetIds } from "./visible-window";
import { readPublishedCanvasAssetLayoutIndex } from "./canvas-asset-layout";

export type ViewportPriorityCanvas = {
  getBoundingClientRect(): Pick<DOMRect, "top" | "bottom">;
  querySelectorAll(selectors: string): Iterable<HTMLElement>;
};

export type ViewportPriorityVirtualLayout = {
  indexOf: (assetId: string) => number | undefined;
  idAt: (index: number) => string | undefined;
  total: number;
};

type PublishedGridOrigin = Pick<DOMRect, "top"> | null;

function publishedCanvasIntersection(
  slot: HTMLElement,
  expectedAssetId: string,
  canvasRect: Pick<DOMRect, "top" | "bottom">,
  gridOrigins: Map<HTMLElement, PublishedGridOrigin>,
): boolean | undefined {
  const assetId = slot.dataset.layoutAssetId;
  const indexValue = slot.dataset.layoutIndex;
  if (!assetId || assetId !== expectedAssetId || indexValue === undefined || indexValue === "") {
    return undefined;
  }
  if (slot.dataset.assetId && slot.dataset.assetId !== assetId) return undefined;
  const index = Number(indexValue);
  if (!Number.isSafeInteger(index) || index < 0) return undefined;

  const grid = slot.closest<HTMLElement>(".masonry-columns, .justified-rows");
  if (!grid) return undefined;
  const layoutIndex = readPublishedCanvasAssetLayoutIndex(grid);
  if (!layoutIndex?.assetRectAtIndex || index >= layoutIndex.total) return undefined;
  const rect = layoutIndex.assetRectAtIndex(index);
  if (
    !rect || rect.id !== assetId ||
    !Number.isFinite(rect.x) || !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) || !Number.isFinite(rect.height)
  ) return undefined;

  let origin = gridOrigins.get(grid);
  if (origin === undefined) {
    const gridRect = grid.getBoundingClientRect();
    origin = Number.isFinite(gridRect.top) ? { top: gridRect.top } : null;
    gridOrigins.set(grid, origin);
  }
  if (!origin) return undefined;
  const top = origin.top + rect.y;
  const bottom = top + rect.height;

  const isMasonry = grid.classList.contains("masonry-columns");
  const isJustified = grid.classList.contains("justified-rows");
  if ((!isMasonry && !isJustified) || rect.height <= 0) return undefined;
  const crossesViewportEdge =
    (top < canvasRect.top && bottom > canvasRect.top)
    || (top < canvasRect.bottom && bottom > canvasRect.bottom);
  const nearViewportEdge = [
    top - canvasRect.top,
    bottom - canvasRect.top,
    top - canvasRect.bottom,
    bottom - canvasRect.bottom,
  ].some((distance) => Math.abs(distance) <= 1);
  if (crossesViewportEdge || nearViewportEdge) return undefined;
  // Masonry slots explicitly use bodyHeight. Justified outer slots now use
  // their row body height too; the inner card may be absent while its summary
  // loads. Both published rectangles therefore bound the reportable slot.
  return bottom > canvasRect.top && top < canvasRect.bottom;
}

function publishedSlotForCandidate(
  candidate: HTMLElement,
  assetId: string,
): HTMLElement | undefined {
  if (candidate.dataset.layoutAssetId) return candidate;
  const slot = candidate.closest<HTMLElement>("[data-layout-index][data-layout-asset-id]");
  return slot?.dataset.layoutAssetId === assetId ? slot : undefined;
}

/**
 * Cards that actually intersect the canvas viewport, in DOM encounter order.
 * Overscan mounts are skipped so they do not share the visible-wave budget.
 */
export function collectIntersectingCanvasAssetIds(
  canvas: ViewportPriorityCanvas,
  isPlaceholder: (assetId: string) => boolean,
): string[] {
  const canvasRect = canvas.getBoundingClientRect();
  const ids: string[] = [];
  const seenIds = new Set<string>();
  const gridOrigins = new Map<HTMLElement, PublishedGridOrigin>();
  for (const slot of canvas.querySelectorAll(
    ".asset-card[data-asset-id], [data-layout-asset-id]",
  )) {
    const assetId = slot.dataset.assetId ?? slot.dataset.layoutAssetId;
    if (!assetId || seenIds.has(assetId) || isPlaceholder(assetId)) continue;
    const publishedSlot = publishedSlotForCandidate(slot, assetId);
    const publishedIntersection = publishedSlot
      ? publishedCanvasIntersection(publishedSlot, assetId, canvasRect, gridOrigins)
      : undefined;
    const intersects = publishedIntersection ?? (() => {
      const rect = slot.getBoundingClientRect();
      return rect.bottom > canvasRect.top && rect.top < canvasRect.bottom;
    })();
    if (!intersects) continue;
    seenIds.add(assetId);
    ids.push(assetId);
  }
  return ids;
}

export function orderedIdsForViewportPriorityReport(input: {
  visibleIds: readonly string[];
  virtualLayout?: ViewportPriorityVirtualLayout;
  fallbackOrderedIds: readonly string[];
}): string[] {
  const visibleIds = preserveVisibleWindowAssetIds(input.visibleIds);
  if (input.virtualLayout) {
    return orderedIdsAroundVisible({
      visibleIds,
      indexOf: input.virtualLayout.indexOf,
      idAt: input.virtualLayout.idAt,
      total: input.virtualLayout.total,
      radius: VIEWPORT_NEAR_FORWARD_LIMIT,
    });
  }
  return preserveVisibleWindowAssetIds(input.fallbackOrderedIds);
}

export function composeBrowseViewportPriorityBands(input: {
  intersectingIds: readonly string[];
  focusedIds: readonly (string | undefined)[];
  orderedIds: readonly string[];
  loadedIds: readonly string[];
  scrollTop: number;
  previousScrollTop: number | undefined;
  viewportHeight: number;
}): ViewportPriorityBands | undefined {
  const visibleIds = preserveVisibleWindowAssetIds(input.intersectingIds);
  if (visibleIds.length === 0) return undefined;
  const focusedIds = input.focusedIds.filter((assetId): assetId is string => Boolean(assetId));
  const direction = detectViewportScrollDirection({
    previousTop: input.previousScrollTop,
    nextTop: input.scrollTop,
    viewportHeight: input.viewportHeight,
  });
  const previousTop = input.previousScrollTop;
  const fastScroll = previousTop !== undefined
    && Math.abs(input.scrollTop - previousTop) >= input.viewportHeight * 1.5;
  return buildViewportPriorityBands({
    orderedIds: input.orderedIds,
    visibleIds,
    direction,
    focusedIds,
    loadedIds: input.loadedIds,
    fastScroll,
  });
}
