import { z } from 'zod';

import { sortDefinitionSchema, type SortDefinition } from '../shared/asset-types';
import {
  DEFAULT_SORT_FIELD,
  DEFAULT_SORT_ORDER,
} from './SortModeControl';

// ---------------------------------------------------------------------------
// Browse sort preferences — global across libraries and browse scopes.
// Filters stay ephemeral; sort is a stable viewing preference (REQ-SORT-009).
// ---------------------------------------------------------------------------

export interface BrowseSortPreferences {
  readonly version: 1;
  readonly field: SortDefinition['field'];
  readonly order: SortDefinition['order'];
}

export interface BrowseSortPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const BROWSE_SORT_PREF_KEY = 'serpent.browse-sort-prefs.v1';

export const DEFAULT_BROWSE_SORT_PREFERENCES: BrowseSortPreferences = {
  version: 1,
  field: DEFAULT_SORT_FIELD,
  order: DEFAULT_SORT_ORDER,
};

const browseSortPreferencesSchema = z.object({
  version: z.literal(1),
  field: sortDefinitionSchema.shape.field,
  order: sortDefinitionSchema.shape.order,
});

function resolveStorage(
  storage?: BrowseSortPreferencesStorage,
): BrowseSortPreferencesStorage {
  if (storage) return storage;
  const ls = (globalThis as { localStorage?: BrowseSortPreferencesStorage })
    .localStorage;
  if (!ls) {
    throw new Error(
      'BrowseSortPreferences: no storage provided and globalThis.localStorage is not available.',
    );
  }
  return ls;
}

export function loadBrowseSortPreferences(
  storage?: BrowseSortPreferencesStorage,
): BrowseSortPreferences {
  const s = resolveStorage(storage);
  const raw = s.getItem(BROWSE_SORT_PREF_KEY);
  if (raw === null) return DEFAULT_BROWSE_SORT_PREFERENCES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_BROWSE_SORT_PREFERENCES;
  }
  const result = browseSortPreferencesSchema.safeParse(parsed);
  return result.success ? result.data : DEFAULT_BROWSE_SORT_PREFERENCES;
}

export function saveBrowseSortPreferences(
  prefs: BrowseSortPreferences,
  storage?: BrowseSortPreferencesStorage,
): void {
  const s = resolveStorage(storage);
  const cleaned = browseSortPreferencesSchema.parse({
    version: 1,
    field: prefs.field,
    order: prefs.order,
  });
  s.setItem(BROWSE_SORT_PREF_KEY, JSON.stringify(cleaned));
}
