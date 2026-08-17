import { describe, expect, it } from "vitest";

import {
  columnWindow,
  quantizeCanvasViewportOffsetPx,
  viewportOverscanPx,
} from "../../src/renderer/viewport-window";

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

  it("covers the requested view when window heights match layout heights", () => {
    const heights = [320, 180, 400, 220, 500, 260, 310, 280];
    const viewStart = 500;
    const viewEnd = 900;
    const slice = columnWindow(heights, viewStart, viewEnd);
    const mounted = heights
      .slice(slice.start, slice.end)
      .reduce((sum, height) => sum + height, 0);
    expect(slice.spacerBefore + mounted).toBeGreaterThanOrEqual(viewEnd);
    expect(slice.spacerBefore).toBeLessThanOrEqual(viewStart + heights[slice.start]!);
  });
});

describe("quantizeCanvasViewportOffsetPx (Serpent-oq86)", () => {
  it("snaps fractional layout edges to whole CSS pixels", () => {
    expect(quantizeCanvasViewportOffsetPx(10.4)).toBe(10);
    expect(quantizeCanvasViewportOffsetPx(10.5)).toBe(11);
    expect(quantizeCanvasViewportOffsetPx(Number.NaN)).toBe(0);
  });
});

describe("viewportOverscanPx (Serpent-1s3d)", () => {
  it("keeps at least five viewports of runway so a fast flick cannot outrun the window", () => {
    expect(viewportOverscanPx(900)).toBeGreaterThanOrEqual(4500);
    expect(viewportOverscanPx(1200)).toBeGreaterThanOrEqual(6000);
  });

  it("grows with large card size because each card consumes more of the overscan budget", () => {
    const compact = viewportOverscanPx(800, 96);
    const fourthStop = viewportOverscanPx(800, 280);
    expect(fourthStop).toBeGreaterThanOrEqual(compact);
    expect(fourthStop).toBeGreaterThanOrEqual(280 * 12);
  });
});

/**
 * Coverage of [viewStart, viewEnd] by the cards a stale `columnWindow`
 * still has mounted. A positive gap is the truncated white band after a
 * fast flick (Serpent-1s3d).
 */
function coverageGapForSlice(
  heights: readonly number[],
  slice: ReturnType<typeof columnWindow>,
  viewStart: number,
  viewEnd: number,
): number {
  let y = slice.spacerBefore;
  let coverageStart: number | null = null;
  let coverageEnd: number | null = null;
  for (let index = slice.start; index < slice.end; index += 1) {
    const height = heights[index] ?? 0;
    if (coverageStart === null) coverageStart = y;
    y += height;
    coverageEnd = y;
  }
  if (coverageStart === null || coverageEnd === null) {
    return Math.max(0, viewEnd - viewStart);
  }
  const visibleStart = Math.max(viewStart, coverageStart);
  const visibleEnd = Math.min(viewEnd, coverageEnd);
  if (visibleEnd <= visibleStart) {
    return Math.max(0, viewEnd - viewStart);
  }
  return Math.max(0, visibleStart - viewStart) + Math.max(0, viewEnd - visibleEnd);
}

describe("windowed viewport coverage (Serpent-1s3d)", () => {
  it("leaves a truncated white band when a 1200px overscan window lags a fast flick", () => {
    const heights = Array.from({ length: 80 }, () => 230);
    const previousScroll = 2000;
    const viewportHeight = 900;
    const staleOverscan = 1200;
    const stale = columnWindow(
      heights,
      previousScroll - staleOverscan,
      previousScroll + viewportHeight + staleOverscan,
    );
    const currentViewStart = 4200;
    const currentViewEnd = currentViewStart + viewportHeight;
    expect(
      coverageGapForSlice(heights, stale, currentViewStart, currentViewEnd),
    ).toBeGreaterThan(80);
  });

  it("covers the new viewport when overscan is at least five screens", () => {
    const heights = Array.from({ length: 80 }, () => 230);
    const previousScroll = 2000;
    const viewportHeight = 900;
    const overscan = viewportOverscanPx(viewportHeight, 280);
    const stale = columnWindow(
      heights,
      previousScroll - overscan,
      previousScroll + viewportHeight + overscan,
    );
    const currentViewStart = 4200;
    const currentViewEnd = currentViewStart + viewportHeight;
    expect(
      coverageGapForSlice(heights, stale, currentViewStart, currentViewEnd),
    ).toBe(0);
  });
});
