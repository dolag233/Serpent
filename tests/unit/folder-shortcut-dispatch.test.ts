import { describe, expect, it } from "vitest";

import {
  readFocusedNavFolder,
  resolveFolderShortcutAction,
} from "../../src/renderer/folder-shortcut-dispatch";

const names = new Map([
  ["folder-a", "Alpha"],
  ["folder-b", "Beta"],
]);

const resolveName = (id: string) => names.get(id);

describe("resolveFolderShortcutAction (Serpent-vf8x)", () => {
  it("create-subfolder uses focused managed nav folder", () => {
    expect(
      resolveFolderShortcutAction({
        commandId: "folder.create-subfolder",
        focusedNav: { folderId: "folder-a", locationKind: "managed" },
        browseManagedFolderId: "folder-b",
        selectedFolderCardIds: [],
        selectedAssetCount: 0,
        resolveManagedFolderName: resolveName,
      }),
    ).toEqual({ type: "create-subfolder", parentFolderId: "folder-a" });
  });

  it("create-subfolder falls back to browse scope, then library root", () => {
    expect(
      resolveFolderShortcutAction({
        commandId: "folder.create-subfolder",
        focusedNav: null,
        browseManagedFolderId: "folder-b",
        selectedFolderCardIds: [],
        selectedAssetCount: 2,
        resolveManagedFolderName: resolveName,
      }),
    ).toEqual({ type: "create-subfolder", parentFolderId: "folder-b" });

    expect(
      resolveFolderShortcutAction({
        commandId: "folder.create-subfolder",
        focusedNav: { folderId: "linked-1", locationKind: "linked" },
        browseManagedFolderId: null,
        selectedFolderCardIds: [],
        selectedAssetCount: 0,
        resolveManagedFolderName: resolveName,
      }),
    ).toEqual({ type: "create-subfolder", parentFolderId: null });
  });

  it("rename/trash defer to assets when any asset is selected", () => {
    expect(
      resolveFolderShortcutAction({
        commandId: "folder.rename",
        focusedNav: { folderId: "folder-a", locationKind: "managed" },
        browseManagedFolderId: null,
        selectedFolderCardIds: [],
        selectedAssetCount: 1,
        resolveManagedFolderName: resolveName,
      }),
    ).toEqual({ type: "none" });

    expect(
      resolveFolderShortcutAction({
        commandId: "folder.move-to-trash",
        focusedNav: { folderId: "folder-a", locationKind: "managed" },
        browseManagedFolderId: null,
        selectedFolderCardIds: [],
        selectedAssetCount: 1,
        resolveManagedFolderName: resolveName,
      }),
    ).toEqual({ type: "none" });
  });

  it("rename/trash use focused managed nav over folder cards", () => {
    expect(
      resolveFolderShortcutAction({
        commandId: "folder.rename",
        focusedNav: { folderId: "folder-a", locationKind: "managed" },
        browseManagedFolderId: null,
        selectedFolderCardIds: ["folder-b"],
        selectedAssetCount: 0,
        resolveManagedFolderName: resolveName,
      }),
    ).toEqual({
      type: "rename",
      folderId: "folder-a",
      currentName: "Alpha",
    });

    expect(
      resolveFolderShortcutAction({
        commandId: "folder.move-to-trash",
        focusedNav: { folderId: "folder-a", locationKind: "managed" },
        browseManagedFolderId: null,
        selectedFolderCardIds: [],
        selectedAssetCount: 0,
        resolveManagedFolderName: resolveName,
      }),
    ).toEqual({
      type: "move-to-trash",
      folderId: "folder-a",
      name: "Alpha",
    });
  });

  it("rename/trash fall back to a single managed folder card", () => {
    expect(
      resolveFolderShortcutAction({
        commandId: "folder.rename",
        focusedNav: null,
        browseManagedFolderId: null,
        selectedFolderCardIds: ["folder-b"],
        selectedAssetCount: 0,
        resolveManagedFolderName: resolveName,
      }),
    ).toEqual({
      type: "rename",
      folderId: "folder-b",
      currentName: "Beta",
    });

    expect(
      resolveFolderShortcutAction({
        commandId: "folder.move-to-trash",
        focusedNav: null,
        browseManagedFolderId: null,
        selectedFolderCardIds: ["folder-a", "folder-b"],
        selectedAssetCount: 0,
        resolveManagedFolderName: resolveName,
      }),
    ).toEqual({ type: "none" });
  });
});

describe("readFocusedNavFolder", () => {
  it("reads data-nav-folder-* from the focused row host", () => {
    const row = {
      dataset: { navFolderId: "folder-a", navFolderKind: "managed" as const },
      closest(selector: string) {
        return selector === "[data-nav-folder-id]" ? this : null;
      },
    };
    expect(readFocusedNavFolder(row)).toEqual({
      folderId: "folder-a",
      locationKind: "managed",
    });
  });

  it("returns null for unrelated focus", () => {
    expect(readFocusedNavFolder(null)).toBeNull();
    expect(
      readFocusedNavFolder({
        closest: () => null,
      }),
    ).toBeNull();
  });
});
