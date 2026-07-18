import { describe, expect, it } from "vitest";
import { resolveBrowseEmptyState } from "../../src/renderer/browse-empty-state";

describe("resolveBrowseEmptyState", () => {
  it("shows search empty without import CTAs when discovery is active", () => {
    expect(
      resolveBrowseEmptyState({
        showTrash: false,
        hasActiveDiscovery: true,
        hasSelectedFolder: true,
      }),
    ).toEqual({
      kind: "search",
      titleKey: "empty.searchTitle",
      detailKey: "empty.searchBody",
      showImportActions: false,
      icon: "search",
    });
  });

  it("prefers search empty over trash when discovery is active in trash", () => {
    expect(
      resolveBrowseEmptyState({
        showTrash: true,
        hasActiveDiscovery: true,
        hasSelectedFolder: false,
      }).kind,
    ).toBe("search");
  });

  it("shows trash-specific empty without import CTAs", () => {
    expect(
      resolveBrowseEmptyState({
        showTrash: true,
        hasActiveDiscovery: false,
        hasSelectedFolder: false,
      }),
    ).toEqual({
      kind: "trash",
      titleKey: "empty.trashTitle",
      detailKey: "empty.trashBody",
      showImportActions: false,
      icon: "trash",
    });
  });

  it("keeps folder empty with import CTAs for a selected folder", () => {
    expect(
      resolveBrowseEmptyState({
        showTrash: false,
        hasActiveDiscovery: false,
        hasSelectedFolder: true,
      }),
    ).toEqual({
      kind: "folder",
      titleKey: "empty.folderTitle",
      detailKey: "empty.folderDetail",
      showImportActions: true,
      icon: "upload",
    });
  });

  it("uses library-first-import title when no folder is selected", () => {
    expect(
      resolveBrowseEmptyState({
        showTrash: false,
        hasActiveDiscovery: false,
        hasSelectedFolder: false,
      }).titleKey,
    ).toBe("empty.folderBody");
  });
});
