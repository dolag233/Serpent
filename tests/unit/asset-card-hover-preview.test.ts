import { describe, expect, it } from "vitest";
import {
  coverSrc,
  isCardHoverPreviewable,
  resolveActivePreviewAssetId,
} from "../../src/renderer/asset-card-hover-preview";

describe("isCardHoverPreviewable", () => {
  it("accepts gif and video when available", () => {
    expect(
      isCardHoverPreviewable({
        mediaType: "image",
        displayName: "loop.gif",
        availability: "available",
        deletedAt: null,
      }),
    ).toBe(true);
    expect(
      isCardHoverPreviewable({
        mediaType: "video",
        displayName: "clip.mp4",
        availability: "available",
        deletedAt: null,
      }),
    ).toBe(true);
  });

  it("rejects static images and unavailable assets", () => {
    expect(
      isCardHoverPreviewable({
        mediaType: "image",
        displayName: "still.jpg",
        availability: "available",
        deletedAt: null,
      }),
    ).toBe(false);
    expect(
      isCardHoverPreviewable({
        mediaType: "video",
        displayName: "clip.mp4",
        availability: "missing",
        deletedAt: null,
      }),
    ).toBe(false);
    expect(
      isCardHoverPreviewable({
        mediaType: "image",
        displayName: "loop.gif",
        availability: "available",
        deletedAt: "2026-07-18T00:00:00.000Z",
      }),
    ).toBe(false);
  });
});

describe("resolveActivePreviewAssetId", () => {
  const previewable = new Set(["gif-1", "vid-1"]);
  const isPreviewable = (id: string) => previewable.has(id);

  it("prefers hover over primary selection", () => {
    expect(
      resolveActivePreviewAssetId({
        hoveredAssetId: "gif-1",
        primarySelectedAssetId: "vid-1",
        isPreviewable,
      }),
    ).toBe("gif-1");
  });

  it("falls back to primary selection when hover is absent or not previewable", () => {
    expect(
      resolveActivePreviewAssetId({
        hoveredAssetId: null,
        primarySelectedAssetId: "vid-1",
        isPreviewable,
      }),
    ).toBe("vid-1");
    expect(
      resolveActivePreviewAssetId({
        hoveredAssetId: "still-1",
        primarySelectedAssetId: "vid-1",
        isPreviewable,
      }),
    ).toBe("vid-1");
  });

  it("returns null when neither qualifies", () => {
    expect(
      resolveActivePreviewAssetId({
        hoveredAssetId: "still-1",
        primarySelectedAssetId: "still-2",
        isPreviewable,
      }),
    ).toBeNull();
    expect(
      resolveActivePreviewAssetId({
        hoveredAssetId: null,
        primarySelectedAssetId: undefined,
        isPreviewable,
      }),
    ).toBeNull();
  });
});

describe("coverSrc", () => {
  it("builds the serpent preview URL", () => {
    expect(coverSrc("lib-a", "art-b")).toBe("serpent://preview/lib-a/art-b");
  });
});
