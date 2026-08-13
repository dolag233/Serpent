import { describe, expect, it } from "vitest";

import { columnWindow } from "../../src/renderer/viewport-window";

describe("columnWindow", () => {
  it("returns an empty window for no items", () => {
    expect(columnWindow([], 0, 400)).toEqual({
      start: 0,
      end: 0,
      spacerBefore: 0,
      spacerAfter: 0,
      totalHeight: 0,
    });
  });

  it("keeps a contiguous visible slice and spacers for the rest", () => {
    const window = columnWindow([100, 100, 100, 100, 100], 150, 280);
    expect(window.start).toBe(1);
    expect(window.end).toBe(3);
    expect(window.spacerBefore).toBe(100);
    expect(window.spacerAfter).toBe(200);
    expect(window.totalHeight).toBe(500);
  });

  it("always keeps at least one item when the viewport lands inside the column", () => {
    const window = columnWindow([80, 80, 80], 90, 95);
    expect(window.end - window.start).toBeGreaterThanOrEqual(1);
    expect(window.start).toBe(1);
  });

  it("does not skip every item when estimated heights are missing", () => {
    const window = columnWindow([0, 0, 0, 0], 0, 2400);
    expect(window.start).toBe(0);
    expect(window.end).toBe(4);
    expect(window.totalHeight).toBe(4);
  });
});
