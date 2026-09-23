/**
 * Recent library search queries, stored per library in the renderer.
 * Only the settled query is recorded; keystroke prefixes are not.
 */

/** Enough settled queries to fill four wrapped rows of short chips. */
export const SEARCH_HISTORY_LIMIT = 24;
export const SEARCH_HISTORY_ROW_LIMIT = 4;
export const SEARCH_HISTORY_STORAGE_KEY = "serpent.search-history.v1";

export type SearchHistoryStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

type SearchHistoryStore = Record<string, string[]>;

function readStore(storage: SearchHistoryStorage): SearchHistoryStore {
  try {
    const parsed = JSON.parse(storage.getItem(SEARCH_HISTORY_STORAGE_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const store: SearchHistoryStore = {};
    for (const [libraryId, queries] of Object.entries(parsed)) {
      if (!libraryId || !Array.isArray(queries)) continue;
      const cleaned = queries.filter(
        (query): query is string => typeof query === "string" && query.trim().length > 0,
      );
      if (cleaned.length > 0) store[libraryId] = cleaned.slice(0, SEARCH_HISTORY_LIMIT);
    }
    return store;
  } catch {
    return {};
  }
}

function writeStore(storage: SearchHistoryStorage, store: SearchHistoryStore): void {
  try {
    storage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // localStorage may be unavailable or full. Search still runs.
  }
}

export function readSearchHistory(
  storage: SearchHistoryStorage,
  libraryId: string,
): string[] {
  return readStore(storage)[libraryId] ?? [];
}

/** Move `query` to the front of this library's history. Empty queries are ignored. */
export function rememberSearchQuery(
  storage: SearchHistoryStorage,
  libraryId: string,
  query: string,
): string[] {
  const trimmed = query.trim();
  if (!libraryId || !trimmed) return readSearchHistory(storage, libraryId);
  const store = readStore(storage);
  const previous = store[libraryId] ?? [];
  const next = [
    trimmed,
    ...previous.filter((entry) => entry.toLocaleLowerCase() !== trimmed.toLocaleLowerCase()),
  ].slice(0, SEARCH_HISTORY_LIMIT);
  store[libraryId] = next;
  writeStore(storage, store);
  return next;
}

export function clearSearchHistory(
  storage: SearchHistoryStorage,
  libraryId: string,
): void {
  const store = readStore(storage);
  delete store[libraryId];
  writeStore(storage, store);
}

/** Empty query shows the full list. A typed query keeps entries that contain it. */
export function filterSearchHistory(
  history: readonly string[],
  query: string,
): string[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...history];
  return history.filter((entry) => entry.toLocaleLowerCase().includes(needle));
}

/**
 * How many chips fit in `rowLimit` wrapped rows, using each chip's offsetTop.
 * The first chip that starts a fifth row is excluded.
 */
export function visibleHistoryCountByOffset(
  offsetTops: readonly number[],
  rowLimit = SEARCH_HISTORY_ROW_LIMIT,
): number {
  if (offsetTops.length === 0 || rowLimit <= 0) return 0;
  let rows = 1;
  let lastTop = offsetTops[0] ?? 0;
  for (let index = 0; index < offsetTops.length; index += 1) {
    const top = offsetTops[index] ?? lastTop;
    if (top > lastTop + 1) {
      rows += 1;
      lastTop = top;
      if (rows > rowLimit) return index;
    }
  }
  return offsetTops.length;
}

export function readVisibleSearchHistoryCount(
  rowLimit = SEARCH_HISTORY_ROW_LIMIT,
): number | null {
  if (typeof document === "undefined") return null;
  const chips = document.querySelectorAll<HTMLElement>("[data-search-history-chip]");
  if (chips.length === 0) return null;
  return visibleHistoryCountByOffset(
    [...chips].map((chip) => chip.offsetTop),
    rowLimit,
  );
}

export function moveSearchHistoryIndex(
  current: number,
  count: number,
  direction: "next" | "previous",
): number {
  if (count <= 0) return -1;
  if (direction === "next") {
    if (current < 0) return 0;
    return Math.min(current + 1, count - 1);
  }
  if (current <= 0) return -1;
  return current - 1;
}
