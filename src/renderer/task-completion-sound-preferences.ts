import { z } from "zod";

export const TASK_COMPLETION_SOUND_PREFERENCES_KEY =
  "serpent.task-completion-sound.v1";

export interface TaskCompletionSoundPreferences {
  readonly version: 1;
  readonly enabled: boolean;
}

export interface TaskCompletionSoundPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_TASK_COMPLETION_SOUND_PREFERENCES: TaskCompletionSoundPreferences = {
  version: 1,
  enabled: true,
};

const preferencesSchema = z.object({
  version: z.literal(1),
  enabled: z.boolean(),
});

function resolveStorage(
  storage?: TaskCompletionSoundPreferencesStorage,
): TaskCompletionSoundPreferencesStorage | undefined {
  if (storage) return storage;
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

export function loadTaskCompletionSoundPreferences(
  storage?: TaskCompletionSoundPreferencesStorage,
): TaskCompletionSoundPreferences {
  const target = resolveStorage(storage);
  if (!target) return DEFAULT_TASK_COMPLETION_SOUND_PREFERENCES;

  const raw = target.getItem(TASK_COMPLETION_SOUND_PREFERENCES_KEY);
  if (!raw) return DEFAULT_TASK_COMPLETION_SOUND_PREFERENCES;

  try {
    const parsed = preferencesSchema.safeParse(JSON.parse(raw));
    return parsed.success
      ? parsed.data
      : DEFAULT_TASK_COMPLETION_SOUND_PREFERENCES;
  } catch {
    return DEFAULT_TASK_COMPLETION_SOUND_PREFERENCES;
  }
}

export function saveTaskCompletionSoundPreferences(
  preferences: TaskCompletionSoundPreferences,
  storage?: TaskCompletionSoundPreferencesStorage,
): void {
  const target = resolveStorage(storage);
  if (!target) return;
  target.setItem(
    TASK_COMPLETION_SOUND_PREFERENCES_KEY,
    JSON.stringify(preferencesSchema.parse(preferences)),
  );
}
