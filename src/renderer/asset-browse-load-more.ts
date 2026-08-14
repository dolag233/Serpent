/**
 * Browse-canvas infinite scroll helpers (Serpent-r94b).
 *
 * Keeps load-more triggering honest: only the scrollport is a valid
 * IntersectionObserver root, and an empty/no-progress page must clamp
 * `total` so the sentinel cannot thrash "loading more" forever.
 */

export function browseLoadMoreObserverRoot(
  sentinel: Element,
): HTMLElement | null {
  const canvas = sentinel.closest(".workspace-canvas");
  return canvas instanceof HTMLElement ? canvas : null;
}

/**
 * After an append page, decide the authoritative `searchTotal`.
 * - Empty page or zero newly-added rows → treat the current offset as the
 *   end so the UI stops requesting.
 * - Otherwise keep the server total.
 */
export function resolveSearchTotalAfterAppend(input: {
  readonly requestOffset: number;
  readonly serverTotal: number;
  readonly pageItemCount: number;
  readonly newlyAddedCount: number;
}): number {
  if (input.pageItemCount <= 0 || input.newlyAddedCount <= 0) {
    return Math.min(input.serverTotal, input.requestOffset);
  }
  return input.serverTotal;
}

export function countNewlyAddedAssets<T extends { readonly assetId: string }>(
  existing: readonly T[],
  pageItems: readonly T[],
): number {
  if (pageItems.length === 0) return 0;
  const seen = new Set(existing.map((item) => item.assetId));
  let added = 0;
  for (const item of pageItems) {
    if (!seen.has(item.assetId)) {
      seen.add(item.assetId);
      added += 1;
    }
  }
  return added;
}

/**
 * Append a fetched page to the browse list, dropping ids that are already
 * present (Serpent-ws4k). The page is a strict continuation of the previous
 * page, so appended rows keep their worker order at the tail; duplicates only
 * appear when the underlying scope changed between page fetches.
 */
export function appendAssetPage<T extends { readonly assetId: string }>(
  current: readonly T[],
  pageItems: readonly T[],
): T[] {
  if (pageItems.length === 0) return [...current];
  const seen = new Set(current.map((item) => item.assetId));
  const merged: T[] = [...current];
  for (const item of pageItems) {
    if (!seen.has(item.assetId)) {
      seen.add(item.assetId);
      merged.push(item);
    }
  }
  return merged;
}
