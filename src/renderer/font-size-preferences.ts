import { z } from "zod";

export const FONT_SIZE_PREFERENCES_KEY = "serpent.font-size-preferences.v1";
export const FONT_SIZE_PREFERENCES_VERSION = 1;

export const FONT_SIZE_OPTIONS = [
  "compact",
  "default",
  "comfortable",
  "large",
] as const;
export type FontSizePreference = (typeof FONT_SIZE_OPTIONS)[number];

export const FONT_SIZE_SCALES: Readonly<Record<FontSizePreference, number>> = {
  compact: 0.94,
  default: 1,
  comfortable: 1.06,
  large: 1.12,
};

export const FONT_SIZE_INDEX_MIN = 0;
export const FONT_SIZE_INDEX_MAX = FONT_SIZE_OPTIONS.length - 1;

export function fontSizePreferenceToIndex(preference: FontSizePreference): number {
  return FONT_SIZE_OPTIONS.indexOf(preference);
}

export function fontSizePreferenceFromIndex(value: number): FontSizePreference {
  if (!Number.isFinite(value)) return "default";
  const index = Math.min(
    FONT_SIZE_INDEX_MAX,
    Math.max(FONT_SIZE_INDEX_MIN, Math.round(value)),
  );
  return FONT_SIZE_OPTIONS[index] ?? "default";
}

export const fontSizePreferencesSchema = z.strictObject({
  version: z.literal(FONT_SIZE_PREFERENCES_VERSION),
  preference: z.enum(FONT_SIZE_OPTIONS),
});

export type FontSizePreferences = z.infer<typeof fontSizePreferencesSchema>;
export type FontSizePreferencesStorage = Pick<Storage, "getItem" | "setItem">;

export const DEFAULT_FONT_SIZE_PREFERENCES: FontSizePreferences = {
  version: FONT_SIZE_PREFERENCES_VERSION,
  preference: "default",
};

function storageOrUndefined(
  storage?: FontSizePreferencesStorage,
): FontSizePreferencesStorage | undefined {
  if (storage) return storage;
  return (globalThis as { localStorage?: FontSizePreferencesStorage }).localStorage;
}

export function parseFontSizePreferences(raw: string | null): FontSizePreferences {
  if (!raw) return DEFAULT_FONT_SIZE_PREFERENCES;
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = fontSizePreferencesSchema.safeParse(parsed);
    return result.success ? result.data : DEFAULT_FONT_SIZE_PREFERENCES;
  } catch {
    return DEFAULT_FONT_SIZE_PREFERENCES;
  }
}

export function loadFontSizePreferences(
  storage?: FontSizePreferencesStorage,
): FontSizePreferences {
  const source = storageOrUndefined(storage);
  if (!source) return DEFAULT_FONT_SIZE_PREFERENCES;
  try {
    return parseFontSizePreferences(source.getItem(FONT_SIZE_PREFERENCES_KEY));
  } catch {
    return DEFAULT_FONT_SIZE_PREFERENCES;
  }
}

export function saveFontSizePreferences(
  preferences: FontSizePreferences,
  storage?: FontSizePreferencesStorage,
): boolean {
  const source = storageOrUndefined(storage);
  if (!source) return false;
  try {
    source.setItem(FONT_SIZE_PREFERENCES_KEY, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}

export function applyFontSizePreferences(
  preferences: FontSizePreferences,
  root: HTMLElement | undefined =
    typeof document === "undefined" ? undefined : document.documentElement,
): void {
  if (!root) return;
  root.dataset.fontSize = preferences.preference;
  root.style.setProperty(
    "--ui-font-scale",
    String(FONT_SIZE_SCALES[preferences.preference]),
  );
}

export function setStoredFontSizePreference(
  preference: FontSizePreference,
  storage?: FontSizePreferencesStorage,
): FontSizePreferences {
  const next: FontSizePreferences = {
    version: FONT_SIZE_PREFERENCES_VERSION,
    preference,
  };
  saveFontSizePreferences(next, storage);
  return next;
}
