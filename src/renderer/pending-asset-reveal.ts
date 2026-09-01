import type { AssetSummary } from '../shared/asset-types';
import {
  encodeLinkedVirtualFolderId,
  linkedAssetDirectory,
} from '../shared/linked-folder-tree';

export type AssetBrowseScope = 'all' | 'root' | string;

/** 单个资产的浏览 scope：managed 文件夹 id / 链接根或虚拟子目录 id / 根。 */
function assetBrowseScope(asset: AssetSummary): AssetBrowseScope | null {
  if (asset.managedFolderId !== null) return asset.managedFolderId;
  if (asset.linkedFolderId) {
    const directory = linkedAssetDirectory(asset.relativeFilePath);
    return directory === ''
      ? asset.linkedFolderId
      : encodeLinkedVirtualFolderId(asset.linkedFolderId, directory);
  }
  return 'root';
}

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

/** Scope that contains every asset when they share one managed/linked folder. */
export function sharedBrowseScopeForAssets(
  assets: readonly AssetSummary[],
): AssetBrowseScope | null {
  if (assets.length === 0) return null;
  const scopes = new Set<AssetBrowseScope | null>();
  for (const asset of assets) scopes.add(assetBrowseScope(asset));
  if (scopes.size !== 1) return null;
  return scopes.values().next().value as AssetBrowseScope;
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
