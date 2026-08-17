import type { AssetSummary } from "../shared/asset-types";

/** Patch in-memory browse rows with fresher Worker summaries (e.g. after relink). */
export function mergeAssetSummaries(
  current: AssetSummary[],
  updates: AssetSummary[],
): AssetSummary[] {
  if (updates.length === 0) return current;
  const byId = new Map(updates.map((asset) => [asset.assetId, asset]));
  let changed = false;
  const next = current.map((item) => {
    const updated = byId.get(item.assetId);
    if (!updated) return item;
    changed = true;
    return updated;
  });
  return changed ? next : current;
}
