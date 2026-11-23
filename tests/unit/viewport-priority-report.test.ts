import { describe, expect, it } from "vitest";

import {
  collectIntersectingCanvasAssetIds,
  composeBrowseViewportPriorityBands,
  orderedIdsForViewportPriorityReport,
  type ViewportPriorityCanvas,
} from "../../src/renderer/viewport-priority-report";
import {
  publishCanvasAssetLayout,
  publishCanvasAssetLayoutIndex,
} from "../../src/renderer/canvas-asset-layout";
import {
  buildJustifiedGeometry,
  buildMasonryGeometry,
  makeJustifiedLayoutIndex,
  makeMasonryLayoutIndex,
} from "../../src/renderer/browse/virtual-browse-canvas";

function fakeSlot(input: {
  assetId?: string;
  layoutId?: string;
  layoutIndex?: number;
  grid?: HTMLElement;
  parentSlot?: HTMLElement;
  top: number;
  bottom: number;
  reads?: { count: number };
}): HTMLElement {
  const slot: Record<string, unknown> = {
    dataset: {
      ...(input.assetId === undefined ? {} : { assetId: input.assetId }),
      ...(input.layoutId === undefined ? {} : { layoutAssetId: input.layoutId }),
      ...(input.layoutIndex === undefined ? {} : { layoutIndex: String(input.layoutIndex) }),
    },
    closest: (selector: string) => selector.includes("data-layout-index")
      ? (input.layoutId !== undefined && input.layoutIndex !== undefined
        ? slot
        : input.parentSlot ?? null)
      : input.grid ?? null,
    getBoundingClientRect: () => {
      if (input.reads) input.reads.count += 1;
      return {
        top: input.top,
        bottom: input.bottom,
        left: 0,
        right: 10,
        width: 10,
        height: input.bottom - input.top,
        x: 0,
        y: input.top,
        toJSON: () => ({}),
      };
    },
  };
  return slot as unknown as HTMLElement;
}

function fakeGrid(kind: "masonry-columns" | "justified-rows", top: number, reads = { count: 0 }): HTMLElement {
  return {
    classList: { contains: (value: string) => value === kind },
    getBoundingClientRect: () => {
      reads.count += 1;
      return { top, left: 0, right: 800, bottom: 1000, width: 800, height: 1000 };
    },
  } as unknown as HTMLElement;
}

function fakeViewport(slots: readonly HTMLElement[], top = 0, bottom = 100): ViewportPriorityCanvas {
  return {
    getBoundingClientRect: () => ({
      top, bottom, left: 0, right: 800, width: 800, height: bottom - top,
      x: 0, y: top, toJSON: () => ({}),
    }),
    querySelectorAll: () => slots,
  };
}

describe("collectIntersectingCanvasAssetIds", () => {
  it("keeps intersecting cards in encounter order and skips overscan and placeholders", () => {
    const canvas = {
      getBoundingClientRect: () => ({
        top: 0,
        bottom: 100,
        left: 0,
        right: 100,
        width: 100,
        height: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
      querySelectorAll: () => [
        fakeSlot({ assetId: "visible-1", top: 10, bottom: 40 }),
        fakeSlot({ layoutId: "visible-2", top: 40, bottom: 80 }),
        fakeSlot({ assetId: "below-fold", top: 120, bottom: 160 }),
        fakeSlot({ assetId: "__geometry__:3", top: 20, bottom: 50 }),
        fakeSlot({ assetId: "visible-1", top: 10, bottom: 40 }),
      ],
    } as unknown as ViewportPriorityCanvas;
    expect(collectIntersectingCanvasAssetIds(canvas, (assetId) => assetId.startsWith("__geometry__:"))).toEqual([
      "visible-1",
      "visible-2",
    ]);
  });

  it("uses real masonry rects in DOM order, preserves strict edges and avoids slot reads", () => {
    const ids = ["m0", "m1", "m2", "__geometry__:3"];
    const columns = buildMasonryGeometry({
      total: ids.length,
      columnCount: 1,
      columnWidth: 200,
      showCaption: false,
      captionBand: 0,
      entryAt: (index) => ({ assetId: ids[index]!, width: 200, height: 200 }),
    });
    const index = makeMasonryLayoutIndex({
      total: ids.length,
      columnCount: 1,
      columnWidth: 200,
      columns,
      idAt: (rank) => ids[rank],
    });
    const gridReads = { count: 0 };
    const grid = fakeGrid("masonry-columns", 10, gridReads);
    publishCanvasAssetLayoutIndex(grid, index);
    const geometryReads: number[] = [];
    const assetRectAtIndex = index.assetRectAtIndex!;
    index.assetRectAtIndex = (rank) => {
      geometryReads.push(rank);
      return assetRectAtIndex(rank);
    };
    const rects = ids.map((_, rank) => index.assetRectAtIndex!(rank)!);
    geometryReads.length = 0;
    const domReads = { count: 0 };
    const slots = rects.map((rect, rank) => fakeSlot({
      layoutId: ids[rank],
      layoutIndex: rank,
      grid,
      top: 10 + rect.y,
      bottom: 10 + rect.y + rect.height,
      reads: domReads,
    }));
    slots.splice(1, 0, fakeSlot({
      layoutId: ids[0], layoutIndex: 0, grid,
      top: 10 + rects[0]!.y, bottom: 10 + rects[0]!.y + rects[0]!.height,
      reads: domReads,
    }));
    slots.push(fakeSlot({
      assetId: ids[2], parentSlot: slots[3], grid,
      top: 10 + rects[2]!.y, bottom: 10 + rects[2]!.y + rects[2]!.height,
      reads: domReads,
    }));
    slots.push(fakeSlot({
      layoutId: ids[3], layoutIndex: 3, grid,
      top: 10 + rects[3]!.y, bottom: 10 + rects[3]!.y + rects[3]!.height,
      reads: domReads,
    }));
    const top = 10 + rects[0]!.y - 10;
    const bottom = 10 + rects[0]!.y + rects[0]!.height + 10;
    const expected = rects.flatMap((rect) =>
      10 + rect.y + rect.height > top && 10 + rect.y < bottom
        ? [rect.id]
        : [],
    ).filter((id) => !id.startsWith("__geometry__:"));

    expect(collectIntersectingCanvasAssetIds(fakeViewport(slots, top, bottom), (id) => id.startsWith("__geometry__:")))
      .toEqual([...new Set(expected)]);
    expect(domReads.count).toBe(0);
    expect(gridReads.count).toBe(1);
    expect(geometryReads).not.toContain(3);

    const only = rects[0]!;
    const bottomEdgeReads = { count: 0 };
    expect(collectIntersectingCanvasAssetIds(fakeViewport([
      fakeSlot({
        layoutId: ids[0], layoutIndex: 0, grid,
        top: 10 + only.y, bottom: 10 + only.y + only.height,
        reads: bottomEdgeReads,
      }),
    ], 10 + only.y + only.height, 10 + only.y + only.height + 40), () => false)).toEqual([]);
    expect(bottomEdgeReads.count).toBe(1);
    const topEdgeReads = { count: 0 };
    expect(collectIntersectingCanvasAssetIds(fakeViewport([
      fakeSlot({
        layoutId: ids[0], layoutIndex: 0, grid,
        top: 10 + only.y, bottom: 10 + only.y + only.height,
        reads: topEdgeReads,
      }),
    ], 10 + only.y - 40, 10 + only.y), () => false)).toEqual([]);
    expect(topEdgeReads.count).toBe(1);
  });

  it("uses the published justified outer slot for an empty real id and skips placeholders", () => {
    const ids = ["empty-real", "__geometry__:1", "loaded"];
    const rows = buildJustifiedGeometry({
      total: ids.length,
      itemsPerRow: 3,
      availableWidth: 800,
      targetHeight: 200,
      captionBand: 30,
      entryAt: (index) => ({ assetId: ids[index]!, width: 100, height: 100 }),
    });
    const geometry = {
      count: rows.length,
      totalHeight: rows.at(-1)!.offset + rows.at(-1)!.bodyHeight,
      rowAt: (row: number) => rows[row]!,
      heightAt: (row: number) => rows[row]!.bodyHeight,
      offsetAt: (row: number) => rows[row]?.offset ?? 0,
    };
    const index = makeJustifiedLayoutIndex({
      total: ids.length,
      itemsPerRow: 3,
      geometry,
      idAt: (rank) => ids[rank],
    });
    const gridReads = { count: 0 };
    const grid = fakeGrid("justified-rows", 50, gridReads);
    publishCanvasAssetLayoutIndex(grid, index);
    const domReads = { count: 0 };
    const slots = ids.map((id, layoutIndex) => {
      const rect = index.assetRectAtIndex!(layoutIndex)!;
      // Empty slots still carry their real indexed identity and full row body.
      return fakeSlot({
        layoutId: id,
        layoutIndex,
        grid,
        top: 50 + rect.y,
        bottom: 50 + rect.y + rect.height,
        reads: domReads,
      });
    });
    const row = rows[0]!;
    const viewTop = 50 + row.offset - 10;
    const viewBottom = 50 + row.offset + row.bodyHeight + 10;
    expect(collectIntersectingCanvasAssetIds(fakeViewport(slots, viewTop, viewBottom), (id) => id.startsWith("__geometry__:")))
      .toEqual(["empty-real", "loaded"]);
    expect(domReads.count).toBe(0);
    expect(gridReads.count).toBe(1);

    const partialTop = 50 + row.offset + row.bodyHeight / 2;
    expect(collectIntersectingCanvasAssetIds(fakeViewport(slots.slice(0, 1), partialTop, partialTop + 30), () => false))
      .toEqual(["empty-real"]);
    expect(domReads.count).toBe(1);
  });

  it("falls back for stale identities and old or mixed grid publications", () => {
    const ids = ["current"];
    const columns = buildMasonryGeometry({
      total: 1, columnCount: 1, columnWidth: 200, showCaption: false, captionBand: 0,
      entryAt: () => ({ assetId: "current", width: 200, height: 100 }),
    });
    const currentIndex = makeMasonryLayoutIndex({
      total: 1, columnCount: 1, columnWidth: 200, columns, idAt: (rank) => ids[rank],
    });
    const currentGridReads = { count: 0 };
    const currentGrid = fakeGrid("masonry-columns", 0, currentGridReads);
    publishCanvasAssetLayoutIndex(currentGrid, currentIndex);
    const oldGrid = fakeGrid("masonry-columns", 0);
    publishCanvasAssetLayout(oldGrid, [{ id: "old", x: 0, y: 0, width: 100, height: 100 }]);
    const domReads = { count: 0 };
    const publishedRect = currentIndex.assetRectAtIndex!(0)!;
    const slots = [
      fakeSlot({
        layoutId: "current", layoutIndex: 0, grid: currentGrid,
        top: publishedRect.y, bottom: publishedRect.y + publishedRect.height, reads: domReads,
      }),
      fakeSlot({ layoutId: "stale", layoutIndex: 0, grid: currentGrid, top: 10, bottom: 40, reads: domReads }),
      fakeSlot({ layoutId: "old", layoutIndex: 0, grid: oldGrid, top: 20, bottom: 50, reads: domReads }),
    ];
    expect(collectIntersectingCanvasAssetIds(
      fakeViewport(slots, -10, publishedRect.height + 10),
      () => false,
    )).toEqual(["current", "stale", "old"]);
    expect(domReads.count).toBe(2);
    expect(currentGridReads.count).toBe(1);
  });
});

describe("orderedIdsForViewportPriorityReport", () => {
  it("walks the virtual layout around the visible window", () => {
    const ordered = ["a", "b", "c", "d", "e"];
    expect(orderedIdsForViewportPriorityReport({
      visibleIds: ["c"],
      virtualLayout: {
        indexOf: (assetId) => ordered.indexOf(assetId),
        idAt: (index) => ordered[index],
        total: ordered.length,
      },
      fallbackOrderedIds: ["fallback"],
    })).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("composeBrowseViewportPriorityBands", () => {
  it("builds visible and neighbor bands from intersecting cards and scroll direction", () => {
    const bands = composeBrowseViewportPriorityBands({
      intersectingIds: ["c", "d"],
      focusedIds: ["viewer-1", undefined],
      orderedIds: ["a", "b", "c", "d", "e", "f"],
      loadedIds: ["c", "e"],
      scrollTop: 220,
      previousScrollTop: 200,
      viewportHeight: 100,
    });
    expect(bands?.visible).toEqual(["c", "d"]);
    expect(bands?.focused).toEqual(["viewer-1"]);
    expect(bands?.direction).toBe("down");
    expect(bands?.nearForward[0]).toBe("e");
  });
});
