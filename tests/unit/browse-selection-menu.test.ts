import { describe, expect, it } from "vitest";

import { resolveBrowseContextMenuIntent } from "../../src/renderer/browse-selection-menu";

describe("resolveBrowseContextMenuIntent", () => {
  it("replaces selection when the click target is outside the current selection", () => {
    expect(
      resolveBrowseContextMenuIntent(
        { kind: "folder", id: "f-new" },
        { assetIds: ["a1"], folderIds: ["f1"] },
      ),
    ).toEqual({ type: "single-folder", folderId: "f-new" });

    expect(
      resolveBrowseContextMenuIntent(
        { kind: "asset", id: "a-new" },
        { assetIds: ["a1"], folderIds: ["f1"] },
      ),
    ).toEqual({ type: "single-asset", assetId: "a-new" });
  });

  it("keeps a single selected item on its dedicated menu", () => {
    expect(
      resolveBrowseContextMenuIntent(
        { kind: "asset", id: "a1" },
        { assetIds: ["a1"], folderIds: [] },
      ),
    ).toEqual({ type: "single-asset", assetId: "a1" });

    expect(
      resolveBrowseContextMenuIntent(
        { kind: "folder", id: "f1" },
        { assetIds: [], folderIds: ["f1"] },
      ),
    ).toEqual({ type: "single-folder", folderId: "f1" });
  });

  it("opens a multi menu for mixed folder+asset selection", () => {
    expect(
      resolveBrowseContextMenuIntent(
        { kind: "folder", id: "f1" },
        { assetIds: ["a1"], folderIds: ["f1"] },
      ),
    ).toEqual({
      type: "multi",
      assetIds: ["a1"],
      folderIds: ["f1"],
    });
  });

  it("opens a multi menu for multi-folder or multi-asset selection", () => {
    expect(
      resolveBrowseContextMenuIntent(
        { kind: "folder", id: "f1" },
        { assetIds: [], folderIds: ["f1", "f2"] },
      ),
    ).toEqual({
      type: "multi",
      assetIds: [],
      folderIds: ["f1", "f2"],
    });

    expect(
      resolveBrowseContextMenuIntent(
        { kind: "asset", id: "a1" },
        { assetIds: ["a1", "a2"], folderIds: [] },
      ),
    ).toEqual({
      type: "multi",
      assetIds: ["a1", "a2"],
      folderIds: [],
    });
  });
});
