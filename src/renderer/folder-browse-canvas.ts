import type { ManagedFolderSummary } from "../shared/asset-types";

export interface FolderBrowseCanvasContext {
  assetScope: string;
  showTrash: boolean;
  activeTagId: string | null;
  activeCollectionId: string | null;
  activeSmartCollectionId: string | null;
  folders: ManagedFolderSummary[];
  /** Text/AI search overlay active on top of the current scope. */
  searchActive: boolean;
}

/**
 * Resolves the `parentFolderId` to fetch direct child folder-card entries for
 * (REQ-FOLDER-001/002/003/010), or `undefined` when the current browse view
 * has no folder-card row: trash, a tag/collection/smart-collection view, "all
 * assets", a linked folder, or an active text/AI search overlay.
 *
 * `null` means the managed library root; a string means a managed folder id.
 */
export function resolveFolderBrowseParentId(
  context: FolderBrowseCanvasContext,
): string | null | undefined {
  const {
    assetScope,
    showTrash,
    activeTagId,
    activeCollectionId,
    activeSmartCollectionId,
    folders,
    searchActive,
  } = context;
  if (showTrash || activeTagId || activeCollectionId || activeSmartCollectionId) {
    return undefined;
  }
  if (searchActive) return undefined;
  if (assetScope === "root") return null;
  if (assetScope === "all") return undefined;
  const isManagedFolderScope = folders.some(
    (folder) => folder.folderId === assetScope,
  );
  return isManagedFolderScope ? assetScope : undefined;
}
