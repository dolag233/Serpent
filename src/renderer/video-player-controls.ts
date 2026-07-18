/**
 * Pure helpers for the asset viewer video player (REQ-VIEW-005).
 *
 * Native HTMLVideoElement `controls` remain the scrubber / transport UI;
 * this module backs Space play/pause and the thin rate chrome.
 */

export const VIDEO_PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export type VideoPlaybackRate = (typeof VIDEO_PLAYBACK_RATES)[number];

export type PlaybackIntent = "play" | "pause";

/** Minimal shape so helpers stay unit-testable outside a DOM environment. */
export type KeyboardTargetLike = {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
} | null;

export function nextPlaybackIntent(paused: boolean): PlaybackIntent {
  return paused ? "play" : "pause";
}

export function isEditableKeyboardTarget(
  target: KeyboardTargetLike | EventTarget | null,
): boolean {
  if (target == null || typeof target !== "object") return false;
  const el = target as KeyboardTargetLike & object;
  const tag = el.tagName?.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  if (typeof el.closest === "function" && el.closest('[role="dialog"]')) {
    return true;
  }
  return false;
}

function isFocusedChromeControl(
  target: KeyboardTargetLike | EventTarget | null,
): boolean {
  if (target == null || typeof target !== "object") return false;
  const el = target as KeyboardTargetLike & object;
  const tag = el.tagName?.toUpperCase();
  if (tag === "BUTTON" || tag === "A") return true;
  if (
    typeof el.closest === "function" &&
    el.closest('button, a, [role="button"], [role="menuitem"], [role="option"]')
  ) {
    return true;
  }
  return false;
}

/**
 * Space toggles play/pause only when the viewer is open and the key is not
 * needed by an editable field or focused chrome control.
 */
export function shouldHandleVideoSpaceKey(event: {
  key: string;
  code?: string;
  repeat: boolean;
  target: KeyboardTargetLike | EventTarget | null;
}): boolean {
  if (event.repeat) return false;
  if (event.key !== " " && event.code !== "Space") return false;
  if (isEditableKeyboardTarget(event.target)) return false;
  if (isFocusedChromeControl(event.target)) return false;
  return true;
}

export function parsePlaybackRate(value: string): VideoPlaybackRate {
  const parsed = Number(value);
  if ((VIDEO_PLAYBACK_RATES as readonly number[]).includes(parsed)) {
    return parsed as VideoPlaybackRate;
  }
  return 1;
}
