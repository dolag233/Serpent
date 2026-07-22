import type { FolderBrowseEntry, TrashedFolderSummary } from '../shared/asset-types';

/** Map worker tombstones to browse canvas folder cards (Serpent-l4nl). */
export function trashedFoldersToBrowseEntries(
  folders: readonly TrashedFolderSummary[],
): FolderBrowseEntry[] {
  return folders.map((folder) => ({
    folderId: folder.tombstoneId,
    parentFolderId: null,
    locationKind: 'managed' as const,
    name: folder.name,
    relativePath: folder.relativePath,
    status: 'available' as const,
    directAssetCount: folder.assetCount,
    recursiveAssetCount: folder.assetCount,
    childFolderCount: 0,
    coverArtifactIds: [],
  }));
}
