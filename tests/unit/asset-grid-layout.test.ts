import { describe, expect, it } from "vitest";

import {
  ASSET_GRID_GAP_PX,
  assetGridLayoutStyle,
  countFittingColumns,
  distributeMasonryItems,
  leftoverWidthPx,
} from "../../src/renderer/asset-grid-layout";

describe("assetGridLayoutStyle", () => {
  it("lets grid tracks absorb leftover width", () => {
    expect(assetGridLayoutStyle("grid", 96)).toEqual({
      gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
    });
    expect(assetGridLayoutStyle("grid", 160)).toEqual({
      gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
    });
    expect(assetGridLayoutStyle("grid", 320)).toEqual({
      gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
    });
  });

  it("leaves masonry sizing to the explicit distributed-column renderer", () => {
    expect(assetGridLayoutStyle("masonry", 96)).toEqual({});
    expect(assetGridLayoutStyle("masonry", 160)).toEqual({});
    expect(assetGridLayoutStyle("masonry", 320)).toEqual({});
  });
});

describe("column packing", () => {
  it("keeps unused width below one column slot", () => {
    for (const width of [900, 1200, 1600]) {
      for (const size of [96, 160, 320]) {
        const leftover = leftoverWidthPx(width, size);
        expect(leftover).toBeGreaterThanOrEqual(0);
        expect(leftover).toBeLessThan(size + ASSET_GRID_GAP_PX);
      }
    }
  });

  it("increases the column count as cards shrink", () => {
    expect(countFittingColumns(1200, 96)).toBeGreaterThan(
      countFittingColumns(1200, 160),
    );
    expect(countFittingColumns(1200, 160)).toBeGreaterThan(
      countFittingColumns(1200, 320),
    );
  });
});

describe("distributed masonry", () => {
  it("seeds sparse folders horizontally instead of stacking every item left", () => {
    const columns = distributeMasonryItems(
      ["a", "b", "c"],
      4,
      () => 100,
    );

    expect(columns.map((column) => column.items)).toEqual([
      ["a"],
      ["b"],
      ["c"],
      [],
    ]);
  });

  it("places later cards in the shortest column with stable left-to-right ties", () => {
    const heights: Record<string, number> = {
      a: 300,
      b: 100,
      c: 200,
      d: 80,
      e: 50,
    };
    const columns = distributeMasonryItems(
      ["a", "b", "c", "d", "e"],
      3,
      (item) => heights[item]!,
    );

    expect(columns.map((column) => column.items)).toEqual([
      ["a"],
      ["b", "d", "e"],
      ["c"],
    ]);
    expect(columns.map((column) => column.estimatedHeightPx)).toEqual([
      300,
      230,
      200,
    ]);
  });

  it("normalizes invalid column counts and ignores invalid height estimates", () => {
    const columns = distributeMasonryItems(
      ["a", "b"],
      0,
      (_item, index) => (index === 0 ? Number.NaN : -20),
    );

    expect(columns).toHaveLength(1);
    expect(columns[0]!.items).toEqual(["a", "b"]);
    expect(columns[0]!.estimatedHeightPx).toBe(0);

    expect(
      distributeMasonryItems(["a"], Number.POSITIVE_INFINITY, () => 20),
    ).toHaveLength(1);
  });
});
