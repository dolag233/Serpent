import { z } from 'zod';

import {
  ACCENT_PRESET_HEX,
  normalizeAccentHex,
} from './accent-preferences';
import type { ThemePreferencesStorage } from './theme-preferences';

/**
 * Quick theme-color choices are intentionally separate from the advanced
 * semantic color editor. They provide one stable accent that can be paired
 * with any theme profile without replacing the profile's surface palette.
 */
export const THEME_ACCENT_PREF_KEY = 'serpent.theme-accent.v1';

export const THEME_ACCENT_PRESETS = [
  { id: 'blue', hex: ACCENT_PRESET_HEX[0], labelKey: 'settings.themeAccentBlue' },
  { id: 'indigo', hex: ACCENT_PRESET_HEX[1], labelKey: 'settings.themeAccentIndigo' },
  { id: 'purple', hex: ACCENT_PRESET_HEX[2], labelKey: 'settings.themeAccentPurple' },
  { id: 'pink', hex: ACCENT_PRESET_HEX[3], labelKey: 'settings.themeAccentPink' },
  { id: 'orange', hex: ACCENT_PRESET_HEX[4], labelKey: 'settings.themeAccentOrange' },
  { id: 'green', hex: ACCENT_PRESET_HEX[5], labelKey: 'settings.themeAccentGreen' },
  { id: 'teal', hex: ACCENT_PRESET_HEX[6], labelKey: 'settings.themeAccentTeal' },
  { id: 'red', hex: ACCENT_PRESET_HEX[7], labelKey: 'settings.themeAccentRed' },
] as const;

export type ThemeAccentPresetId = (typeof THEME_ACCENT_PRESETS)[number]['id'];

const themeAccentPreferencesSchema = z.object({
  version: z.literal(1),
  accentHex: z.string().regex(/^#[0-9a-f]{6}$/iu),
});

function resolveStorage(storage?: ThemePreferencesStorage): ThemePreferencesStorage {
  if (storage) return storage;
  const localStorage = (globalThis as { localStorage?: ThemePreferencesStorage })
    .localStorage;
  if (!localStorage) {
    throw new Error(
      'ThemeAccentPreferences: no storage provided and localStorage is unavailable.',
    );
  }
  return localStorage;
}

export function loadThemeAccent(
  storage?: ThemePreferencesStorage,
): string | null {
  try {
    const raw = resolveStorage(storage).getItem(THEME_ACCENT_PREF_KEY);
    if (!raw) return null;
    const parsed = themeAccentPreferencesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? normalizeAccentHex(parsed.data.accentHex) : null;
  } catch {
    return null;
  }
}

export function saveThemeAccent(
  accentHex: string,
  storage?: ThemePreferencesStorage,
): string {
  const normalized = normalizeAccentHex(accentHex);
  if (!normalized) throw new Error('Invalid theme accent color');
  const parsed = themeAccentPreferencesSchema.parse({
    version: 1,
    accentHex: normalized,
  });
  resolveStorage(storage).setItem(THEME_ACCENT_PREF_KEY, JSON.stringify(parsed));
  return normalized;
}

export function themeAccentPresetByHex(
  accentHex: string | null,
): ThemeAccentPresetId | null {
  const normalized = accentHex === null ? null : normalizeAccentHex(accentHex);
  if (!normalized) return null;
  return THEME_ACCENT_PRESETS.find((preset) => preset.hex === normalized)?.id ?? null;
}
