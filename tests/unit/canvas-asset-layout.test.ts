import { describe, expect, it } from "vitest";

import type { AssetSummary } from "../../src/shared/asset-types";
import {
  estimateMasonryCardBodyPx,
  hitTestCanvasAssetLayout,
  layoutJustifiedAssetRects,
  layoutMasonryAssetRects,
  MASONRY_CAPTION_BAND_PX,
  MASONRY_DIMENSIONS_CAPTION_BAND_PX,
  stackItemHeights,
} from "../../src/renderer/canvas-asset-layout";

function asset(
  id: string,
  width: number,
  height: number,
): AssetSummary {
  return {
    assetId: id,
    locationKind: "linked",
    managedFolderId: null,
    relativeFilePath: `${id}.jpg`,
    displayName: `${id}.jpg`,
    currentRevisionId: `rev-${id}`,
    byteSize: 1,
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
    width,
    height,
    durationMs: null,
  };
}

describe("canvas asset layout", () => {
  it("lays out every masonry card, not only a viewport slice", () => {
    const assets = Array.from({ length: 12 }, (_, index) =>
      asset(`a${index}`, 100, 100),
    );
    const rects = layoutMasonryAssetRects(assets, 400, 120, false);
    expect(rects).toHaveLength(12);
    expect(new Set(rects.map((item) => item.id)).size).toBe(12);
  });

  it("hit-tests masonry cards that would be unmounted by windowing", () => {
    const assets = Array.from({ length: 8 }, (_, index) =>
      asset(`a${index}`, 100, 200),
    );
    const rects = layoutMasonryAssetRects(assets, 260, 120, false);
    const last = rects.at(-1);
    expect(last).toBeDefined();
    const hits = hitTestCanvasAssetLayout(rects, {
      left: last!.x + 1,
      top: last!.y + 1,
      right: last!.x + last!.width - 1,
      bottom: last!.y + last!.height - 1,
    });
    expect(hits).toContain(last!.id);
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it("reserves the third caption row when resolution is enabled", () => {
    const base = estimateMasonryCardBodyPx(asset("caption", 100, 100), 160, true);
    const withDimensions = estimateMasonryCardBodyPx(
      asset("caption", 100, 100),
      160,
      true,
      MASONRY_DIMENSIONS_CAPTION_BAND_PX,
    );
    expect(base).toBeGreaterThan(0);
    expect(withDimensions - base).toBe(
      MASONRY_DIMENSIONS_CAPTION_BAND_PX - MASONRY_CAPTION_BAND_PX,
    );
  });

  it("lays out justified rows with stable ids", () => {
    const assets = [
      asset("wide", 400, 100),
      asset("tall", 100, 400),
      asset("square", 200, 200),
    ];
    const rects = layoutJustifiedAssetRects(assets, 640, 160);
    expect(rects.map((item) => item.id)).toEqual(["wide", "tall", "square"]);
    expect(rects.every((item) => item.width > 0 && item.height > 0)).toBe(true);
    expect(
      rects.every(
        (item) => Number.isInteger(item.width) && Number.isInteger(item.height) && Number.isInteger(item.x) && Number.isInteger(item.y),
      ),
    ).toBe(true);
  });

  it("keeps trailing gap out of the last stacked item", () => {
    expect(stackItemHeights([100, 100, 100])).toEqual([114, 114, 100]);
  });
});
