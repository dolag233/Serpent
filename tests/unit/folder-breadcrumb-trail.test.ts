import { describe, expect, it } from "vitest";

import { buildManagedFolderBreadcrumbTrail } from "../../src/renderer/folder-breadcrumb-trail";
import type { ManagedFolderSummary } from "../../src/shared/asset-types";

const folder = (
  overrides: Partial<ManagedFolderSummary> & Pick<ManagedFolderSummary, "folderId" | "name" | "relativePath">,
): ManagedFolderSummary => ({
  parentFolderId: null,
  ...overrides,
});

describe("buildManagedFolderBreadcrumbTrail", () => {
  it("returns empty for an unknown folder id", () => {
    expect(buildManagedFolderBreadcrumbTrail([], "missing")).toEqual([]);
    expect(
      buildManagedFolderBreadcrumbTrail(
        [folder({ folderId: "a", name: "A", relativePath: "a" })],
        "missing",
      ),
    ).toEqual([]);
  });

  it("returns a single entry for a root folder", () => {
    const folders = [folder({ folderId: "root", name: "Root", relativePath: "root" })];
    expect(buildManagedFolderBreadcrumbTrail(folders, "root")).toEqual([
      { folderId: "root", name: "Root" },
    ]);
  });

  it("walks parentFolderId to the root with root first", () => {
    const folders = [
      folder({ folderId: "root", name: "Root", relativePath: "root" }),
      folder({
        folderId: "child",
        name: "Child",
        relativePath: "root/child",
        parentFolderId: "root",
      }),
      folder({
        folderId: "leaf",
        name: "Leaf",
        relativePath: "root/child/leaf",
        parentFolderId: "child",
      }),
    ];

    expect(buildManagedFolderBreadcrumbTrail(folders, "leaf")).toEqual([
      { folderId: "root", name: "Root" },
      { folderId: "child", name: "Child" },
      { folderId: "leaf", name: "Leaf" },
    ]);
  });

  it("stops with an empty trail when a parent id is missing mid-chain", () => {
    const folders = [
      folder({
        folderId: "orphan",
        name: "Orphan",
        relativePath: "missing/orphan",
        parentFolderId: "missing",
      }),
    ];

    expect(buildManagedFolderBreadcrumbTrail(folders, "orphan")).toEqual([]);
  });

  it("guards against parent cycles", () => {
    const folders = [
      folder({
        folderId: "a",
        name: "A",
        relativePath: "a",
        parentFolderId: "b",
      }),
      folder({
        folderId: "b",
        name: "B",
        relativePath: "b",
        parentFolderId: "a",
      }),
    ];

    expect(buildManagedFolderBreadcrumbTrail(folders, "a")).toEqual([]);
  });
});
