import type { AssetSummary } from '../shared/asset-types';

/** Selected IDs outlive paged summaries; unloaded cards remain in the batch. */
export function clipboardSelectionIds(selectedIds: readonly string[], loaded: readonly AssetSummary[]): string[] {
  const unavailable = new Set(loaded.filter(asset => asset.availability !== 'available' || asset.deletedAt).map(asset => asset.assetId));
  return [...new Set(selectedIds)].filter(id => !unavailable.has(id));
}
