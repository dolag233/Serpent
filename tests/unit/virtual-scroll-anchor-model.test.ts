import { describe, expect, it } from "vitest";

import {
  captureVirtualScrollAnchor,
  virtualScrollAnchorDelta,
  type VirtualScrollAnchorModel,
} from "../../src/renderer/browse/virtual-scroll-anchor-model";

function model(rects: Array<{ top: number; height: number }>): VirtualScrollAnchorModel {
  return {
    rectAtIndex: (index) => rects[index] ?? null,
    firstVisibleIndex: (visibleStart) => {
      const index = rects.findIndex((rect) => rect.top + rect.height > visibleStart);
      return index < 0 ? null : index;
    },
  };
}

describe("virtual scroll anchor geometry", () => {
  it("keeps the same visible slot while an earlier card gains height", () => {
    const before = model([
      { top: 0, height: 200 },
      { top: 214, height: 200 },
      { top: 428, height: 200 },
    ]);
    const anchor = captureVirtualScrollAnchor(before, 450, 1_050, null);
    expect(anchor).toEqual({ index: 2, top: 428 });
    const after = model([
      { top: 0, height: 350 },
      { top: 364, height: 200 },
      { top: 578, height: 200 },
    ]);
    expect(virtualScrollAnchorDelta(after, anchor!)).toBe(150);
    expect(captureVirtualScrollAnchor(after, 600, 1_200, anchor)).toEqual({ index: 2, top: 578 });
  });

  it("moves to the next slot after scrolling past the previous anchor", () => {
    const geometry = model([
      { top: 0, height: 200 },
      { top: 214, height: 200 },
      { top: 428, height: 200 },
    ]);
    expect(captureVirtualScrollAnchor(geometry, 450, 1_050, { index: 0, top: 0 }))
      .toEqual({ index: 2, top: 428 });
    expect(virtualScrollAnchorDelta(geometry, { index: 10, top: 0 })).toBeNull();
  });

  it("drops an anchor below the viewport after a distant upward jump", () => {
    const geometry = model([
      { top: 0, height: 200 },
      { top: 214, height: 200 },
      { top: 428, height: 200 },
    ]);
    expect(captureVirtualScrollAnchor(geometry, 0, 200, { index: 2, top: 428 }))
      .toEqual({ index: 0, top: 0 });
  });
});
