import { z } from 'zod';

import type { AppLocale } from './types';

/**
 * Locale preference persistence (REQ-I18N-001).
 *
 * Default preference is `system` (follow OS language). Effective locale is
 * resolved to `zh-CN` or `en`. E2E injects `__SERPENT_E2E_LOCALE__` via preload
 * so Chinese selectors stay stable when preference is still `system`.
 */

export type LocalePreference = 'system' | AppLocale;

export interface LocalePreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const localePreferenceSchema = z.enum(['system', 'zh-CN', 'en']);
const appLocaleSchema = z.enum(['zh-CN', 'en']);

export const LOCALE_PREF_KEY = 'serpent.locale-prefs.v1';

/** Fallback catalog / translator fallback when a key is missing. */
export const DEFAULT_LOCALE: AppLocale = 'zh-CN';

/** First-run / empty-storage preference (product: follow system). */
export const DEFAULT_LOCALE_PREFERENCE: LocalePreference = 'system';

const localePreferencesSchema = z.object({
  version: z.literal(1),
  locale: localePreferenceSchema,
});

export interface LocalePreferences {
  readonly version: 1;
  readonly locale: LocalePreference;
}

export const DEFAULT_LOCALE_PREFERENCES: LocalePreferences = {
  version: 1,
  locale: DEFAULT_LOCALE_PREFERENCE,
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

export function readSystemLocale(
  languages: readonly string[] = typeof navigator !== 'undefined'
    ? (navigator.languages?.length
        ? navigator.languages
        : [navigator.language])
    : ['en'],
): AppLocale {
  const e2eLocale = (
    globalThis as { __SERPENT_E2E_LOCALE__?: string }
  ).__SERPENT_E2E_LOCALE__;
  if (e2eLocale === 'zh-CN' || e2eLocale === 'en') {
    return e2eLocale;
  }

  for (const raw of languages) {
    const tag = raw.toLowerCase();
    if (tag === 'zh' || tag.startsWith('zh-')) return 'zh-CN';
  }
  return 'en';
}

export function resolveEffectiveLocale(
  preference: LocalePreference,
  systemLocale: AppLocale = readSystemLocale(),
): AppLocale {
  if (preference === 'system') return systemLocale;
  return preference;
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
  locale: LocalePreference,
  storage?: LocalePreferencesStorage,
): LocalePreferences {
  const next: LocalePreferences = { version: 1, locale };
  saveLocalePreferences(next, storage);
  return next;
}

export { appLocaleSchema };
