// ---------------------------------------------------------------------------
// Asset drag & drop (REQ-DND-001/002)
//
// Pure decision logic for dragging asset cards onto directory-tree targets.
// The drag payload carries ALL selected asset ids as JSON under
// MANAGED_ASSETS_DRAG_TYPE (the existing sidebar convention — linked rows
// already consume it for 复制到链接文件夹); each drop target resolves
// eligibility here so App.tsx stays a thin executor and every branch is
// unit-testable without React or the DOM.
// ---------------------------------------------------------------------------

export const MANAGED_ASSETS_DRAG_TYPE = 'application/x-serpent-managed-assets';

/** Minimal per-asset facts the drop resolution needs. */
export interface DragAssetFact {
  readonly assetId: string;
  readonly locationKind: 'managed' | 'linked';
  readonly availability: 'available' | 'missing';
  readonly deletedAt: string | null;
}

/**
 * Selection snapshot for a drag start: dragging a card that belongs to the
 * current selection moves the whole selection; dragging any other card moves
 * just that card (it becomes selected on click elsewhere in the app).
 */
export function resolveDraggedAssetIds(
  draggedAssetId: string,
  selectedAssetIds: readonly string[],
): string[] {
  return selectedAssetIds.includes(draggedAssetId)
    ? [...selectedAssetIds]
    : [draggedAssetId];
}

export function supportsManagedAssetDrag(transfer: DataTransfer): boolean {
  return transfer.types.includes(MANAGED_ASSETS_DRAG_TYPE);
}

/** Parse the drag payload on drop. Returns null for invalid/absent data. */
export function parseManagedAssetDrag(transfer: DataTransfer): string[] | null {
  const raw = transfer.getData(MANAGED_ASSETS_DRAG_TYPE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== 'string')) {
      return null;
    }
    return parsed as string[];
  } catch {
    return null;
  }
}

/** Assets eligible for folder move / trash: managed, present on disk, not already trashed. */
function movableAssets(assets: readonly DragAssetFact[]): DragAssetFact[] {
  return assets.filter(
    (asset) =>
      asset.locationKind === 'managed' &&
      asset.availability === 'available' &&
      !asset.deletedAt,
  );
}

export type FolderDropResolution =
  | { readonly kind: 'move'; readonly assetIds: string[]; readonly skippedCount: number }
  | {
      readonly kind: 'reject';
      readonly reason: 'same-folder' | 'no-eligible-assets';
      readonly skippedCount: number;
    };

/**
 * Resolve a drop onto a managed folder row (or the library root, targetFolderId
 * = null). Dropping onto the folder the assets already live in is a no-op
 * reject; linked/missing/trashed assets in the snapshot are skipped and
 * counted (the caller explains the skip in the result toast).
 */
export function resolveFolderDrop(input: {
  readonly targetFolderId: string | null;
  readonly currentFolderId: string | null;
  readonly assets: readonly DragAssetFact[];
}): FolderDropResolution {
  if (input.targetFolderId === input.currentFolderId) {
    return { kind: 'reject', reason: 'same-folder', skippedCount: 0 };
  }
  const eligible = movableAssets(input.assets);
  const skippedCount = input.assets.length - eligible.length;
  if (eligible.length === 0) {
    return { kind: 'reject', reason: 'no-eligible-assets', skippedCount };
  }
  return {
    kind: 'move',
    assetIds: eligible.map((asset) => asset.assetId),
    skippedCount,
  };
}

export interface TrashDropResolution {
  readonly assetIds: string[];
  readonly skippedCount: number;
}

/**
 * Resolve a drop onto the trash row: same eligibility as the batch 移至回收站
 * menu action (managed + available + not already trashed); skips are counted
 * for the result toast. Linked assets never enter the Serpent trash.
 */
export function resolveTrashDrop(
  assets: readonly DragAssetFact[],
): TrashDropResolution {
  const eligible = movableAssets(assets);
  return {
    assetIds: eligible.map((asset) => asset.assetId),
    skippedCount: assets.length - eligible.length,
  };
}
