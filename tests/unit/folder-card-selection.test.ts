import { describe, expect, it } from "vitest";

import {
  resolveFolderBrowseParentId,
  type FolderBrowseCanvasContext,
} from "../../src/renderer/folder-browse-canvas";
import type { LinkedFolderSummary, ManagedFolderSummary } from "../../src/shared/asset-types";

const managedFolder = (folderId: string): ManagedFolderSummary => ({
  folderId,
  parentFolderId: null,
  name: folderId,
  relativePath: folderId,
  directAssetCount: 0,
  childFolderCount: 0,
});

const baseContext: FolderBrowseCanvasContext = {
  assetScope: "all",
  showTrash: false,
  activeTagId: null,
  activeCollectionId: null,
  activeSmartCollectionId: null,
  folders: [managedFolder("folder-1")],
  searchActive: false,
};

describe("resolveFolderBrowseParentId", () => {
  it("resolves the managed library root (null parentFolderId) for the root scope", () => {
    expect(
      resolveFolderBrowseParentId({ ...baseContext, assetScope: "root" }),
    ).toBeNull();
  });

  it("resolves a managed folder scope to its own folder id", () => {
    expect(
      resolveFolderBrowseParentId({ ...baseContext, assetScope: "folder-1" }),
    ).toBe("folder-1");
  });

  it("has no folder-card row for 'all assets'", () => {
    expect(
      resolveFolderBrowseParentId({ ...baseContext, assetScope: "all" }),
    ).toBeUndefined();
  });

  it("resolves a linked-folder scope when the id is in linkedFolders", () => {
    const linkedFolder: LinkedFolderSummary = {
      folderId: "linked-1",
      displayName: "Linked",
      status: "available",
      assetCount: 2,
      absoluteRootPath: "/tmp/linked",
      linkedFolderId: "linked-1",
      relativePath: "",
      parentFolderId: null,
    };
    expect(
      resolveFolderBrowseParentId({
        ...baseContext,
        assetScope: "linked-1",
        linkedFolders: [linkedFolder],
      }),
    ).toBe("linked-1");
  });

  it("has no folder-card row for an unknown folder id", () => {
    expect(
      resolveFolderBrowseParentId({ ...baseContext, assetScope: "linked-1" }),
    ).toBeUndefined();
  });

  it("has no folder-card row while browsing trash, even if assetScope looks like a managed folder", () => {
    expect(
      resolveFolderBrowseParentId({
        ...baseContext,
        assetScope: "folder-1",
        showTrash: true,
      }),
    ).toBeUndefined();
  });

  it("has no folder-card row for a tag view", () => {
    expect(
      resolveFolderBrowseParentId({ ...baseContext, activeTagId: "tag-1" }),
    ).toBeUndefined();
  });

  it("has no folder-card row for a collection view", () => {
    expect(
      resolveFolderBrowseParentId({
        ...baseContext,
        activeCollectionId: "collection-1",
      }),
    ).toBeUndefined();
  });

  it("has no folder-card row for a smart-collection view", () => {
    expect(
      resolveFolderBrowseParentId({
        ...baseContext,
        activeSmartCollectionId: "smart-1",
      }),
    ).toBeUndefined();
  });

  it("has no folder-card row while a text/AI search overlay is active on a managed folder scope", () => {
    expect(
      resolveFolderBrowseParentId({
        ...baseContext,
        assetScope: "folder-1",
        searchActive: true,
      }),
    ).toBeUndefined();
  });
});
