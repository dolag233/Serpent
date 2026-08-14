/**
 * Eligibility for browse F2 / Delete (Serpent-g8u9).
 *
 * Command registry already allows rename on any available non-deleted asset
 * (managed or linked). Keyboard dispatch must match that — gating F2/Delete to
 * managed-only made linked libraries look like "shortcuts do nothing".
 */

import type { AssetSummary } from "../shared/asset-types";

export function canRenameAssetWithShortcut(
  asset: AssetSummary | undefined,
): asset is AssetSummary {
  return (
    asset !== undefined &&
    asset.availability === "available" &&
    asset.deletedAt === null
  );
}

export type AssetDeleteShortcutPlan =
  | { readonly type: "permanent-delete"; readonly assetIds: readonly string[] }
  | {
      readonly type: "remove-from-collection";
      readonly assetIds: readonly string[];
    }
  | { readonly type: "trash-managed"; readonly assetIds: readonly string[] }
  | { readonly type: "trash-linked"; readonly assetIds: readonly string[] }
  | { readonly type: "none" };

export function planAssetDeleteShortcut(input: {
  readonly showTrash: boolean;
  readonly activeCollectionId: string | null;
  readonly libraryOpen: boolean;
  readonly selectedAssets: readonly AssetSummary[];
}): AssetDeleteShortcutPlan {
  const { showTrash, activeCollectionId, libraryOpen, selectedAssets } = input;
  if (selectedAssets.length === 0) return { type: "none" };

  const ids = selectedAssets.map((asset) => asset.assetId);

  if (showTrash) {
    return { type: "permanent-delete", assetIds: ids };
  }

  if (activeCollectionId !== null) {
    return { type: "remove-from-collection", assetIds: ids };
  }

  if (!libraryOpen) return { type: "none" };

  const managedIds = selectedAssets
    .filter((asset) => asset.locationKind === "managed" && !asset.deletedAt)
    .map((asset) => asset.assetId);
  if (managedIds.length > 0) {
    return { type: "trash-managed", assetIds: managedIds };
  }

  const linkedIds = selectedAssets
    .filter((asset) => asset.locationKind === "linked" && !asset.deletedAt)
    .map((asset) => asset.assetId);
  if (linkedIds.length > 0) {
    return { type: "trash-linked", assetIds: linkedIds };
  }

  return { type: "none" };
}
