import { z } from "zod";

/** Four stepped levels for the shared context-menu acrylic surface. */
export type MenuAcrylicLevel = 0 | 1 | 2 | 3;

export interface MenuAcrylicPreferences {
  readonly version: 1;
  readonly level: MenuAcrylicLevel;
}

export interface MenuAcrylicPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const MENU_ACRYLIC_PREF_KEY = "serpent.menu-acrylic-prefs.v1";
export const MENU_ACRYLIC_LEVEL_MIN = 0;
export const MENU_ACRYLIC_LEVEL_MAX = 3;

/** Preserve the current viewer-menu treatment as the default low level. */
export const DEFAULT_MENU_ACRYLIC_PREFERENCES: MenuAcrylicPreferences = {
  version: 1,
  level: 1,
};

const menuAcrylicLevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

const menuAcrylicPreferencesSchema = z.object({
  version: z.literal(1),
  level: menuAcrylicLevelSchema,
});

function resolveStorage(
  storage?: MenuAcrylicPreferencesStorage,
): MenuAcrylicPreferencesStorage {
  if (storage) return storage;
  const localStorage = (globalThis as {
    localStorage?: MenuAcrylicPreferencesStorage;
  }).localStorage;
  if (!localStorage) {
    throw new Error(
      "MenuAcrylicPreferences: no storage provided and localStorage is unavailable.",
    );
  }
  return localStorage;
}

export function clampMenuAcrylicLevel(value: number): MenuAcrylicLevel {
  if (!Number.isFinite(value)) return DEFAULT_MENU_ACRYLIC_PREFERENCES.level;
  const rounded = Math.round(value);
  if (rounded <= 0) return 0;
  if (rounded === 1) return 1;
  if (rounded === 2) return 2;
  return 3;
}

export function loadMenuAcrylicPreferences(
  storage?: MenuAcrylicPreferencesStorage,
): MenuAcrylicPreferences {
  const store = resolveStorage(storage);
  const raw = store.getItem(MENU_ACRYLIC_PREF_KEY);
  if (!raw) return DEFAULT_MENU_ACRYLIC_PREFERENCES;
  try {
    const parsed = menuAcrylicPreferencesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_MENU_ACRYLIC_PREFERENCES;
  } catch {
    return DEFAULT_MENU_ACRYLIC_PREFERENCES;
  }
}

export function saveMenuAcrylicPreferences(
  preferences: MenuAcrylicPreferences,
  storage?: MenuAcrylicPreferencesStorage,
): void {
  const store = resolveStorage(storage);
  const cleaned: MenuAcrylicPreferences = {
    version: 1,
    level: menuAcrylicLevelSchema.parse(preferences.level),
  };
  store.setItem(MENU_ACRYLIC_PREF_KEY, JSON.stringify(cleaned));
}

export function setStoredMenuAcrylicLevel(
  level: MenuAcrylicLevel,
  storage?: MenuAcrylicPreferencesStorage,
): MenuAcrylicPreferences {
  const next: MenuAcrylicPreferences = { version: 1, level };
  saveMenuAcrylicPreferences(next, storage);
  return next;
}

/** Apply the setting before the first paint and whenever it changes. */
export function applyMenuAcrylicPreferences(
  preferences: MenuAcrylicPreferences,
): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.menuAcrylic = String(preferences.level);
}
