import { z } from 'zod';

/**
 * Theme preference persistence (REQ-THEME-001).
 *
 * Clarification queue #11 still owns the *default* policy (follow system vs
 * keep dark). Until that lands, the stored default is `dark` so the current
 * dark UI and E2E visual baselines stay stable.
 */

export type ThemePreference = 'light' | 'dark' | 'system';

export type ResolvedTheme = 'light' | 'dark';

export interface ThemePreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const themePreferenceSchema = z.enum(['light', 'dark', 'system']);

export const THEME_PREF_KEY = 'serpent.theme-prefs.v1';

export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'dark';

const themePreferencesSchema = z.object({
  version: z.literal(1),
  theme: themePreferenceSchema,
});

export interface ThemePreferences {
  readonly version: 1;
  readonly theme: ThemePreference;
}

export const DEFAULT_THEME_PREFERENCES: ThemePreferences = {
  version: 1,
  theme: DEFAULT_THEME_PREFERENCE,
};

function resolveStorage(
  storage?: ThemePreferencesStorage,
): ThemePreferencesStorage {
  if (storage) return storage;
  const ls = (globalThis as { localStorage?: ThemePreferencesStorage })
    .localStorage;
  if (!ls) {
    throw new Error(
      'ThemePreferences: no storage provided and globalThis.localStorage is not available.',
    );
  }
  return ls;
}

export function loadThemePreferences(
  storage?: ThemePreferencesStorage,
): ThemePreferences {
  const store = resolveStorage(storage);
  const raw = store.getItem(THEME_PREF_KEY);
  if (!raw) return DEFAULT_THEME_PREFERENCES;
  try {
    const parsed = themePreferencesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_THEME_PREFERENCES;
  } catch {
    return DEFAULT_THEME_PREFERENCES;
  }
}

export function saveThemePreferences(
  preferences: ThemePreferences,
  storage?: ThemePreferencesStorage,
): void {
  const store = resolveStorage(storage);
  const parsed = themePreferencesSchema.parse(preferences);
  store.setItem(THEME_PREF_KEY, JSON.stringify(parsed));
}

export function setStoredTheme(
  theme: ThemePreference,
  storage?: ThemePreferencesStorage,
): ThemePreferences {
  const next: ThemePreferences = { version: 1, theme };
  saveThemePreferences(next, storage);
  return next;
}

export function readSystemTheme(
  matchMedia: (query: string) => { matches: boolean } = globalThis.matchMedia?.bind(
    globalThis,
  ) ?? (() => ({ matches: false })),
): ResolvedTheme {
  try {
    return matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  } catch {
    return 'dark';
  }
}

export function resolveEffectiveTheme(
  preference: ThemePreference,
  systemTheme: ResolvedTheme = readSystemTheme(),
): ResolvedTheme {
  if (preference === 'system') return systemTheme;
  return preference;
}

export function applyResolvedTheme(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}
