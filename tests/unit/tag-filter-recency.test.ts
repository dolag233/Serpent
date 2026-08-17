import { describe, expect, it } from "vitest";

import {
  DEFAULT_TAG_FILTER_RECENCY,
  TAG_FILTER_RECENCY_LIMIT,
  loadTagFilterRecency,
  saveTagFilterRecency,
  withTagFilterUsed,
  type TagFilterRecencyStorage,
} from "../../src/renderer/tag-filter-recency";

function memoryStorage(
  initial: Record<string, string> = {},
): TagFilterRecencyStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

describe("tag-filter-recency (REQ-FILTER-020)", () => {
  it("defaults to an empty history", () => {
    expect(DEFAULT_TAG_FILTER_RECENCY).toEqual({ version: 1, names: [] });
  });

  it("moves a used name to the front", () => {
    let recency = withTagFilterUsed(DEFAULT_TAG_FILTER_RECENCY, "warm");
    recency = withTagFilterUsed(recency, "wood");
    recency = withTagFilterUsed(recency, "warm");
    expect(recency.names).toEqual(["warm", "wood"]);
  });

  it("deduplicates repeated use without growing the list", () => {
    let recency = withTagFilterUsed(DEFAULT_TAG_FILTER_RECENCY, "warm");
    recency = withTagFilterUsed(recency, "warm");
    expect(recency.names).toEqual(["warm"]);
  });

  it("caps the history at TAG_FILTER_RECENCY_LIMIT", () => {
    let recency = DEFAULT_TAG_FILTER_RECENCY;
    for (let i = 0; i < TAG_FILTER_RECENCY_LIMIT + 3; i += 1) {
      recency = withTagFilterUsed(recency, `tag-${i}`);
    }
    expect(recency.names.length).toBe(TAG_FILTER_RECENCY_LIMIT);
    expect(recency.names[0]).toBe(`tag-${TAG_FILTER_RECENCY_LIMIT + 2}`);
  });

  it("persists and reloads through injected storage", () => {
    const storage = memoryStorage();
    const recency = withTagFilterUsed(DEFAULT_TAG_FILTER_RECENCY, "warm");
    saveTagFilterRecency(recency, storage);
    expect(loadTagFilterRecency(storage)).toEqual(recency);
  });

  it("falls back to the default on missing or corrupt storage", () => {
    expect(loadTagFilterRecency(memoryStorage())).toEqual(
      DEFAULT_TAG_FILTER_RECENCY,
    );
    expect(
      loadTagFilterRecency(
        memoryStorage({ "serpent.tag-filter-recency.v1": "{not-json" }),
      ),
    ).toEqual(DEFAULT_TAG_FILTER_RECENCY);
    expect(
      loadTagFilterRecency(
        memoryStorage({
          "serpent.tag-filter-recency.v1": JSON.stringify({ version: 2 }),
        }),
      ),
    ).toEqual(DEFAULT_TAG_FILTER_RECENCY);
  });
});
