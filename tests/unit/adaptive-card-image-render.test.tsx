// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdaptiveCardImage } from "../../src/renderer/adaptive-card-image";
import type { SerpentLibraryApi } from "../../src/shared/library-api";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

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
  expect(requestPreview).toHaveBeenCalledOnce();
  const upgraded = container.querySelector<HTMLImageElement>(".adaptive-card-upgrade")!;
  expect(upgraded.style.opacity).toBe("0");
  Object.defineProperty(upgraded, "decode", { value: () => Promise.resolve() });
  await act(async () => { upgraded.dispatchEvent(new Event("load")); });
  expect(upgraded.style.opacity).toBe("1");
  expect(cover.getAttribute("src")).toBe("serpent://preview/cover");
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
    expect(requestPreview).toHaveBeenCalledOnce();
    expect(container.querySelector("img")).toBe(cover);
  } finally { await act(async () => { root.unmount(); }); }
});
