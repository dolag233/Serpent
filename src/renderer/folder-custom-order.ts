/**
 * User-defined sidebar order ("自定义" sort) for folders and collections.
 *
 * Stored per library next to the existing sidebar sort preference, which is
 * also device-local. Positions are compared only among siblings, so a single
 * numeric sequence per row is enough.
 */

const FOLDER_STORAGE_PREFIX = "serpent.folder-custom-order.v1.";
const COLLECTION_STORAGE_PREFIX = "serpent.collection-custom-order.v1.";
export const FOLDER_CUSTOM_ORDER_CHANGED = "serpent:folder-custom-order-changed";

/** Seed source ordering without replacing this device's existing manual order. */
export function mergeImportedFolderOrder(
  existing: ReadonlyMap<string, number>,
  imported: readonly { folderId: string; parentFolderId: string | null; position: number }[],
): Map<string, number> {
  const next = new Map(existing);
  const manuallyOrderedParents = new Set(imported
    .filter((folder) => resolveCustomPosition(existing, folder.parentFolderId, folder.folderId) !== undefined)
    .map((folder) => folder.parentFolderId));
  for (const folder of imported) {
    if (manuallyOrderedParents.has(folder.parentFolderId)) continue;
    next.set(customOrderKey(folder.parentFolderId, folder.folderId), folder.position);
  }
  return next;
}

export function importFolderCustomOrder(
  libraryId: string,
  imported: Parameters<typeof mergeImportedFolderOrder>[1],
): void {
  if (imported.length === 0) return;
  saveFolderCustomOrder(libraryId, mergeImportedFolderOrder(loadFolderCustomOrder(libraryId), imported));
  window.dispatchEvent(new CustomEvent(FOLDER_CUSTOM_ORDER_CHANGED, { detail: libraryId }));
}

export type FolderDropEdge = "before" | "after";

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  return ls ?? null;
}

export function folderCustomOrderKey(libraryId: string): string {
  return `${FOLDER_STORAGE_PREFIX}${libraryId}`;
}

export function collectionCustomOrderKey(libraryId: string): string {
  return `${COLLECTION_STORAGE_PREFIX}${libraryId}`;
}

export function parseFolderCustomOrder(raw: string | null): Map<string, number> {
  if (!raw) return new Map();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return new Map();
    }
    const order = new Map<string, number>();
    for (const [rowId, position] of Object.entries(parsed as Record<string, unknown>)) {
      if (rowId.length === 0) continue;
      if (typeof position !== "number" || !Number.isFinite(position)) continue;
      order.set(rowId, position);
    }
    return order;
  } catch {
    return new Map();
  }
}

function loadScopedOrder(
  key: string | null,
  storage?: StorageLike,
): Map<string, number> {
  if (!key) return new Map();
  const target = resolveStorage(storage);
  if (!target) return new Map();
  try {
    return parseFolderCustomOrder(target.getItem(key));
  } catch {
    return new Map();
  }
}

export function loadFolderCustomOrder(
  libraryId: string | null | undefined,
  storage?: StorageLike,
): Map<string, number> {
  return loadScopedOrder(libraryId ? folderCustomOrderKey(libraryId) : null, storage);
}

export function loadCollectionCustomOrder(
  libraryId: string | null | undefined,
  storage?: StorageLike,
): Map<string, number> {
  return loadScopedOrder(libraryId ? collectionCustomOrderKey(libraryId) : null, storage);
}

function saveScopedOrder(
  key: string,
  order: ReadonlyMap<string, number>,
  storage?: StorageLike,
): void {
  const target = resolveStorage(storage);
  if (!target) return;
  const serialized: Record<string, number> = {};
  for (const [rowId, position] of order) serialized[rowId] = position;
  target.setItem(key, JSON.stringify(serialized));
}

export function saveFolderCustomOrder(
  libraryId: string,
  order: ReadonlyMap<string, number>,
  storage?: StorageLike,
): void {
  saveScopedOrder(folderCustomOrderKey(libraryId), order, storage);
}

export function saveCollectionCustomOrder(
  libraryId: string,
  order: ReadonlyMap<string, number>,
  storage?: StorageLike,
): void {
  saveScopedOrder(collectionCustomOrderKey(libraryId), order, storage);
}

/**
 * Move `draggedIds` beside `targetId` in the given sibling sequence. Dragged
 * rows keep their relative order; dropping onto one of the dragged rows is a
 * no-op.
 */
export function moveFolderInCustomOrder(
  sequence: readonly string[],
  draggedIds: readonly string[],
  targetId: string,
  edge: FolderDropEdge,
): string[] {
  const dragged = new Set(draggedIds.filter((id) => id !== targetId));
  if (dragged.size === 0) return [...sequence];
  const remaining = sequence.filter((id) => !dragged.has(id));
  const targetIndex = remaining.indexOf(targetId);
  if (targetIndex === -1) return [...sequence];
  const insertAt = edge === "before" ? targetIndex : targetIndex + 1;
  const moving = sequence.filter((id) => dragged.has(id));
  return [
    ...remaining.slice(0, insertAt),
    ...moving,
    ...remaining.slice(insertAt),
  ];
}

/**
 * Insert rows beside `targetId` even when they currently belong to another
 * parent. Rows that are not part of `sequence` yet are appended before the
 * move so the result contains the dragged rows at the insertion point.
 */
export function insertBesideSibling(
  sequence: readonly string[],
  draggedIds: readonly string[],
  targetId: string,
  edge: FolderDropEdge,
): string[] {
  const next = [...sequence];
  for (const rowId of draggedIds) {
    if (!next.includes(rowId)) next.push(rowId);
  }
  return moveFolderInCustomOrder(next, draggedIds, targetId, edge);
}

/**
 * Positions belong to a sibling scope. A cross-level move writes the new
 * position under the destination parent, so the row keeps its old order while
 * the filesystem move is still in flight and only changes place once it
 * actually appears under the new parent.
 */
const SCOPE_SEPARATOR = "\u001f";

export function customOrderKey(parentId: string | null, rowId: string): string {
  return `${parentId ?? ""}${SCOPE_SEPARATOR}${rowId}`;
}

/**
 * Scoped position first, then the pre-scope flat value written by the first
 * build of this feature. The fallback keeps existing device-local orders when
 * the new format is first loaded.
 */
export function resolveCustomPosition(
  order: ReadonlyMap<string, number> | undefined,
  parentId: string | null,
  rowId: string,
): number | undefined {
  return order?.get(customOrderKey(parentId, rowId)) ?? order?.get(rowId);
}

/** Positions for a freshly reordered sibling sequence (0-based). */
export function positionsForSequence(sequence: readonly string[]): Map<string, number> {
  return new Map(sequence.map((rowId, index) => [rowId, index]));
}

/** Apply a reordered sibling sequence on top of the existing library order. */
export function applyFolderSiblingOrder(
  existing: ReadonlyMap<string, number>,
  parentId: string | null,
  sequence: readonly string[],
): Map<string, number> {
  const next = new Map(existing);
  for (const [rowId, position] of positionsForSequence(sequence)) {
    next.set(customOrderKey(parentId, rowId), position);
  }
  return next;
}
