import { z } from "zod";

export const IMAGE_SEQUENCE_PREFERENCES_KEY = "serpent.image-sequence.v1";

export interface ImageSequencePreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ImageSequencePreferences {
  readonly version: 1;
  readonly autoDetectOnImport: boolean;
}

export const DEFAULT_IMAGE_SEQUENCE_PREFERENCES: ImageSequencePreferences = {
  version: 1,
  autoDetectOnImport: true,
};

const schema = z.object({
  version: z.literal(1),
  autoDetectOnImport: z.boolean(),
});

function resolveStorage(
  storage?: ImageSequencePreferencesStorage,
): ImageSequencePreferencesStorage {
  if (storage) return storage;
  const localStorage = globalThis.localStorage;
  if (!localStorage) {
    throw new Error("ImageSequencePreferences: localStorage is unavailable.");
  }
  return localStorage;
}

export function loadImageSequencePreferences(
  storage?: ImageSequencePreferencesStorage,
): ImageSequencePreferences {
  const raw = resolveStorage(storage).getItem(IMAGE_SEQUENCE_PREFERENCES_KEY);
  if (!raw) return DEFAULT_IMAGE_SEQUENCE_PREFERENCES;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_IMAGE_SEQUENCE_PREFERENCES;
  } catch {
    return DEFAULT_IMAGE_SEQUENCE_PREFERENCES;
  }
}

export function saveImageSequencePreferences(
  preferences: ImageSequencePreferences,
  storage?: ImageSequencePreferencesStorage,
): void {
  const parsed = schema.parse(preferences);
  resolveStorage(storage).setItem(
    IMAGE_SEQUENCE_PREFERENCES_KEY,
    JSON.stringify(parsed),
  );
}
