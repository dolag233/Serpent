// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readCanvasLocalViewportSnapshot,
  useCanvasLocalViewport,
  type CanvasLocalViewportRange,
} from "../../src/renderer/viewport-window";
import { buildMasonryGeometry, virtualViewportRenderKey } from "../../src/renderer/browse/virtual-browse-canvas";

const geometry = buildMasonryGeometry({
  total: 100, columnCount: 1, columnWidth: 200,
  showCaption: false, captionBand: 0,
  entryAt: index => ({ assetId: `asset-${index}`, width: 200, height: 400 }),
});
const renderKey = (range: CanvasLocalViewportRange) => virtualViewportRenderKey(geometry, range);

describe("geometry-aware viewport publication", () => {
  let canvas: HTMLDivElement;
  let root: Root;
  let renders: number;
  let viewport: CanvasLocalViewportRange;
  let resize: ResizeObserverCallback;
  let height: number;
  let resizeObserverConstructions: number;
  let resizeObserverDisconnects: number;
  let elementRectReads: number;
  let canvasRectReads: number;
  let clientHeightReads: number;
  let scrollTopReads: number;

  function Harness({ keyForViewport = renderKey }: {
    keyForViewport?: ((range: CanvasLocalViewportRange) => string) | null;
  }) {
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
      // happy-dom has no scroll layout; model the grid's fixed content origin.
      if (ref.current) ref.current.getBoundingClientRect = () => {
        elementRectReads += 1;
        return ({ top: -canvas.scrollTop }) as DOMRect;
      };
    }, []);
    viewport = useCanvasLocalViewport(ref, 200, keyForViewport ?? undefined);
    renders += 1;
    return createElement("div", { ref, "data-grid": "" });
  }

  beforeEach(() => {
    renders = 0;
    height = 200;
    resizeObserverConstructions = 0;
    resizeObserverDisconnects = 0;
    elementRectReads = 0;
    canvasRectReads = 0;
    clientHeightReads = 0;
    scrollTopReads = 0;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) {
        resizeObserverConstructions += 1;
        resize = callback;
      }
      observe() {}
      disconnect() { resizeObserverDisconnects += 1; }
    });
    canvas = document.createElement("div");
    canvas.className = "workspace-canvas";
    let currentScrollTop = 0;
    Object.defineProperties(canvas, {
      scrollTop: {
        get: () => { scrollTopReads += 1; return currentScrollTop; },
        set: (value: number) => { currentScrollTop = value; },
      },
      clientHeight: { get: () => { clientHeightReads += 1; return height; } },
      clientWidth: { value: 800 },
    });
    const getCanvasRect = canvas.getBoundingClientRect.bind(canvas);
    canvas.getBoundingClientRect = () => {
      canvasRectReads += 1;
      return getCanvasRect();
    };
    document.body.append(canvas);
    root = createRoot(canvas);
    act(() => root.render(createElement(Harness)));
  });

  afterEach(() => {
    act(() => root.unmount());
    canvas.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function scroll(top: number) {
    act(() => {
      canvas.scrollTop = top;
      canvas.dispatchEvent(new Event("scroll"));
    });
  }

  function notifyResize() {
    act(() => resize([{
      target: canvas,
      contentRect: new DOMRectReadOnly(0, 0, 800, height),
      borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [],
    }], {} as ResizeObserver));
  }

  it("keeps anchor scroll positions current without rerendering each pixel", () => {
    const before = renders;
    for (let top = 1; top <= 100; top += 1) scroll(top);
    expect(renders - before).toBe(0);
    expect(readCanvasLocalViewportSnapshot(canvas.querySelector("[data-grid]")!)?.scrollTop).toBe(100);
    // Crossing a visible boundary must publish immediately, including reverse.
    scroll(215);
    expect(renders).toBeGreaterThan(before);
    expect(viewport.visibleStart).toBe(215);
    scroll(0);
    expect(viewport.visibleStart).toBe(0);
  });

  it("preserves exact-coordinate updates for callers without a geometry key", () => {
    act(() => root.render(createElement(Harness, { keyForViewport: null })));
    const before = renders;
    for (let top = 1; top <= 100; top += 1) scroll(top);
    // React may additionally render to discard the same-state measurement
    // queued when the effect changed; every changed coordinate still renders.
    expect(renders - before).toBeGreaterThanOrEqual(100);
    expect(viewport.visibleStart).toBe(100);
  });

  it("publishes a distant jump, viewport resize and changed geometry callback", () => {
    scroll(12_000);
    expect(viewport.visibleStart).toBe(12_000);
    height = 1000;
    notifyResize();
    expect(viewport.visibleEnd).toBe(13_000);
    scroll(12_001);
    // A new layout must not inherit the old layout's render key.
    act(() => root.render(createElement(Harness, { keyForViewport: () => "new-layout" })));
    expect(viewport.visibleStart).toBe(12_001);
    expect(viewport.visibleEnd).toBe(13_001);
  });

  it("does not remeasure or recreate observers when only render-key callback identity churns", () => {
    scroll(12_000);
    const grid = canvas.querySelector<HTMLElement>("[data-grid]")!;
    const snapshotBeforeChurn = readCanvasLocalViewportSnapshot(grid)!;
    const countsBeforeChurn = {
      resizeObserverConstructions,
      resizeObserverDisconnects,
      elementRectReads,
      canvasRectReads,
      clientHeightReads,
    };
    expect(countsBeforeChurn).toEqual({
      resizeObserverConstructions: 1,
      resizeObserverDisconnects: 1,
      elementRectReads: 1,
      canvasRectReads: 1,
      clientHeightReads: 2,
    });
    const addListenerSpy = vi.spyOn(canvas, "addEventListener");
    const removeListenerSpy = vi.spyOn(canvas, "removeEventListener");
    const scrollReadsBeforeChurn = scrollTopReads;
    const scrollListenerCalls = (calls: typeof addListenerSpy.mock.calls) =>
      calls.filter(([type]) => type === "scroll").length;

    const latestCallbackRanges: CanvasLocalViewportRange[] = [];
    for (let index = 0; index < 25; index += 1) {
      const keyForViewport = index === 24
        ? (range: CanvasLocalViewportRange) => {
            latestCallbackRanges.push(range);
            return range.visibleStart >= 12_100 ? "new-window" : "current-window";
          }
        : () => "current-window";
      act(() => root.render(createElement(Harness, { keyForViewport })));
    }

    expect(resizeObserverConstructions).toBe(countsBeforeChurn.resizeObserverConstructions);
    expect(resizeObserverDisconnects).toBe(countsBeforeChurn.resizeObserverDisconnects);
    expect(elementRectReads).toBe(countsBeforeChurn.elementRectReads);
    expect(canvasRectReads).toBe(countsBeforeChurn.canvasRectReads);
    expect(clientHeightReads).toBe(countsBeforeChurn.clientHeightReads);
    expect(scrollTopReads).toBe(scrollReadsBeforeChurn);
    expect(scrollListenerCalls(addListenerSpy.mock.calls)).toBe(0);
    expect(scrollListenerCalls(removeListenerSpy.mock.calls)).toBe(0);
    expect(readCanvasLocalViewportSnapshot(grid)).toBe(snapshotBeforeChurn);
    expect(readCanvasLocalViewportSnapshot(grid)).toMatchObject({
      contentTop: 0,
      scrollTop: 12_000,
      height: 200,
    });

    const rendersBeforeMembershipChange = renders;
    scroll(12_100);
    expect(latestCallbackRanges.at(-1)?.visibleStart).toBe(12_100);
    expect(viewport.visibleStart).toBe(12_100);
    expect(renders).toBeGreaterThan(rendersBeforeMembershipChange);
  });

  it("publishes current coordinates for a new geometry even when its key equals the old one", () => {
    const firstGeometryKey = (range: CanvasLocalViewportRange) => range.visibleStart < 200 ? "first" : "later";
    act(() => root.render(createElement(Harness, { keyForViewport: firstGeometryKey })));
    scroll(12_000);
    scroll(12_001);
    expect(viewport.visibleStart).toBe(12_000);
    const reads = elementRectReads;
    const observers = resizeObserverConstructions;
    const nextGeometryKey = (range: CanvasLocalViewportRange) => range.visibleStart < 200 ? "first" : "later";
    act(() => root.render(createElement(Harness, { keyForViewport: nextGeometryKey })));
    expect(viewport.visibleStart).toBe(12_001);
    expect(elementRectReads).toBe(reads);
    expect(resizeObserverConstructions).toBe(observers);
  });

  it("retains the last measurable viewport while the viewer collapses the canvas", () => {
    scroll(12_000);
    height = 0;
    notifyResize();
    expect(viewport.visibleStart).toBe(12_000);
    height = 200;
    notifyResize();
    expect(viewport.visibleEnd).toBe(12_200);
  });
});
