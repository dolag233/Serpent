/** Unknown counts keep navigation available; only confirmed zero matches hide a folder. */
export function filteredFolderBrowseEntries<T extends { folderId: string }>(
  entries: T[],
  counts: { byFolderId: ReadonlyMap<string, number> } | null,
): T[] {
  if (counts === null) return entries;
  return entries.filter((entry) => (counts.byFolderId.get(entry.folderId) ?? 0) > 0);
}
