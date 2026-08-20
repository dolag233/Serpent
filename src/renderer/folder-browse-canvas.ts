import type { LinkedFolderSummary, ManagedFolderSummary } from "../shared/asset-types";

export interface FolderBrowseCanvasContext {
  assetScope: string;
  showTrash: boolean;
  activeTagId: string | null;
  activeCollectionId: string | null;
  activeSmartCollectionId: string | null;
  folders: ManagedFolderSummary[];
  linkedFolders?: readonly LinkedFolderSummary[];
  /** Text/AI search overlay active on top of the current scope. */
  searchActive: boolean;
}

/**
 * How the open-library browse canvas should pack folder cards vs the asset
 * grid (CANVAS-022 / Serpent-an1).
 *
 * When a folder has only child folders (recursive browse off → zero assets),
 * mounting an empty `.asset-grid` with `min-height: 100%` reserves a full
 * viewport under the folder cards. Folders-only must skip that grid and
 * keep the folder row packed at the top.
 */
export type BrowseCanvasBodyLayout =
  | { mode: "empty" }
  | { mode: "folders-only"; showFolders: true; showAssetGrid: false }
  | { mode: "assets"; showFolders: boolean; showAssetGrid: true };

export function resolveBrowseCanvasBodyLayout(
  assetCount: number,
  folderCount: number,
): BrowseCanvasBodyLayout {
  const showFolders = folderCount > 0;
  const showAssetGrid = assetCount > 0;
  if (!showFolders && !showAssetGrid) return { mode: "empty" };
  if (!showAssetGrid) {
    return { mode: "folders-only", showFolders: true, showAssetGrid: false };
  }
  return { mode: "assets", showFolders, showAssetGrid: true };
}

/**
 * Whether the browse canvas should still render direct child folder cards.
 *
 * Serpent-7a9e89: when 「递归显示子文件夹内容」(recursive browse) is on for a
 * folder scope, the browse semantics flatten child assets into the canvas, so
 * child folder cards conflict with that flattened view and must be hidden.
 * Non-folder scopes ("all" / "root" / trash / tag / collection / search) are
 * unaffected — recursive is only ever enabled for a managed/linked folder id.
 */
export function shouldShowFolderBrowseCards(
  assetScope: string,
  folderRecursive: boolean,
): boolean {
  return !(folderRecursive && assetScope !== "all" && assetScope !== "root");
}

/**
 * Resolves the `parentFolderId` to fetch direct child folder-card entries for
 * (REQ-FOLDER-001/002/003/010), or `undefined` when the current browse view
 * has no folder-card row: trash, a tag/collection/smart-collection view, "all
 * assets", or an active text/AI search overlay.
 *
 * `null` means the managed library root; a string means a managed folder id
 * or a linked root / virtual linked subdirectory id.
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
    linkedFolders = [],
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
  if (isManagedFolderScope) return assetScope;
  const isLinkedFolderScope = linkedFolders.some(
    (folder) => folder.folderId === assetScope,
  );
  return isLinkedFolderScope ? assetScope : undefined;
}
