// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { CANVAS_LAYOUT_MEASURE, observeCanvasLayoutMeasure, settleCanvasLayout } from "../../src/renderer/canvas-layout-measure";
import { restoreVerticalReflowAnchor } from "../../src/renderer/canvas-reflow-restore";
import { publishCanvasAssetLayoutIndex } from "../../src/renderer/canvas-asset-layout";

describe("synchronous navigation layout", () => {
  it("stops after two publications when the viewport is already stable", () => {
    const measure = vi.fn();
    settleCanvasLayout({ scrollTop: 100 }, measure, () => {});
    expect(measure).toHaveBeenCalledTimes(2);
  });

  it("publishes a final virtual window when the last anchor pass still moves", () => {
    const canvas = { scrollTop: 100 };
    const measure = vi.fn();
    const restore = vi.fn(() => { canvas.scrollTop += 100; });
    settleCanvasLayout(canvas, measure, restore);
    expect(restore).toHaveBeenCalledTimes(3);
    expect(measure).toHaveBeenCalledTimes(4);
    expect(canvas.scrollTop).toBe(400);
  });

  it("measures only its canvas and releases the listener", () => {
    const canvas = document.createElement("div");
    canvas.className = "workspace-canvas";
    const host = document.createElement("div");
    canvas.append(host);
    const update = vi.fn();
    const stop = observeCanvasLayoutMeasure(host, update);
    document.createElement("div").dispatchEvent(new Event(CANVAS_LAYOUT_MEASURE));
    expect(update).not.toHaveBeenCalled();
    canvas.dispatchEvent(new Event(CANVAS_LAYOUT_MEASURE));
    expect(update).toHaveBeenCalledTimes(1);
    stop();
    canvas.dispatchEvent(new Event(CANVAS_LAYOUT_MEASURE));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("aligns a mounted card vertically without waiting for a frame or changing X", () => {
    const canvas = document.createElement("div");
    const card = document.createElement("div");
    card.dataset.assetId = "a";
    canvas.append(card);
    Object.defineProperties(canvas, { scrollHeight: { value: 4000 }, clientHeight: { value: 600 } });
    canvas.scrollTop = 1000;
    card.getBoundingClientRect = () => new DOMRect(224, 240, 180, 120);
    restoreVerticalReflowAnchor(canvas, { assetId: "a", ratioX: 0.5, ratioY: 0, clientX: 90, clientY: 40 });
    expect(canvas.scrollTop).toBe(1200);
    expect(canvas.scrollLeft).toBe(0);
  });

  it("uses published geometry before a virtual anchor remounts", () => {
    const canvas = document.createElement("div");
    const host = document.createElement("div");
    host.className = "masonry-columns";
    canvas.append(host);
    Object.defineProperties(canvas, { scrollHeight: { value: 8000 }, clientHeight: { value: 600 } });
    host.getBoundingClientRect = () => new DOMRect(224, -canvas.scrollTop, 800, 8000);
    publishCanvasAssetLayoutIndex(host, { total: 1, forEachIntersecting: () => {}, forEachAll: (visit) => visit({ id: "a", x: 40, y: 2000, width: 120, height: 100 }) });
    restoreVerticalReflowAnchor(canvas, { assetId: "a", ratioX: 0.5, ratioY: 0, clientX: 100, clientY: 80 });
    expect(canvas.scrollTop).toBe(1920);
    expect(canvas.scrollLeft).toBe(0);
  });
});
