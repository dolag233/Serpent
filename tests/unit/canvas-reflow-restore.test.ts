import { describe, expect, it } from "vitest";

import {
  captureReflowAnchorFromCards,
  pickTopmostVisibleCard,
  scheduleAnchorRestore,
  scheduleCanvasReflowRestore,
  type AnchorCard,
} from "../../src/renderer/canvas-reflow-restore";

describe("pickTopmostVisibleCard", () => {
  const viewport = { left: 0, top: 100, width: 800, height: 600 };
  const cards: AnchorCard[] = [
    { assetId: "a", left: 0, top: 120, width: 100, height: 100 },
    { assetId: "b", left: 200, top: 120, width: 100, height: 100 },
    { assetId: "c", left: 0, top: 400, width: 100, height: 100 },
    { assetId: "d", left: 0, top: 900, width: 100, height: 100 },
  ];

  it("picks the topmost visible card (then leftmost)", () => {
    expect(pickTopmostVisibleCard(cards, viewport)?.assetId).toBe("a");
  });

  it("falls back to closest overall when none overlap", () => {
    const off = [
      { assetId: "x", left: 0, top: 900, width: 100, height: 100 },
      { assetId: "y", left: 0, top: 1200, width: 100, height: 100 },
    ];
    expect(pickTopmostVisibleCard(off, viewport)?.assetId).toBe("x");
  });
});

describe("captureReflowAnchorFromCards", () => {
  it("anchors the topmost visible card at its top-center", () => {
    const viewport = { left: 0, top: 0, width: 800, height: 600 };
    const cards: AnchorCard[] = [
      { assetId: "lead", left: 40, top: 80, width: 120, height: 100 },
      { assetId: "below", left: 40, top: 300, width: 120, height: 100 },
    ];
    const anchor = captureReflowAnchorFromCards(cards, viewport);
    expect(anchor?.assetId).toBe("lead");
    expect(anchor?.clientX).toBeCloseTo(100);
    expect(anchor?.clientY).toBeCloseTo(80);
  });
});

describe("scheduleAnchorRestore", () => {
  it("restores scroll even when scrollTop drifted during the wait (Serpent-32p)", () => {
    const rafQueue: FrameRequestCallback[] = [];
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) => {
      rafQueue[id - 1] = () => undefined;
    }) as typeof cancelAnimationFrame;

    const card = {
      dataset: { assetId: "lead" },
      getBoundingClientRect: () => ({
        left: 40,
        top: 500,
        width: 120,
        height: 100,
        right: 160,
        bottom: 600,
        x: 40,
        y: 500,
        toJSON() {
          return {};
        },
      }),
    } as unknown as HTMLElement;

    let scrollTop = 0;
    const canvas = {
      get scrollLeft() {
        return 0;
      },
      get scrollTop() {
        return scrollTop;
      },
      scrollWidth: 800,
      scrollHeight: 4000,
      clientWidth: 800,
      clientHeight: 600,
      scrollTo: ({ top }: { left: number; top: number }) => {
        scrollTop = top;
      },
      querySelectorAll: () => [card],
      querySelector: () => card,
    } as unknown as HTMLElement;

    const frameRef: { current: number | null } = { current: null };
    scheduleAnchorRestore(
      canvas,
      {
        assetId: "lead",
        ratioX: 0.5,
        ratioY: 0,
        clientX: 100,
        clientY: 80,
      },
      frameRef,
      3,
    );

    // Simulate unintended scroll reset to 0 during reflow (the old bail path).
    scrollTop = 0;
    while (rafQueue.length > 0) {
      const next = rafQueue.shift();
      next?.(0);
    }

    // Card top 500 vs desired clientY 80 → scrollTop should move by ~420.
    expect(scrollTop).toBeCloseTo(420);

    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
  });

  it("uses captured scrollTop before anchor correction (viewer-close parity)", () => {
    const rafQueue: FrameRequestCallback[] = [];
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) => {
      rafQueue[id - 1] = () => undefined;
    }) as typeof cancelAnimationFrame;

    let scrollTop = 0;
    const card = {
      dataset: { assetId: "lead" },
      getBoundingClientRect: () => ({
        left: 40,
        top: 80,
        width: 120,
        height: 100,
        right: 160,
        bottom: 180,
        x: 40,
        y: 80,
        toJSON() {
          return {};
        },
      }),
    } as unknown as HTMLElement;

    const canvas = {
      get scrollLeft() {
        return 0;
      },
      get scrollTop() {
        return scrollTop;
      },
      scrollWidth: 800,
      scrollHeight: 4000,
      clientWidth: 800,
      clientHeight: 600,
      scrollTo: ({ top }: { left: number; top: number }) => {
        scrollTop = top;
      },
      querySelector: () => card,
      querySelectorAll: () => [card],
    } as unknown as HTMLElement;

    const frameRef: { current: number | null } = { current: null };
    scheduleCanvasReflowRestore(
      canvas,
      {
        scrollLeft: 0,
        scrollTop: 800,
        anchor: {
          assetId: "lead",
          ratioX: 0.5,
          ratioY: 0,
          clientX: 100,
          clientY: 80,
        },
      },
      frameRef,
      { settleFrames: 0, maxPasses: 1 },
    );

    while (rafQueue.length > 0) {
      const next = rafQueue.shift();
      next?.(0);
    }

    expect(scrollTop).toBe(800);

    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
  });
});
