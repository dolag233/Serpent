import { describe, expect, it } from "vitest";

import {
  geometryPlaceholderId,
  isGeometryPlaceholder,
  BROWSE_FULL_INDEX_MAX_ASSETS,
  shouldFetchCompleteBrowseIndex,
  shouldUseVirtualBrowseLayout,
} from "../../src/renderer/browse/use-virtual-browse-session";
import {
  createVirtualBrowseLayout,
  createVirtualBrowseLayoutFromIndex,
  evictVirtualSummaryPage,
  mergeVirtualSummaryPage,
  patchVirtualLayoutGeometry,
  permuteVirtualBrowseLayout,
  virtualIndexMatchesFirstPage,
  virtualLayoutEntryAt,
  virtualLayoutPublishedId,
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
    expect(virtualLayoutPublishedId(layout, 0)).toBe("first");
    expect(virtualLayoutPublishedId(layout, 1)).toBe(geometryPlaceholderId(1));
  });

  it("virtualizes exactly the scopes whose COUNT exceeds the first painted page", () => {
    expect(shouldUseVirtualBrowseLayout({
      sessionId: "session-1",
      total: 1_000,
      firstPageCount: 100,
    })).toBe(true);
    // One page already covers the scope: the compact path owns it.
    expect(shouldUseVirtualBrowseLayout({
      sessionId: "session-1",
      total: 100,
      firstPageCount: 100,
    })).toBe(false);
    // Without a session there is no full-range COUNT to trust.
    expect(shouldUseVirtualBrowseLayout({
      total: 1_000,
      firstPageCount: 100,
    })).toBe(false);
    expect(shouldUseVirtualBrowseLayout({
      sessionId: "session-1",
      total: 0,
      firstPageCount: 0,
    })).toBe(false);
  });

  /**
   * CANVAS-038: the whole scope's geometry must arrive in one commit. Streaming
   * 128-row blocks rewrote heights and identities while the user scrolled, which
   * made the scrollbar thumb follow the loaded subset and re-sliced the window.
   */
  it("commits a complete index in one step so no slot stays a geometry placeholder", () => {
    const entries = Array.from({ length: 300 }, (_, index) => ({
      assetId: `asset-${index}`,
      width: 100 + index,
      height: 80,
      displayName: `asset-${index}.png`,
      previewArtifactId: `artifact-${index}`,
      mediaType: "image" as const,
    }));
    const layout = createVirtualBrowseLayoutFromIndex({ total: 300, entries });

    expect(layout.total).toBe(300);
    expect(layout.entries.size).toBe(300);
    for (const index of [0, 127, 128, 299]) {
      const entry = virtualLayoutEntryAt(layout, index);
      expect(isGeometryPlaceholder(entry)).toBe(false);
      expect(entry.assetId).toBe(`asset-${index}`);
      expect(entry.width).toBe(100 + index);
      expect(entry.previewArtifactId).toBe(`artifact-${index}`);
    }
    // Geometry is committed once; a patch that only changes non-geometry fields
    // (displayName, ready thumbnail) must not move the geometry revision.
    const patched = mergeVirtualSummaryPage(layout, 200, [{
      ...asset("asset-200"),
      width: 300,
      height: 80,
      displayName: "renamed-200.png",
    }]);
    expect(patched.geometryRevision).toBe(layout.geometryRevision);
    expect(patched.geometryEntries).toBe(layout.geometryEntries);
    expect(virtualLayoutEntryAt(patched, 200).displayName).toBe("renamed-200.png");
    // A real dimension correction is still allowed to move geometry.
    const corrected = mergeVirtualSummaryPage(layout, 200, [{
      ...asset("asset-200"),
      width: 999,
      height: 80,
    }]);
    expect(corrected.geometryRevision).toBeGreaterThan(layout.geometryRevision);
  });

  it("keeps COUNT geometry and placeholder tail for a truncated index", () => {
    const entries = Array.from({ length: 4 }, (_, index) => ({
      assetId: `asset-${index}`,
      width: 100,
      height: 80,
      displayName: `asset-${index}.png`,
    }));
    // A scope above BROWSE_SCOPE_MAX_ASSETS returns only its prefix.
    const layout = createVirtualBrowseLayoutFromIndex({ total: 90_000, entries });

    expect(layout.total).toBe(90_000);
    expect(virtualLayoutEntryAt(layout, 3).assetId).toBe("asset-3");
    expect(isGeometryPlaceholder(virtualLayoutEntryAt(layout, 4))).toBe(true);
    expect(isGeometryPlaceholder(virtualLayoutEntryAt(layout, 89_999))).toBe(true);
  });

  /**
   * CANVAS-038: a refresh must keep the committed index. Rebuilding it from the
   * 100-item first page left placeholders at indices 100+ whose estimated
   * heights moved the scrollbar by ~20% on a 1442-asset network library.
   */
  it("reuses a committed index for a refresh but not for a different scope", () => {
    const entries = Array.from({ length: 300 }, (_, index) => ({
      assetId: `asset-${index}`,
      width: 100,
      height: 80,
      displayName: `asset-${index}.png`,
    }));
    const layout = createVirtualBrowseLayoutFromIndex({ total: 300, entries });
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      assetId: `asset-${index}`,
    }));

    // Same ordered scope re-reported: reuse, so geometry never regresses.
    expect(virtualIndexMatchesFirstPage(layout, { offset: 0, items: firstPage })).toBe(true);
    // Different folder that happens to report COUNT 300: never reuse.
    expect(virtualIndexMatchesFirstPage(layout, {
      offset: 0,
      items: firstPage.map((item, index) => (
        index === 7 ? { assetId: "other-asset" } : item
      )),
    })).toBe(false);
    // Nothing committed yet, or an empty page: nothing to reuse.
    expect(virtualIndexMatchesFirstPage(null, { offset: 0, items: firstPage })).toBe(false);
    expect(virtualIndexMatchesFirstPage(layout, { offset: 0, items: [] })).toBe(false);
  });

  /**
   * The summary-patch fast path republishes the compact layout only when the
   * entries map identity changes. That is only sound because every mutation
   * produces a fresh map — including eviction, which rewrites entry *contents*
   * without changing `entries.size` or `geometryRevision`. If eviction ever
   * mutated in place, `browseLayout` would silently diverge from the virtual
   * index and App's `selectedLayoutEntry` would read a stale copy.
   */
  it("reports an identity change when summary eviction rewrites entry contents", () => {
    const seeded = createVirtualBrowseLayoutFromIndex({
      total: 300,
      entries: Array.from({ length: 300 }, (_, index) => ({
        assetId: `asset-${index}`,
        width: 100,
        height: 80,
        displayName: `asset-${index}.png`,
      })),
    });
    const withSummary = mergeVirtualSummaryPage(seeded, 128, [asset("asset-128")]);
    expect(withSummary.entries).not.toBe(seeded.entries);

    const evicted = evictVirtualSummaryPage(withSummary, 128, 100);
    expect(evicted.entries.size).toBe(withSummary.entries.size);
    expect(evicted.geometryRevision).toBe(withSummary.geometryRevision);
    // Size and revision are unchanged, so identity is the only valid signal.
    expect(evicted.entries).not.toBe(withSummary.entries);
    expect(virtualLayoutEntryAt(evicted, 128).displayName).toBeUndefined();
    expect(virtualLayoutEntryAt(evicted, 128).assetId).toBe("asset-128");
  });

  /**
   * CANVAS-038 guard: the one-shot index is O(scope) on the renderer main thread
   * (payload + Zod + index maps + compact array). Switching to a very large
   * library stalled behind the loading overlay, so above the bound identity and
   * geometry come from the bounded summary pages instead.
   */
  it("bounds the one-shot index so a huge library cannot stall the renderer", () => {
    expect(shouldFetchCompleteBrowseIndex(0)).toBe(true);
    expect(shouldFetchCompleteBrowseIndex(1_442)).toBe(true);
    expect(shouldFetchCompleteBrowseIndex(BROWSE_FULL_INDEX_MAX_ASSETS)).toBe(true);
    expect(shouldFetchCompleteBrowseIndex(BROWSE_FULL_INDEX_MAX_ASSETS + 1)).toBe(false);
    expect(shouldFetchCompleteBrowseIndex(50_000)).toBe(false);
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

  it("patches live video dimensions onto loaded virtual slots (Serpent-9c9f97)", () => {
    const current = createVirtualBrowseLayout({
      total: 2_100,
      firstPage: {
        items: [{ ...asset("asset-0"), width: null, height: null }],
        offset: 0,
      },
    });
    const patched = patchVirtualLayoutGeometry(
      current,
      new Map([["asset-0", { width: 1920, height: 1080 }]]),
    );
    expect(patched).not.toBe(current);
    expect(patched.geometryRevision).toBeGreaterThan(current.geometryRevision);
    expect(virtualLayoutEntryAt(patched, 0)).toMatchObject({
      assetId: "asset-0",
      width: 1920,
      height: 1080,
    });
    expect(patchVirtualLayoutGeometry(
      patched,
      new Map([["asset-0", { width: 1920, height: 1080 }]]),
    )).toBe(patched);
  });
});

describe("permuteVirtualBrowseLayout (client shuffle)", () => {
  it("moves source slots onto display ranks and keeps source placeholder ids", () => {
    const layout = createVirtualBrowseLayoutFromIndex({
      total: 4,
      entries: [
        { assetId: "a", width: 10, height: 10 },
        { assetId: "b", width: 20, height: 20 },
      ],
    });
    const shuffled = permuteVirtualBrowseLayout(layout, [2, 0, 3, 1]);
    expect(virtualLayoutPublishedId(shuffled, 1)).toBe("a");
    expect(virtualLayoutPublishedId(shuffled, 3)).toBe("b");
    expect(virtualLayoutPublishedId(shuffled, 0)).toBe(geometryPlaceholderId(2));
    expect(virtualLayoutEntryAt(shuffled, 0).assetId).toBe(geometryPlaceholderId(2));
    expect(virtualLayoutEntryAt(shuffled, 1)).toMatchObject({
      assetId: "a",
      width: 10,
      height: 10,
    });
    expect(shuffled.indexByAssetId.get("a")).toBe(1);
  });
});
