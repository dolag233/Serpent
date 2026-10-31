import { describe, expect, it } from "vitest";

import { filteredFolderBrowseEntries } from "../../src/renderer/filtered-folder-visibility";
import { resolveBrowseCanvasBodyLayout } from "../../src/renderer/folder-browse-canvas";

const folders = [
  { folderId: "parent", directAssetCount: 0 },
  { folderId: "linked:parent/deep", directAssetCount: 0 },
  { folderId: "nonmatching", directAssetCount: 12 },
  { folderId: "empty", directAssetCount: 0 },
];

describe("filtered folder visibility", () => {
  it("uses recursive filtered counts, keeping deep managed and linked matches", () => {
    expect(filteredFolderBrowseEntries(folders, {
      byFolderId: new Map([["parent", 1], ["linked:parent/deep", 2], ["empty", 0]]),
    })).toEqual(folders.slice(0, 2));
  });

  it("keeps ordinary empty folders without filters or while counts are unavailable", () => {
    expect(filteredFolderBrowseEntries(folders, null)).toBe(folders);
  });

  it("allows an empty state when neither assets nor folders match", () => {
    const visible = filteredFolderBrowseEntries(folders, { byFolderId: new Map() });
    expect(visible).toEqual([]);
    expect(resolveBrowseCanvasBodyLayout(0, visible.length)).toEqual({ mode: "empty" });
  });

  it("applies the same rule to matching folder names combined with toolbar filters", () => {
    const nameMatches = [{ folderId: "nonmatching", name: "Reference" }, { folderId: "parent", name: "Reference Deep" }];
    expect(filteredFolderBrowseEntries(nameMatches, {
      byFolderId: new Map([["parent", 3]]),
    })).toEqual([nameMatches[1]]);
    expect(filteredFolderBrowseEntries(nameMatches, null)).toBe(nameMatches);
  });
});
