import { z } from 'zod';

import type { AppLocale } from './types';

// ---------------------------------------------------------------------------
// Locale preference persistence (REQ-I18N-001)
//
// Clarification queue #11 still owns the *default* policy (follow system vs
// first-run picker). Until that lands, the stored default is zh-CN so the
// current Chinese UI and E2E selectors stay stable.
// ---------------------------------------------------------------------------

export type LocalePreference = AppLocale;

export interface LocalePreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const localeSchema = z.enum(['zh-CN', 'en']);

export const LOCALE_PREF_KEY = 'serpent.locale-prefs.v1';

export const DEFAULT_LOCALE: AppLocale = 'zh-CN';

const localePreferencesSchema = z.object({
  version: z.literal(1),
  locale: localeSchema,
});

export interface LocalePreferences {
  readonly version: 1;
  readonly locale: AppLocale;
}

export const DEFAULT_LOCALE_PREFERENCES: LocalePreferences = {
  version: 1,
  locale: DEFAULT_LOCALE,
};

function resolveStorage(
  storage?: LocalePreferencesStorage,
): LocalePreferencesStorage {
  if (storage) return storage;
  const ls = (globalThis as { localStorage?: LocalePreferencesStorage })
    .localStorage;
  if (!ls) {
    throw new Error(
      'LocalePreferences: no storage provided and globalThis.localStorage is not available.',
    );
  }
  return ls;
}

export function loadLocalePreferences(
  storage?: LocalePreferencesStorage,
): LocalePreferences {
  const store = resolveStorage(storage);
  const raw = store.getItem(LOCALE_PREF_KEY);
  if (!raw) return DEFAULT_LOCALE_PREFERENCES;
  try {
    const parsed = localePreferencesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_LOCALE_PREFERENCES;
  } catch {
    return DEFAULT_LOCALE_PREFERENCES;
  }
}

export function saveLocalePreferences(
  preferences: LocalePreferences,
  storage?: LocalePreferencesStorage,
): void {
  const store = resolveStorage(storage);
  const parsed = localePreferencesSchema.parse(preferences);
  store.setItem(LOCALE_PREF_KEY, JSON.stringify(parsed));
}

export function setStoredLocale(
  locale: AppLocale,
  storage?: LocalePreferencesStorage,
): LocalePreferences {
  const next: LocalePreferences = { version: 1, locale };
  saveLocalePreferences(next, storage);
  return next;
}
