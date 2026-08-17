import type { IconName } from "./Icons";

/** Which browse empty surface to show when the grid has zero assets. */
export type BrowseEmptyKind =
  | "search"
  | "trash"
  | "folder"
  | "collection"
  | "smart-collection";

/** Organizational browse scope (excluding trash / discovery overlays). */
export type OrganizationBrowseScope =
  | "folder"
  | "collection"
  | "smart-collection";

export type BrowseEmptyState = {
  kind: BrowseEmptyKind;
  titleKey: string;
  detailKey: string;
  showImportActions: boolean;
  icon: IconName;
};

export type ImportMenuItemCopy = {
  labelKey: string;
  /** Destination / semantics hint for `title` attribute. */
  titleKey: string;
};

export type ImportMenuCopy = {
  importFiles: ImportMenuItemCopy;
  importFolder: ImportMenuItemCopy;
  pasteImage: ImportMenuItemCopy;
  importLinkedFolder: ImportMenuItemCopy;
};

/**
 * Resolve empty-grid copy for the asset browse canvas.
 *
 * Priority: active search/discovery narrowing → trash → smart collection →
 * collection → true folder/library empty.
 * Only the folder path keeps import CTAs (CU-B6 / CU-B7 / CU-U5).
 * Collection / smart-collection empty states hide import CTAs so users are not
 * led to believe dialog import targets the current collection view.
 */
export function resolveBrowseEmptyState(input: {
  showTrash: boolean;
  /** Non-empty search box and/or active discovery filters that narrow results. */
  hasActiveDiscovery: boolean;
  hasSelectedFolder: boolean;
  organizationScope?: OrganizationBrowseScope;
}): BrowseEmptyState {
  if (input.hasActiveDiscovery) {
    return {
      kind: "search",
      titleKey: "empty.searchTitle",
      detailKey: "empty.searchBody",
      showImportActions: false,
      icon: "search",
    };
  }
  if (input.showTrash) {
    return {
      kind: "trash",
      titleKey: "empty.trashTitle",
      detailKey: "empty.trashBody",
      showImportActions: false,
      icon: "trash",
    };
  }
  if (input.organizationScope === "smart-collection") {
    return {
      kind: "smart-collection",
      titleKey: "empty.smartCollectionTitle",
      detailKey: "empty.smartCollectionBody",
      showImportActions: false,
      icon: "smart",
    };
  }
  if (input.organizationScope === "collection") {
    return {
      kind: "collection",
      titleKey: "empty.collectionTitle",
      detailKey: "empty.collectionBody",
      showImportActions: false,
      icon: "collection",
    };
  }
  return {
    kind: "folder",
    titleKey: input.hasSelectedFolder
      ? "empty.folderTitle"
      : "empty.folderBody",
    detailKey: "empty.folderDetail",
    showImportActions: true,
    icon: "upload",
  };
}

/**
 * Library-menu import labels for the current organization scope (CU-U5).
 *
 * Dialog import (files/folder/linked) never targets a collection membership —
 * only drop/clipboard already support `targetCollectionId`. Labels make that
 * destination explicit instead of inventing dialog import-into-collection.
 */
export function resolveImportMenuCopy(
  scope: OrganizationBrowseScope = "folder",
): ImportMenuCopy {
  if (scope === "collection") {
    return {
      importFiles: {
        labelKey: "toolbar.importFilesToLibrary",
        titleKey: "toolbar.importToLibraryHint",
      },
      importFolder: {
        labelKey: "toolbar.importFolderToLibrary",
        titleKey: "toolbar.importToLibraryHint",
      },
      pasteImage: {
        labelKey: "toolbar.pasteImageToCollection",
        titleKey: "toolbar.pasteImageToCollectionHint",
      },
      importLinkedFolder: {
        labelKey: "toolbar.importLinkedFolderToLibrary",
        titleKey: "toolbar.importToLibraryHint",
      },
    };
  }
  if (scope === "smart-collection") {
    return {
      importFiles: {
        labelKey: "toolbar.importFilesToLibrary",
        titleKey: "toolbar.importSmartScopeHint",
      },
      importFolder: {
        labelKey: "toolbar.importFolderToLibrary",
        titleKey: "toolbar.importSmartScopeHint",
      },
      pasteImage: {
        labelKey: "toolbar.pasteImageToLibrary",
        titleKey: "toolbar.importSmartScopeHint",
      },
      importLinkedFolder: {
        labelKey: "toolbar.importLinkedFolderToLibrary",
        titleKey: "toolbar.importSmartScopeHint",
      },
    };
  }
  return {
    importFiles: {
      labelKey: "toolbar.importFiles",
      titleKey: "toolbar.importFiles",
    },
    importFolder: {
      labelKey: "toolbar.importFolder",
      titleKey: "toolbar.importFolder",
    },
    pasteImage: {
      labelKey: "toolbar.pasteImage",
      titleKey: "toolbar.pasteImage",
    },
    importLinkedFolder: {
      labelKey: "toolbar.importLinkedFolder",
      titleKey: "toolbar.importLinkedFolder",
    },
  };
}
