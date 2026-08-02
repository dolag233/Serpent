/**
 * Pure helpers for the asset viewer video player (REQ-VIEW-005 / Serpent-60k).
 *
 * The transport chrome (play/pause, scrub track, rate) is fully custom —
 * layering a thin UI on top of `HTMLVideoElement`'s native `controls` was
 * tried first (Serpent-2j9) and failed human acceptance: the browser's own
 * control auto-hide timer fights the viewer's chrome-idle fade, and its
 * shadow-DOM focus/keyboard handling made Space unreliable. This module
 * backs Space play/pause, the rate list, and the scrub-track position math
 * so all of it stays unit-testable outside a DOM environment.
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

/**
 * True only for targets where letter keys must type (Inspector fields etc.).
 * Viewer chrome `<select>` / buttons are NOT typing targets — D/F/X/C must
 * still work after the rate control was clicked (VIEWER-018 / Serpent-gwp1).
 */
export function isTypingKeyboardTarget(
  target: KeyboardTargetLike | EventTarget | null,
): boolean {
  if (target == null || typeof target !== "object") return false;
  const el = target as KeyboardTargetLike & object;
  const tag = el.tagName?.toUpperCase();
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    // Range/checkbox/button inputs are chrome, not typing surfaces.
    const type =
      "type" in el && typeof (el as { type?: unknown }).type === "string"
        ? String((el as { type: string }).type).toLowerCase()
        : "text";
    if (
      type === "button" ||
      type === "checkbox" ||
      type === "radio" ||
      type === "range" ||
      type === "file" ||
      type === "reset" ||
      type === "submit"
    ) {
      return false;
    }
    return true;
  }
  if (el.isContentEditable) return true;
  return false;
}

/** Prefer physical key codes so IME `key: "Process"` still matches D/F/X/C. */
function matchPhysicalOrKey(
  event: { key: string; code?: string },
  code: string,
  keys: readonly string[],
): boolean {
  if (event.code === code) return true;
  return keys.includes(event.key);
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

/**
 * Default frame duration when the container does not expose fps
 * (HTMLVideoElement has no standard frame-rate field). 30 fps matches
 * common screen/camera masters and is close enough for editorial stepping.
 */
export const VIDEO_FRAME_STEP_SECONDS = 1 / 30;

/** Ctrl+← / Ctrl+→ skip distance (Serpent-sk1). */
export const VIDEO_SKIP_SECONDS = 2;

export type VideoKeyboardSeekAction =
  | { kind: "frame"; direction: 1 | -1 }
  | { kind: "skip"; direction: 1 | -1 };

/**
 * D = previous frame, F = next frame (Serpent-soii);
 * Ctrl+←/→ = ±2s.
 * Capture-phase callers must stopPropagation so shell ←/→ asset nav does not fire.
 * Uses Ctrl (not Cmd) on all platforms per product request.
 */
export function matchVideoPlaybackSeekKey(event: {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey?: boolean;
  target: KeyboardTargetLike | EventTarget | null;
}): VideoKeyboardSeekAction | null {
  // Only block true typing surfaces — not viewer chrome select/buttons.
  if (isTypingKeyboardTarget(event.target)) return null;

  // Ctrl+Arrow — require ctrl, reject Cmd/Alt so macOS system chords stay free.
  if (event.ctrlKey && !event.metaKey && !event.altKey) {
    if (event.key === "ArrowLeft" || event.code === "ArrowLeft") {
      return { kind: "skip", direction: -1 };
    }
    if (event.key === "ArrowRight" || event.code === "ArrowRight") {
      return { kind: "skip", direction: 1 };
    }
  }

  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (matchPhysicalOrKey(event, "KeyD", ["d", "D"])) {
    return { kind: "frame", direction: -1 };
  }
  if (matchPhysicalOrKey(event, "KeyF", ["f", "F"])) {
    return { kind: "frame", direction: 1 };
  }
  return null;
}

export type VideoPlaybackRateStep = "slower" | "faster";

/**
 * X = slower, C = faster — step within VIDEO_PLAYBACK_RATES (Serpent-soii).
 */
export function matchVideoPlaybackRateKey(event: {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: KeyboardTargetLike | EventTarget | null;
}): VideoPlaybackRateStep | null {
  if (isTypingKeyboardTarget(event.target)) return null;
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (matchPhysicalOrKey(event, "KeyX", ["x", "X"])) {
    return "slower";
  }
  if (matchPhysicalOrKey(event, "KeyC", ["c", "C"])) {
    return "faster";
  }
  return null;
}

/** Frame duration from probe fps, else 1/30. */
export function resolveFrameStepSeconds(fps?: number | null): number {
  if (typeof fps === "number" && Number.isFinite(fps) && fps > 0) {
    return 1 / fps;
  }
  return VIDEO_FRAME_STEP_SECONDS;
}

/**
 * One editorial frame step target. HTMLVideoElement may snap to the nearest
 * keyframe; callers that need a visible advance can retry with a larger step.
 */
export function nextFrameSeekTime(
  currentTime: number,
  duration: number,
  direction: 1 | -1,
  frameStepSeconds: number = VIDEO_FRAME_STEP_SECONDS,
): number {
  const step =
    Number.isFinite(frameStepSeconds) && frameStepSeconds > 0
      ? frameStepSeconds
      : VIDEO_FRAME_STEP_SECONDS;
  return clampScrubTime(currentTime + direction * step, duration);
}

export function stepVideoPlaybackRate(
  current: VideoPlaybackRate,
  step: VideoPlaybackRateStep,
): VideoPlaybackRate {
  const index = VIDEO_PLAYBACK_RATES.indexOf(current);
  const resolvedIndex = index >= 0 ? index : VIDEO_PLAYBACK_RATES.indexOf(1);
  if (step === "slower") {
    return VIDEO_PLAYBACK_RATES[Math.max(0, resolvedIndex - 1)] ?? current;
  }
  return (
    VIDEO_PLAYBACK_RATES[
      Math.min(VIDEO_PLAYBACK_RATES.length - 1, resolvedIndex + 1)
    ] ?? current
  );
}

/** Seconds to add to `currentTime` for a matched seek action. */
export function videoSeekDeltaSeconds(
  action: VideoKeyboardSeekAction,
  frameStepSeconds: number = VIDEO_FRAME_STEP_SECONDS,
): number {
  const step =
    action.kind === "frame"
      ? Number.isFinite(frameStepSeconds) && frameStepSeconds > 0
        ? frameStepSeconds
        : VIDEO_FRAME_STEP_SECONDS
      : VIDEO_SKIP_SECONDS;
  return step * action.direction;
}

export function parsePlaybackRate(value: string): VideoPlaybackRate {
  const parsed = Number(value);
  if ((VIDEO_PLAYBACK_RATES as readonly number[]).includes(parsed)) {
    return parsed as VideoPlaybackRate;
  }
  return 1;
}

/** Geometry of the scrub track, in the same coordinate space as `clientX`. */
export interface ScrubTrackGeometry {
  left: number;
  width: number;
}

/**
 * Convert a pointer's `clientX` into a 0..1 ratio along the scrub track,
 * clamped to the track bounds. Pure so drag math is testable without a DOM.
 */
export function scrubRatioFromClientX(
  clientX: number,
  track: ScrubTrackGeometry,
): number {
  if (!Number.isFinite(track.width) || track.width <= 0) return 0;
  const ratio = (clientX - track.left) / track.width;
  if (!Number.isFinite(ratio)) return 0;
  return Math.min(1, Math.max(0, ratio));
}

/** Ratio (0..1) along the track → seconds, clamped to `[0, duration]`. */
export function scrubTimeFromRatio(ratio: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const clampedRatio = Math.min(1, Math.max(0, ratio));
  return clampedRatio * duration;
}

/** Playback time → 0..1 ratio along the track, for rendering fill/thumb. */
export function scrubRatioFromTime(
  currentTime: number,
  duration: number,
): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (!Number.isFinite(currentTime) || currentTime <= 0) return 0;
  return Math.min(1, currentTime / duration);
}

/** Clamp a seek target (e.g. from arrow-key stepping) to `[0, duration]`. */
export function clampScrubTime(time: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (!Number.isFinite(time)) return 0;
  return Math.min(duration, Math.max(0, time));
}

/** `mm:ss`, growing to `h:mm:ss` past one hour. Non-finite input → `0:00`. */
export function formatVideoClockTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const whole = Math.floor(totalSeconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}
