import { describe, expect, it } from "vitest";

import type { AssetSummary } from "../../src/shared/asset-types";
import {
  browsePageOffset,
  browsePageOffsetsForRange,
  contiguousBrowsePageRuns,
  mergeLoadedBrowsePage,
  assetSummaryFromLayoutEntry,
} from "../../src/renderer/browse-window-slots";

function asset(assetId: string): AssetSummary {
  return {
    assetId,
    locationKind: "managed",
    managedFolderId: null,
    relativeFilePath: `${assetId}.png`,
    displayName: `${assetId}.png`,
    currentRevisionId: `${assetId}-rev`,
    byteSize: 1,
    modifiedAt: "2026-01-01T00:00:00.000Z",
    availability: "available",
    rating: 0,
    favorite: false,
    deletedAt: null,
    trashedFromPath: null,
    trashedFromTombstoneId: null,
    remainingDays: null,
    thumbnailStatus: null,
    thumbnailArtifactId: null,
    mediaType: "image",
    width: 1,
    height: 1,
    durationMs: null,
  };
}

describe("browse window virtualization (Serpent-sa65)", () => {
  it("aligns an index to its page offset", () => {
    expect(browsePageOffset(0, 100)).toBe(0);
    expect(browsePageOffset(99, 100)).toBe(0);
    expect(browsePageOffset(100, 100)).toBe(100);
    expect(browsePageOffset(250, 100)).toBe(200);
  });

  it("orders the destination page first so a scrollbar jump is not queued behind earlier pages", () => {
    expect(
      browsePageOffsetsForRange({
        startIndex: 250,
        endIndex: 260,
        total: 700,
        pageSize: 100,
      }),
    ).toEqual([200, 100, 300]);
  });

  it("splits missing pages around an in-flight gap", () => {
    expect(contiguousBrowsePageRuns([0, 100, 300, 500, 400, 300], 100)).toEqual([
      [0, 100],
      [300, 400, 500],
    ]);
  });

  it("keeps only real summaries instead of expanding COUNT into placeholders", () => {
    const loaded = mergeLoadedBrowsePage({
      current: [],
      items: [asset("a"), asset("b")],
      layout: Array.from({ length: 250 }, (_, index) => ({
        assetId: index === 0 ? "a" : index === 1 ? "b" : `real-${index}`,
        width: 1,
        height: 1,
      })),
    });
    expect(loaded.map((item) => item.assetId)).toEqual(["a", "b"]);
  });

  it("merges a jumped page in compact-layout order without fake intervening rows", () => {
    const jumped = mergeLoadedBrowsePage({
      current: [asset("tail")],
      items: [asset("a"), asset("middle")],
      layout: [
        { assetId: "a", width: 1, height: 1 },
        { assetId: "unloaded", width: 1, height: 1 },
        { assetId: "middle", width: 1, height: 1 },
        { assetId: "tail", width: 1, height: 1 },
      ],
    });
    expect(jumped.map((item) => item.assetId)).toEqual(["a", "middle", "tail"]);
  });

  it("builds a first-paint AssetSummary from layout caption fields (Serpent-l2at)", () => {
    const summary = assetSummaryFromLayoutEntry({
      assetId: "hero",
      width: 1920,
      height: 1080,
      displayName: "hero.png",
      relativeFilePath: "hero.png",
      byteSize: 12,
      modifiedAt: "2026-08-17T00:00:00.000Z",
      rating: 4,
      previewArtifactId: "thumb-1",
    });
    expect(summary).toMatchObject({
      assetId: "hero",
      displayName: "hero.png",
      byteSize: 12,
      rating: 4,
      thumbnailArtifactId: "thumb-1",
      width: 1920,
      height: 1080,
    });
  });
});
