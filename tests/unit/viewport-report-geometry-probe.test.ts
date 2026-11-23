// @vitest-environment happy-dom

import type { Page } from "@playwright/test";
import { describe, expect, it } from "vitest";
import { installViewportReportGeometryProbe } from "../e2e/viewport-report-geometry-probe";

type PageFunction = (arg?: unknown) => unknown | Promise<unknown>;

function fakePage() {
  const listeners = new Set<(error: Error) => void>();
  const page = {
    evaluate: async (fn: PageFunction, arg?: unknown) => fn(arg),
    on: (event: string, listener: (error: Error) => void) => {
      if (event === "pageerror") listeners.add(listener);
    },
    off: (event: string, listener: (error: Error) => void) => {
      if (event === "pageerror") listeners.delete(listener);
    },
  } as unknown as Page;
  return {
    page,
    emitPageError(error = new Error("synthetic renderer error")) {
      for (const listener of listeners) listener(error);
    },
    get pageErrorListenerCount() { return listeners.size; },
  };
}

function rectangle(top: number, bottom: number): DOMRect {
  return { top, bottom } as DOMRect;
}

describe("viewport report geometry probe", () => {
  it("counts renderer geometry reads, compares exact visible order, checkpoints settled DOM, and restores the method", async () => {
    document.body.replaceChildren();
    const previousDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "getBoundingClientRect");
    const rectangles = new WeakMap<Element, DOMRect>();
    const receivedArgs: unknown[][] = [];
    const originalMethod = function (this: Element, ...args: unknown[]): DOMRect {
      receivedArgs.push(args);
      return rectangles.get(this) ?? rectangle(0, 0);
    };
    Object.defineProperty(Element.prototype, "getBoundingClientRect", {
      configurable: true,
      enumerable: previousDescriptor?.enumerable ?? false,
      writable: true,
      value: originalMethod,
    });
    const installedDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "getBoundingClientRect");

    const outside = document.createElement("div");
    const canvas = document.createElement("main");
    canvas.className = "workspace-canvas";
    const grid = document.createElement("section");
    grid.className = "masonry-columns";
    const slot = document.createElement("div");
    slot.dataset.layoutAssetId = "asset-alpha";
    const card = document.createElement("button");
    card.className = "asset-card";
    card.dataset.assetId = "asset-alpha";
    const partial = document.createElement("button");
    partial.className = "asset-card";
    partial.dataset.assetId = "asset-gamma";
    const touching = document.createElement("button");
    touching.className = "asset-card";
    touching.dataset.assetId = "asset-touching";
    const placeholder = document.createElement("div");
    placeholder.dataset.layoutAssetId = "__geometry__:empty-slot";
    slot.append(card);
    grid.append(slot, partial, touching, placeholder);
    canvas.append(grid);
    document.body.append(outside, canvas);

    rectangles.set(canvas, rectangle(100, 300));
    rectangles.set(grid, rectangle(100, 300));
    rectangles.set(slot, rectangle(90, 110));
    rectangles.set(card, rectangle(90, 110));
    rectangles.set(partial, rectangle(299, 320));
    rectangles.set(touching, rectangle(60, 100));
    rectangles.set(placeholder, rectangle(120, 140));
    rectangles.set(outside, rectangle(0, 100));

    const page = fakePage();
    let probe: Awaited<ReturnType<typeof installViewportReportGeometryProbe>> | undefined;
    try {
      probe = await installViewportReportGeometryProbe(page.page, { compareDom: true });
      await expect(installViewportReportGeometryProbe(page.page, { compareDom: true }))
        .rejects.toThrow("already installed");

      const canvasRect = rectangles.get(canvas)!;
      expect(Reflect.apply(canvas.getBoundingClientRect, canvas, ["first", 7])).toBe(canvasRect);
      grid.getBoundingClientRect();
      slot.getBoundingClientRect();
      card.getBoundingClientRect();
      outside.getBoundingClientRect();
      expect(receivedArgs[0]).toEqual(["first", 7]);

      window.dispatchEvent(new CustomEvent("serpent:e2e-visible-window", {
        detail: { visible: ["asset-alpha", "asset-gamma"] },
      }));
      const first = await probe.read();
      expect(first).toEqual({
        reads: { total: 4, workspaceCanvas: 1, grid: 1, layoutSlot: 1, card: 1, other: 0 },
        comparisons: {
          events: 1, comparedIds: 2, mismatches: 0, missing: 0, extra: 0, orderOnly: 0,
        },
        checkpoint: {
          referenceCount: 0, reportedCount: 0, checkpointCompared: 0, comparedIds: 0,
          mismatches: 0, missing: 0, extra: 0, orderOnly: 0,
        },
        pageErrors: 0,
      });
      expect(JSON.stringify(first)).not.toContain("asset-");
      expect(JSON.stringify(first)).not.toContain("__geometry__:");

      window.dispatchEvent(new CustomEvent("serpent:e2e-visible-window", {
        detail: { visible: ["asset-gamma", "asset-alpha"] },
      }));
      window.dispatchEvent(new CustomEvent("serpent:e2e-visible-window", {
        detail: { visible: ["asset-alpha", "asset-extra"] },
      }));
      expect((await probe.read()).comparisons).toEqual({
        events: 3, comparedIds: 6, mismatches: 2, missing: 1, extra: 1, orderOnly: 1,
      });

      rectangles.set(partial, rectangle(300, 320));
      await probe.reset();
      const checkpoint = await probe.checkpoint();
      expect(checkpoint).toEqual({
        referenceCount: 1,
        reportedCount: 2,
        checkpointCompared: 1,
        comparedIds: 2,
        mismatches: 1,
        missing: 0,
        extra: 1,
        orderOnly: 0,
      });
      const afterReset = await probe.read();
      expect(afterReset.reads.total).toBe(0);
      expect(afterReset.comparisons).toEqual({
        events: 0, comparedIds: 0, mismatches: 0, missing: 0, extra: 0, orderOnly: 0,
      });
      expect(afterReset.checkpoint).toEqual(checkpoint);
      expect(receivedArgs.length).toBeGreaterThan(5);
    } finally {
      await probe?.dispose();
      expect(Object.getOwnPropertyDescriptor(Element.prototype, "getBoundingClientRect"))
        .toEqual(installedDescriptor);
      if (previousDescriptor) Object.defineProperty(Element.prototype, "getBoundingClientRect", previousDescriptor);
      else Reflect.deleteProperty(Element.prototype, "getBoundingClientRect");
      document.body.replaceChildren();
    }
  });

  it("reports renderer page errors when disposed and still restores the original descriptor", async () => {
    const page = fakePage();
    const originalDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "getBoundingClientRect");
    const probe = await installViewportReportGeometryProbe(page.page);
    page.emitPageError();

    await expect(probe.dispose()).rejects.toThrow("observed 1 renderer page error(s)");
    expect(page.pageErrorListenerCount).toBe(0);
    expect(Object.getOwnPropertyDescriptor(Element.prototype, "getBoundingClientRect")).toEqual(originalDescriptor);
  });
});
