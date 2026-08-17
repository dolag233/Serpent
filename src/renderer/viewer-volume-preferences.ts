import { z } from "zod";

import type { KeyboardTargetLike } from "./video-player-controls";
import { isEditableKeyboardTarget } from "./video-player-controls";

export interface ViewerVolumePreferences {
  readonly version: 1;
  /** Linear gain 0..1. */
  readonly volume: number;
  readonly muted: boolean;
}

export const VIEWER_VOLUME_PREF_KEY = "serpent.viewer-volume.v1";
export const VIEWER_VOLUME_STEP = 0.05;

const viewerVolumeSchema = z.object({
  version: z.literal(1),
  volume: z.number().min(0).max(1),
  muted: z.boolean(),
});

export const DEFAULT_VIEWER_VOLUME_PREFERENCES: ViewerVolumePreferences = {
  version: 1,
  volume: 1,
  muted: false,
};

export function clampViewerVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  return Math.min(1, Math.max(0, Math.round(volume * 100) / 100));
}

export function loadViewerVolumePreferences(
  storage: Pick<Storage, "getItem"> = localStorage,
): ViewerVolumePreferences {
  const raw = storage.getItem(VIEWER_VOLUME_PREF_KEY);
  if (raw === null) return DEFAULT_VIEWER_VOLUME_PREFERENCES;
  try {
    const parsed = viewerVolumeSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_VIEWER_VOLUME_PREFERENCES;
  } catch {
    return DEFAULT_VIEWER_VOLUME_PREFERENCES;
  }
}

export function saveViewerVolumePreferences(
  prefs: ViewerVolumePreferences,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  const cleaned: ViewerVolumePreferences = {
    version: 1,
    volume: clampViewerVolume(prefs.volume),
    muted: prefs.muted,
  };
  storage.setItem(VIEWER_VOLUME_PREF_KEY, JSON.stringify(cleaned));
}

export type ViewerVolumeDirection = "up" | "down";

export function stepViewerVolumeLevel(
  current: number,
  direction: ViewerVolumeDirection,
): number {
  const delta = direction === "up" ? VIEWER_VOLUME_STEP : -VIEWER_VOLUME_STEP;
  return clampViewerVolume(current + delta);
}

/**
 * ↑ / ↓ adjust global viewer volume (Serpent-8w6x). Capture-phase callers
 * should stopPropagation so browse shortcuts do not fire underneath.
 */
export function matchViewerVolumeKey(event: {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: KeyboardTargetLike | EventTarget | null;
}): ViewerVolumeDirection | null {
  if (isEditableKeyboardTarget(event.target)) return null;
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.key === "ArrowUp" || event.code === "ArrowUp") return "up";
  if (event.key === "ArrowDown" || event.code === "ArrowDown") return "down";
  return null;
}

export function applyViewerVolumeToMedia(
  media: HTMLMediaElement,
  prefs: Pick<ViewerVolumePreferences, "volume" | "muted">,
): void {
  media.volume = clampViewerVolume(prefs.volume);
  media.muted = prefs.muted || prefs.volume === 0;
}
