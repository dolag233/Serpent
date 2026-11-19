import { describe, expect, it } from "vitest";

import {
  resolveBrowseCanvasBodyLayout,
  resolveBrowseCreateFolderParentId,
  type FolderBrowseCanvasContext,
  shouldShowFolderBrowseCards,
} from "../../src/renderer/folder-browse-canvas";

describe("resolveBrowseCanvasBodyLayout (CANVAS-022 / Serpent-an1)", () => {
  it("returns empty when there are no folders and no assets", () => {
    expect(resolveBrowseCanvasBodyLayout(0, 0)).toEqual({ mode: "empty" });
  });

  it("skips the asset grid when only child folders are present", () => {
    expect(resolveBrowseCanvasBodyLayout(0, 3)).toEqual({
      mode: "folders-only",
      showFolders: true,
      showAssetGrid: false,
    });
  });

  it("shows the asset grid when assets are present without folders", () => {
    expect(resolveBrowseCanvasBodyLayout(5, 0)).toEqual({
      mode: "assets",
      showFolders: false,
      showAssetGrid: true,
    });
  });

  it("shows folders and the asset grid when both are present", () => {
    expect(resolveBrowseCanvasBodyLayout(2, 1)).toEqual({
      mode: "assets",
      showFolders: true,
      showAssetGrid: true,
    });
  });
});

describe("blank-canvas folder creation scope", () => {
  const context: FolderBrowseCanvasContext & { writable: boolean; interactionBlocked: boolean } = {
    assetScope: "folder", writable: true, interactionBlocked: false,
    showTrash: false, activeTagId: null, activeCollectionId: null, activeSmartCollectionId: null,
    searchActive: false,
    folders: [{
      folderId: "folder", parentFolderId: null, name: "Materials", relativePath: "Materials",
      directAssetCount: 0, childFolderCount: 0,
    }],
    linkedFolders: [{
      folderId: "linked", displayName: "Linked", status: "available", assetCount: 0,
      absoluteRootPath: "fixture-linked-root", relativePath: "",
    }, {
      folderId: "lfv:linked/deep", linkedFolderId: "linked", displayName: "deep", status: "available",
      assetCount: 0, absoluteRootPath: "fixture-linked-root", relativePath: "deep", parentFolderId: "linked",
    }],
  };

  it("uses the current real parent, including an empty library root and linked child", () => {
    expect(resolveBrowseCreateFolderParentId(context)).toBe("folder");
    expect(resolveBrowseCreateFolderParentId({ ...context, assetScope: "root", folders: [] })).toBeNull();
    expect(resolveBrowseCreateFolderParentId({ ...context, assetScope: "linked" })).toBe("linked");
    expect(resolveBrowseCreateFolderParentId({ ...context, assetScope: "lfv:linked/deep" })).toBe("lfv:linked/deep");
  });

  it.each([
    { assetScope: "all" }, { assetScope: "missing" }, { showTrash: true },
    { activeTagId: "tag" }, { activeCollectionId: "collection" }, { activeSmartCollectionId: "smart" },
    { searchActive: true }, { writable: false }, { interactionBlocked: true },
  ])("omits creation outside writable ordinary folder browsing: %j", overrides => {
    expect(resolveBrowseCreateFolderParentId({ ...context, ...overrides })).toBeUndefined();
  });

  it("omits creation in offline linked directories", () => {
    expect(resolveBrowseCreateFolderParentId({
      ...context, assetScope: "linked",
      linkedFolders: context.linkedFolders!.map(folder => ({ ...folder, status: "offline" })),
    })).toBeUndefined();
  });
});

describe("shouldShowFolderBrowseCards (Serpent-7a9e89)", () => {
  it("keeps child folder cards by default when recursive browse is on", () => {
    expect(shouldShowFolderBrowseCards("folder-1", true)).toBe(true);
    expect(shouldShowFolderBrowseCards("folder-1", true, true)).toBe(true);
  });

  it("hides child folder cards when the setting turns them off", () => {
    expect(shouldShowFolderBrowseCards("folder-1", true, false)).toBe(false);
  });

  it("keeps folder cards when recursive browse is off", () => {
    expect(shouldShowFolderBrowseCards("folder-1", false)).toBe(true);
    expect(shouldShowFolderBrowseCards("folder-1", false, false)).toBe(true);
  });

  it("never hides folder cards for all/root scopes", () => {
    expect(shouldShowFolderBrowseCards("all", true, false)).toBe(true);
    expect(shouldShowFolderBrowseCards("root", true, false)).toBe(true);
  });

  it("is scoped to a concrete folder id only (recursive is never set outside it)", () => {
    expect(shouldShowFolderBrowseCards("all", false)).toBe(true);
    expect(shouldShowFolderBrowseCards("root", false)).toBe(true);
  });
});
