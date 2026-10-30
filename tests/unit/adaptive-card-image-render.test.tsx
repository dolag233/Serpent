// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdaptiveCardImage, CARD_IMAGE_UPGRADE_IDLE_MS } from "../../src/renderer/adaptive-card-image";
import type { SerpentLibraryApi } from "../../src/shared/library-api";
import { NAVIGATION_REFLOW_START, NAVIGATION_REFLOW_END } from "../../src/renderer/navigation-reflow-transition";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); delete document.documentElement.dataset.navTransition; });

async function settleImageSize() {
  await act(async () => { await vi.advanceTimersByTimeAsync(CARD_IMAGE_UPGRADE_IDLE_MS); });
}

it("defers image measurements and original requests until navigation playback and reversals finish", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const reads = vi.spyOn(HTMLImageElement.prototype, "getBoundingClientRect")
    .mockImplementation(() => new DOMRect(0, 0, 600, 300));
  const requestPreview = vi.fn().mockResolvedValue({ ok: true, value: { status: "ready", url: "serpent://source/image" } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const start = () => {
    document.documentElement.dataset.navTransition = "true";
    window.dispatchEvent(new Event(NAVIGATION_REFLOW_START));
  };
  const end = () => {
    delete document.documentElement.dataset.navTransition;
    window.dispatchEvent(new Event(NAVIGATION_REFLOW_END));
  };
  try {
    await act(async () => root.render(createElement(AdaptiveCardImage, {
      alt: "photo", coverUrl: "serpent://preview/cover", loadImmediately: true, onError: vi.fn(),
      source: { api: { requestPreview } as unknown as SerpentLibraryApi, libraryId: "library", assetId: "asset", revisionId: "revision", width: 4000, height: 2000 },
    })));
    const cover = host.querySelector("img")!;
    Object.defineProperties(cover, { naturalWidth: { value: 512 }, naturalHeight: { value: 256 } });
    await act(async () => { cover.dispatchEvent(new Event("load")); start(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(reads).not.toHaveBeenCalled();
    expect(requestPreview).not.toHaveBeenCalled();
    await act(async () => { end(); await vi.advanceTimersByTimeAsync(100); start(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(reads).not.toHaveBeenCalled();
    expect(requestPreview).not.toHaveBeenCalled();
    await act(async () => { end(); await vi.advanceTimersByTimeAsync(CARD_IMAGE_UPGRADE_IDLE_MS - 1); });
    expect(reads).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(reads).toHaveBeenCalledOnce();
    expect(requestPreview).toHaveBeenCalledOnce();
    expect(host.querySelector("img")).toBe(cover);
  } finally { await act(async () => root.unmount()); }
});

it("keeps the cover visible while requesting and decoding a larger image", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLImageElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 600, height: 300, x: 0, y: 0, top: 0, left: 0, right: 600, bottom: 300, toJSON: () => ({}),
  });
  const requestPreview = vi.fn().mockResolvedValue({ ok: true, value: { status: "ready", url: "serpent://source/image" } });
  const api = { requestPreview } as unknown as SerpentLibraryApi;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(createElement(AdaptiveCardImage, {
    alt: "photo", coverUrl: "serpent://preview/cover", loadImmediately: true, onError: vi.fn(),
    source: { api, libraryId: "library", assetId: "asset", revisionId: "revision", width: 4000, height: 2000 },
  })); });
  const cover = container.querySelector("img")!;
  Object.defineProperties(cover, { naturalWidth: { value: 512 }, naturalHeight: { value: 256 } });
  await act(async () => { cover.dispatchEvent(new Event("load")); });
  expect(requestPreview).not.toHaveBeenCalled();
  await settleImageSize();
  expect(requestPreview).toHaveBeenCalledOnce();
  const upgraded = container.querySelector<HTMLImageElement>(".adaptive-card-upgrade")!;
  expect(upgraded.style.opacity).toBe("0");
  Object.defineProperty(upgraded, "decode", { value: () => Promise.resolve() });
  await act(async () => { upgraded.dispatchEvent(new Event("load")); });
  expect(upgraded.style.opacity).toBe("1");
  expect(cover.getAttribute("src")).toBe("serpent://preview/cover");
  const layoutReads = vi.spyOn(cover, "getBoundingClientRect");
  await act(async () => { root.render(createElement(AdaptiveCardImage, {
    alt: "photo", coverUrl: "serpent://preview/cover", loadImmediately: true, onError: vi.fn(),
    suspendUpgrade: true,
    source: { api, libraryId: "library", assetId: "asset", revisionId: "revision", width: 4000, height: 2000 },
  })); });
  layoutReads.mockClear();
  await act(async () => { window.dispatchEvent(new Event("scroll")); window.dispatchEvent(new Event("resize")); });
  expect(layoutReads).not.toHaveBeenCalled();
  expect(container.querySelector(".adaptive-card-upgrade")).toBeNull();
  expect(container.querySelector("img")).toBe(cover);
  await act(async () => { root.unmount(); });
});

it.each(["viewer", "offscreen"])("defers original requests for %s cards and resumes when visible", async (reason) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  let top = reason === "offscreen" ? 5000 : 0;
  vi.spyOn(HTMLImageElement.prototype, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, top, 600, 600));
  const requestPreview = vi.fn().mockResolvedValue({ ok: true, value: { status: "ready", url: "serpent://source/image" } });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const props = {
    alt: "photo", coverUrl: "serpent://preview/cover", loadImmediately: true, onError: vi.fn(),
    source: { api: { requestPreview } as unknown as SerpentLibraryApi, libraryId: "library", assetId: "asset", revisionId: "revision", width: 3672, height: 4896 },
  };
  try {
    await act(async () => { root.render(createElement(AdaptiveCardImage, { ...props, suspendUpgrade: reason === "viewer" })); });
    const cover = container.querySelector("img")!;
    Object.defineProperties(cover, { naturalWidth: { value: 384 }, naturalHeight: { value: 512 } });
    await act(async () => { cover.dispatchEvent(new Event("load")); });
    expect(requestPreview).not.toHaveBeenCalled();
    expect(container.querySelector(".adaptive-card-upgrade")).toBeNull();
    await act(async () => {
      top = 0;
      if (reason === "viewer") root.render(createElement(AdaptiveCardImage, { ...props, suspendUpgrade: false }));
      else window.dispatchEvent(new Event("scroll"));
    });
    await settleImageSize();
    expect(requestPreview).toHaveBeenCalledOnce();
    expect(container.querySelector("img")).toBe(cover);
  } finally { await act(async () => { root.unmount(); }); }
});

it("keeps the cover during rapid resizing and requests the original only after the last resize settles", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let resized!: () => void;
  vi.stubGlobal("ResizeObserver", class {
    constructor(update: () => void) { resized = update; }
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLImageElement.prototype, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 0, 600, 300));
  const requestPreview = vi.fn().mockResolvedValue({ ok: true, value: { status: "ready", url: "serpent://source/image" } });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(AdaptiveCardImage, {
      alt: "photo", coverUrl: "serpent://preview/cover", loadImmediately: true, onError: vi.fn(),
      source: { api: { requestPreview } as unknown as SerpentLibraryApi, libraryId: "library", assetId: "asset", revisionId: "revision", width: 4000, height: 2000 },
    })));
    const cover = container.querySelector("img")!;
    const layoutReads = vi.spyOn(cover, "getBoundingClientRect");
    Object.defineProperties(cover, { naturalWidth: { value: 512 }, naturalHeight: { value: 256 } });
    await act(async () => cover.dispatchEvent(new Event("load")));
    for (let i = 0; i < 8; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
        resized();
      });
      expect(requestPreview).not.toHaveBeenCalled();
      expect(container.querySelector("img")).toBe(cover);
      expect(cover.getAttribute("src")).toBe("serpent://preview/cover");
      expect(layoutReads).not.toHaveBeenCalled();
    }
    await settleImageSize();
    expect(requestPreview).toHaveBeenCalledOnce();
    expect(layoutReads).toHaveBeenCalledOnce();
    expect(container.querySelector(".adaptive-card-upgrade")).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
