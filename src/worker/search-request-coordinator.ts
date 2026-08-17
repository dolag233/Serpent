/**
 * Keeps only the newest interactive search request for each library. The
 * Worker is single-threaded, so the coordinator is checked after yielding one
 * event-loop turn: a burst of renderer keystrokes can replace queued searches
 * before any of them touch SQLite.
 */
export class LatestSearchRequestCoordinator {
  readonly #latestByLane = new Map<string, string>();

  mark(libraryId: string, laneKey: string, requestId: string): void {
    this.#latestByLane.set(`${libraryId}\u0000${laneKey}`, requestId);
  }

  isLatest(libraryId: string, laneKey: string, requestId: string): boolean {
    const latest = this.#latestByLane.get(`${libraryId}\u0000${laneKey}`);
    return latest === undefined || latest === requestId;
  }

  clearIfLatest(libraryId: string, laneKey: string, requestId: string): void {
    const key = `${libraryId}\u0000${laneKey}`;
    if (this.#latestByLane.get(key) === requestId) {
      this.#latestByLane.delete(key);
    }
  }
}

/**
 * Parallel browse loads issue several asset.search commands for one library
 * (page, library count, and trash count). Count and ids-only queries need
 * independent cancellation lanes. Paginated summary windows share one
 * browse-window offset gets its own lane. Folder/search changes at the same
 * offset still coalesce, while independent viewport pages cannot cancel one
 * another during a masonry jump or a concurrent refresh.
 */
export function searchRequestLaneKey(input: {
  filters?: unknown;
  scope?: unknown;
  sort?: unknown;
  scopeMode?: boolean;
  idsOnly?: boolean;
  layoutOnly?: boolean;
  limit?: number | null;
  offset?: number;
  showIgnored?: boolean;
}): string {
  if (input.idsOnly) {
    return JSON.stringify({
      kind: "ids",
      filters: input.filters ?? null,
      scope: input.scope ?? null,
      showIgnored: input.showIgnored ?? false,
    });
  }
  if (input.layoutOnly) {
    return JSON.stringify({
      kind: "layout",
      filters: input.filters ?? null,
      scope: input.scope ?? null,
      sort: input.sort ?? null,
      showIgnored: input.showIgnored ?? false,
    });
  }
  const limit = input.limit ?? null;
  if (limit === 0 || limit === 1) {
    return JSON.stringify({
      kind: "count",
      filters: input.filters ?? null,
      scope: input.scope ?? null,
      showIgnored: input.showIgnored ?? false,
    });
  }
  if (input.scopeMode) {
    return JSON.stringify({
      kind: "scope-mode",
      filters: input.filters ?? null,
      scope: input.scope ?? null,
      sort: input.sort ?? null,
      showIgnored: input.showIgnored ?? false,
    });
  }
  return JSON.stringify({
    kind: "browse-window",
    offset: input.offset ?? 0,
    showIgnored: input.showIgnored ?? false,
  });
}
