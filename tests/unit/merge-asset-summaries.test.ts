import { describe, expect, it } from "vitest";

import type { AssetSummary } from "../../src/shared/asset-types";
import { mergeAssetSummaries } from "../../src/renderer/merge-asset-summaries";

function asset(id: string, availability: AssetSummary["availability"]): AssetSummary {
  return {
    assetId: id,
    locationKind: "managed",
    managedFolderId: null,
    relativeFilePath: `${id}.jpg`,
    displayName: `${id}.jpg`,
    currentRevisionId: `${id}-rev`,
    byteSize: 1,
    modifiedAt: "2026-01-01T00:00:00.000Z",
    availability,
    rating: 0,
    favorite: false,
    deletedAt: null,
    trashedFromPath: null,
    trashedFromTombstoneId: null,
    remainingDays: null,
    thumbnailStatus: null,
    thumbnailArtifactId: null,
    mediaType: "image",
    width: null,
    height: null,
    durationMs: null,
  };
}

describe("mergeAssetSummaries", () => {
  it("replaces matching rows and leaves others unchanged", () => {
    const current = [asset("a", "available"), asset("b", "missing")];
    const next = mergeAssetSummaries(current, [asset("b", "available")]);
    expect(next[0]?.availability).toBe("available");
    expect(next[1]?.availability).toBe("available");
    expect(next).not.toBe(current);
  });

  it("returns the same array reference when nothing matches", () => {
    const current = [asset("a", "missing")];
    expect(mergeAssetSummaries(current, [asset("b", "available")])).toBe(current);
  });
});
