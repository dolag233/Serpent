import { describe, expect, it } from "vitest";

import {
  captureBrowseViewSnapshot,
  resolveBrowseRestoreScroll,
  type ScrollExtent,
} from "../../src/renderer/view-restore";

const extent: ScrollExtent = {
  scrollWidth: 2000,
  scrollHeight: 4000,
  clientWidth: 800,
  clientHeight: 600,
};

describe("captureBrowseViewSnapshot", () => {
  it("captures a center anchor when the card rect is known", () => {
    const snapshot = captureBrowseViewSnapshot(
      "asset-1",
      { left: 100, top: 200, width: 150, height: 150 },
      50,
      300,
    );
    expect(snapshot.scrollLeft).toBe(50);
    expect(snapshot.scrollTop).toBe(300);
    expect(snapshot.anchor?.assetId).toBe("asset-1");
    expect(snapshot.anchor?.ratioX).toBeCloseTo(0.5);
    expect(snapshot.anchor?.ratioY).toBeCloseTo(0.5);
  });

  it("captures a null anchor when the card rect is unknown", () => {
    const snapshot = captureBrowseViewSnapshot("asset-1", null, 50, 300);
    expect(snapshot.anchor).toBeNull();
    expect(snapshot.scrollLeft).toBe(50);
    expect(snapshot.scrollTop).toBe(300);
  });
});

describe("resolveBrowseRestoreScroll", () => {
  it("returns the raw clamped scroll position when there is no anchor", () => {
    const snapshot = captureBrowseViewSnapshot("asset-1", null, 500, 1200);
    const result = resolveBrowseRestoreScroll(snapshot, null, extent);
    expect(result).toEqual({ left: 500, top: 1200 });
  });

  it("clamps the raw fallback position to the current scroll extent", () => {
    const snapshot = captureBrowseViewSnapshot("asset-1", null, 9000, 9000);
    const result = resolveBrowseRestoreScroll(snapshot, null, extent);
    expect(result).toEqual({
      left: extent.scrollWidth - extent.clientWidth,
      top: extent.scrollHeight - extent.clientHeight,
    });
  });

  it("returns the raw position unchanged when the card reflowed to the same spot", () => {
    const cardRect = { left: 100, top: 200, width: 150, height: 150 };
    const snapshot = captureBrowseViewSnapshot("asset-1", cardRect, 500, 1200);
    const result = resolveBrowseRestoreScroll(snapshot, cardRect, extent);
    expect(result.left).toBeCloseTo(500);
    expect(result.top).toBeCloseTo(1200);
  });

  it("corrects the scroll position when the card moved due to reflow while viewing", () => {
    const openedCardRect = { left: 100, top: 200, width: 150, height: 150 };
    const snapshot = captureBrowseViewSnapshot("asset-1", openedCardRect, 500, 1200);
    // Grid became narrower while viewing (e.g. inspector panel opened), so the
    // same asset now renders further down and to the right within its row.
    const reflowedCardRect = { left: 100, top: 260, width: 130, height: 130 };
    const result = resolveBrowseRestoreScroll(snapshot, reflowedCardRect, extent);
    // Card's center moved down by 45px (260+65 - (200+75) = 325-275=50, adjusted
    // for the size delta too); the corrected top should differ from the raw 1200.
    expect(result.top).not.toBeCloseTo(1200, 0);
  });

  it("clamps the corrected position to the current scroll extent", () => {
    const openedCardRect = { left: 100, top: 200, width: 150, height: 150 };
    const snapshot = captureBrowseViewSnapshot("asset-1", openedCardRect, 500, 3900);
    const reflowedCardRect = { left: 100, top: 5000, width: 150, height: 150 };
    const result = resolveBrowseRestoreScroll(snapshot, reflowedCardRect, extent);
    expect(result.top).toBeLessThanOrEqual(extent.scrollHeight - extent.clientHeight);
    expect(result.top).toBeGreaterThanOrEqual(0);
  });
});
