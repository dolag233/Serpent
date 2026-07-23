import type { FolderBrowseEntry, TrashedFolderSummary } from '../shared/asset-types';

function trashHierarchyKey(
  trashedAt: string,
  relativePath: string | null,
): string {
  return `${trashedAt}\0${relativePath ?? ''}`;
}

/** Map worker tombstones to browse canvas folder cards (Serpent-l4nl / 6pcd / whvm). */
export function trashedFoldersToBrowseEntries(
  folders: readonly TrashedFolderSummary[],
): FolderBrowseEntry[] {
  const tombstoneIdByHierarchy = new Map(
    folders.map(
      (folder) =>
        [
          trashHierarchyKey(folder.trashedAt, folder.relativePath),
          folder.tombstoneId,
        ] as const,
    ),
  );
  const childCountByParent = new Map<string, number>();
  for (const folder of folders) {
    const parentKey = trashHierarchyKey(
      folder.trashedAt,
      folder.parentRelativePath,
    );
    childCountByParent.set(parentKey, (childCountByParent.get(parentKey) ?? 0) + 1);
  }

  return folders.map((folder) => ({
    folderId: folder.tombstoneId,
    parentFolderId:
      folder.parentRelativePath === null
        ? null
        : (tombstoneIdByHierarchy.get(
            trashHierarchyKey(folder.trashedAt, folder.parentRelativePath),
          ) ?? null),
    locationKind: 'managed' as const,
    name: folder.name,
    relativePath: folder.relativePath,
    status: 'available' as const,
    directAssetCount: folder.assetCount,
    recursiveAssetCount: folder.assetCount,
    childFolderCount:
      childCountByParent.get(
        trashHierarchyKey(folder.trashedAt, folder.relativePath),
      ) ?? 0,
    coverArtifactIds: folder.coverArtifactIds ?? [],
  }));
}
