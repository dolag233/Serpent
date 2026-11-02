import { describe, expect, it } from "vitest";

import {
  ASSET_GRID_GAP_PX,
  assetGridLayoutStyle,
  aspectRatioForAsset,
  countFittingColumns,
  distributeIntegerRowWidths,
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

describe("missing asset dimensions", () => {
  it("uses the font specimen ratio for justified layout", () => {
    expect(aspectRatioForAsset(null, null, "font")).toBe(16 / 9);
    expect(aspectRatioForAsset(null, null, "document")).toBe(1);
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

    // Shortest-load packing with ASSET_GRID_GAP_PX=14 → [a] | [b,d,e] | [c].
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

  it("keeps masonry keyboard focus ids in asset-array order (SELECT-015)", () => {
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

describe("distributeIntegerRowWidths (Serpent-oq86)", () => {
  it("emits whole pixels that sum exactly to the usable width", () => {
    const widths = distributeIntegerRowWidths([16 / 9, 1, 9 / 16], 180, 872);
    expect(widths.every((width) => Number.isInteger(width) && width >= 1)).toBe(
      true,
    );
    expect(widths.reduce((sum, width) => sum + width, 0)).toBe(872);
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
      ASSET_GRID_GAP_PX,
    );
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    const widths = row.items.map((item) => item.width);
    const gaps = ASSET_GRID_GAP_PX * (row.items.length - 1);
    expect(widths.every((width) => Number.isInteger(width))).toBe(true);
    expect(Number.isInteger(row.height)).toBe(true);
    expect(widths.reduce((sum, w) => sum + w, 0) + gaps).toBe(900);
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
      ASSET_GRID_GAP_PX,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.height).toBe(100);
    expect(rows[0]!.items[0]!.width).toBe(100);
  });
});

describe("layoutJustifiedRows closest-break smoothing", () => {
  it("includes the overflowing item when that lands nearer the target height", () => {
    // 1000px wide, target 200: three 1.5 aspect items natural = 900 + gaps.
    // Greedy would close with 3 (scaled ~1.08); a 4th tall item (0.7) gives
    // ~1.0 overall, which is closer to target.
    const items = [1.5, 1.5, 1.5, 0.7, 1.5].map((aspectRatio, i) => ({ id: String(i), aspectRatio }));
    const rows = layoutJustifiedRows(items, 1000, 200, 10);
    expect(rows[0]!.items).toHaveLength(4);
    expect(Math.abs(rows[0]!.height - 200)).toBeLessThan(20);
  });
});

describe("layoutJustifiedRows minimum slot aspect", () => {
  it("never makes a slot narrower than JUSTIFIED_MIN_SLOT_ASPECT x height", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: String(i), aspectRatio: 0.3 }));
    const rows = layoutJustifiedRows(items, 900, 200, 10);
    for (const row of rows) for (const item of row.items) {
      expect(item.width / row.height).toBeGreaterThanOrEqual(0.6);
    }
  });
});
