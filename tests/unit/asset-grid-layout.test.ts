import { describe, expect, it } from "vitest";

import {
  ASSET_GRID_GAP_PX,
  assetGridLayoutStyle,
  countFittingColumns,
  distributeMasonryItems,
  layoutJustifiedRows,
  leftoverWidthPx,
  masonryVisualReadingOrderIds,
} from "../../src/renderer/asset-grid-layout";
import { resolveMasonryTabTarget } from "../../src/renderer/masonry-focus-order";

describe("masonry keyboard focus order", () => {
  it("moves Tab and Shift+Tab through the visual reading order", () => {
    const order = ["a", "b", "c", "d"];
    expect(resolveMasonryTabTarget(order, "a", false)).toBe("b");
    expect(resolveMasonryTabTarget(order, "c", true)).toBe("b");
    expect(resolveMasonryTabTarget(order, "d", false)).toBeNull();
    expect(resolveMasonryTabTarget(order, "a", true)).toBeNull();
  });

  it("ignores cards that are not in the current visible order", () => {
    expect(resolveMasonryTabTarget(["a", "b"], "missing", false)).toBeNull();
  });
});

describe("assetGridLayoutStyle", () => {
  it("defers both modes to explicit layout renderers", () => {
    expect(assetGridLayoutStyle("grid", 96)).toEqual({});
    expect(assetGridLayoutStyle("grid", 160)).toEqual({});
    expect(assetGridLayoutStyle("masonry", 96)).toEqual({});
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

  it("packs later cards into the shortest estimated column to avoid white slices", () => {
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

    // Shortest-load packing → [a] | [b,d,e] | [c].
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

  it("keeps Shift selection identical to asset array order (Serpent-1jnp)", () => {
    const heights: Record<string, number> = {
      a: 300,
      b: 100,
      c: 200,
      d: 80,
      e: 50,
    };
    expect(
      masonryVisualReadingOrderIds(
        ["a", "b", "c", "d", "e"],
        3,
        (item) => heights[item]!,
        (item) => item,
      ),
    ).toEqual(["a", "b", "c", "d", "e"]);

    const order = masonryVisualReadingOrderIds(
      ["a", "b", "c", "d", "e"],
      3,
      (item) => heights[item]!,
      (item) => item,
    );
    const b = order.indexOf("b");
    const e = order.indexOf("e");
    const range = order.slice(Math.min(b, e), Math.max(b, e) + 1);
    expect(range).toEqual(["b", "c", "d", "e"]);
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

describe("layoutJustifiedRows", () => {
  it("keeps equal height within a row and fills the container width", () => {
    const rows = layoutJustifiedRows(
      [
        { id: "a", aspectRatio: 16 / 9 },
        { id: "b", aspectRatio: 1 },
        { id: "c", aspectRatio: 9 / 16 },
      ],
      900,
      120,
      14,
    );
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    const widths = row.items.map((item) => item.width);
    const gaps = 14 * (row.items.length - 1);
    expect(widths.reduce((sum, w) => sum + w, 0) + gaps).toBeCloseTo(900, 0);
    expect(new Set(row.items.map((item) => item.height)).size).toBe(1);
  });

  it("splits into multiple rows when items overflow the target height packing", () => {
    const rows = layoutJustifiedRows(
      [
        { id: "a", aspectRatio: 2 },
        { id: "b", aspectRatio: 2 },
        { id: "c", aspectRatio: 2 },
        { id: "d", aspectRatio: 2 },
      ],
      400,
      100,
      10,
    );
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      expect(new Set(row.items.map((item) => item.height)).size).toBe(1);
    }
  });

  it("does not stretch a sparse last row across the full width", () => {
    const rows = layoutJustifiedRows(
      [{ id: "solo", aspectRatio: 1 }],
      800,
      100,
      14,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.height).toBe(100);
    expect(rows[0]!.items[0]!.width).toBe(100);
  });
});
