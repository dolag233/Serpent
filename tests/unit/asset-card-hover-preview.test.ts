import { describe, expect, it } from "vitest";
import {
  assetCardKey,
  coverSrc,
  isCardHoverPreviewable,
  resolveActivePreviewAssetId,
  resolveAssetCardCoverUrl,
  resolveLivePreviewMedia,
  resolveLiveVideoMuted,
  shouldPlayLiveAudio,
} from "../../src/renderer/asset-card-hover-preview";

describe("isCardHoverPreviewable", () => {
  it("accepts gif, video and audio when available", () => {
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
    expect(
      isCardHoverPreviewable({
        mediaType: "audio",
        displayName: "track.mp3",
        availability: "available",
        deletedAt: null,
      }),
    ).toBe(true);
  });

  it("rejects static images, sequences, and unavailable assets", () => {
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
        mediaType: "image",
        displayName: "clip_001.png",
        availability: "available",
        deletedAt: null,
        sequence: { frameCount: 12 },
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

describe("assetCardKey", () => {
  it("remounts a reused asset id when the library changes", () => {
    expect(assetCardKey("library-a", "asset-1")).not.toBe(
      assetCardKey("library-b", "asset-1"),
    );
    expect(assetCardKey(undefined, "asset-1")).toBe("no-library:asset-1");
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

  it("plays a ready audio as 'audio' when active (Serpent hover 音频工单)", () => {
    expect(
      resolveLivePreviewMedia(true, {
        status: "ready",
        url: "serpent://source/lib/aud-1",
        mediaType: "audio",
      }),
    ).toEqual({ url: "serpent://source/lib/aud-1", kind: "audio" });
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

describe("resolveAssetCardCoverUrl", () => {
  it("uses the preview artifact when the thumbnail is ready", () => {
    expect(
      resolveAssetCardCoverUrl({
        libraryId: "lib",
        assetId: "a1",
        mediaType: "image",
        availability: "available",
        deletedAt: null,
        thumbnailStatus: "ready",
        thumbnailArtifactId: "art-1",
      }),
    ).toEqual({ url: coverSrc("lib", "art-1"), usedSourceFallback: false });
  });

  it("uses the default icon path when the thumbnail failed", () => {
    expect(
      resolveAssetCardCoverUrl({
        libraryId: "lib",
        assetId: "a1",
        mediaType: "image",
        availability: "available",
        deletedAt: null,
        thumbnailStatus: "failed",
        thumbnailArtifactId: null,
      }),
    ).toEqual({ url: null, usedSourceFallback: false });
  });

  it("does not fall back for pending, missing, or non-image assets", () => {
    expect(
      resolveAssetCardCoverUrl({
        libraryId: "lib",
        assetId: "a1",
        mediaType: "image",
        availability: "available",
        deletedAt: null,
        thumbnailStatus: "pending",
        thumbnailArtifactId: null,
      }).url,
    ).toBeNull();
    expect(
      resolveAssetCardCoverUrl({
        libraryId: "lib",
        assetId: "a1",
        mediaType: "video",
        availability: "available",
        deletedAt: null,
        thumbnailStatus: "failed",
        thumbnailArtifactId: null,
      }).url,
    ).toBeNull();
  });
});

describe("resolveLiveVideoMuted (Serpent hover 音频工单)", () => {
  it("plays sound only on hover with the preference on", () => {
    expect(
      resolveLiveVideoMuted({
        hovering: true,
        hoverVideoSound: true,
        mediaMuted: false,
      }),
    ).toBe(false);
    expect(
      resolveLiveVideoMuted({
        hovering: true,
        hoverVideoSound: false,
        mediaMuted: false,
      }),
    ).toBe(true);
  });

  it("keeps primary selection silent (hover only)", () => {
    expect(
      resolveLiveVideoMuted({
        hovering: false,
        hoverVideoSound: true,
        mediaMuted: false,
      }),
    ).toBe(true);
  });

  it("viewer mute wins over everything", () => {
    expect(
      resolveLiveVideoMuted({
        hovering: true,
        hoverVideoSound: true,
        mediaMuted: true,
      }),
    ).toBe(true);
  });
});

describe("shouldPlayLiveAudio (Serpent hover 音频工单)", () => {
  it("plays audio only on hover with the preference on", () => {
    expect(
      shouldPlayLiveAudio({ hovering: true, hoverAudioPlay: true }),
    ).toBe(true);
    expect(
      shouldPlayLiveAudio({ hovering: true, hoverAudioPlay: false }),
    ).toBe(false);
    // Selection never plays audio.
    expect(
      shouldPlayLiveAudio({ hovering: false, hoverAudioPlay: true }),
    ).toBe(false);
  });
});
