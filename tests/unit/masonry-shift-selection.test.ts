// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import type {
  CanvasAssetLayoutIndex,
  CanvasAssetLayoutRect,
} from "../../src/renderer/canvas-asset-layout";
import {
  collectPublishedMasonryAssetRects,
  publishCanvasAssetLayoutIndex,
} from "../../src/renderer/canvas-asset-layout";
import {
  buildBrowseSelectionOrder,
  resolveShiftBrowseRange,
} from "../../src/renderer/browse-selection-order";
import {
  orderMasonryShiftAssetIds,
  readMasonryShiftAssetOrder,
} from "../../src/renderer/masonry-shift-selection";

function rect(
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 100,
): CanvasAssetLayoutRect {
  return { id, x, y, width, height };
}

function sparseIndex(rects: readonly CanvasAssetLayoutRect[]): CanvasAssetLayoutIndex {
  return {
    total: rects.length,
    forEachIntersecting: () => undefined,
    forEachAll: (visit) => rects.forEach(visit),
  };
}

describe("masonry Shift reading order", () => {
  it("uses each card's top edge, then its left edge, across uneven columns", () => {
    const assetIds = ["A", "E", "B", "F", "C", "G", "D"];
    const geometry = [
      rect("A", 0, 0, 100, 300),
      rect("B", 114, 0, 100, 100),
      rect("C", 228, 0, 100, 200),
      rect("D", 342, 0, 100, 150),
      rect("E", 0, 314),
      rect("F", 114, 114),
      rect("G", 228, 214),
    ];
    const order = orderMasonryShiftAssetIds(assetIds, geometry);
    const items = buildBrowseSelectionOrder([], order);

    expect(order).toEqual(["A", "B", "C", "D", "F", "G", "E"]);
    expect(
      resolveShiftBrowseRange({
        items,
        anchor: { kind: "asset", id: "A" },
        target: { kind: "asset", id: "G" },
        currentFolderIds: [],
        currentAssetIds: [],
        additive: false,
      })?.assetIds,
    ).toEqual(["A", "B", "C", "D", "F", "G"]);
  });

  it("keeps reverse ranges identical and orders same-top cards left to right despite different heights", () => {
    const assetIds = ["tall-right", "short-left", "medium-center"];
    const geometry = [
      rect("tall-right", 220, 0, 100, 300),
      rect("short-left", 0, 0, 100, 70),
      rect("medium-center", 110, 0, 100, 180),
    ];
    const order = orderMasonryShiftAssetIds(assetIds, geometry);
    const items = buildBrowseSelectionOrder([], order);
    const resolve = (anchor: string, target: string) =>
      resolveShiftBrowseRange({
        items,
        anchor: { kind: "asset", id: anchor },
        target: { kind: "asset", id: target },
        currentFolderIds: [],
        currentAssetIds: [],
        additive: false,
      })?.assetIds;

    expect(order).toEqual(["short-left", "medium-center", "tall-right"]);
    expect(resolve("tall-right", "short-left")).toEqual(order);
    expect(resolve("short-left", "tall-right")).toEqual(order);
  });

  it("deduplicates known IDs, ignores geometry placeholders, and falls back without losing endpoints when geometry is incomplete", () => {
    const fallbackOrder = orderMasonryShiftAssetIds(
      ["a", "b", "a", "c", "__geometry__:9"],
      [rect("a", 100, 0), rect("b", 0, 0), rect("__geometry__:9", 50, 0)],
    );
    expect(fallbackOrder).toEqual(["a", "b", "c"]);
    expect(
      resolveShiftBrowseRange({
        items: buildBrowseSelectionOrder([], fallbackOrder),
        anchor: { kind: "asset", id: "a" },
        target: { kind: "asset", id: "c" },
        currentFolderIds: [],
        currentAssetIds: [],
        additive: false,
      })?.assetIds,
    ).toEqual(["a", "b", "c"]);
    expect(
      orderMasonryShiftAssetIds(
        ["a", "b", "c"],
        [rect("a", 100, 0), rect("b", 0, 0), rect("b", 1, 0), rect("__geometry__:9", 50, 0)],
      ),
    ).toEqual(["a", "b", "c"]);
  });

  it("uses stable browse order when multiple cards share the same top-left point", () => {
    expect(
      orderMasonryShiftAssetIds(["c", "a", "b"], [
        rect("a", 10, 10),
        rect("b", 10, 10),
        rect("c", 10, 10),
      ]),
    ).toEqual(["c", "a", "b"]);
  });

  it("reads the complete sparse layout, including offscreen cards, and uses newly published geometry", () => {
    const canvas = document.createElement("div");
    const grid = document.createElement("div");
    grid.className = "masonry-columns";
    canvas.append(grid);
    const initial = [
      rect("a", 0, 200),
      rect("b", 100, 100),
      rect("c", 200, 0),
      rect("__geometry__:3", 300, 50),
    ];
    publishCanvasAssetLayoutIndex(grid, sparseIndex(initial));
    expect(
      collectPublishedMasonryAssetRects(canvas, new Set(["a", "b", "c"]))?.map(
        ({ id }) => id,
      ),
    ).toEqual(["a", "b", "c"]);

    expect(readMasonryShiftAssetOrder(canvas, ["a", "b", "c"])).toEqual([
      "c",
      "b",
      "a",
    ]);

    publishCanvasAssetLayoutIndex(
      grid,
      sparseIndex([
        rect("a", 0, 0),
        rect("b", 100, 100),
        rect("c", 200, 200),
      ]),
    );
    expect(readMasonryShiftAssetOrder(canvas, ["a", "b", "c"])).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("uses DOM geometry only before publication and falls back when the mounted set is partial", () => {
    const canvas = document.createElement("div");
    const makeCard = (id: string, x: number, y: number) => {
      const card = document.createElement("div");
      card.className = "asset-card";
      card.dataset.assetId = id;
      card.getBoundingClientRect = () => ({
        x,
        y,
        left: x,
        top: y,
        right: x + 100,
        bottom: y + 100,
        width: 100,
        height: 100,
        toJSON: () => ({}),
      });
      canvas.append(card);
      return card;
    };
    makeCard("b", 100, 0);
    makeCard("a", 0, 0);

    expect(readMasonryShiftAssetOrder(canvas, ["b", "a"])).toEqual(["a", "b"]);
    expect(readMasonryShiftAssetOrder(canvas, ["b", "a", "offscreen"])).toEqual([
      "b",
      "a",
      "offscreen",
    ]);
  });

  it("keeps folders before geometry-ordered assets and clears folders outside a replacement range", () => {
    const items = buildBrowseSelectionOrder(
      ["folder-a", "folder-b", "folder-b"],
      orderMasonryShiftAssetIds(["asset-b", "asset-a"], [
        rect("asset-a", 0, 0),
        rect("asset-b", 100, 0),
      ]),
    );
    const resolved = resolveShiftBrowseRange({
      items,
      anchor: { kind: "folder", id: "folder-b" },
      target: { kind: "asset", id: "asset-b" },
      currentFolderIds: ["folder-a"],
      currentAssetIds: [],
      additive: false,
    });

    expect(items.map(({ kind, id }) => `${kind}:${id}`)).toEqual([
      "folder:folder-a",
      "folder:folder-b",
      "asset:asset-a",
      "asset:asset-b",
    ]);
    expect(resolved).toEqual({
      folderIds: ["folder-b"],
      assetIds: ["asset-a", "asset-b"],
      anchor: { kind: "folder", id: "folder-b" },
    });
  });
});
