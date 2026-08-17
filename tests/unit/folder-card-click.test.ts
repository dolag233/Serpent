import { describe, expect, it } from "vitest";

import { resolveFolderCardClickIntent } from "../../src/renderer/folder-card-click";

const folders = ["a", "b", "c", "d"] as const;

describe("resolveFolderCardClickIntent (Serpent-829)", () => {
  it("ignores non-left-button clicks", () => {
    expect(
      resolveFolderCardClickIntent({
        folderId: "b",
        folderIds: folders,
        anchorId: null,
        modifiers: { shiftKey: false, metaKey: false, ctrlKey: false },
        platform: "mac",
        mouseButton: 2,
      }),
    ).toEqual({ kind: "ignore" });
  });

  it("plain click replaces selection with that folder and clears assets", () => {
    expect(
      resolveFolderCardClickIntent({
        folderId: "c",
        folderIds: folders,
        anchorId: "a",
        modifiers: { shiftKey: false, metaKey: false, ctrlKey: false },
        platform: "mac",
        mouseButton: 0,
      }),
    ).toEqual({
      kind: "replace",
      folderIds: ["c"],
      anchorId: "c",
      clearAssets: true,
    });
  });

  it("Cmd click toggles without clearing assets on macOS", () => {
    expect(
      resolveFolderCardClickIntent({
        folderId: "b",
        folderIds: folders,
        anchorId: "a",
        modifiers: { shiftKey: false, metaKey: true, ctrlKey: false },
        platform: "mac",
        mouseButton: 0,
      }),
    ).toEqual({
      kind: "toggle",
      folderId: "b",
      anchorId: "b",
      clearAssets: false,
    });
  });

  it("Ctrl click does not toggle on macOS (reserved for context menu)", () => {
    expect(
      resolveFolderCardClickIntent({
        folderId: "b",
        folderIds: folders,
        anchorId: "a",
        modifiers: { shiftKey: false, metaKey: false, ctrlKey: true },
        platform: "mac",
        mouseButton: 0,
      }),
    ).toEqual({
      kind: "replace",
      folderIds: ["b"],
      anchorId: "b",
      clearAssets: true,
    });
  });

  it("Ctrl click toggles on Windows", () => {
    expect(
      resolveFolderCardClickIntent({
        folderId: "b",
        folderIds: folders,
        anchorId: "a",
        modifiers: { shiftKey: false, metaKey: false, ctrlKey: true },
        platform: "windows",
        mouseButton: 0,
      }),
    ).toEqual({
      kind: "toggle",
      folderId: "b",
      anchorId: "b",
      clearAssets: false,
    });
  });

  it("Shift click is handled by unified browse selection, not folder intent", () => {
    expect(
      resolveFolderCardClickIntent({
        folderId: "d",
        folderIds: folders,
        anchorId: "b",
        modifiers: { shiftKey: true, metaKey: false, ctrlKey: false },
        platform: "mac",
        mouseButton: 0,
      }),
    ).toEqual({
      kind: "replace",
      folderIds: ["d"],
      anchorId: "d",
      clearAssets: true,
    });
  });
});
