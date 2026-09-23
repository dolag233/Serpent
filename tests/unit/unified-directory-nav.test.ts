import { describe, expect, it } from "vitest";

import {
  buildUnifiedDirectoryNavEntries,
  filterCollapsedDirectoryEntries,
  folderIdsInSubtree,
  managedFolderIdsWithChildren,
  sortCollectionTree,
  sortManagedTreeEntries,
} from "../../src/renderer/unified-directory-nav";
import type {
  CollectionSummary,
  LinkedFolderSummary,
  ManagedFolderSummary,
} from "../../src/shared/asset-types";

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
        depth: 0,
        parentFolderId: null,
        directAssetCount: 0,
      },
      {
        kind: "managed",
        folderId: "child-a",
        name: "Child",
        depth: 1,
        parentFolderId: "root-a",
        directAssetCount: 0,
      },
      {
        kind: "managed",
        folderId: "root-b",
        name: "B",
        depth: 0,
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
        depth: 0,
        parentFolderId: null,
        directAssetCount: 0,
      },
      {
        kind: "linked",
        folderId: "l2",
        name: "Linked Offline",
        depth: 0,
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
        depth: 0,
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
        depth: 1,
        parentFolderId: "l1",
        status: "available",
        assetCount: 1,
        linkedFolderId: "l1",
        relativePath: "notes",
      },
    ]);
  });

  // Serpent-316493: a linked root imported into a managed folder hangs under it.
  it("nests a linked root under its managed parent and shifts its children", () => {
    const folders = [
      managed({ folderId: "p", name: "Parent", relativePath: "Parent" }),
    ];
    const entries = buildUnifiedDirectoryNavEntries(folders, [
      linked({
        folderId: "link",
        displayName: "Link",
        assetCount: 3,
        linkedFolderId: "link",
        relativePath: "",
        parentFolderId: "p",
      }),
      linked({
        folderId: "lfv:link/notes",
        displayName: "notes",
        assetCount: 1,
        linkedFolderId: "link",
        relativePath: "notes",
        parentFolderId: "link",
      }),
    ]);

    expect(entries.map((entry) => [entry.folderId, entry.depth, entry.parentFolderId]))
      .toEqual([
        ["p", 0, null],
        ["link", 1, "p"],
        ["lfv:link/notes", 2, "link"],
      ]);
  });

  // Serpent-316493: a parent that is gone (trashed / deleted from disk) must not
  // hide the link — it falls back to the library root and re-nests on restore.
  it("falls back to the library root when the managed parent is not visible", () => {
    const entries = buildUnifiedDirectoryNavEntries([], [
      linked({
        folderId: "link",
        displayName: "Link",
        assetCount: 1,
        linkedFolderId: "link",
        relativePath: "",
        parentFolderId: "gone-folder",
      }),
      linked({
        folderId: "lfv:link/notes",
        displayName: "notes",
        assetCount: 1,
        linkedFolderId: "link",
        relativePath: "notes",
        parentFolderId: "link",
      }),
    ]);

    expect(entries.map((entry) => [entry.folderId, entry.depth, entry.parentFolderId]))
      .toEqual([
        ["link", 0, null],
        ["lfv:link/notes", 1, "link"],
      ]);
  });

  it("keeps linked-only roots at depth 0", () => {
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
        depth: 0,
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

  const virtualChild = (
    rootId: string,
    relativePath: string,
    parentFolderId: string,
    displayName = relativePath.split("/").at(-1) ?? relativePath,
  ) =>
    linked({
      folderId: `lfv:${rootId}/${relativePath}`,
      displayName,
      assetCount: 1,
      linkedFolderId: rootId,
      relativePath,
      parentFolderId,
    });

  // Serpent-316493: a linked root under a managed folder is emitted after that
  // folder's own subtree, followed by its virtual children.
  it("emits a nested linked root after its managed parent's subtree", () => {
    const nested = linked({
      folderId: "l2",
      displayName: "Nested link",
      assetCount: 2,
      linkedFolderId: "l2",
      relativePath: "",
      parentFolderId: "apple",
    });
    const entries = buildUnifiedDirectoryNavEntries(treeFolders, [
      linkedRoot,
      nested,
      virtualChild("l2", "notes", "l2"),
    ]);
    expect(ids(sortManagedTreeEntries(entries, "name", "asc"))).toEqual([
      "apple",
      "apple/grape",
      "apple/kiwi",
      "l2",
      "lfv:l2/notes",
      "banana",
      "banana/fig",
      "cherry",
      "l1",
    ]);
  });

  it("keeps virtual children of a library-root linked folder when managed folders exist", () => {
    const entries = buildUnifiedDirectoryNavEntries(treeFolders, [
      linkedRoot,
      virtualChild("l1", "notes", "l1"),
      virtualChild("l1", "notes/2024", "lfv:l1/notes"),
    ]);
    expect(ids(sortManagedTreeEntries(entries, "name", "asc"))).toEqual([
      "apple",
      "apple/grape",
      "apple/kiwi",
      "banana",
      "banana/fig",
      "cherry",
      "l1",
      "lfv:l1/notes",
      "lfv:l1/notes/2024",
    ]);
  });

  it("keeps children on both nested and library-root linked folders in one tree", () => {
    const nested = linked({
      folderId: "l2",
      displayName: "Nested link",
      assetCount: 2,
      linkedFolderId: "l2",
      relativePath: "",
      parentFolderId: "apple",
    });
    const entries = buildUnifiedDirectoryNavEntries(treeFolders, [
      linkedRoot,
      virtualChild("l1", "notes", "l1"),
      nested,
      virtualChild("l2", "shots", "l2"),
    ]);
    expect(ids(sortManagedTreeEntries(entries, "name", "asc"))).toEqual([
      "apple",
      "apple/grape",
      "apple/kiwi",
      "l2",
      "lfv:l2/shots",
      "banana",
      "banana/fig",
      "cherry",
      "l1",
      "lfv:l1/notes",
    ]);
  });

  it("emits each library-root linked folder followed by its own children", () => {
    const alpha = linked({
      folderId: "alpha",
      displayName: "Alpha link",
      assetCount: 2,
      linkedFolderId: "alpha",
      relativePath: "",
      parentFolderId: null,
    });
    const zeta = linked({
      folderId: "zeta",
      displayName: "Zeta link",
      assetCount: 2,
      linkedFolderId: "zeta",
      relativePath: "",
      parentFolderId: null,
    });
    const entries = buildUnifiedDirectoryNavEntries(treeFolders, [
      zeta,
      virtualChild("zeta", "b", "zeta"),
      alpha,
      virtualChild("alpha", "a", "alpha"),
    ]);
    expect(ids(sortManagedTreeEntries(entries, "name", "asc"))).toEqual([
      "alpha",
      "lfv:alpha/a",
      "apple",
      "apple/grape",
      "apple/kiwi",
      "banana",
      "banana/fig",
      "cherry",
      "zeta",
      "lfv:zeta/b",
    ]);
  });

  it("keeps library-root linked children when there are no managed folders", () => {
    const entries = buildUnifiedDirectoryNavEntries([], [
      linkedRoot,
      virtualChild("l1", "notes", "l1"),
    ]);
    expect(ids(sortManagedTreeEntries(entries, "name", "asc"))).toEqual([
      "l1",
      "lfv:l1/notes",
    ]);
  });

  it("keeps children of a linked root that fell back to the library root", () => {
    const entries = buildUnifiedDirectoryNavEntries(treeFolders, [
      linked({
        folderId: "orphan",
        displayName: "Orphan link",
        assetCount: 2,
        linkedFolderId: "orphan",
        relativePath: "",
        parentFolderId: "gone-folder",
      }),
      virtualChild("orphan", "notes", "orphan"),
    ]);
    expect(ids(sortManagedTreeEntries(entries, "name", "asc"))).toEqual([
      "apple",
      "apple/grape",
      "apple/kiwi",
      "banana",
      "banana/fig",
      "cherry",
      "orphan",
      "lfv:orphan/notes",
    ]);
  });

  it("still hides collapsed library-root linked children after sorting", () => {
    const unified = buildUnifiedDirectoryNavEntries(treeFolders, [
      linkedRoot,
      virtualChild("l1", "notes", "l1"),
      virtualChild("l1", "notes/2024", "lfv:l1/notes"),
    ]);
    const sorted = sortManagedTreeEntries(unified, "name", "asc");
    expect(managedFolderIdsWithChildren(unified).has("l1")).toBe(true);
    expect(managedFolderIdsWithChildren(sorted).has("l1")).toBe(true);
    expect(
      ids(filterCollapsedDirectoryEntries(sorted, new Set(["l1"]))),
    ).toEqual([
      "apple",
      "apple/grape",
      "apple/kiwi",
      "banana",
      "banana/fig",
      "cherry",
      "l1",
    ]);
    expect(
      ids(filterCollapsedDirectoryEntries(sorted, new Set())),
    ).toEqual([
      "apple",
      "apple/grape",
      "apple/kiwi",
      "banana",
      "banana/fig",
      "cherry",
      "l1",
      "lfv:l1/notes",
      "lfv:l1/notes/2024",
    ]);
  });

  it("sorts managed and linked siblings together by name ascending", () => {
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

  it("reverses name order for managed and linked siblings", () => {
    const entries = buildUnifiedDirectoryNavEntries(treeFolders, [linkedRoot]);
    expect(ids(sortManagedTreeEntries(entries, "name", "desc"))).toEqual([
      "l1",
      "cherry",
      "banana",
      "banana/fig",
      "apple",
      "apple/kiwi",
      "apple/grape",
    ]);
  });

  it("sorts linked roots by creation time with managed siblings", () => {
    const dated = linked({
      folderId: "l1",
      displayName: "Linked",
      assetCount: 3,
      linkedFolderId: "l1",
      relativePath: "",
      parentFolderId: null,
      createdAt: "2022-01-01T00:00:00.000Z",
    });
    const entries = buildUnifiedDirectoryNavEntries(treeFolders, [dated]);
    expect(ids(sortManagedTreeEntries(entries, "created", "desc"))).toEqual([
      "apple",
      "apple/grape",
      "apple/kiwi",
      "l1",
      "cherry",
      "banana",
      "banana/fig",
    ]);
    expect(ids(sortManagedTreeEntries(entries, "created", "asc"))).toEqual([
      "banana",
      "banana/fig",
      "cherry",
      "l1",
      "apple",
      "apple/kiwi",
      "apple/grape",
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

  it("sorts by badge count most-first including linked folders", () => {
    const entries = buildUnifiedDirectoryNavEntries(treeFolders, [linkedRoot]);
    expect(ids(sortManagedTreeEntries(entries, "count", "desc"))).toEqual([
      "apple",
      "apple/kiwi",
      "apple/grape",
      "cherry",
      "l1",
      "banana",
      "banana/fig",
    ]);
  });

  it("sorts by badge count fewest-first including linked folders", () => {
    const entries = buildUnifiedDirectoryNavEntries(treeFolders, [linkedRoot]);
    expect(ids(sortManagedTreeEntries(entries, "count", "asc"))).toEqual([
      "banana",
      "banana/fig",
      "l1",
      "cherry",
      "apple",
      "apple/grape",
      "apple/kiwi",
    ]);
  });

  it("sorts virtual children of a linked folder by the same control", () => {
    const entries = buildUnifiedDirectoryNavEntries([], [
      linkedRoot,
      virtualChild("l1", "zeta", "l1", "zeta"),
      virtualChild("l1", "alpha", "l1", "alpha"),
    ]);
    expect(ids(sortManagedTreeEntries(entries, "name", "asc"))).toEqual([
      "l1",
      "lfv:l1/alpha",
      "lfv:l1/zeta",
    ]);
    expect(ids(sortManagedTreeEntries(entries, "name", "desc"))).toEqual([
      "l1",
      "lfv:l1/zeta",
      "lfv:l1/alpha",
    ]);
    const counted = buildUnifiedDirectoryNavEntries([], [
      linkedRoot,
      linked({
        folderId: "lfv:l1/few",
        displayName: "few",
        assetCount: 1,
        linkedFolderId: "l1",
        relativePath: "few",
        parentFolderId: "l1",
      }),
      linked({
        folderId: "lfv:l1/many",
        displayName: "many",
        assetCount: 9,
        linkedFolderId: "l1",
        relativePath: "many",
        parentFolderId: "l1",
      }),
    ]);
    expect(ids(sortManagedTreeEntries(counted, "count", "desc"))).toEqual([
      "l1",
      "lfv:l1/many",
      "lfv:l1/few",
    ]);
  });

  it("interleaves a nested linked root with managed siblings by name", () => {
    const nested = linked({
      folderId: "l2",
      displayName: "avocado",
      assetCount: 2,
      linkedFolderId: "l2",
      relativePath: "",
      parentFolderId: "apple",
    });
    const entries = buildUnifiedDirectoryNavEntries(treeFolders, [
      nested,
      virtualChild("l2", "notes", "l2"),
    ]);
    expect(ids(sortManagedTreeEntries(entries, "name", "asc"))).toEqual([
      "apple",
      "l2",
      "lfv:l2/notes",
      "apple/grape",
      "apple/kiwi",
      "banana",
      "banana/fig",
      "cherry",
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

describe("sortCollectionTree", () => {
  const collection = (
    overrides: Partial<CollectionSummary> &
      Pick<CollectionSummary, "collectionId" | "name">,
  ): CollectionSummary => ({
    parentId: null,
    description: null,
    coverAssetId: null,
    position: 0,
    assetCount: 0,
    childCollectionCount: 0,
    ...overrides,
  });

  it("sorts every collection level with the shared sidebar fields", () => {
    const parent = collection({
      collectionId: "parent",
      name: "Parent",
      assetCount: 1,
    });
    const children = [
      collection({
        collectionId: "child-b",
        parentId: parent.collectionId,
        name: "Beta",
        assetCount: 2,
      }),
      collection({
        collectionId: "child-a",
        parentId: parent.collectionId,
        name: "Alpha",
        assetCount: 8,
      }),
    ];
    const tree = new Map<string | null, CollectionSummary[]>([
      [null, [parent]],
      [parent.collectionId, children],
    ]);

    expect(
      sortCollectionTree(tree, "count", "desc")
        .get(parent.collectionId)
        ?.map((item) => item.collectionId),
    ).toEqual(["child-a", "child-b"]);
    expect(
      sortCollectionTree(tree, "name", "asc")
        .get(parent.collectionId)
        ?.map((item) => item.collectionId),
    ).toEqual(["child-a", "child-b"]);
  });
});

describe("folderIdsInSubtree", () => {
  it("includes the node and every recursive child", () => {
    const entries = buildUnifiedDirectoryNavEntries(
      [
        managed({ folderId: "a", name: "A", relativePath: "a" }),
        managed({
          folderId: "a-1",
          name: "A1",
          relativePath: "a/a1",
          parentFolderId: "a",
        }),
        managed({
          folderId: "a-1-1",
          name: "A11",
          relativePath: "a/a1/a11",
          parentFolderId: "a-1",
        }),
        managed({ folderId: "b", name: "B", relativePath: "b" }),
      ],
      [],
    );
    expect(folderIdsInSubtree(entries, "a").sort()).toEqual([
      "a",
      "a-1",
      "a-1-1",
    ]);
    expect(folderIdsInSubtree(entries, null).sort()).toEqual([
      "a",
      "a-1",
      "a-1-1",
      "b",
    ]);
  });
});
