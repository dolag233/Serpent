import type { AssetSummary } from '../shared/asset-types';

export type TrashFolderGroup = {
  /** Stable key for React; root assets use empty string. */
  readonly key: string;
  /** Human label for the group header; null hides the header row. */
  readonly label: string | null;
  readonly assets: AssetSummary[];
};

/**
 * Group trashed assets by their original parent folder path (Serpent-09xd).
 * Uses `trashedFromPath` dirname; root-level assets share one unlabeled group.
 */
export function groupTrashedAssetsBySourceFolder(
  assets: readonly AssetSummary[],
  _rootLabel: string,
): TrashFolderGroup[] {
  void _rootLabel;
  const byKey = new Map<string, AssetSummary[]>();

  for (const asset of assets) {
    const key = trashGroupKey(asset.trashedFromPath);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(asset);
    else byKey.set(key, [asset]);
  }

  const keys = [...byKey.keys()].sort((a, b) => {
    if (a === '') return 1;
    if (b === '') return -1;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });

  return keys.map((key) => ({
    key,
    label: key === '' ? null : key.split('/').pop() ?? key,
    assets: byKey.get(key) ?? [],
  }));
}

export function trashGroupKey(trashedFromPath: string | null): string {
  if (!trashedFromPath) return '';
  const slash = trashedFromPath.lastIndexOf('/');
  if (slash <= 0) return '';
  return trashedFromPath.slice(0, slash);
}

/** Label for per-asset origin line in trash cards (TRASH-005). */
export function trashedFromFolderLabel(
  trashedFromPath: string | null,
  rootLabel: string,
): string {
  const key = trashGroupKey(trashedFromPath);
  if (!key) return rootLabel;
  return key;
}
