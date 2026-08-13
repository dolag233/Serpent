import { describe, expect, it } from "vitest";

import { applyAssetThumbnailPatches } from "../../src/renderer/asset-thumbnail-patches";
import type { AssetSummary } from "../../src/shared/asset-types";

function asset(id: string, extra: Partial<AssetSummary> = {}): AssetSummary {
  return {
    assetId: id,
    locationKind: "linked",
    managedFolderId: null,
    relativeFilePath: `${id}.jpg`,
    displayName: `${id}.jpg`,
    currentRevisionId: `rev-${id}`,
    byteSize: 12,
    modifiedAt: "2026-08-13T00:00:00.000Z",
    availability: "available",
    rating: 0,
    favorite: false,
    deletedAt: null,
    trashedFromPath: null,
    trashedFromTombstoneId: null,
    remainingDays: null,
    thumbnailStatus: "pending",
    thumbnailArtifactId: null,
    mediaType: "image",
    width: null,
    height: null,
    durationMs: null,
    ...extra,
  };
}

describe("applyAssetThumbnailPatches", () => {
  it("returns the same array when no patch applies", () => {
    const assets = [asset("a"), asset("b")];
    expect(applyAssetThumbnailPatches(assets, new Map())).toBe(assets);
    expect(
      applyAssetThumbnailPatches(assets, new Map([["z", { width: 10 }]])),
    ).toBe(assets);
  });

  it("patches only matching assets in one pass", () => {
    const assets = [asset("a"), asset("b")];
    const next = applyAssetThumbnailPatches(
      assets,
      new Map([
        [
          "b",
          {
            thumbnailStatus: "ready",
            thumbnailArtifactId: "art-b",
            width: 2560,
            height: 1440,
          },
        ],
      ]),
    );
    expect(next[0]).toBe(assets[0]);
    expect(next[1]).toMatchObject({
      assetId: "b",
      thumbnailStatus: "ready",
      thumbnailArtifactId: "art-b",
      width: 2560,
      height: 1440,
    });
  });
});
