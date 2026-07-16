import { describe, expect, it } from "vitest";

import { buildUnifiedDirectoryNavEntries } from "../../src/renderer/unified-directory-nav";
import type { LinkedFolderSummary, ManagedFolderSummary } from "../../src/shared/asset-types";

const managed = (
  overrides: Partial<ManagedFolderSummary> & Pick<ManagedFolderSummary, "folderId" | "name" | "relativePath">,
): ManagedFolderSummary => ({
  parentFolderId: null,
  ...overrides,
});

const linked = (
  overrides: Partial<LinkedFolderSummary> & Pick<LinkedFolderSummary, "folderId" | "displayName">,
): LinkedFolderSummary => ({
  status: "available",
  assetCount: 0,
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
      },
      {
        kind: "managed",
        folderId: "child-a",
        name: "Child",
        depth: 2,
        parentFolderId: "root-a",
      },
      {
        kind: "managed",
        folderId: "root-b",
        name: "B",
        depth: 1,
        parentFolderId: null,
      },
    ]);
  });

  it("appends linked folders after managed with depth 1 and no invented hierarchy", () => {
    const folders = [managed({ folderId: "m1", name: "Managed", relativePath: "managed" })];
    const linkedFolders = [
      linked({
        folderId: "l1",
        displayName: "Linked Online",
        status: "available",
        assetCount: 3,
      }),
      linked({
        folderId: "l2",
        displayName: "Linked Offline",
        status: "offline",
        assetCount: 0,
      }),
    ];

    expect(buildUnifiedDirectoryNavEntries(folders, linkedFolders)).toEqual([
      {
        kind: "managed",
        folderId: "m1",
        name: "Managed",
        depth: 1,
        parentFolderId: null,
      },
      {
        kind: "linked",
        folderId: "l1",
        name: "Linked Online",
        depth: 1,
        status: "available",
        assetCount: 3,
      },
      {
        kind: "linked",
        folderId: "l2",
        name: "Linked Offline",
        depth: 1,
        status: "offline",
        assetCount: 0,
      },
    ]);
  });

  it("keeps linked-only lists as flat root-level entries", () => {
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
        status: "available",
        assetCount: 1,
      },
    ]);
  });
});
