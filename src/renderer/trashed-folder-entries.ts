import type { FolderBrowseEntry, TrashedFolderSummary } from '../shared/asset-types';

/** Map worker tombstones to browse canvas folder cards (Serpent-l4nl / 6pcd). */
export function trashedFoldersToBrowseEntries(
  folders: readonly TrashedFolderSummary[],
): FolderBrowseEntry[] {
  const tombstoneIdByPath = new Map(
    folders.map((folder) => [folder.relativePath, folder.tombstoneId] as const),
  );
  const childCountByParent = new Map<string | null, number>();
  for (const folder of folders) {
    const parent = folder.parentRelativePath;
    childCountByParent.set(parent, (childCountByParent.get(parent) ?? 0) + 1);
  }

  return folders.map((folder) => ({
    folderId: folder.tombstoneId,
    parentFolderId:
      folder.parentRelativePath === null
        ? null
        : (tombstoneIdByPath.get(folder.parentRelativePath) ?? null),
    locationKind: 'managed' as const,
    name: folder.name,
    relativePath: folder.relativePath,
    status: 'available' as const,
    directAssetCount: folder.assetCount,
    recursiveAssetCount: folder.assetCount,
    childFolderCount: childCountByParent.get(folder.relativePath) ?? 0,
    coverArtifactIds: [],
  }));
}
