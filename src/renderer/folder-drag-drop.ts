// ---------------------------------------------------------------------------
// Managed folder drag & drop (Serpent-nno6)
//
// Drag folder cards / sidebar rows onto another managed folder to reparent.
// Worker enforces disk/DB rules; renderer rejects obvious invalid targets
// (same parent, into self, into descendant) before calling moveFolders.
// ---------------------------------------------------------------------------

export const MANAGED_FOLDERS_DRAG_TYPE =
  'application/x-serpent-managed-folders';

export interface FolderDragFact {
  readonly folderId: string;
  readonly parentFolderId: string | null;
}

export type FolderOntoFolderDropResolution =
  | {
      readonly kind: 'move';
      readonly folderIds: readonly string[];
      readonly targetParentFolderId: string | null;
    }
  | {
      readonly kind: 'reject';
      readonly reason: 'same-parent' | 'into-self' | 'into-descendant' | 'empty';
    };

export function resolveDraggedFolderIds(
  draggedFolderId: string,
  selectedFolderIds: readonly string[],
): string[] {
  return selectedFolderIds.includes(draggedFolderId)
    ? [...selectedFolderIds]
    : [draggedFolderId];
}

/**
 * A folder drag can contain both a folder and one of its descendants when a
 * multi-selection is dragged. Trash the highest selected folders only: the
 * worker recursively moves their contents, so sending the descendants again
 * would create avoidable not-found errors after the parent is gone.
 */
export function resolveDraggedFolderIdsForTrash(
  draggedFolderIds: readonly string[],
  folders: readonly FolderDragFact[],
): string[] {
  const unique = [...new Set(draggedFolderIds.filter(Boolean))];
  return unique.filter(
    (folderId) =>
      !unique.some(
        (candidateAncestorId) =>
          candidateAncestorId !== folderId &&
          isFolderDescendantOf(folders, candidateAncestorId, folderId),
      ),
  );
}

export function supportsManagedFolderDrag(transfer: DataTransfer): boolean {
  return transfer.types.includes(MANAGED_FOLDERS_DRAG_TYPE);
}

export function parseManagedFolderDrag(transfer: DataTransfer): string[] | null {
  const raw = transfer.getData(MANAGED_FOLDERS_DRAG_TYPE);
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

export function isFolderDescendantOf(
  folders: readonly FolderDragFact[],
  ancestorId: string,
  candidateId: string,
): boolean {
  const parentById = new Map(
    folders.map((folder) => [folder.folderId, folder.parentFolderId]),
  );
  let current: string | null = candidateId;
  while (current) {
    if (current === ancestorId) return true;
    current = parentById.get(current) ?? null;
  }
  return false;
}

/**
 * Resolve dropping dragged folders onto a managed folder row/card.
 * `targetFolderId` null = library root (Assets).
 */
export function resolveFolderOntoFolderDrop(input: {
  readonly targetFolderId: string | null;
  readonly draggedFolderIds: readonly string[];
  readonly folders: readonly FolderDragFact[];
}): FolderOntoFolderDropResolution {
  const unique = [...new Set(input.draggedFolderIds.filter(Boolean))];
  if (unique.length === 0) {
    return { kind: 'reject', reason: 'empty' };
  }

  const folderById = new Map(
    input.folders.map((folder) => [folder.folderId, folder]),
  );

  for (const folderId of unique) {
    if (input.targetFolderId === folderId) {
      return { kind: 'reject', reason: 'into-self' };
    }
    if (
      input.targetFolderId &&
      isFolderDescendantOf(input.folders, folderId, input.targetFolderId)
    ) {
      return { kind: 'reject', reason: 'into-descendant' };
    }
  }

  const allSameParent = unique.every((folderId) => {
    const folder = folderById.get(folderId);
    if (!folder) return false;
    return folder.parentFolderId === input.targetFolderId;
  });
  if (allSameParent) {
    return { kind: 'reject', reason: 'same-parent' };
  }

  return {
    kind: 'move',
    folderIds: unique,
    targetParentFolderId: input.targetFolderId,
  };
}
