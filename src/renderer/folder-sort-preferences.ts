import { z } from "zod";

import type {
  FolderTreeSortMode,
  FolderTreeSortOrder,
} from "./unified-directory-nav";

// ---------------------------------------------------------------------------
// Sidebar folder sort preference (Serpent-db1835)
// ---------------------------------------------------------------------------

export type FolderSortOrder = FolderTreeSortOrder;

export interface FolderSortPreferences {
  readonly version: 1;
  readonly mode: FolderTreeSortMode;
  readonly order: FolderSortOrder;
}

export interface FolderSortPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const folderSortPreferencesSchema = z.object({
  version: z.literal(1),
  mode: z.enum(["name", "created", "count"]),
  // Optional for data written before the direction UI existed; load defaults
  // it to asc so a persisted `{ mode }` value keeps sorting instead of resetting.
  order: z.enum(["asc", "desc"]).optional(),
});

export const FOLDER_SORT_PREF_KEY = "serpent.folder-sort-prefs.v1";

export const DEFAULT_FOLDER_SORT_PREFERENCES: FolderSortPreferences = {
  version: 1,
  mode: "name",
  order: "asc",
};

function resolveStorage(
  storage?: FolderSortPreferencesStorage,
): FolderSortPreferencesStorage {
  if (storage) return storage;
  const ls = (globalThis as { localStorage?: FolderSortPreferencesStorage })
    .localStorage;
  if (!ls) {
    throw new Error(
      "FolderSortPreferences: no storage provided and globalThis.localStorage is not available.",
    );
  }
  return ls;
}

export function loadFolderSortPreferences(
  storage?: FolderSortPreferencesStorage,
): FolderSortPreferences {
  try {
    const raw = resolveStorage(storage).getItem(FOLDER_SORT_PREF_KEY);
    if (!raw) return DEFAULT_FOLDER_SORT_PREFERENCES;
    const parsed = folderSortPreferencesSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return DEFAULT_FOLDER_SORT_PREFERENCES;
    return { version: 1, mode: parsed.data.mode, order: parsed.data.order ?? "asc" };
  } catch {
    return DEFAULT_FOLDER_SORT_PREFERENCES;
  }
}

export function saveFolderSortPreferences(
  prefs: FolderSortPreferences,
  storage?: FolderSortPreferencesStorage,
): void {
  const parsed = folderSortPreferencesSchema.parse(prefs);
  resolveStorage(storage).setItem(FOLDER_SORT_PREF_KEY, JSON.stringify(parsed));
}

export function withFolderSort(
  prefs: FolderSortPreferences,
  next: Partial<Pick<FolderSortPreferences, "mode" | "order">>,
): FolderSortPreferences {
  return { ...prefs, ...next };
}