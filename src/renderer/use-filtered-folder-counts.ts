import { useEffect, useMemo, useState } from "react";

import type { FilterClause } from "../shared/asset-types";
import type { SerpentLibraryApi } from "../shared/library-api";

export interface FilteredFolderCounts {
  all: number;
  root: number;
  byFolderId: ReadonlyMap<string, number>;
}

export interface UseFilteredFolderCountsOptions {
  api: Pick<SerpentLibraryApi, "listFilteredFolderCounts"> | null | undefined;
  libraryId: string | undefined;
  filters: FilterClause[] | undefined;
  showIgnored: boolean;
  enabled: boolean;
  refreshToken: number;
}

/** Only current, successful recursive counts may hide a folder. */
export function useFilteredFolderCounts({
  api,
  libraryId,
  filters,
  showIgnored,
  enabled,
  refreshToken,
}: UseFilteredFolderCountsOptions): FilteredFolderCounts | null {
  // Callers build clauses during render; equal contents must not restart IPC.
  const serializedFilters = JSON.stringify(filters ?? []);
  const request = useMemo(() => ({
    api,
    libraryId,
    filters: JSON.parse(serializedFilters) as FilterClause[],
    showIgnored,
    enabled,
    refreshToken,
  }), [api, libraryId, serializedFilters, showIgnored, enabled, refreshToken]);
  const [snapshot, setSnapshot] = useState<{
    request: typeof request;
    counts: FilteredFolderCounts;
  } | null>(null);

  useEffect(() => {
    const { api, libraryId, filters, showIgnored } = request;
    if (!api || !libraryId || !request.enabled || filters.length === 0) {
      return;
    }
    let cancelled = false;
    const loadCounts = async () => {
      try {
        const result = await api.listFilteredFolderCounts({ libraryId, filters, showIgnored });
        if (cancelled) return;
        setSnapshot(result.ok ? {
          request,
          counts: {
            all: result.value.all,
            root: result.value.root,
            byFolderId: new Map(result.value.folders.map((folder) => [folder.folderId, folder.count])),
          },
        } : null);
      } catch {
        if (!cancelled) setSnapshot(null);
      }
    };
    void loadCounts();
    return () => {
      cancelled = true;
    };
  }, [request]);

  // A new identity also covers leaving and re-entering identical filters.
  return snapshot?.request === request ? snapshot.counts : null;
}
