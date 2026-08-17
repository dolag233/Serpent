import { describe, expect, it } from "vitest";

import {
  captureAnchor,
  clampScrollOffset,
  computeAnchorScrollDelta,
  pickNearestCard,
  rectLikeFromDomRect,
  type AnchorCard,
} from "../../src/renderer/canvas-scroll-anchor";

describe("rectLikeFromDomRect", () => {
  it("copies non-enumerable DOMRect geometry accessors explicitly", () => {
    const rect = Object.defineProperties(
      {},
      {
        left: { value: 12, enumerable: false },
        top: { value: 34, enumerable: false },
        width: { value: 56, enumerable: false },
        height: { value: 78, enumerable: false },
      },
    ) as DOMRectReadOnly;

    expect({ ...rect }).toEqual({});
    expect(rectLikeFromDomRect(rect)).toEqual({
      left: 12,
      top: 34,
      width: 56,
      height: 78,
    });
  });
});

describe("pickNearestCard", () => {
  const viewport = { left: 0, top: 0, width: 800, height: 600 };
  const cards: AnchorCard[] = [
    { assetId: "a", left: 0, top: 0, width: 100, height: 100 },
    { assetId: "b", left: 200, top: 0, width: 100, height: 100 },
    { assetId: "c", left: 0, top: 900, width: 100, height: 100 }, // below viewport
  ];

  it("picks the card whose center is closest to the point", () => {
    const picked = pickNearestCard(cards, viewport, 210, 10);
    expect(picked?.assetId).toBe("b");
  });

  it("prefers cards overlapping the viewport band over off-screen ones", () => {
    const picked = pickNearestCard(cards, viewport, 40, 920);
    // "c" is closest in raw distance but sits outside the visible band,
    // so a visible card should win instead.
    expect(picked?.assetId).not.toBe("c");
  });

  it("falls back to the closest card overall when none overlap the viewport", () => {
    const offscreenOnly: AnchorCard[] = [
      { assetId: "x", left: 0, top: 900, width: 100, height: 100 },
      { assetId: "y", left: 500, top: 1200, width: 100, height: 100 },
    ];
    const picked = pickNearestCard(offscreenOnly, viewport, 40, 920);
    expect(picked?.assetId).toBe("x");
  });

  it("returns null for an empty card list", () => {
    expect(pickNearestCard([], viewport, 0, 0)).toBeNull();
  });
});

describe("captureAnchor / computeAnchorScrollDelta", () => {
  const card: AnchorCard = { assetId: "a", left: 100, top: 50, width: 200, height: 100 };

  it("captures ratio 0.5/0.5 for the card's exact center", () => {
    const anchor = captureAnchor(card, 200, 100);
    expect(anchor.ratioX).toBeCloseTo(0.5);
    expect(anchor.ratioY).toBeCloseTo(0.5);
  });

  it("captures ratio 0/0 for the card's top-left corner", () => {
    const anchor = captureAnchor(card, card.left, card.top);
    expect(anchor.ratioX).toBeCloseTo(0);
    expect(anchor.ratioY).toBeCloseTo(0);
  });

  it("produces zero delta when the card reflows to the exact same rect", () => {
    const anchor = captureAnchor(card, 200, 100);
    const delta = computeAnchorScrollDelta(anchor, card);
    expect(delta.deltaX).toBeCloseTo(0);
    expect(delta.deltaY).toBeCloseTo(0);
  });

  it("computes the delta needed to keep the anchor point stable after reflow", () => {
    const anchor = captureAnchor(card, 200, 100); // center anchor
    const reflowed = { left: 300, top: 150, width: 200, height: 100 };
    const delta = computeAnchorScrollDelta(anchor, reflowed);
    // Card moved +200 right / +100 down; scroll must shift by the same amount.
    expect(delta.deltaX).toBeCloseTo(200);
    expect(delta.deltaY).toBeCloseTo(100);
  });

  it("accounts for size changes alongside position changes", () => {
    const anchor = captureAnchor(card, card.left, card.top); // top-left anchor, ratio 0/0
    const grown = { left: 100, top: 50, width: 400, height: 200 };
    const delta = computeAnchorScrollDelta(anchor, grown);
    // Ratio 0/0 means only the top-left corner matters, size growth is irrelevant.
    expect(delta.deltaX).toBeCloseTo(0);
    expect(delta.deltaY).toBeCloseTo(0);
  });

  it("handles zero-size cards without dividing by zero", () => {
    const zeroCard: AnchorCard = { assetId: "z", left: 10, top: 10, width: 0, height: 0 };
    const anchor = captureAnchor(zeroCard, 10, 10);
    expect(anchor.ratioX).toBe(0.5);
    expect(anchor.ratioY).toBe(0.5);
  });
});

describe("clampScrollOffset", () => {
  it("clamps below zero up to zero", () => {
    expect(clampScrollOffset(-50, 1000, 400)).toBe(0);
  });

  it("clamps above the max scrollable extent", () => {
    expect(clampScrollOffset(10000, 1000, 400)).toBe(600);
  });

  it("passes through in-range values unchanged", () => {
    expect(clampScrollOffset(300, 1000, 400)).toBe(300);
  });

  it("clamps to zero when content is smaller than the viewport", () => {
    expect(clampScrollOffset(50, 300, 400)).toBe(0);
  });
});
