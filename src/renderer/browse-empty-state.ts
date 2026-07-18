import type { IconName } from "./Icons";

/** Which browse empty surface to show when the grid has zero assets. */
export type BrowseEmptyKind = "search" | "trash" | "folder";

export type BrowseEmptyState = {
  kind: BrowseEmptyKind;
  titleKey: string;
  detailKey: string;
  showImportActions: boolean;
  icon: IconName;
};

/**
 * Resolve empty-grid copy for the asset browse canvas.
 *
 * Priority: active search/discovery narrowing → trash → true folder/library empty.
 * Only the folder path keeps import CTAs (CU-B6 / CU-B7).
 */
export function resolveBrowseEmptyState(input: {
  showTrash: boolean;
  /** Non-empty search box and/or active discovery filters that narrow results. */
  hasActiveDiscovery: boolean;
  hasSelectedFolder: boolean;
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
