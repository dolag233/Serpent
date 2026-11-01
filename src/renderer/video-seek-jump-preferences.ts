import { z } from "zod";

/**
 * How Ctrl+Left / Ctrl+Right (and one wheel notch on the video progress
 * track) move through a video. Time is a fixed number of seconds. Progress
 * is a share of the duration.
 */
export type VideoSeekJumpMode = "time" | "percent";

export interface VideoSeekJumpPreferences {
  readonly version: 1;
  readonly mode: VideoSeekJumpMode;
  /** Seconds per jump when `mode` is `time`. */
  readonly seconds: number;
  /** Percent of duration per jump when `mode` is `percent`. */
  readonly percent: number;
}

export const VIDEO_SEEK_JUMP_PREFERENCES_KEY = "serpent.video-seek-jump.v1";

export const VIDEO_SEEK_JUMP_MIN_SECONDS = 0.1;
export const VIDEO_SEEK_JUMP_MAX_SECONDS = 3600;
export const VIDEO_SEEK_JUMP_MIN_PERCENT = 0.1;
export const VIDEO_SEEK_JUMP_MAX_PERCENT = 100;

export const DEFAULT_VIDEO_SEEK_JUMP_PREFERENCES: VideoSeekJumpPreferences = {
  version: 1,
  mode: "time",
  seconds: 2,
  percent: 5,
};

const schema = z.object({
  version: z.literal(1),
  mode: z.enum(["time", "percent"]),
  seconds: z.number(),
  percent: z.number(),
});

export interface VideoSeekJumpPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function resolveStorage(
  storage?: VideoSeekJumpPreferencesStorage,
): VideoSeekJumpPreferencesStorage {
  if (storage) return storage;
  const localStorage = globalThis.localStorage;
  if (!localStorage) {
    throw new Error("VideoSeekJumpPreferences: localStorage is unavailable.");
  }
  return localStorage;
}

export function clampVideoSeekJumpSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return DEFAULT_VIDEO_SEEK_JUMP_PREFERENCES.seconds;
  const rounded = Math.round(seconds * 10) / 10;
  return Math.min(
    VIDEO_SEEK_JUMP_MAX_SECONDS,
    Math.max(VIDEO_SEEK_JUMP_MIN_SECONDS, rounded),
  );
}

export function clampVideoSeekJumpPercent(percent: number): number {
  if (!Number.isFinite(percent)) return DEFAULT_VIDEO_SEEK_JUMP_PREFERENCES.percent;
  const rounded = Math.round(percent * 10) / 10;
  return Math.min(
    VIDEO_SEEK_JUMP_MAX_PERCENT,
    Math.max(VIDEO_SEEK_JUMP_MIN_PERCENT, rounded),
  );
}

export function normalizeVideoSeekJumpPreferences(
  preferences: VideoSeekJumpPreferences,
): VideoSeekJumpPreferences {
  return {
    version: 1,
    mode: preferences.mode === "percent" ? "percent" : "time",
    seconds: clampVideoSeekJumpSeconds(preferences.seconds),
    percent: clampVideoSeekJumpPercent(preferences.percent),
  };
}

export function loadVideoSeekJumpPreferences(
  storage?: VideoSeekJumpPreferencesStorage,
): VideoSeekJumpPreferences {
  const raw = resolveStorage(storage).getItem(VIDEO_SEEK_JUMP_PREFERENCES_KEY);
  if (!raw) return DEFAULT_VIDEO_SEEK_JUMP_PREFERENCES;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success
      ? normalizeVideoSeekJumpPreferences(parsed.data)
      : DEFAULT_VIDEO_SEEK_JUMP_PREFERENCES;
  } catch {
    return DEFAULT_VIDEO_SEEK_JUMP_PREFERENCES;
  }
}

export function saveVideoSeekJumpPreferences(
  preferences: VideoSeekJumpPreferences,
  storage?: VideoSeekJumpPreferencesStorage,
): VideoSeekJumpPreferences {
  const cleaned = normalizeVideoSeekJumpPreferences(preferences);
  resolveStorage(storage).setItem(
    VIDEO_SEEK_JUMP_PREFERENCES_KEY,
    JSON.stringify(cleaned),
  );
  return cleaned;
}
