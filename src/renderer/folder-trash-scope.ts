/**
 * Detect whether the current browse scope is removed or orphaned by trashing
 * one or more managed folders (Serpent-yvch).
 */

export type FolderParentNode = {
  readonly folderId: string;
  readonly parentFolderId: string | null;
};

/**
 * True when `assetScope` is one of `trashedFolderIds`, or a descendant of any
 * of them in the pre-trash folder tree. Call before reload so we can navigate
 * away instead of querying a deleted folder id.
 */
export function isBrowseScopeAffectedByFolderTrash(
  assetScope: string,
  trashedFolderIds: readonly string[],
  folders: readonly FolderParentNode[],
): boolean {
  if (assetScope === "all" || assetScope === "root") return false;
  if (trashedFolderIds.length === 0) return false;
  const trashed = new Set(trashedFolderIds);
  if (trashed.has(assetScope)) return true;

  const parentById = new Map(
    folders.map((folder) => [folder.folderId, folder.parentFolderId] as const),
  );
  const seen = new Set<string>();
  let current: string | null = assetScope;
  while (current) {
    if (trashed.has(current)) return true;
    if (seen.has(current)) break;
    seen.add(current);
    current = parentById.get(current) ?? null;
  }
  return false;
}
