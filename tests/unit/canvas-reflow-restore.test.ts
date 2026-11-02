import { describe, expect, it } from "vitest";

import { publishCanvasAssetLayoutIndex } from "../../src/renderer/canvas-asset-layout";
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
  it("leaves a later scrollbar jump in control during a pending reflow restore", () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    const listeners = new Map<string, Set<() => void>>();
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancel = globalThis.cancelAnimationFrame;
    let nextFrame = 0;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      const id = ++nextFrame;
      callbacks.set(id, callback);
      return id;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) => {
      callbacks.delete(id);
    }) as typeof cancelAnimationFrame;
    try {
      const canvas = {
        scrollLeft: 0,
        scrollTop: 1_000,
        scrollWidth: 800,
        scrollHeight: 100_000,
        clientWidth: 800,
        clientHeight: 600,
        addEventListener: (type: string, callback: () => void) => {
          if (!listeners.has(type)) listeners.set(type, new Set());
          listeners.get(type)!.add(callback);
        },
        removeEventListener: (type: string, callback: () => void) => {
          listeners.get(type)?.delete(callback);
        },
        querySelectorAll: () => [],
      } as unknown as HTMLElement;
      const frameRef = { current: null as number | null };
      let restoreCompletions = 0;
      const onRestored = () => { restoreCompletions += 1; };
      scheduleAnchorRestore(canvas, {
        assetId: "lead",
        ratioX: 0.5,
        ratioY: 0,
        clientX: 100,
        clientY: 80,
      }, frameRef, 3, onRestored, { left: 0, top: 1_000 });

      canvas.scrollTop = 55_000;
      for (const callback of listeners.get("scroll") ?? []) callback();
      while (callbacks.size > 0) {
        const [id, callback] = callbacks.entries().next().value!;
        callbacks.delete(id);
        callback(0);
      }

      expect(canvas.scrollTop).toBe(55_000);
      expect(frameRef.current).toBeNull();
      expect(restoreCompletions).toBe(1);
      expect([...listeners.values()].every((set) => set.size === 0)).toBe(true);
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCancel;
    }
  });

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
    const listeners = new Map<string, Set<() => void>>();
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
      scrollTop: 1_000,
      scrollWidth: 800,
      scrollHeight: 4000,
      clientWidth: 800,
      clientHeight: 600,
      addEventListener: (type: string, callback: () => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(callback);
      },
      removeEventListener: (type: string, callback: () => void) => {
        listeners.get(type)?.delete(callback);
      },
      querySelectorAll: () => [card],
    };

    const frameRef: { current: number | null } = { current: null };
    scheduleAnchorRestore(
      canvas as unknown as HTMLElement,
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

    // A temporary content-height collapse clamps scrollTop to zero. The
    // delayed restore must still run after the height returns.
    canvas.scrollHeight = 600;
    canvas.scrollTop = 0;
    for (const callback of listeners.get("scroll") ?? []) callback();
    canvas.scrollHeight = 4_000;
    while (rafQueue.length > 0) {
      const next = rafQueue.shift();
      next?.(0);
    }

    // Card top 500 vs desired clientY 80 → scrollTop should move by ~420.
    expect(canvas.scrollTop).toBeCloseTo(420);

    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
  });

  it("scrolls toward published geometry when the anchor card is unmounted", () => {
    const rafQueue: FrameRequestCallback[] = [];
    const scrollListeners: Array<() => void> = [];
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
      scrollTop: 0,
      scrollWidth: 800,
      scrollHeight: 8_000,
      clientWidth: 800,
      clientHeight: 600,
      addEventListener: (type: string, listener: () => void) => {
        if (type === 'scroll') scrollListeners.push(listener);
      },
      removeEventListener: (type: string, listener: () => void) => {
        if (type !== 'scroll') return;
        const index = scrollListeners.indexOf(listener);
        if (index >= 0) scrollListeners.splice(index, 1);
      },
      querySelectorAll: (selector: string) => {
        if (selector === ".justified-rows, .masonry-columns") return [host];
        return [];
      },
    } as unknown as HTMLElement;
    const host = {
      getBoundingClientRect: () => ({
        left: 0,
        top: -canvas.scrollTop,
        width: 800,
        height: 8_000,
        right: 800,
        bottom: 8_000 - canvas.scrollTop,
        x: 0,
        y: -canvas.scrollTop,
        toJSON() {
          return {};
        },
      }),
    } as unknown as HTMLElement;
    publishCanvasAssetLayoutIndex(host, {
      total: 1,
      forEachIntersecting: () => undefined,
      forEachAll: (visit) => {
        visit({ id: "lead", x: 40, y: 2_000, width: 120, height: 100 });
      },
    });

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
    );

    // The first frame writes a large internal scroll offset. Its subsequent
    // scroll event must not cancel the remaining mount/alignment passes.
    rafQueue.shift()?.(0);
    expect(canvas.scrollTop).toBeCloseTo(1_920);
    for (const listener of scrollListeners) listener();
    expect(frameRef.current).not.toBeNull();
    while (rafQueue.length > 0) {
      const next = rafQueue.shift();
      next?.(0);
    }

    // Content top 2000 should land on clientY 80.
    expect(canvas.scrollTop).toBeCloseTo(1_920);

    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
  });
});
