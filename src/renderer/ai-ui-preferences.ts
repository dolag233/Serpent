import { z } from "zod";

// ---------------------------------------------------------------------------
// AI UI preferences (Serpent-t8sw)
//
// Controls whether Inspector shows AI source badges. Does not delete AI data.
// ---------------------------------------------------------------------------

export interface AiUiPreferences {
  readonly version: 1;
  /** When false, hide AI badges on description / tags / rating. */
  readonly showAiBadges: boolean;
}

export interface AiUiPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const aiUiPreferencesSchema = z.object({
  version: z.literal(1),
  showAiBadges: z.boolean(),
});

export const AI_UI_PREF_KEY = "serpent.ai-ui-prefs.v1";

export const DEFAULT_AI_UI_PREFERENCES: AiUiPreferences = {
  version: 1,
  showAiBadges: true,
};

function resolveStorage(
  storage?: AiUiPreferencesStorage,
): AiUiPreferencesStorage {
  if (storage) return storage;
  const ls = (globalThis as { localStorage?: AiUiPreferencesStorage })
    .localStorage;
  if (!ls) {
    throw new Error(
      "AiUiPreferences: no storage provided and globalThis.localStorage is not available.",
    );
  }
  return ls;
}

export function loadAiUiPreferences(
  storage?: AiUiPreferencesStorage,
): AiUiPreferences {
  const s = resolveStorage(storage);
  const raw = s.getItem(AI_UI_PREF_KEY);
  if (raw === null) return DEFAULT_AI_UI_PREFERENCES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_AI_UI_PREFERENCES;
  }
  const result = aiUiPreferencesSchema.safeParse(parsed);
  return result.success ? result.data : DEFAULT_AI_UI_PREFERENCES;
}

export function saveAiUiPreferences(
  prefs: AiUiPreferences,
  storage?: AiUiPreferencesStorage,
): void {
  const s = resolveStorage(storage);
  const cleaned: AiUiPreferences = {
    version: 1,
    showAiBadges: prefs.showAiBadges,
  };
  s.setItem(AI_UI_PREF_KEY, JSON.stringify(cleaned));
}
