import { describe, expect, it } from "vitest";

import type { AssetSummary } from "../../src/shared/asset-types";
import {
  browsePageOffset,
  browsePageOffsetsForRange,
  createPendingBrowseAsset,
  isPendingBrowseAsset,
  mergeBrowseWindow,
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

describe("browse window slots (Serpent-87pd)", () => {
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

  it("expands the first page to the full COUNT so the scrollbar is not stuck at 100", () => {
    const slots = mergeBrowseWindow({
      current: [],
      total: 250,
      offset: 0,
      items: [asset("a"), asset("b")],
    });
    expect(slots).toHaveLength(250);
    expect(slots[0]?.assetId).toBe("a");
    expect(slots[1]?.assetId).toBe("b");
    expect(isPendingBrowseAsset(slots[2]!)).toBe(true);
    expect(isPendingBrowseAsset(slots[249]!)).toBe(true);
  });

  it("fills a jumped window without requiring earlier pages to load first", () => {
    const first = mergeBrowseWindow({
      current: [],
      total: 250,
      offset: 0,
      items: [asset("a")],
    });
    const jumped = mergeBrowseWindow({
      current: first,
      total: 250,
      offset: 200,
      items: [asset("tail")],
    });
    expect(jumped[0]?.assetId).toBe("a");
    expect(jumped[200]?.assetId).toBe("tail");
    expect(isPendingBrowseAsset(jumped[100]!)).toBe(true);
  });

  it("does not treat a locally created placeholder as a real asset id", () => {
    expect(isPendingBrowseAsset(createPendingBrowseAsset(3))).toBe(true);
    expect(isPendingBrowseAsset(asset("real"))).toBe(false);
  });
});
