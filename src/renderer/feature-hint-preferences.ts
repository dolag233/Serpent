import { z } from "zod";

// ---------------------------------------------------------------------------
// Global "feature hints" preference (Serpent-b8a853)
//
// One-time UI hints (a faint accent flash on the recursive-subfolders icon,
// and future hints) are gated by a single global switch plus a per-hint
// "seen" key. When the switch is off, no hint renders at all. When it is on,
// a hint fires once per key (e.g. `recursive-subfolders:<libraryId>:<folderId>`)
// and is then marked as seen so it never repeats.
// ---------------------------------------------------------------------------

export const FEATURE_HINT_PREFERENCES_KEY = "serpent.feature-hints.v2";

export interface FeatureHintPreferences {
  readonly version: 2;
  readonly enabled: boolean;
  /** Hint keys already recorded (semantics: dismissed / feature already used). */
  readonly seen: Readonly<Record<string, true>>;
}

export interface FeatureHintPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_FEATURE_HINT_PREFERENCES: FeatureHintPreferences = {
  version: 2,
  enabled: true,
  seen: {},
};

const featureHintPreferencesSchema = z.object({
  version: z.literal(2),
  enabled: z.boolean(),
  seen: z.record(z.string(), z.literal(true)),
});

/**
 * 2026-09-04 second feedback round: the v1 key recorded "hint shown once" and
 * was persisted during earlier one-shot-flash testing, which poisoned the
 * same keys now used as "dismissed". Bump to v2 so the new dismiss semantics
 * start from a clean slate.
 */

function resolveStorage(
  storage?: FeatureHintPreferencesStorage,
): FeatureHintPreferencesStorage | undefined {
  if (storage) return storage;
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

export function loadFeatureHintPreferences(
  storage?: FeatureHintPreferencesStorage,
): FeatureHintPreferences {
  const target = resolveStorage(storage);
  if (!target) return DEFAULT_FEATURE_HINT_PREFERENCES;

  const raw = target.getItem(FEATURE_HINT_PREFERENCES_KEY);
  if (!raw) return DEFAULT_FEATURE_HINT_PREFERENCES;

  try {
    const parsed = featureHintPreferencesSchema.safeParse(JSON.parse(raw));
    return parsed.success
      ? parsed.data
      : DEFAULT_FEATURE_HINT_PREFERENCES;
  } catch {
    return DEFAULT_FEATURE_HINT_PREFERENCES;
  }
}

export function saveFeatureHintPreferences(
  preferences: FeatureHintPreferences,
  storage?: FeatureHintPreferencesStorage,
): void {
  const target = resolveStorage(storage);
  if (!target) return;
  target.setItem(FEATURE_HINT_PREFERENCES_KEY, JSON.stringify(preferences));
}

export function isFeatureHintEnabled(preferences: FeatureHintPreferences): boolean {
  return preferences.enabled;
}

export function hasFeatureHintBeenShown(
  preferences: FeatureHintPreferences,
  key: string,
): boolean {
  return preferences.seen[key] === true;
}

/** Returns a new preferences object with `key` recorded as dismissed. */
export function withFeatureHintShown(
  preferences: FeatureHintPreferences,
  key: string,
): FeatureHintPreferences {
  if (preferences.seen[key] === true) return preferences;
  return {
    version: 2,
    enabled: preferences.enabled,
    seen: { ...preferences.seen, [key]: true },
  };
}