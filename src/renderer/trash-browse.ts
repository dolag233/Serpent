/**
 * Pure helpers for trash folder hierarchy browse (Serpent-6pcd / jcur / whvm).
 * Navigate by tombstone id — never by display name or bare relativePath alone,
 * so two same-named folders stay distinct.
 */

import type { AssetSummary, TrashedFolderSummary } from '../shared/asset-types';

/** Direct child tombstones under `browseTombstoneId` (null = trash root). */
export function filterTrashedFoldersAtTombstone(
  folders: readonly TrashedFolderSummary[],
  browseTombstoneId: string | null,
): TrashedFolderSummary[] {
  if (browseTombstoneId === null) {
    const byPathAndTime = new Map<string, TrashedFolderSummary>();
    for (const folder of folders) {
      byPathAndTime.set(`${folder.trashedAt}\0${folder.relativePath}`, folder);
    }
    return folders.filter((folder) => {
      if (folder.parentRelativePath === null) return true;
      const parentKey = `${folder.trashedAt}\0${folder.parentRelativePath}`;
      return !byPathAndTime.has(parentKey);
    });
  }

  const current = folders.find((folder) => folder.tombstoneId === browseTombstoneId);
  if (!current) return [];
  return folders.filter(
    (folder) =>
      folder.trashedAt === current.trashedAt &&
      folder.parentRelativePath === current.relativePath,
  );
}

/**
 * Assets that belonged directly to the browsed tombstone folder.
 * At trash root, only assets not bound to any surviving tombstone.
 */
export function filterTrashedAssetsAtTombstone(
  assets: readonly AssetSummary[],
  folders: readonly TrashedFolderSummary[],
  browseTombstoneId: string | null,
): AssetSummary[] {
  const tombstoneIds = new Set(folders.map((folder) => folder.tombstoneId));
  if (browseTombstoneId === null) {
    return assets.filter((asset) => {
      const bound = asset.trashedFromTombstoneId ?? null;
      if (bound) return !tombstoneIds.has(bound);
      // Legacy rows without tombstone binding: keep at root only when their
      // parent path is not covered by any tombstone relativePath.
      const parent = trashParentPath(asset.trashedFromPath);
      if (!parent) return true;
      return !folders.some((folder) => folder.relativePath === parent);
    });
  }

  return assets.filter(
    (asset) => (asset.trashedFromTombstoneId ?? null) === browseTombstoneId,
  );
}

export type TrashBreadcrumbHop = {
  readonly tombstoneId: string | null;
  readonly label: string;
};

/** Trail from trash root through the browsed tombstone. */
export function buildTrashBreadcrumbHops(
  folders: readonly TrashedFolderSummary[],
  browseTombstoneId: string | null,
  trashRootLabel: string,
): TrashBreadcrumbHop[] {
  const hops: TrashBreadcrumbHop[] = [
    { tombstoneId: null, label: trashRootLabel },
  ];
  if (!browseTombstoneId) return hops;

  const current = folders.find((folder) => folder.tombstoneId === browseTombstoneId);
  if (!current) return hops;

  const byPathAndTime = new Map<string, TrashedFolderSummary>();
  for (const folder of folders) {
    byPathAndTime.set(`${folder.trashedAt}\0${folder.relativePath}`, folder);
  }
  const chain: TrashedFolderSummary[] = [];
  let cursor: TrashedFolderSummary | undefined = current;
  const seen = new Set<string>();
  while (cursor) {
    if (seen.has(cursor.tombstoneId)) break;
    seen.add(cursor.tombstoneId);
    chain.push(cursor);
    if (!cursor.parentRelativePath) break;
    cursor = byPathAndTime.get(
      `${cursor.trashedAt}\0${cursor.parentRelativePath}`,
    );
  }
  chain.reverse();
  for (const folder of chain) {
    hops.push({ tombstoneId: folder.tombstoneId, label: folder.name });
  }
  return hops;
}

/** @deprecated Prefer filterTrashedFoldersAtTombstone. */
export function filterTrashedFoldersAtPath(
  folders: readonly TrashedFolderSummary[],
  browsePath: string | null,
): TrashedFolderSummary[] {
  if (browsePath === null) {
    return filterTrashedFoldersAtTombstone(folders, null);
  }
  const match = folders.find((folder) => folder.relativePath === browsePath);
  return filterTrashedFoldersAtTombstone(folders, match?.tombstoneId ?? null);
}

/** @deprecated Prefer filterTrashedAssetsAtTombstone. */
export function filterTrashedAssetsAtPath(
  assets: readonly AssetSummary[],
  folders: readonly TrashedFolderSummary[],
  browsePath: string | null,
): AssetSummary[] {
  if (browsePath === null) {
    return filterTrashedAssetsAtTombstone(assets, folders, null);
  }
  const match = folders.find((folder) => folder.relativePath === browsePath);
  return filterTrashedAssetsAtTombstone(assets, folders, match?.tombstoneId ?? null);
}

function trashParentPath(trashedFromPath: string | null): string {
  if (!trashedFromPath) return '';
  const slash = trashedFromPath.lastIndexOf('/');
  if (slash <= 0) return '';
  return trashedFromPath.slice(0, slash);
}
