import { z } from "zod";

/**
 * Inspector preview card tilt / glare (experiment/card-feel-preview subset).
 * Browse grid is unaffected; toggled in Settings → Appearance.
 */

export interface InspectorCardFeelPreferences {
  readonly version: 1;
  readonly enabled: boolean;
}

export interface InspectorCardFeelPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const INSPECTOR_CARD_FEEL_PREF_KEY =
  "serpent.inspector-card-feel-prefs.v1";

const inspectorCardFeelPreferencesSchema = z.object({
  version: z.literal(1),
  enabled: z.boolean(),
});

export const DEFAULT_INSPECTOR_CARD_FEEL_PREFERENCES: InspectorCardFeelPreferences =
  {
    version: 1,
    enabled: true,
  };

function resolveStorage(
  storage?: InspectorCardFeelPreferencesStorage,
): InspectorCardFeelPreferencesStorage {
  if (storage) return storage;
  const ls = (globalThis as { localStorage?: InspectorCardFeelPreferencesStorage })
    .localStorage;
  if (!ls) {
    throw new Error(
      "InspectorCardFeelPreferences: no storage provided and globalThis.localStorage is not available.",
    );
  }
  return ls;
}

export function loadInspectorCardFeelPreferences(
  storage?: InspectorCardFeelPreferencesStorage,
): InspectorCardFeelPreferences {
  const store = resolveStorage(storage);
  const raw = store.getItem(INSPECTOR_CARD_FEEL_PREF_KEY);
  if (!raw) return DEFAULT_INSPECTOR_CARD_FEEL_PREFERENCES;
  try {
    const parsed = inspectorCardFeelPreferencesSchema.safeParse(JSON.parse(raw));
    return parsed.success
      ? parsed.data
      : DEFAULT_INSPECTOR_CARD_FEEL_PREFERENCES;
  } catch {
    return DEFAULT_INSPECTOR_CARD_FEEL_PREFERENCES;
  }
}

export function saveInspectorCardFeelPreferences(
  preferences: InspectorCardFeelPreferences,
  storage?: InspectorCardFeelPreferencesStorage,
): void {
  const store = resolveStorage(storage);
  const cleaned = inspectorCardFeelPreferencesSchema.parse(preferences);
  store.setItem(INSPECTOR_CARD_FEEL_PREF_KEY, JSON.stringify(cleaned));
}

export function isInspectorCardFeelEnabled(
  storage?: InspectorCardFeelPreferencesStorage,
): boolean {
  return loadInspectorCardFeelPreferences(storage).enabled;
}

export function setInspectorCardFeelEnabled(
  enabled: boolean,
  storage?: InspectorCardFeelPreferencesStorage,
): InspectorCardFeelPreferences {
  const next: InspectorCardFeelPreferences = { version: 1, enabled };
  saveInspectorCardFeelPreferences(next, storage);
  return next;
}
