import { z } from "zod";

export const AUDIO_PREVIEW_PREFERENCES_KEY = "serpent.audio-preview.v1";

export interface AudioPreviewPreferences {
  readonly version: 1;
  /** When true, audio cards use embedded cover art when the file has one. */
  readonly preferCover: boolean;
}

export interface AudioPreviewPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_AUDIO_PREVIEW_PREFERENCES: AudioPreviewPreferences = {
  version: 1,
  preferCover: true,
};

const preferencesSchema = z.object({
  version: z.literal(1),
  preferCover: z.boolean(),
});

function resolveStorage(
  storage?: AudioPreviewPreferencesStorage,
): AudioPreviewPreferencesStorage | undefined {
  if (storage) return storage;
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

export function loadAudioPreviewPreferences(
  storage?: AudioPreviewPreferencesStorage,
): AudioPreviewPreferences {
  const target = resolveStorage(storage);
  if (!target) return DEFAULT_AUDIO_PREVIEW_PREFERENCES;
  const raw = target.getItem(AUDIO_PREVIEW_PREFERENCES_KEY);
  if (!raw) return DEFAULT_AUDIO_PREVIEW_PREFERENCES;
  try {
    const parsed = preferencesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_AUDIO_PREVIEW_PREFERENCES;
  } catch {
    return DEFAULT_AUDIO_PREVIEW_PREFERENCES;
  }
}

export function saveAudioPreviewPreferences(
  preferences: AudioPreviewPreferences,
  storage?: AudioPreviewPreferencesStorage,
): void {
  const target = resolveStorage(storage);
  if (!target) return;
  target.setItem(
    AUDIO_PREVIEW_PREFERENCES_KEY,
    JSON.stringify(preferencesSchema.parse(preferences)),
  );
}
