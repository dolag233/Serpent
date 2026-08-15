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
 * (page, library count, and trash count). They need independent cancellation
 * lanes, while successive queries for the same page lane should supersede
 * each other. The query text is deliberately excluded from the lane key.
 */
export function searchRequestLaneKey(input: {
  filters?: unknown;
  scope?: unknown;
  sort?: unknown;
  scopeMode?: boolean;
  idsOnly?: boolean;
  limit?: number | null;
  offset?: number;
  showIgnored?: boolean;
}): string {
  return JSON.stringify({
    filters: input.filters ?? null,
    scope: input.scope ?? null,
    sort: input.sort ?? null,
    scopeMode: input.scopeMode ?? false,
    idsOnly: input.idsOnly ?? false,
    limit: input.limit ?? null,
    offset: input.offset ?? 0,
    showIgnored: input.showIgnored ?? false,
  });
}
