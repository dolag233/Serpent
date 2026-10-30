export interface FilteredFolderCountSnapshot {
  requestKey: { readonly query: string };
  all: number;
  root: number;
  byFolderId: ReadonlyMap<string, number>;
}

/** A previous library/filter response cannot decide current folder visibility. */
export function currentFilteredFolderCounts(
  snapshot: FilteredFolderCountSnapshot | null,
  requestKey: FilteredFolderCountSnapshot["requestKey"],
): FilteredFolderCountSnapshot | null {
  return snapshot?.requestKey === requestKey ? snapshot : null;
}

/** Keep navigation available until a successful count for this view is ready. */
export function favoriteFolderBrowseEntries<T extends { folderId: string }>(
  entries: T[],
  favoritesOnly: boolean,
  counts: FilteredFolderCountSnapshot | null,
): T[] {
  if (!favoritesOnly || counts === null) return entries;
  return entries.filter((entry) => (counts.byFolderId.get(entry.folderId) ?? 0) > 0);
}
