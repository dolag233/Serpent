import { z } from "zod";

export const IMAGE_ROTATION_PREFERENCES_KEY = "serpent.image-rotation.v1";

export interface ImageRotationPreferences {
  readonly version: 1;
  /** When true, viewer quarter-turns are written into bakeable still images. */
  readonly bakeIntoFile: boolean;
}

export interface ImageRotationPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_IMAGE_ROTATION_PREFERENCES: ImageRotationPreferences = {
  version: 1,
  bakeIntoFile: false,
};

const preferencesSchema = z.object({
  version: z.literal(1),
  bakeIntoFile: z.boolean(),
});

function resolveStorage(
  storage?: ImageRotationPreferencesStorage,
): ImageRotationPreferencesStorage | undefined {
  if (storage) return storage;
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

export function loadImageRotationPreferences(
  storage?: ImageRotationPreferencesStorage,
): ImageRotationPreferences {
  const target = resolveStorage(storage);
  if (!target) return DEFAULT_IMAGE_ROTATION_PREFERENCES;
  const raw = target.getItem(IMAGE_ROTATION_PREFERENCES_KEY);
  if (!raw) return DEFAULT_IMAGE_ROTATION_PREFERENCES;
  try {
    const parsed = preferencesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_IMAGE_ROTATION_PREFERENCES;
  } catch {
    return DEFAULT_IMAGE_ROTATION_PREFERENCES;
  }
}

export function saveImageRotationPreferences(
  preferences: ImageRotationPreferences,
  storage?: ImageRotationPreferencesStorage,
): void {
  const target = resolveStorage(storage);
  if (!target) return;
  target.setItem(
    IMAGE_ROTATION_PREFERENCES_KEY,
    JSON.stringify(preferencesSchema.parse(preferences)),
  );
}
