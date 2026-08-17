import { z } from "zod";

/**
 * Hierarchical elevation (Serpent-zcyg).
 *
 * Four stepped levels (0–3). Level 0 disables the experimental shell/card
 * elevation shadows entirely (no box-shadow paint). Levels 1–3 map to size /
 * intensity presets written as CSS `--elev-*` multipliers.
 */

export type ShadowLevel = 0 | 1 | 2 | 3;

export interface ShadowPreferences {
  readonly version: 3;
  readonly level: ShadowLevel;
}

export interface ShadowPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const SHADOW_PREF_KEY = "serpent.shadow-prefs.v1";

export const SHADOW_LEVEL_MIN = 0;
export const SHADOW_LEVEL_MAX = 3;

/** Level presets: 0 is off (no elev shadows applied in CSS). */
export const SHADOW_LEVEL_PRESETS: Readonly<
  Record<ShadowLevel, { readonly size: number; readonly intensity: number }>
> = {
  0: { size: 0, intensity: 0 },
  1: { size: 22, intensity: 16 },
  2: { size: 45, intensity: 40 },
  3: { size: 72, intensity: 58 },
};

/** Default matches the soft hierarchy users liked (former “more”). */
export const DEFAULT_SHADOW_PREFERENCES: ShadowPreferences = {
  version: 3,
  level: 2,
};

const shadowLevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

const shadowPreferencesV3Schema = z.object({
  version: z.literal(3),
  level: shadowLevelSchema,
});

const shadowPreferencesV2Schema = z.object({
  version: z.literal(2),
  amount: z.enum(["more", "less"]),
});

const shadowPreferencesV1Schema = z.object({
  version: z.literal(1),
  size: z.number().int().min(0).max(100),
  intensity: z.number().int().min(0).max(100),
});

function resolveStorage(
  storage?: ShadowPreferencesStorage,
): ShadowPreferencesStorage {
  if (storage) return storage;
  const ls = (globalThis as { localStorage?: ShadowPreferencesStorage })
    .localStorage;
  if (!ls) {
    throw new Error(
      "ShadowPreferences: no storage provided and globalThis.localStorage is not available.",
    );
  }
  return ls;
}

export function isShadowElevationEnabled(level: ShadowLevel): boolean {
  return level > 0;
}

export function shadowLevelToPreset(level: ShadowLevel): {
  readonly size: number;
  readonly intensity: number;
} {
  return SHADOW_LEVEL_PRESETS[level];
}

function migrateV1ToLevel(size: number, intensity: number): ShadowLevel {
  const score = size * 0.6 + intensity * 0.4;
  if (score < 8) return 0;
  if (score < 30) return 1;
  if (score < 55) return 2;
  return 3;
}

function migrateV2ToLevel(amount: "more" | "less"): ShadowLevel {
  return amount === "less" ? 1 : 2;
}

export function loadShadowPreferences(
  storage?: ShadowPreferencesStorage,
): ShadowPreferences {
  const store = resolveStorage(storage);
  const raw = store.getItem(SHADOW_PREF_KEY);
  if (!raw) return DEFAULT_SHADOW_PREFERENCES;
  try {
    const json: unknown = JSON.parse(raw);
    const v3 = shadowPreferencesV3Schema.safeParse(json);
    if (v3.success) return v3.data;
    const v2 = shadowPreferencesV2Schema.safeParse(json);
    if (v2.success) {
      return { version: 3, level: migrateV2ToLevel(v2.data.amount) };
    }
    const v1 = shadowPreferencesV1Schema.safeParse(json);
    if (v1.success) {
      return {
        version: 3,
        level: migrateV1ToLevel(v1.data.size, v1.data.intensity),
      };
    }
    return DEFAULT_SHADOW_PREFERENCES;
  } catch {
    return DEFAULT_SHADOW_PREFERENCES;
  }
}

export function saveShadowPreferences(
  preferences: ShadowPreferences,
  storage?: ShadowPreferencesStorage,
): void {
  const store = resolveStorage(storage);
  const cleaned: ShadowPreferences = {
    version: 3,
    level: shadowLevelSchema.parse(preferences.level),
  };
  store.setItem(SHADOW_PREF_KEY, JSON.stringify(cleaned));
}

export function setStoredShadowLevel(
  level: ShadowLevel,
  storage?: ShadowPreferencesStorage,
): ShadowPreferences {
  const next: ShadowPreferences = { version: 3, level };
  saveShadowPreferences(next, storage);
  return next;
}

export function clampShadowLevel(value: number): ShadowLevel {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value);
  if (rounded <= 0) return 0;
  if (rounded === 1) return 1;
  if (rounded === 2) return 2;
  return 3;
}

/**
 * 50 → multiplier 1. CSS tokens use `calc(... * var(--elev-size))`.
 */
export function shadowPreferenceToMultiplier(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const clamped = Math.min(100, Math.max(0, Math.round(value)));
  return clamped / 50;
}

/**
 * Write elevation state onto :root.
 * Level 0 sets `data-elevation="0"` so CSS omits elev box-shadows entirely.
 */
export function applyShadowPreferences(preferences: ShadowPreferences): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const { level } = preferences;
  root.dataset.elevation = String(level);

  if (!isShadowElevationEnabled(level)) {
    root.style.removeProperty("--elev-size");
    root.style.removeProperty("--elev-intensity");
    return;
  }

  const preset = shadowLevelToPreset(level);
  root.style.setProperty(
    "--elev-size",
    String(shadowPreferenceToMultiplier(preset.size)),
  );
  root.style.setProperty(
    "--elev-intensity",
    String(shadowPreferenceToMultiplier(preset.intensity)),
  );
}
