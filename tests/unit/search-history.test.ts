import { describe, expect, it } from "vitest";

import {
  SEARCH_HISTORY_LIMIT,
  clearSearchHistory,
  filterSearchHistory,
  moveSearchHistoryIndex,
  readSearchHistory,
  rememberSearchQuery,
  visibleHistoryCountByOffset,
  type SearchHistoryStorage,
} from "../../src/renderer/search-history";

function memoryStorage(): SearchHistoryStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe("search history", () => {
  it("keeps the latest settled query first and drops empty text", () => {
    const storage = memoryStorage();
    rememberSearchQuery(storage, "lib-a", "  hero  ");
    rememberSearchQuery(storage, "lib-a", "");
    const next = rememberSearchQuery(storage, "lib-a", "Hero");
    expect(next).toEqual(["Hero"]);
    expect(readSearchHistory(storage, "lib-a")).toEqual(["Hero"]);
    expect(readSearchHistory(storage, "lib-b")).toEqual([]);
  });

  it("filters by the text already in the field", () => {
    expect(filterSearchHistory(["name:hero", "tag:sketch", "hero concept"], "hero"))
      .toEqual(["name:hero", "hero concept"]);
    expect(filterSearchHistory(["name:hero"], "   ")).toEqual(["name:hero"]);
  });

  it("moves the highlight without leaving the list", () => {
    expect(moveSearchHistoryIndex(-1, 3, "next")).toBe(0);
    expect(moveSearchHistoryIndex(2, 3, "next")).toBe(2);
    expect(moveSearchHistoryIndex(0, 3, "previous")).toBe(-1);
    expect(moveSearchHistoryIndex(2, 3, "previous")).toBe(1);
  });

  it("keeps only the newest queries up to the stored cap", () => {
    const storage = memoryStorage();
    for (let index = 0; index < SEARCH_HISTORY_LIMIT + 2; index += 1) {
      rememberSearchQuery(storage, "lib-a", `query-${index}`);
    }
    const history = readSearchHistory(storage, "lib-a");
    expect(history).toHaveLength(SEARCH_HISTORY_LIMIT);
    expect(history[0]).toBe(`query-${SEARCH_HISTORY_LIMIT + 1}`);
  });

  it("stops at the fourth wrapped row", () => {
    const tops = [0, 0, 0, 28, 28, 56, 56, 84, 84, 112];
    expect(visibleHistoryCountByOffset(tops)).toBe(9);
    expect(visibleHistoryCountByOffset([10, 10, 38])).toBe(3);
  });

  it("clears only the current library", () => {
    const storage = memoryStorage();
    rememberSearchQuery(storage, "lib-a", "one");
    rememberSearchQuery(storage, "lib-b", "two");
    clearSearchHistory(storage, "lib-a");
    expect(readSearchHistory(storage, "lib-a")).toEqual([]);
    expect(readSearchHistory(storage, "lib-b")).toEqual(["two"]);
  });
});
