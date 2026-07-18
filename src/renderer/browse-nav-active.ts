/**
 * Sidebar / workspace-bar active predicates for browse scopes.
 * Keeps NavigationSidebar and title derivation from drifting apart (CU-B3).
 */

export type BrowseNavFlags = {
  assetScope: "all" | "root" | string;
  showTrash: boolean;
  activeTagId: string | null;
  activeCollectionId: string | null;
  activeSmartCollectionId: string | null;
};

export function isAllAssetsNavActive(flags: BrowseNavFlags): boolean {
  return (
    flags.assetScope === "all" &&
    !flags.showTrash &&
    !flags.activeTagId &&
    !flags.activeCollectionId &&
    !flags.activeSmartCollectionId
  );
}

export function isTrashNavActive(flags: BrowseNavFlags): boolean {
  return (
    flags.showTrash &&
    !flags.activeTagId &&
    !flags.activeCollectionId &&
    !flags.activeSmartCollectionId
  );
}

export function isRootFolderNavActive(flags: BrowseNavFlags): boolean {
  return (
    flags.assetScope === "root" &&
    !flags.showTrash &&
    !flags.activeTagId &&
    !flags.activeCollectionId &&
    !flags.activeSmartCollectionId
  );
}

export function isManagedFolderNavActive(
  flags: BrowseNavFlags,
  folderId: string,
): boolean {
  return (
    flags.assetScope === folderId &&
    !flags.showTrash &&
    !flags.activeTagId &&
    !flags.activeCollectionId &&
    !flags.activeSmartCollectionId
  );
}
