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
        mouseButton: 0,
      }),
    ).toEqual({
      kind: "replace",
      folderIds: ["c"],
      anchorId: "c",
      clearAssets: true,
    });
  });

  it("Cmd/Ctrl click toggles without clearing assets", () => {
    expect(
      resolveFolderCardClickIntent({
        folderId: "b",
        folderIds: folders,
        anchorId: "a",
        modifiers: { shiftKey: false, metaKey: true, ctrlKey: false },
        mouseButton: 0,
      }),
    ).toEqual({
      kind: "toggle",
      folderId: "b",
      anchorId: "b",
      clearAssets: false,
    });
  });

  it("Shift click replaces with the inclusive range", () => {
    expect(
      resolveFolderCardClickIntent({
        folderId: "d",
        folderIds: folders,
        anchorId: "b",
        modifiers: { shiftKey: true, metaKey: false, ctrlKey: false },
        mouseButton: 0,
      }),
    ).toEqual({
      kind: "replace",
      folderIds: ["b", "c", "d"],
      anchorId: "b",
      clearAssets: true,
    });
  });

  it("Shift+Cmd click adds the range without clearing assets", () => {
    expect(
      resolveFolderCardClickIntent({
        folderId: "c",
        folderIds: folders,
        anchorId: "a",
        modifiers: { shiftKey: true, metaKey: true, ctrlKey: false },
        mouseButton: 0,
      }),
    ).toEqual({
      kind: "additive-range",
      folderIds: ["a", "b", "c"],
      clearAssets: false,
    });
  });
});
