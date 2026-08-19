import { z } from "zod";

// ---------------------------------------------------------------------------
// Nav tree collapse preferences (CU-D2 / Serpent-5n5)
// ---------------------------------------------------------------------------

export interface NavTreePreferences {
  readonly version: 1;
  /** Folder ids whose children are hidden. Empty = fully expanded (legacy). */
  readonly collapsedFolderIds: readonly string[];
  /**
   * Collection ids whose child collections are hidden (Serpent-c42eb1).
   * Optional so v1 data written before collections could collapse loads fine.
   */
  readonly collapsedCollectionIds?: readonly string[];
}

export interface NavTreePreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const navTreePreferencesSchema = z.object({
  version: z.literal(1),
  collapsedFolderIds: z.array(z.string().min(1)).max(2000),
  collapsedCollectionIds: z.array(z.string().min(1)).max(2000).optional(),
});

export const NAV_TREE_PREF_KEY = "serpent.nav-tree-prefs.v1";

export const DEFAULT_NAV_TREE_PREFERENCES: NavTreePreferences = {
  version: 1,
  collapsedFolderIds: [],
  collapsedCollectionIds: [],
};

function resolveStorage(
  storage?: NavTreePreferencesStorage,
): NavTreePreferencesStorage {
  if (storage) return storage;
  const ls = (globalThis as { localStorage?: NavTreePreferencesStorage })
    .localStorage;
  if (!ls) {
    throw new Error(
      "NavTreePreferences: no storage provided and globalThis.localStorage is not available.",
    );
  }
  return ls;
}

export function loadNavTreePreferences(
  storage?: NavTreePreferencesStorage,
): NavTreePreferences {
  try {
    const raw = resolveStorage(storage).getItem(NAV_TREE_PREF_KEY);
    if (!raw) return DEFAULT_NAV_TREE_PREFERENCES;
    const parsed = navTreePreferencesSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return DEFAULT_NAV_TREE_PREFERENCES;
    return parsed.data;
  } catch {
    return DEFAULT_NAV_TREE_PREFERENCES;
  }
}

export function saveNavTreePreferences(
  prefs: NavTreePreferences,
  storage?: NavTreePreferencesStorage,
): void {
  const parsed = navTreePreferencesSchema.parse(prefs);
  resolveStorage(storage).setItem(NAV_TREE_PREF_KEY, JSON.stringify(parsed));
}

export function withCollapsedFolderIds(
  prefs: NavTreePreferences,
  collapsedFolderIds: readonly string[],
): NavTreePreferences {
  return { ...prefs, collapsedFolderIds: [...collapsedFolderIds] };
}

export function withCollapsedCollectionIds(
  prefs: NavTreePreferences,
  collapsedCollectionIds: readonly string[],
): NavTreePreferences {
  return { ...prefs, collapsedCollectionIds: [...collapsedCollectionIds] };
}
