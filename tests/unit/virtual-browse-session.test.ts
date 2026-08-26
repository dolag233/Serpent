import { describe, expect, it } from "vitest";

import {
  BrowseGeometryBlockCache,
  BROWSE_GEOMETRY_BLOCK_SIZE,
  geometryBlockStartsForRange,
  geometryPlaceholderId,
  isGeometryPlaceholder,
} from "../../src/renderer/browse/use-virtual-browse-session";
import {
  createVirtualBrowseLayout,
  evictVirtualSummaryPage,
  mergeVirtualSummaryPage,
  virtualLayoutEntryAt,
} from "../../src/renderer/browse/virtual-browse-layout";

function asset(assetId: string) {
  return {
    assetId,
    locationKind: "managed" as const,
    managedFolderId: null,
    relativeFilePath: `${assetId}.png`,
    displayName: `${assetId}.png`,
    currentRevisionId: `revision-${assetId}`,
    byteSize: 10,
    modifiedAt: "2026-01-01T00:00:00.000Z",
    availability: "available" as const,
    rating: 0,
    favorite: false,
    deletedAt: null,
    trashedFromPath: null,
    trashedFromTombstoneId: null,
    remainingDays: null,
    thumbnailStatus: null,
    thumbnailArtifactId: null,
    mediaType: "image" as const,
    width: 100,
    height: 80,
    durationMs: null,
  };
}

describe("virtual browse geometry", () => {
  it("creates lightweight estimated slots and overlays only the first page", () => {
    const layout = createVirtualBrowseLayout({
      total: 2_100,
      firstPage: { items: [asset("first")], offset: 0 },
    });
    expect(layout.total).toBe(2_100);
    expect(layout.entries.size).toBe(1);
    expect(virtualLayoutEntryAt(layout, 0)).toMatchObject({
      assetId: "first",
      width: 100,
      height: 80,
    });
    expect(isGeometryPlaceholder(virtualLayoutEntryAt(layout, 1))).toBe(true);
    expect(virtualLayoutEntryAt(layout, 1).assetId).toBe(geometryPlaceholderId(1));
  });

  it("aligns viewport requests to bounded blocks with one block of overscan", () => {
    expect(geometryBlockStartsForRange({
      startIndex: 257,
      endIndex: 300,
      total: 1_000,
    })).toEqual([128, 256, 384]);
    expect(geometryBlockStartsForRange({
      startIndex: 0,
      endIndex: 20,
      total: 100,
    })).toEqual([0]);
  });

  it("evicts geometry blocks by LRU and keeps summary fields when geometry arrives", () => {
    const cache = new BrowseGeometryBlockCache(2);
    const block = (startIndex: number) => ({
      sessionId: "session-1",
      startIndex,
      changeSequence: 1,
      entries: [{ index: startIndex, assetId: `asset-${startIndex}`, width: 2, height: 1 }],
    });
    cache.set(block(0));
    cache.set(block(BROWSE_GEOMETRY_BLOCK_SIZE));
    expect(cache.get(0)?.startIndex).toBe(0);
    cache.set(block(BROWSE_GEOMETRY_BLOCK_SIZE * 2));
    expect(cache.has(BROWSE_GEOMETRY_BLOCK_SIZE)).toBe(false);
    expect(cache.size).toBe(2);

    const current = createVirtualBrowseLayout({
      total: 2_100,
      firstPage: { items: [asset("asset-0")], offset: 0 },
    });
    const merged = mergeVirtualSummaryPage(current, 128, [asset("asset-128")]);
    expect(virtualLayoutEntryAt(merged, 128)).toMatchObject({
      assetId: "asset-128",
      displayName: "asset-128.png",
      byteSize: 10,
    });
  });

  it("evicts heavy summary fields without losing a loaded geometry slot", () => {
    const current = mergeVirtualSummaryPage(
      createVirtualBrowseLayout({
        total: 2_100,
        firstPage: { items: [asset("asset-0")], offset: 0 },
      }),
      128,
      [asset("asset-128")],
    );
    const evicted = evictVirtualSummaryPage(current, 128, 100);
    expect(virtualLayoutEntryAt(evicted, 128).assetId).toBe("asset-128");
    expect(virtualLayoutEntryAt(evicted, 128)).toMatchObject({
      width: 100,
      height: 80,
    });
    expect(virtualLayoutEntryAt(evicted, 128).displayName).toBeUndefined();

    const withGeometry = {
      ...current,
      entries: new Map(current.entries).set(128, {
        ...virtualLayoutEntryAt(current, 128),
        width: 200,
        height: 100,
      }),
    };
    const retained = evictVirtualSummaryPage(withGeometry, 128, 100);
    expect(virtualLayoutEntryAt(retained, 128)).toMatchObject({
      assetId: "asset-128",
      width: 200,
      height: 100,
    });
    expect(virtualLayoutEntryAt(retained, 128).displayName).toBeUndefined();
  });

  it("does not advance the geometry revision for summary-only patches", () => {
    const current = createVirtualBrowseLayout({
      total: 2_100,
      firstPage: { items: [asset("asset-0")], offset: 0 },
    });
    const summaryPatch = mergeVirtualSummaryPage(current, 0, [{
      ...asset("asset-0"),
      displayName: "renamed.png",
      thumbnailArtifactId: "artifact-1",
    }]);
    expect(summaryPatch.geometryRevision).toBe(current.geometryRevision);
    expect(summaryPatch.geometryEntries).toBe(current.geometryEntries);
    expect(summaryPatch.assetIdsByIndex).toBe(current.assetIdsByIndex);

    const geometryPatch = mergeVirtualSummaryPage(current, 0, [{
      ...asset("asset-0"),
      width: 200,
    }]);
    expect(geometryPatch.geometryRevision).toBeGreaterThan(current.geometryRevision);
    expect(geometryPatch.geometryEntries).not.toBe(current.geometryEntries);
  });
});
