import { z } from "zod";

// ---------------------------------------------------------------------------
// Tag filter usage recency (REQ-FILTER-020)
//
// Tracks which tag *names* the user has recently applied through the
// discovery tag filter (distinct from Inspector "recently created/assigned"
// tag suggestions in tag-suggestions.ts, and from tag creation time — this is
// purely "recently used as a filter value"). The list is consulted by
// tag-filter-suggestions.ts to build the picker's default "recent" section.
//
// Persisted globally rather than scoped per-library: a recorded name that no
// longer exists in the current library's tag list (deleted tag, different
// library) is simply filtered out when the default section is built, so
// staleness is self-correcting without needing library-keyed storage.
// ---------------------------------------------------------------------------

export interface TagFilterRecency {
  readonly version: 1;
  /** Most-recently-used first, deduplicated. */
  readonly names: readonly string[];
}

export interface TagFilterRecencyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const TAG_FILTER_RECENCY_KEY = "serpent.tag-filter-recency.v1";
export const TAG_FILTER_RECENCY_LIMIT = 8;

export const DEFAULT_TAG_FILTER_RECENCY: TagFilterRecency = {
  version: 1,
  names: [],
};

const tagFilterRecencySchema = z.object({
  version: z.literal(1),
  names: z.array(z.string()),
});

function resolveStorage(
  storage?: TagFilterRecencyStorage,
): TagFilterRecencyStorage {
  if (storage) return storage;
  const ls = (globalThis as { localStorage?: TagFilterRecencyStorage })
    .localStorage;
  if (!ls) {
    throw new Error(
      "TagFilterRecency: no storage provided and globalThis.localStorage is not available.",
    );
  }
  return ls;
}

/**
 * Load tag filter recency from storage. Returns the default (empty) value
 * when absent or when the stored value fails Zod validation.
 */
export function loadTagFilterRecency(
  storage?: TagFilterRecencyStorage,
): TagFilterRecency {
  const s = resolveStorage(storage);
  const raw = s.getItem(TAG_FILTER_RECENCY_KEY);
  if (raw === null) return DEFAULT_TAG_FILTER_RECENCY;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_TAG_FILTER_RECENCY;
  }
  const result = tagFilterRecencySchema.safeParse(parsed);
  return result.success ? result.data : DEFAULT_TAG_FILTER_RECENCY;
}

export function saveTagFilterRecency(
  recency: TagFilterRecency,
  storage?: TagFilterRecencyStorage,
): void {
  const s = resolveStorage(storage);
  s.setItem(TAG_FILTER_RECENCY_KEY, JSON.stringify(recency));
}

/**
 * Returns a new recency record with `name` moved to the front, deduplicated,
 * and capped at `TAG_FILTER_RECENCY_LIMIT`.
 */
export function withTagFilterUsed(
  recency: TagFilterRecency,
  name: string,
): TagFilterRecency {
  const rest = recency.names.filter((existing) => existing !== name);
  return {
    version: 1,
    names: [name, ...rest].slice(0, TAG_FILTER_RECENCY_LIMIT),
  };
}
