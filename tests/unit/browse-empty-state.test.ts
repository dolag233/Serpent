import { describe, expect, it } from "vitest";
import {
  resolveBrowseEmptyState,
  resolveImportMenuCopy,
} from "../../src/renderer/browse-empty-state";

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

  it("hides import CTAs for an empty collection", () => {
    expect(
      resolveBrowseEmptyState({
        showTrash: false,
        hasActiveDiscovery: false,
        hasSelectedFolder: false,
        organizationScope: "collection",
      }),
    ).toEqual({
      kind: "collection",
      titleKey: "empty.collectionTitle",
      detailKey: "empty.collectionBody",
      showImportActions: false,
      icon: "collection",
    });
  });

  it("hides import CTAs for an empty smart collection", () => {
    expect(
      resolveBrowseEmptyState({
        showTrash: false,
        hasActiveDiscovery: false,
        hasSelectedFolder: false,
        organizationScope: "smart-collection",
      }),
    ).toEqual({
      kind: "smart-collection",
      titleKey: "empty.smartCollectionTitle",
      detailKey: "empty.smartCollectionBody",
      showImportActions: false,
      icon: "smart",
    });
  });

  it("prefers discovery empty over collection scope", () => {
    expect(
      resolveBrowseEmptyState({
        showTrash: false,
        hasActiveDiscovery: true,
        hasSelectedFolder: false,
        organizationScope: "collection",
      }).kind,
    ).toBe("search");
  });
});

describe("resolveImportMenuCopy", () => {
  it("keeps default labels in folder scope", () => {
    expect(resolveImportMenuCopy("folder").importFiles.labelKey).toBe(
      "toolbar.importFiles",
    );
    expect(resolveImportMenuCopy().pasteImage.labelKey).toBe(
      "toolbar.pasteImage",
    );
  });

  it("labels collection-scope dialog import as library destination", () => {
    const copy = resolveImportMenuCopy("collection");
    expect(copy.importFiles).toEqual({
      labelKey: "toolbar.importFilesToLibrary",
      titleKey: "toolbar.importToLibraryHint",
    });
    expect(copy.pasteImage).toEqual({
      labelKey: "toolbar.pasteImageToCollection",
      titleKey: "toolbar.pasteImageToCollectionHint",
    });
  });

  it("labels smart-collection import as library-only", () => {
    const copy = resolveImportMenuCopy("smart-collection");
    expect(copy.importFiles.labelKey).toBe("toolbar.importFilesToLibrary");
    expect(copy.pasteImage.labelKey).toBe("toolbar.pasteImageToLibrary");
    expect(copy.importFolder.titleKey).toBe("toolbar.importSmartScopeHint");
  });
});
