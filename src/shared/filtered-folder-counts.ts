/**
 * Roll a folder's own matches into every ancestor. Deepest folders are added
 * first so each parent receives the child's full subtree once.
 */
export function rollupDirectFolderCounts(
  folders: readonly { folderId: string; parentFolderId: string | null }[],
  directCounts: ReadonlyMap<string, number>,
): Map<string, number> {
  const byId = new Map(folders.map((folder) => [folder.folderId, folder]));
  const totals = new Map(
    folders.map((folder) => [folder.folderId, directCounts.get(folder.folderId) ?? 0]),
  );
  const depth = new Map<string, number>();
  const depthOf = (folderId: string): number => {
    const cached = depth.get(folderId);
    if (cached !== undefined) return cached;
    const parentId = byId.get(folderId)?.parentFolderId ?? null;
    const value = parentId && byId.has(parentId) ? depthOf(parentId) + 1 : 0;
    depth.set(folderId, value);
    return value;
  };
  const deepestFirst = [...folders].sort(
    (left, right) => depthOf(right.folderId) - depthOf(left.folderId),
  );
  for (const folder of deepestFirst) {
    const parentId = folder.parentFolderId;
    if (!parentId || !totals.has(parentId)) continue;
    totals.set(
      parentId,
      (totals.get(parentId) ?? 0) + (totals.get(folder.folderId) ?? 0),
    );
  }
  return totals;
}
