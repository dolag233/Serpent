/** Resolve the next card in the visual reading order for keyboard focus. */
export function resolveMasonryTabTarget(
  assetIds: readonly string[],
  currentAssetId: string,
  reverse: boolean,
): string | null {
  const currentIndex = assetIds.indexOf(currentAssetId);
  if (currentIndex < 0) return null;
  const nextIndex = currentIndex + (reverse ? -1 : 1);
  return assetIds[nextIndex] ?? null;
}
