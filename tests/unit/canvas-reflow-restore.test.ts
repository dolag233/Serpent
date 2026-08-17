import { describe, expect, it } from "vitest";

import {
  captureReflowAnchorFromCards,
  isCanvasReflowRestorationPending,
  pickTopmostVisibleCard,
  retainReflowAnchor,
  scheduleAnchorRestore,
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

describe("retainReflowAnchor", () => {
  it("does not replace the anchor during a continuous resize burst", () => {
    const first = captureReflowAnchorFromCards(
      [{ assetId: "first", left: 0, top: 120, width: 100, height: 100 }],
      { left: 0, top: 100, width: 800, height: 600 },
    );
    const retained = retainReflowAnchor(
      first,
      [{ assetId: "later", left: 0, top: 0, width: 100, height: 100 }],
      { left: 0, top: 0, width: 800, height: 600 },
    );
    expect(retained).toBe(first);
    expect(retained?.assetId).toBe("first");
  });
});

describe("isCanvasReflowRestorationPending", () => {
  const element = (classes: string[]) => ({
    classList: {
      contains: (name: string) => classes.includes(name),
    },
  });

  it("suspends child raw-scroll restoration while the canvas is frozen", () => {
    expect(isCanvasReflowRestorationPending(element(["is-reflow-frozen"]))).toBe(
      true,
    );
  });

  it("suspends child raw-scroll restoration while the anchor settles", () => {
    expect(
      isCanvasReflowRestorationPending(element(["is-reflow-restoring"])),
    ).toBe(true);
  });

  it("allows child restoration outside a reflow", () => {
    expect(isCanvasReflowRestorationPending(element(["workspace-canvas"]))).toBe(
      false,
    );
    expect(isCanvasReflowRestorationPending(null)).toBe(false);
  });
});

describe("scheduleAnchorRestore", () => {
  it("keeps the compensated offset after restoring a captured scroll snapshot", () => {
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

    const canvas = {
      scrollLeft: 0,
      scrollTop: 1_000,
      scrollWidth: 800,
      scrollHeight: 4_000,
      clientWidth: 800,
      clientHeight: 600,
      querySelectorAll: () => [card],
    } as unknown as HTMLElement;
    const card = {
      dataset: { assetId: "lead" },
      getBoundingClientRect: () => ({
        left: 40,
        top: 1_500 - canvas.scrollTop,
        width: 120,
        height: 100,
        right: 160,
        bottom: 1_600 - canvas.scrollTop,
        x: 40,
        y: 1_500 - canvas.scrollTop,
        toJSON() {
          return {};
        },
      }),
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
      1,
      undefined,
      { left: 0, top: 1_000 },
    );

    while (rafQueue.length > 0) {
      const next = rafQueue.shift();
      next?.(0);
    }

    // The reflow moved the card's document top from 1080 to 1500. Restoring
    // the exact client anchor therefore requires scrollTop 1500 - 80 = 1420.
    expect(canvas.scrollTop).toBeCloseTo(1_420);

    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
  });

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
        top: 500 - canvas.scrollTop,
        width: 120,
        height: 100,
        right: 160,
        bottom: 600 - canvas.scrollTop,
        x: 40,
        y: 500 - canvas.scrollTop,
        toJSON() {
          return {};
        },
      }),
    } as unknown as HTMLElement;

    const canvas = {
      scrollLeft: 0,
      scrollTop: 0,
      scrollWidth: 800,
      scrollHeight: 4000,
      clientWidth: 800,
      clientHeight: 600,
      querySelectorAll: () => [card],
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
    canvas.scrollTop = 0;
    while (rafQueue.length > 0) {
      const next = rafQueue.shift();
      next?.(0);
    }

    // Card top 500 vs desired clientY 80 → scrollTop should move by ~420.
    expect(canvas.scrollTop).toBeCloseTo(420);

    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
  });
});
