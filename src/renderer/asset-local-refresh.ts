/**
 * Local (associated) refresh helpers for asset deletions (Serpent-关联刷新).
 *
 * Deleting/trashing assets must clear the visible cards immediately instead
 * of waiting for a full searchAssets round trip (~10s on large libraries).
 * The pure helpers here update the renderer state locally; the deferred
 * background reconcile keeps derived data (sidebar counts, folder covers)
 * fresh afterwards.
 */

export function removeAssetIdsLocally<T extends { assetId: string }>(
  assets: readonly T[],
  removedIds: ReadonlySet<string>,
): T[] {
  if (removedIds.size === 0) return assets as T[];
  const kept = assets.filter((asset) => !removedIds.has(asset.assetId));
  // Keep the original reference when nothing was actually removed so React
  // skips a no-op re-render.
  return kept.length === assets.length ? (assets as T[]) : kept;
}

/**
 * Decrement a scope count without going below zero. `null` means "no count
 * displayed" and stays null.
 */
export function decrementScopeCount(
  current: number | null,
  removedCount: number,
): number | null {
  if (current === null) return null;
  return Math.max(0, current - Math.max(0, removedCount));
}
