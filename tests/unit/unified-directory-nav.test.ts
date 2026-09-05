import { describe, expect, it } from "vitest";

import {
  buildUnifiedDirectoryNavEntries,
  filterCollapsedDirectoryEntries,
  managedFolderIdsWithChildren,
  sortManagedTreeEntries,
} from "../../src/renderer/unified-directory-nav";
import type { LinkedFolderSummary, ManagedFolderSummary } from "../../src/shared/asset-types";

const managed = (
  overrides: Partial<ManagedFolderSummary> & Pick<ManagedFolderSummary, "folderId" | "name" | "relativePath">,
): ManagedFolderSummary => ({
  parentFolderId: null,
  directAssetCount: 0,
  childFolderCount: 0,
  ...overrides,
});

const linked = (
  overrides: Partial<LinkedFolderSummary> & Pick<LinkedFolderSummary, "folderId" | "displayName">,
): LinkedFolderSummary => ({
  status: "available",
  assetCount: 0,
  absoluteRootPath: "/tmp/linked",
  relativePath: "",
  parentFolderId: null,
  ...overrides,
});

describe("buildUnifiedDirectoryNavEntries", () => {
  it("returns an empty list when both inputs are empty", () => {
    expect(buildUnifiedDirectoryNavEntries([], [])).toEqual([]);
  });

  it("preserves managed input order and derives depth from relativePath segments", () => {
    const folders = [
      managed({ folderId: "root-a", name: "A", relativePath: "a" }),
      managed({
        folderId: "child-a",
        name: "Child",
        relativePath: "a/child",
        parentFolderId: "root-a",
      }),
      managed({ folderId: "root-b", name: "B", relativePath: "b" }),
    ];

    expect(buildUnifiedDirectoryNavEntries(folders, [])).toEqual([
      {
        kind: "managed",
        folderId: "root-a",
        name: "A",
        depth: 1,
        parentFolderId: null,
        directAssetCount: 0,
      },
      {
        kind: "managed",
        folderId: "child-a",
        name: "Child",
        depth: 2,
        parentFolderId: "root-a",
        directAssetCount: 0,
      },
      {
        kind: "managed",
        folderId: "root-b",
        name: "B",
        depth: 1,
        parentFolderId: null,
        directAssetCount: 0,
      },
    ]);
  });

  it("appends linked folders after managed, including virtual children", () => {
    const folders = [managed({ folderId: "m1", name: "Managed", relativePath: "managed" })];
    const linkedFolders = [
      linked({
        folderId: "l1",
        displayName: "Linked Online",
        status: "available",
        assetCount: 3,
        linkedFolderId: "l1",
        relativePath: "",
        parentFolderId: null,
      }),
      linked({
        folderId: "lfv:l1/notes",
        displayName: "notes",
        status: "available",
        assetCount: 1,
        linkedFolderId: "l1",
        relativePath: "notes",
        parentFolderId: "l1",
      }),
      linked({
        folderId: "l2",
        displayName: "Linked Offline",
        status: "offline",
        assetCount: 0,
        linkedFolderId: "l2",
        relativePath: "",
        parentFolderId: null,
      }),
    ];

    expect(buildUnifiedDirectoryNavEntries(folders, linkedFolders)).toEqual([
      {
        kind: "managed",
        folderId: "m1",
        name: "Managed",
        depth: 1,
        parentFolderId: null,
        directAssetCount: 0,
      },
      {
        kind: "linked",
        folderId: "l2",
        name: "Linked Offline",
        depth: 1,
        parentFolderId: null,
        status: "offline",
        assetCount: 0,
        linkedFolderId: "l2",
        relativePath: "",
      },
      {
        kind: "linked",
        folderId: "l1",
        name: "Linked Online",
        depth: 1,
        parentFolderId: null,
        status: "available",
        assetCount: 3,
        linkedFolderId: "l1",
        relativePath: "",
      },
      {
        kind: "linked",
        folderId: "lfv:l1/notes",
        name: "notes",
        depth: 2,
        parentFolderId: "l1",
        status: "available",
        assetCount: 1,
        linkedFolderId: "l1",
        relativePath: "notes",
      },
    ]);
  });

  it("keeps linked-only roots at depth 1", () => {
    expect(
      buildUnifiedDirectoryNavEntries(
        [],
        [linked({ folderId: "only", displayName: "Only Linked", assetCount: 1 })],
      ),
    ).toEqual([
      {
        kind: "linked",
        folderId: "only",
        name: "Only Linked",
        depth: 1,
        parentFolderId: null,
        status: "available",
        assetCount: 1,
        linkedFolderId: "only",
        relativePath: "",
      },
    ]);
  });
});

describe("filterCollapsedDirectoryEntries", () => {
  it("hides managed and linked descendants of collapsed folders", () => {
    const folders = [
      managed({ folderId: "p", name: "Parent", relativePath: "Parent" }),
      managed({
        folderId: "c",
        name: "Child",
        relativePath: "Parent/Child",
        parentFolderId: "p",
      }),
    ];
    const entries = buildUnifiedDirectoryNavEntries(folders, [
      linked({
        folderId: "l1",
        displayName: "Link",
        assetCount: 2,
        linkedFolderId: "l1",
        relativePath: "",
        parentFolderId: null,
      }),
      linked({
        folderId: "lfv:l1/notes",
        displayName: "notes",
        assetCount: 1,
        linkedFolderId: "l1",
        relativePath: "notes",
        parentFolderId: "l1",
      }),
    ]);
    expect(managedFolderIdsWithChildren(entries).has("p")).toBe(true);
    expect(managedFolderIdsWithChildren(entries).has("l1")).toBe(true);
    const visible = filterCollapsedDirectoryEntries(entries, new Set(["p", "l1"]));
    expect(visible.map((entry) => entry.folderId)).toEqual(["p", "l1"]);
  });
});

describe("sortManagedTreeEntries", () => {
  const treeFolders: ManagedFolderSummary[] = [
    managed({ folderId: "banana", name: "banana", relativePath: "banana", directAssetCount: 1, createdAt: "2020-01-01T00:00:00.000Z" }),
    managed({ folderId: "apple", name: "apple", relativePath: "apple", directAssetCount: 9, createdAt: "2023-06-01T00:00:00.000Z" }),
    managed({ folderId: "cherry", name: "cherry", relativePath: "cherry", directAssetCount: 4, createdAt: "2021-03-01T00:00:00.000Z" }),
    managed({ folderId: "apple/kiwi", name: "kiwi", relativePath: "apple/kiwi", parentFolderId: "apple", directAssetCount: 20, createdAt: "2022-05-01T00:00:00.000Z" }),
    managed({ folderId: "apple/grape", name: "grape", relativePath: "apple/grape", parentFolderId: "apple", directAssetCount: 2, createdAt: "2024-01-01T00:00:00.000Z" }),
    managed({ folderId: "banana/fig", name: "fig", relativePath: "banana/fig", parentFolderId: "banana", directAssetCount: 7, createdAt: "2019-12-01T00:00:00.000Z" }),
  ];
  const linkedRoot = linked({
    folderId: "l1",
    displayName: "Linked",
    assetCount: 3,
    linkedFolderId: "l1",
    relativePath: "",
    parentFolderId: null,
  });

  const ids = (entries: ReturnType<typeof buildUnifiedDirectoryNavEntries>) =>
    entries.map((entry) => entry.folderId);

  it("sorts managed siblings by name ascending at every depth, keeping linked appended", () => {
    const entries = buildUnifiedDirectoryNavEntries(treeFolders, [linkedRoot]);
    expect(ids(sortManagedTreeEntries(entries, "name", "asc"))).toEqual([
      "apple",
      "apple/grape",
      "apple/kiwi",
      "banana",
      "banana/fig",
      "cherry",
      "l1",
    ]);
  });

  it("reverses name order when descending", () => {
    const entries = buildUnifiedDirectoryNavEntries(treeFolders, [linkedRoot]);
    expect(ids(sortManagedTreeEntries(entries, "name", "desc"))).toEqual([
      "cherry",
      "banana",
      "banana/fig",
      "apple",
      "apple/kiwi",
      "apple/grape",
      "l1",
    ]);
  });

  it("sorts managed siblings by creation time newest-first (desc)", () => {
    const entries = buildUnifiedDirectoryNavEntries(treeFolders, [linkedRoot]);
    expect(ids(sortManagedTreeEntries(entries, "created", "desc"))).toEqual([
      "apple",
      "apple/grape",
      "apple/kiwi",
      "cherry",
      "banana",
      "banana/fig",
      "l1",
    ]);
  });

  it("sorts managed siblings by creation time oldest-first (asc)", () => {
    const entries = buildUnifiedDirectoryNavEntries(treeFolders, [linkedRoot]);
    expect(ids(sortManagedTreeEntries(entries, "created", "asc"))).toEqual([
      "banana",
      "banana/fig",
      "cherry",
      "apple",
      "apple/kiwi",
      "apple/grape",
      "l1",
    ]);
  });

  it("sorts by descendant badge count most-first (desc) at every depth", () => {
    const entries = buildUnifiedDirectoryNavEntries(treeFolders, [linkedRoot]);
    expect(ids(sortManagedTreeEntries(entries, "count", "desc"))).toEqual([
      "apple",
      "apple/kiwi",
      "apple/grape",
      "cherry",
      "banana",
      "banana/fig",
      "l1",
    ]);
  });

  it("sorts by descendant badge count fewest-first (asc)", () => {
    const entries = buildUnifiedDirectoryNavEntries(treeFolders, [linkedRoot]);
    expect(ids(sortManagedTreeEntries(entries, "count", "asc"))).toEqual([
      "banana",
      "banana/fig",
      "cherry",
      "apple",
      "apple/grape",
      "apple/kiwi",
      "l1",
    ]);
  });

  it("falls back to name order when creation time is missing or tied", () => {
    const folders = [
      managed({ folderId: "z", name: "zulu", relativePath: "zulu", directAssetCount: 3 }),
      managed({ folderId: "a", name: "alpha", relativePath: "alpha", directAssetCount: 3 }),
      managed({ folderId: "m", name: "mike", relativePath: "mike", directAssetCount: 1, createdAt: "2020-01-01T00:00:00.000Z" }),
    ];
    const entries = buildUnifiedDirectoryNavEntries(folders, []);
    // "mike" has a timestamp and sorts first (newest desc); the two without
    // timestamps fall back to name order so the result is deterministic.
    expect(ids(sortManagedTreeEntries(entries, "created", "desc"))).toEqual([
      "m",
      "a",
      "z",
    ]);
    expect(ids(sortManagedTreeEntries(entries, "count", "desc"))).toEqual(["a", "z", "m"]);
  });
});
