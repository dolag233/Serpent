// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { BrowseLayoutPreview } from "../../src/renderer/BrowseLayoutPreview";
import { LocaleProvider } from "../../src/renderer/i18n";

describe("BrowseLayoutPreview caption (Serpent-l2at / Serpent-qc7v)", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
  });

  it("always paints a card: skeleton when caption fields are missing, even without a thumbnail", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          { children: null, initialPreference: "zh-CN" },
          createElement(BrowseLayoutPreview, {
            entry: { assetId: "asset-1", width: 1600, height: 900 },
            libraryId: "lib-1",
          }),
        ),
      );
    });
    expect(container.querySelector(".asset-card.is-layout-preview")).not.toBeNull();
    expect(container.querySelector(".asset-caption")).not.toBeNull();
    expect(container.querySelector(".asset-caption-skeleton-line.is-name")).not.toBeNull();
    expect(container.querySelector(".asset-caption-skeleton-line.is-meta")).not.toBeNull();
    expect(container.querySelector(".asset-dimensions")).toBeNull();
    expect(container.querySelector(".asset-card-media.is-pending")).toBeNull();
    expect(container.querySelector("svg, img")).not.toBeNull();
    expect(container.querySelector("img.asset-thumbnail")).toBeNull();
  });

  it("matches the loaded masonry caption: filename then size and date, not resolution", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          { children: null, initialPreference: "zh-CN" },
          createElement(BrowseLayoutPreview, {
            entry: {
              assetId: "asset-2",
              width: 1920,
              height: 1080,
              displayName: "hero.png",
              byteSize: 2048,
              modifiedAt: "2026-08-17T00:00:00.000Z",
              previewArtifactId: "thumb-1",
            },
            libraryId: "lib-1",
            viewMode: "masonry",
          }),
        ),
      );
    });
    const caption = container.querySelector(".asset-caption");
    expect(caption).not.toBeNull();
    expect(caption?.querySelector(".asset-dimensions")).toBeNull();
    expect(caption?.querySelector(".asset-caption-filename")?.textContent).toBe("hero.png");
    expect(caption?.querySelector(".asset-filename-prefix")).not.toBeNull();
    expect(caption?.querySelector(".asset-filename-extension")?.textContent).toBe(".png");
    expect(caption?.textContent).toMatch(/2\.0 KB/);
    expect(caption?.querySelector("strong.asset-caption-filename")?.nextElementSibling?.textContent).toMatch(
      /2\.0 KB/,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "serpent://preview/lib-1/thumb-1",
    );
  });

  it("keeps a meta skeleton under the filename when size and date are not yet known", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          { children: null, initialPreference: "zh-CN" },
          createElement(BrowseLayoutPreview, {
            entry: {
              assetId: "asset-3",
              width: null,
              height: null,
              displayName: "pending.png",
            },
            libraryId: "lib-1",
            viewMode: "masonry",
          }),
        ),
      );
    });
    const caption = container.querySelector(".asset-caption");
    expect(caption?.querySelector(".asset-caption-filename")?.textContent).toBe("pending.png");
    expect(caption?.querySelector(".asset-dimensions")).toBeNull();
    expect(caption?.querySelector(".asset-caption-skeleton-line.is-meta")).not.toBeNull();
    expect(caption?.querySelector(".asset-caption-filename")?.nextElementSibling).toBe(
      caption?.querySelector(".asset-caption-skeleton-line.is-meta"),
    );
  });

  it("uses TITLE-001 middle ellipsis parts for a long placeholder filename", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          { children: null, initialPreference: "zh-CN" },
          createElement(BrowseLayoutPreview, {
            entry: {
              assetId: "asset-ellipsis",
              width: 800,
              height: 600,
              displayName: "wghuasgfsad.jpg",
              byteSize: 2048,
              modifiedAt: "2026-08-17T00:00:00.000Z",
            },
            libraryId: "lib-1",
            viewMode: "masonry",
          }),
        ),
      );
    });
    const filename = container.querySelector(".asset-caption-filename");
    expect(filename?.getAttribute("title")).toBe("wghuasgfsad.jpg");
    expect(filename?.querySelector(".asset-filename-prefix")?.textContent).toBe("wghuasgf");
    expect(filename?.querySelector(".asset-filename-tail")?.textContent).toBe("sad");
    expect(filename?.querySelector(".asset-filename-extension")?.textContent).toBe(".jpg");
    expect(filename?.textContent).toBe("wghuasgfsad.jpg");
  });

  it("keeps grid captions starting with width × height before the filename", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          { children: null, initialPreference: "zh-CN" },
          createElement(BrowseLayoutPreview, {
            entry: {
              assetId: "asset-4",
              width: 1920,
              height: 1080,
              displayName: "tile.png",
              byteSize: 2048,
              modifiedAt: "2026-08-17T00:00:00.000Z",
            },
            libraryId: "lib-1",
            viewMode: "grid",
          }),
        ),
      );
    });
    const caption = container.querySelector(".asset-caption");
    const children = [...(caption?.children ?? [])];
    expect(children[0]?.className).toBe("asset-dimensions");
    expect(children[0]?.textContent).toMatch(/1920/);
    expect(children[1]?.className).toContain("asset-caption-filename");
    expect(children[1]?.textContent).toBe("tile.png");
    expect(children[2]?.textContent).toMatch(/2\.0 KB/);
  });
});
