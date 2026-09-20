import { describe, expect, it } from "vitest";

import type { AssetSummary } from "../../src/shared/asset-types";
import {
  browsePageOffset,
  browsePageOffsetsForRange,
  browsePageOffsetsForIndices,
  compactBrowseLayoutIsComplete,
  contiguousBrowsePageRuns,
  mergeLoadedBrowsePage,
  nextUnfilledBrowsePageOffset,
  resolveBrowseCanvasLayout,
  assetSummaryFromLayoutEntry,
  browseRankFromPublishedId,
  virtualSlotAsset,
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

  it("covers scattered shuffle ranks without spanning min..max", () => {
    expect(
      browsePageOffsetsForIndices({
        indices: [5, 250, 251],
        total: 700,
        pageSize: 100,
      }),
    ).toEqual([0, 200]);
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

  /**
   * CANVAS-038: a slot's card identity must not flip between a shadow card and
   * a real card. Before the index resolves an identity the slot renders nothing
   * (`undefined`); once it does, the card is synthesized from the index and the
   * loaded summary only replaces fields.
   */
  it("resolves virtual slot identity from the index, never from a placeholder", () => {
    const entry = {
      assetId: "hero",
      width: 1920,
      height: 1080,
      displayName: "hero.png",
      relativeFilePath: "hero.png",
      previewArtifactId: "thumb-1",
      mediaType: "image" as const,
    };
    // Unresolved geometry placeholder: no card at all, so nothing can be torn down.
    expect(virtualSlotAsset(new Map(), {
      assetId: "__geometry__:7",
      width: null,
      height: null,
    })).toBeUndefined();
    // Real index identity: a full card paints before its summary page arrives.
    expect(virtualSlotAsset(new Map(), entry)).toMatchObject({
      assetId: "hero",
      displayName: "hero.png",
      mediaType: "image",
      thumbnailStatus: "ready",
      thumbnailArtifactId: "thumb-1",
    });
    // The loaded summary wins, but the identity is the same one.
    const loaded = asset("hero");
    expect(virtualSlotAsset(new Map([["hero", loaded]]), entry)).toBe(loaded);
  });

  it("does not treat a first page of 100 as a complete compact layout (Serpent-9cfc8c)", () => {
    expect(compactBrowseLayoutIsComplete(100, 398)).toBe(false);
    expect(compactBrowseLayoutIsComplete(398, 398)).toBe(true);
    expect(compactBrowseLayoutIsComplete(0, 398)).toBe(false);
    expect(nextUnfilledBrowsePageOffset(new Set([0]), 398, 100)).toBe(100);
    expect(nextUnfilledBrowsePageOffset(new Set([0, 100, 200, 300]), 398, 100)).toBeNull();
  });

  it("grows a stale first-page layout with later loaded summaries", () => {
    const layout = resolveBrowseCanvasLayout(
      [
        { assetId: "a", width: 1, height: 1 },
        { assetId: "b", width: 1, height: 1 },
      ],
      [asset("a"), asset("b"), asset("c"), asset("d")],
    );
    expect(layout.map((entry) => entry.assetId)).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps a complete compact index when summaries are still streaming in", () => {
    const layout = resolveBrowseCanvasLayout(
      [
        { assetId: "a", width: 8, height: 8 },
        { assetId: "b", width: 8, height: 8 },
        { assetId: "c", width: 8, height: 8 },
      ],
      [asset("a"), asset("b")],
    );
    expect(layout.map((entry) => entry.assetId)).toEqual(["a", "b", "c"]);
    expect(layout[0]?.width).toBe(8);
  });

  it("maps published placeholder ids to session ranks when compact layout is only the loaded prefix", () => {
    const rankById = new Map([
      ["first", 0],
      ["second", 1],
    ]);
    expect(browseRankFromPublishedId("first", rankById)).toBe(0);
    expect(browseRankFromPublishedId("__geometry__:150", rankById)).toBe(150);
    expect(browseRankFromPublishedId("missing", rankById)).toBeUndefined();
    expect(browseRankFromPublishedId("__geometry__:-1", rankById)).toBeUndefined();
  });
});
