import { describe, expect, it } from "vitest";
import {
  coverSrc,
  isCardHoverPreviewable,
  resolveActivePreviewAssetId,
  resolveLivePreviewMedia,
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

describe("resolveLivePreviewMedia (Serpent-a9n)", () => {
  it("plays a ready GIF (image mediaType) as 'gif' when active", () => {
    expect(
      resolveLivePreviewMedia(true, {
        status: "ready",
        url: "serpent://source/lib/gif-1",
        mediaType: "image",
      }),
    ).toEqual({ url: "serpent://source/lib/gif-1", kind: "gif" });
  });

  it("plays a ready video as 'video' when active", () => {
    expect(
      resolveLivePreviewMedia(true, {
        status: "ready",
        url: "serpent://source/lib/vid-1",
        mediaType: "video",
        posterUrl: "serpent://preview/lib/poster-1",
      }),
    ).toEqual({ url: "serpent://source/lib/vid-1", kind: "video" });
  });

  it("does not play when inactive — this is how Inspector multi-selection stays static", () => {
    expect(
      resolveLivePreviewMedia(false, {
        status: "ready",
        url: "serpent://source/lib/vid-1",
        mediaType: "video",
      }),
    ).toEqual({ url: undefined, kind: null });
  });

  it("does not play when the resolution is not ready yet", () => {
    expect(
      resolveLivePreviewMedia(true, {
        status: "pending",
        url: undefined,
        mediaType: "video",
      }),
    ).toEqual({ url: undefined, kind: null });
  });

  it("does not play when there is no preview at all", () => {
    expect(resolveLivePreviewMedia(true, null)).toEqual({
      url: undefined,
      kind: null,
    });
    expect(resolveLivePreviewMedia(true, undefined)).toEqual({
      url: undefined,
      kind: null,
    });
  });

  it("does not play a non-gif/video mediaType even if marked ready", () => {
    expect(
      resolveLivePreviewMedia(true, {
        status: "ready",
        url: "serpent://source/lib/other-1",
        mediaType: "other",
      }),
    ).toEqual({ url: undefined, kind: null });
  });
});
