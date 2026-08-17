/**
 * CU-B4 / Serpent-cnp: decide which collection add/remove context-menu
 * items to show from direct-membership state of the current selection.
 *
 * Multi-select follows REQ-MENU-007 skip patterns when membership is mixed:
 * both actions stay available and batch handlers report processed/skipped.
 * Uniform membership filters to a single action.
 */

export type CollectionMembershipState = "all" | "none" | "mixed";

export type CollectionMenuActions = {
  readonly showAdd: boolean;
  readonly showRemove: boolean;
};

/**
 * Classify how the selection relates to one collection's direct members.
 */
export function resolveCollectionMembershipState(
  selectedAssetIds: readonly string[],
  memberAssetIds: ReadonlySet<string>,
): CollectionMembershipState {
  if (selectedAssetIds.length === 0) return "none";

  let memberCount = 0;
  for (const assetId of selectedAssetIds) {
    if (memberAssetIds.has(assetId)) memberCount += 1;
  }

  if (memberCount === 0) return "none";
  if (memberCount === selectedAssetIds.length) return "all";
  return "mixed";
}

/**
 * Map membership state to menu visibility.
 *
 * - all members → remove only (hide add)
 * - no members → add only (hide remove)
 * - mixed → both (batch paths already skip non-eligible items)
 */
export function resolveCollectionMenuActions(
  state: CollectionMembershipState,
): CollectionMenuActions {
  switch (state) {
    case "all":
      return { showAdd: false, showRemove: true };
    case "none":
      return { showAdd: true, showRemove: false };
    case "mixed":
      return { showAdd: true, showRemove: true };
  }
}

export type CollectionMembershipRow = {
  readonly assetId: string;
  readonly collectionId: string;
};

/**
 * Index direct membership rows as collectionId → member asset ids.
 */
export function indexMembershipsByCollection(
  memberships: readonly CollectionMembershipRow[],
): Map<string, Set<string>> {
  const byCollection = new Map<string, Set<string>>();
  for (const { assetId, collectionId } of memberships) {
    let members = byCollection.get(collectionId);
    if (!members) {
      members = new Set();
      byCollection.set(collectionId, members);
    }
    members.add(assetId);
  }
  return byCollection;
}

/**
 * Resolve add/remove visibility for one collection against the selection.
 * Missing collection keys mean no selected asset is a direct member.
 */
export function resolveCollectionMenuForSelection(
  selectedAssetIds: readonly string[],
  collectionId: string,
  memberIdsByCollection: ReadonlyMap<string, ReadonlySet<string>>,
): CollectionMenuActions {
  const members =
    memberIdsByCollection.get(collectionId) ?? new Set<string>();
  return resolveCollectionMenuActions(
    resolveCollectionMembershipState(selectedAssetIds, members),
  );
}
