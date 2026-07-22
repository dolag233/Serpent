/**
 * Pure helpers for trash folder hierarchy browse (Serpent-6pcd).
 * Navigate tombstones like normal folders — not click-to-filter lists.
 */

import type { AssetSummary, TrashedFolderSummary } from '../shared/asset-types';
import { trashGroupKey } from './trash-folder-groups';

/** Direct child tombstones under `browsePath` (null = trash root). */
export function filterTrashedFoldersAtPath(
  folders: readonly TrashedFolderSummary[],
  browsePath: string | null,
): TrashedFolderSummary[] {
  const pathSet = new Set(folders.map((folder) => folder.relativePath));
  if (browsePath === null) {
    return folders.filter(
      (folder) =>
        folder.parentRelativePath === null ||
        !pathSet.has(folder.parentRelativePath),
    );
  }
  return folders.filter((folder) => folder.parentRelativePath === browsePath);
}

/**
 * Assets whose original parent folder equals `browsePath`.
 * At trash root, only assets not belonging to any surviving tombstone folder.
 */
export function filterTrashedAssetsAtPath(
  assets: readonly AssetSummary[],
  folders: readonly TrashedFolderSummary[],
  browsePath: string | null,
): AssetSummary[] {
  const folderPaths = new Set(folders.map((folder) => folder.relativePath));
  return assets.filter((asset) => {
    const parent = trashGroupKey(asset.trashedFromPath);
    if (browsePath === null) {
      if (parent === '') return true;
      return !folderPaths.has(parent);
    }
    return parent === browsePath;
  });
}

export type TrashBreadcrumbHop = {
  readonly path: string | null;
  readonly label: string;
};

/** Trail from trash root through `browsePath` using tombstone names. */
export function buildTrashBreadcrumbHops(
  folders: readonly TrashedFolderSummary[],
  browsePath: string | null,
  trashRootLabel: string,
): TrashBreadcrumbHop[] {
  const hops: TrashBreadcrumbHop[] = [
    { path: null, label: trashRootLabel },
  ];
  if (!browsePath) return hops;

  const byPath = new Map(
    folders.map((folder) => [folder.relativePath, folder] as const),
  );
  const parts = browsePath.split('/').filter(Boolean);
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    hops.push({
      path: acc,
      label: byPath.get(acc)?.name ?? part,
    });
  }
  return hops;
}
