// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../../src/renderer/i18n";
import { ZoomableImage } from "../../src/renderer/zoomable-preview-image";

function viewerLayer(container: HTMLElement): string | null {
  return (
    container
      .querySelector(".preview-image-viewport")
      ?.getAttribute("data-viewer-layer") ?? null
  );
}

function markImageDecoded(image: HTMLImageElement, width = 64, height = 64): void {
  Object.defineProperty(image, "complete", {
    configurable: true,
    get: () => true,
  });
  Object.defineProperty(image, "naturalWidth", {
    configurable: true,
    get: () => width,
  });
  Object.defineProperty(image, "naturalHeight", {
    configurable: true,
    get: () => height,
  });
  image.decode = () => Promise.resolve();
}

describe("ZoomableImage cached load vs decode token", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  let restoreImage: (() => void) | undefined;
  const decodes = new Map<string, () => Promise<void>>();
  const dimensions = new Map<string, [number, number]>();

  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    const proto = HTMLImageElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "src");
    const originalSetAttribute = proto.setAttribute;
    const fireCachedLoad = (image: HTMLImageElement) => {
      const source = image.getAttribute("src") ?? image.src;
      markImageDecoded(image, ...(dimensions.get(source) ?? [64, 64] as [number, number]));
      const decode = decodes.get(source);
      if (decode) image.decode = decode;
      image.dispatchEvent(new Event("load"));
    };
    if (descriptor?.set && descriptor.get) {
      const originalSet = descriptor.set;
      const originalGet = descriptor.get;
      Object.defineProperty(proto, "src", {
        configurable: true,
        get() {
          return originalGet.call(this);
        },
        set(value: string) {
          originalSet.call(this, value);
          fireCachedLoad(this);
        },
      });
    }
    proto.setAttribute = function setAttribute(name: string, value: string) {
      originalSetAttribute.call(this, name, value);
      if (name === "src") {
        fireCachedLoad(this);
      }
    };
    restoreImage = () => {
      if (descriptor) {
        Object.defineProperty(proto, "src", descriptor);
      }
      proto.setAttribute = originalSetAttribute;
    };
  });

  afterEach(() => {
    restoreImage?.();
    restoreImage = undefined;
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
    decodes.clear();
    dimensions.clear();
    vi.unstubAllGlobals();
  });

  async function renderImage(src: string, placeholderSrc: string): Promise<void> {
    if (!container) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
    await act(async () => {
      root!.render(
        createElement(LocaleProvider, {
          initialPreference: "zh-CN",
          children: createElement(ZoomableImage, {
            src,
            alt: "asset",
            placeholderSrc,
          }),
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("promotes a cache-hit original after switching back to the same image", async () => {
    await renderImage("serpent://source/a", "serpent://preview/a");
    expect(viewerLayer(container!)).toBe("full");

    await renderImage("serpent://source/b", "serpent://preview/b");
    expect(viewerLayer(container!)).toBe("full");

    await renderImage("serpent://source/a", "serpent://preview/a");
    expect(viewerLayer(container!)).toBe("full");
  });
  it("retains the painted thumbnail node until a slow original has decoded", async () => {
    let releaseDecode: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => { releaseDecode = resolve; });
    decodes.set("serpent://source/large", () => ready);
    await renderImage("serpent://preview/large", "serpent://preview/large");
    const thumbnail = container!.querySelector("img.preview-image-placeholder")!;
    expect(thumbnail).not.toBeNull();
    expect(container!.querySelectorAll("img")).toHaveLength(1);

    await renderImage("serpent://source/large", "serpent://preview/large");
    expect(container!.querySelector("img.preview-image-placeholder")).toBe(thumbnail);
    expect(thumbnail.isConnected).toBe(true);
    expect(thumbnail.classList.contains("is-hidden")).toBe(false);
    expect(viewerLayer(container!)).toBe("placeholder");
    expect(container!.querySelector("img.preview-image-full")!.classList.contains("is-hidden")).toBe(true);

    await act(async () => { releaseDecode!(); await ready; });
    expect(container!.querySelector("img.preview-image-placeholder")).toBe(thumbnail);
    expect(viewerLayer(container!)).toBe("full");
    expect(thumbnail.classList.contains("is-hidden")).toBe(true);
    expect(container!.querySelector("img.preview-image-full")!.classList.contains("is-visible")).toBe(true);
  });
  it("switches decoded layers without simultaneous fades exposing the backdrop", async () => {
    const style = document.createElement("style");
    style.textContent = readFileSync("src/renderer/styles.css", "utf8");
    document.head.append(style);
    try {
      await renderImage("serpent://source/a", "serpent://preview/a");
      const full = container!.querySelector<HTMLImageElement>("img.preview-image-full")!;
      const thumbnail = container!.querySelector<HTMLImageElement>("img.preview-image-placeholder")!;
      expect(getComputedStyle(full).opacity).toBe("1");
      expect(getComputedStyle(full).visibility).toBe("visible");
      expect(getComputedStyle(full).transition).toBe("none");
      expect(getComputedStyle(thumbnail).visibility).toBe("hidden");
      expect(getComputedStyle(thumbnail).transition).toBe("none");
    } finally { style.remove(); }
  });
  it("keeps a large portrait fitted through promotion and a late thumbnail load", async () => {
    dimensions.set("serpent://preview/portrait", [300, 400]);
    dimensions.set("serpent://source/portrait", [12000, 16000]);
    await renderImage("serpent://preview/portrait", "serpent://preview/portrait");
    const viewport = container!.querySelector<HTMLElement>(".preview-image-viewport")!;
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 600 },
    });
    const thumbnail = container!.querySelector<HTMLImageElement>("img.preview-image-placeholder")!;
    await act(async () => { thumbnail.dispatchEvent(new Event("load")); });
    expect(thumbnail.style.width).toBe("450px");
    expect(thumbnail.style.height).toBe("600px");

    await renderImage("serpent://source/portrait", "serpent://preview/portrait");
    const full = container!.querySelector<HTMLImageElement>("img.preview-image-full")!;
    expect(viewerLayer(container!)).toBe("full");
    expect(full.style.width).toBe("450px");
    expect(full.style.height).toBe("600px");
    await act(async () => { thumbnail.dispatchEvent(new Event("load")); });
    expect(full.style.width).toBe("450px");
    expect(full.style.height).toBe("600px");
  });
});
