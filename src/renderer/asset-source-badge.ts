import type { ManagedFolderSummary } from "../shared/asset-types";

export type AssetSourceBadgeBrowseContext = {
  /** Current folder browse scope (`all` / `root` / folder id). */
  assetScope: "all" | "root" | (string & {});
  /**
   * True when the visible list can mix folders outside a single non-recursive
   * folder scope (all assets, search, tag, collection, smart collection).
   */
  mixedFolderBrowse: boolean;
};

/**
 * CU-U1: show a compact containing-folder chip when the card is not native to
 * the current folder scope (recursive children), or when browsing a mixed
 * folder surface that already carries `managedFolderId` on AssetSummary.
 */
export function shouldShowAssetSourceBadge(
  context: AssetSourceBadgeBrowseContext,
  managedFolderId: string | null,
): boolean {
  if (context.assetScope !== "all" && context.assetScope !== "root") {
    // Folder scope: badge only when the asset lives elsewhere (typical under
    // recursive/include-children). Direct children of the current folder stay clean.
    return managedFolderId !== context.assetScope;
  }

  if (context.assetScope === "all" || context.mixedFolderBrowse) {
    // All-assets / search / org surfaces: chip only when the asset is in a folder.
    return managedFolderId !== null;
  }

  // Library root scope lists only root assets — no origin chip.
  return false;
}

/**
 * Resolve a compact label for the containing managed folder.
 * Prefers a path relative to the current folder scope when nested; otherwise
 * uses the folder's library-relative path (or leaf name as last resort).
 */
export function resolveAssetSourceBadgeLabel(
  folders: ReadonlyArray<
    Pick<ManagedFolderSummary, "folderId" | "name" | "relativePath">
  >,
  managedFolderId: string | null,
  currentFolderId: string | null | undefined,
): string | null {
  if (managedFolderId === null) {
    return null;
  }

  const folder = folders.find((entry) => entry.folderId === managedFolderId);
  if (!folder) {
    return null;
  }

  if (currentFolderId) {
    const current = folders.find((entry) => entry.folderId === currentFolderId);
    if (current) {
      const prefix = `${current.relativePath}/`;
      if (folder.relativePath.startsWith(prefix)) {
        return folder.relativePath.slice(prefix.length);
      }
    }
  }

  return folder.relativePath || folder.name;
}
