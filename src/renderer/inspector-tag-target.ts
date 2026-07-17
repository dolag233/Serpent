// REQ-MENU-007: Inspector tag operations must apply to every selected asset,
// not only the primary one. This helper decides whether an Inspector tag
// operation (assign / remove / create+assign) targets a single asset or the
// whole multi-selection, so App.tsx wiring stays a thin routing layer.

export type InspectorTagTarget =
  | { kind: "single"; assetId: string }
  | { kind: "batch"; assetIds: string[] };

/**
 * Resolve the effective target of an Inspector tag operation.
 *
 * - Two or more selected assets -> batch over the full (deduped) selection.
 * - Exactly one selected asset  -> single-asset path, preferring the primary
 *   selection id so behavior matches the historical single-asset handlers.
 * - No selection at all         -> null (operation is a no-op).
 */
export function resolveInspectorTagTarget(
  selectedAssetIds: readonly string[],
  primaryAssetId: string | undefined,
): InspectorTagTarget | null {
  const uniqueIds = [...new Set(selectedAssetIds)];
  if (uniqueIds.length >= 2) {
    return { kind: "batch", assetIds: uniqueIds };
  }
  const singleId = primaryAssetId ?? uniqueIds[0];
  return singleId ? { kind: "single", assetId: singleId } : null;
}
