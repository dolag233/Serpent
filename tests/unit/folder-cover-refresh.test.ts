import { describe, expect, it } from "vitest";

import { collectFolderCoverCandidateAssetIds } from "../../src/renderer/folder-cover-refresh";
import type { FolderBrowseEntry } from "../../src/shared/asset-types";

function entry(folderId: string, coverAssetIds: string[]): FolderBrowseEntry {
  return {
    folderId,
    parentFolderId: null,
    locationKind: "managed",
    name: folderId,
    relativePath: folderId,
    status: "available",
    directAssetCount: 0,
    recursiveAssetCount: 0,
    childFolderCount: 0,
    coverArtifactIds: [],
    coverAssetIds,
  };
}

describe("collectFolderCoverCandidateAssetIds (Serpent-d0nv)", () => {
  it("collects every cover candidate asset id across the folder-card row", () => {
    const entries = [
      entry("folder-a", ["asset-1", "asset-2"]),
      entry("folder-b", ["asset-3"]),
      entry("folder-c", []),
    ];
    expect([...collectFolderCoverCandidateAssetIds(entries)].sort()).toEqual([
      "asset-1",
      "asset-2",
      "asset-3",
    ]);
  });

  it("deduplicates shared candidates across folders", () => {
    const entries = [
      entry("folder-a", ["shared"]),
      entry("folder-b", ["shared"]),
    ];
    const ids = collectFolderCoverCandidateAssetIds(entries);
    expect(ids.size).toBe(1);
    expect(ids.has("shared")).toBe(true);
  });

  it("returns an empty set when no folder has cover candidates", () => {
    expect(collectFolderCoverCandidateAssetIds([]).size).toBe(0);
    expect(collectFolderCoverCandidateAssetIds([entry("folder-a", [])]).size).toBe(0);
  });
});
