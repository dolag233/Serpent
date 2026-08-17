import type { AssetSummary } from '../shared/asset-types';

export type AssetBrowseScope = 'all' | 'root' | string;

export type PendingAssetReveal = {
  readonly assetIds: readonly string[];
  readonly focusAssetId: string;
};

/** Build a reveal request from imported/saved assets (empty → null). */
export function pendingRevealFromAssets(
  assets: readonly AssetSummary[],
): PendingAssetReveal | null {
  if (assets.length === 0) return null;
  const assetIds = assets.map((asset) => asset.assetId);
  return {
    assetIds,
    focusAssetId: assetIds[0]!,
  };
}

/** Scope that contains every asset when they share one managed folder. */
export function sharedBrowseScopeForAssets(
  assets: readonly AssetSummary[],
): AssetBrowseScope | null {
  if (assets.length === 0) return null;
  const folderIds = new Set(assets.map((asset) => asset.managedFolderId));
  if (folderIds.size !== 1) return null;
  const managedFolderId = folderIds.values().next().value as string | null;
  return managedFolderId ?? 'root';
}

/**
 * Whether the current browse scope can show the revealed assets without
 * navigating. "all" always can; otherwise require an exact folder match
 * (recursive parents are treated as insufficient so the card is on-screen).
 */
export function currentScopeShowsRevealAssets(
  assetScope: AssetBrowseScope,
  assets: readonly AssetSummary[],
): boolean {
  if (assets.length === 0) return true;
  if (assetScope === 'all') return true;
  const shared = sharedBrowseScopeForAssets(assets);
  if (shared === null) return false;
  return assetScope === shared;
}

export function presentIdsFromPendingReveal(
  pending: PendingAssetReveal,
  assets: readonly AssetSummary[],
): string[] {
  const available = new Set(assets.map((asset) => asset.assetId));
  return pending.assetIds.filter((assetId) => available.has(assetId));
}
