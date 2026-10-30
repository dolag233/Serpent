import { describe, expect, it } from "vitest";

import {
  currentFilteredFolderCounts,
  favoriteFolderBrowseEntries,
  type FilteredFolderCountSnapshot,
} from "../../src/renderer/favorite-folder-visibility";

const entries = [{ folderId: "direct" }, { folderId: "deep" }, { folderId: "empty" }];
const snapshot: FilteredFolderCountSnapshot = {
  requestKey: { query: "library-a:favorites:1" },
  all: 2,
  root: 0,
  byFolderId: new Map([["direct", 1], ["deep", 1]]),
};

describe("favorite folder visibility", () => {
  it("keeps folders with recursive matches, including ones without direct assets", () => {
    expect(favoriteFolderBrowseEntries(entries, true, snapshot)).toEqual(entries.slice(0, 2));
  });

  it("restores all folders when leaving favorite mode", () => {
    expect(favoriteFolderBrowseEntries(entries, false, snapshot)).toBe(entries);
  });

  it("keeps navigation available while loading or after a failed count request", () => {
    expect(favoriteFolderBrowseEntries(entries, true, null)).toBe(entries);
  });

  it.each(["library-b:favorites:1", "library-a:format:1", "library-a:favorites:2", "library-a:favorites:1"])(
    "does not hide folders using stale counts for %s",
    (requestKey) => {
      const counts = currentFilteredFolderCounts(snapshot, { query: requestKey });
      expect(counts).toBeNull();
      expect(favoriteFolderBrowseEntries(entries, true, counts)).toBe(entries);
    },
  );

  it("uses the refreshed result after the last favorite is removed", () => {
    const refreshed = { ...snapshot, requestKey: { query: "library-a:favorites:2" }, byFolderId: new Map() };
    const counts = currentFilteredFolderCounts(refreshed, refreshed.requestKey);
    expect(favoriteFolderBrowseEntries(entries, true, counts)).toEqual([]);
  });
});
