// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AssetSummary } from "../../src/shared/asset-types";
import { CANVAS_LAYOUT_COMMITTED_EVENT } from "../../src/renderer/canvas-layout-commit-signal";
import { readPublishedCanvasAssetLayoutIndex } from "../../src/renderer/canvas-asset-layout";
import {
  createVirtualBrowseLayoutFromIndex,
  mergeVirtualSummaryPage,
} from "../../src/renderer/browse/virtual-browse-layout";
import { VirtualJustifiedAssetRows } from "../../src/renderer/browse/virtual-browse-canvas";

function summary(assetId: string): AssetSummary {
  return {
    assetId,
    locationKind: "linked",
    managedFolderId: null,
    relativeFilePath: `${assetId}.jpg`,
    displayName: `${assetId}.jpg`,
    currentRevisionId: `revision-${assetId}`,
    byteSize: 100,
    modifiedAt: "2026-01-01T00:00:00.000Z",
    availability: "available",
    rating: 0,
    favorite: false,
    deletedAt: null,
    trashedFromPath: null,
    trashedFromTombstoneId: null,
    remainingDays: null,
    thumbnailStatus: "ready",
    thumbnailArtifactId: null,
    mediaType: "image",
    width: 100,
    height: 100,
    durationMs: null,
  };
}

describe("virtual justified slot DOM geometry", () => {
  let canvas: HTMLDivElement;
  let host: HTMLDivElement;
  let root: Root;
  let previousClientWidth: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
    });
    previousClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 800,
    });
    canvas = document.createElement("div");
    canvas.className = "workspace-canvas";
    Object.defineProperties(canvas, {
      clientHeight: { configurable: true, value: 600 },
      clientWidth: { configurable: true, value: 800 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    canvas.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    host = document.createElement("div");
    canvas.append(host);
    document.body.append(canvas);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    canvas.remove();
    if (previousClientWidth) {
      Object.defineProperty(HTMLElement.prototype, "clientWidth", previousClientWidth);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
    }
    vi.unstubAllGlobals();
  });

  function render(layout: ReturnType<typeof createVirtualBrowseLayoutFromIndex>, assets: AssetSummary[]) {
    act(() => root.render(createElement(VirtualJustifiedAssetRows, {
      assets,
      layout,
      cardSize: 180,
      captionBandForAsset: () => 24,
      renderCard: (asset) => createElement("div", {
        className: "asset-card",
        "data-asset-id": asset.assetId,
      }),
    })));
  }

  it("keeps the real slot body sized while a summary is empty, then replaces a placeholder in place", () => {
    const placeholder = createVirtualBrowseLayoutFromIndex({
      total: 1,
      entries: [{ assetId: "__geometry__:0", width: 100, height: 100, mediaType: "image" }],
    });
    render(placeholder, []);

    const slot = host.querySelector<HTMLElement>(".justified-card-slot");
    const row = host.querySelector<HTMLElement>(".justified-row");
    expect(slot).not.toBeNull();
    expect(row).not.toBeNull();
    expect(Number.parseFloat(slot!.style.height)).toBeGreaterThan(0);
    expect(slot!.style.height).toBe(row!.style.height);
    expect(slot!.querySelector(".asset-card")).toBeNull();

    const emptyRealId = createVirtualBrowseLayoutFromIndex({
      total: 1,
      entries: [{ assetId: "real-asset", width: 100, height: 100, mediaType: "image" }],
    });
    render(emptyRealId, []);
    expect(host.querySelector(".justified-card-slot")).toBe(slot);
    expect(slot!.dataset.layoutAssetId).toBe("real-asset");
    expect(Number.parseFloat(slot!.style.height)).toBeGreaterThan(0);
    expect(slot!.querySelector(".asset-card")).toBeNull();

    const loaded = summary("real-asset");
    const loadedLayout = mergeVirtualSummaryPage(emptyRealId, 0, [loaded]);
    render(loadedLayout, [loaded]);
    expect(host.querySelector(".justified-card-slot")).toBe(slot);
    expect(slot!.dataset.layoutAssetId).toBe("real-asset");
    expect(slot!.querySelector(".asset-card")?.getAttribute("data-asset-id")).toBe("real-asset");
    expect(slot!.style.height).toBe(row!.style.height);
  });

  it("notifies after a cached layout mounts the new scroll window", () => {
    const layout = createVirtualBrowseLayoutFromIndex({
      total: 1000,
      entries: Array.from({ length: 1000 }, (_, index) => ({
        assetId: `cached-${index}`,
        width: 100,
        height: 100,
        mediaType: "image" as const,
      })),
    });
    const mountedIds = () => [...host.querySelectorAll<HTMLElement>(".justified-card-slot")]
      .map((slot) => slot.dataset.layoutAssetId);
    const notifications: Array<Array<string | undefined>> = [];
    const onCommitted = () => notifications.push(mountedIds());
    canvas.addEventListener(CANVAS_LAYOUT_COMMITTED_EVENT, onCommitted);

    render(layout, []);
    const initialIds = mountedIds();
    const grid = host.querySelector<HTMLElement>(".justified-rows");
    const publishedIndex = grid && readPublishedCanvasAssetLayoutIndex(grid);
    expect(publishedIndex).toBeDefined();
    notifications.length = 0;

    act(() => {
      canvas.scrollTop = 12_000;
      canvas.dispatchEvent(new Event("scroll"));
    });

    const finalIds = mountedIds();
    expect(finalIds).not.toEqual(initialIds);
    expect(notifications.at(-1)).toEqual(finalIds);
    expect(grid && readPublishedCanvasAssetLayoutIndex(grid)).toBe(publishedIndex);
    canvas.removeEventListener(CANVAS_LAYOUT_COMMITTED_EVENT, onCommitted);
  });
});
