import { z } from 'zod';

/**
 * User accent color preference (REQ-THEME-005 / Serpent-lti3).
 * Drives `--accent` / `--accent-dark`; derived tokens use color-mix in CSS.
 */

export const ACCENT_PREF_KEY = 'serpent.accent-prefs.v1';

export const DEFAULT_ACCENT_HEX = '#3b82f6';

export const ACCENT_PRESET_HEX = [
  '#3b82f6',
  '#2563eb',
  '#8b5cf6',
  '#ec4899',
  '#f97316',
  '#22c55e',
  '#14b8a6',
  '#ef4444',
] as const;

export interface AccentPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Expected #RRGGBB hex color');

const accentPreferencesSchema = z.object({
  version: z.literal(1),
  accentHex: hexColorSchema,
});

export interface AccentPreferences {
  readonly version: 1;
  readonly accentHex: string;
}

export const DEFAULT_ACCENT_PREFERENCES: AccentPreferences = {
  version: 1,
  accentHex: DEFAULT_ACCENT_HEX,
};

function resolveStorage(
  storage?: AccentPreferencesStorage,
): AccentPreferencesStorage {
  if (storage) return storage;
  const ls = (globalThis as { localStorage?: AccentPreferencesStorage })
    .localStorage;
  if (!ls) {
    throw new Error(
      'AccentPreferences: no storage provided and localStorage is unavailable.',
    );
  }
  return ls;
}

export function normalizeAccentHex(value: string): string | null {
  const trimmed = value.trim();
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  const parsed = hexColorSchema.safeParse(withHash);
  return parsed.success ? parsed.data.toLowerCase() : null;
}

export function loadAccentPreferences(
  storage?: AccentPreferencesStorage,
): AccentPreferences {
  const store = resolveStorage(storage);
  const raw = store.getItem(ACCENT_PREF_KEY);
  if (!raw) return DEFAULT_ACCENT_PREFERENCES;
  try {
    const parsed = accentPreferencesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_ACCENT_PREFERENCES;
  } catch {
    return DEFAULT_ACCENT_PREFERENCES;
  }
}

export function saveAccentPreferences(
  preferences: AccentPreferences,
  storage?: AccentPreferencesStorage,
): void {
  const store = resolveStorage(storage);
  const parsed = accentPreferencesSchema.parse(preferences);
  store.setItem(ACCENT_PREF_KEY, JSON.stringify(parsed));
}

export function setStoredAccentHex(
  accentHex: string,
  storage?: AccentPreferencesStorage,
): AccentPreferences {
  const normalized = normalizeAccentHex(accentHex);
  if (!normalized) {
    throw new Error('Invalid accent hex color');
  }
  const next: AccentPreferences = { version: 1, accentHex: normalized };
  saveAccentPreferences(next, storage);
  return next;
}

/** Apply accent CSS variables on :root (light/dark blocks inherit via color-mix). */
export function applyAccentColor(accentHex: string): void {
  if (typeof document === 'undefined') return;
  const normalized = normalizeAccentHex(accentHex) ?? DEFAULT_ACCENT_HEX;
  const root = document.documentElement;
  root.style.setProperty('--accent', normalized);
  root.style.setProperty('--accent-dark', normalized);
}

export function resetAccentColor(): void {
  applyAccentColor(DEFAULT_ACCENT_HEX);
}
