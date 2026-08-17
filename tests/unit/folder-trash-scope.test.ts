import { describe, expect, it } from "vitest";

import { isBrowseScopeAffectedByFolderTrash } from "../../src/renderer/folder-trash-scope";

describe("isBrowseScopeAffectedByFolderTrash", () => {
  const folders = [
    { folderId: "root-a", parentFolderId: null },
    { folderId: "child-b", parentFolderId: "root-a" },
    { folderId: "grand-c", parentFolderId: "child-b" },
    { folderId: "other", parentFolderId: null },
  ];

  it("ignores all/root scopes", () => {
    expect(isBrowseScopeAffectedByFolderTrash("all", ["root-a"], folders)).toBe(false);
    expect(isBrowseScopeAffectedByFolderTrash("root", ["root-a"], folders)).toBe(false);
  });

  it("detects the trashed folder itself", () => {
    expect(
      isBrowseScopeAffectedByFolderTrash("child-b", ["child-b"], folders),
    ).toBe(true);
  });

  it("detects when an ancestor folder is trashed", () => {
    expect(
      isBrowseScopeAffectedByFolderTrash("grand-c", ["root-a"], folders),
    ).toBe(true);
    expect(
      isBrowseScopeAffectedByFolderTrash("grand-c", ["child-b"], folders),
    ).toBe(true);
  });

  it("leaves unrelated scopes alone", () => {
    expect(
      isBrowseScopeAffectedByFolderTrash("other", ["root-a"], folders),
    ).toBe(false);
    expect(
      isBrowseScopeAffectedByFolderTrash("grand-c", ["other"], folders),
    ).toBe(false);
  });
});
