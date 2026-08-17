/**
 * Global Cmd/Ctrl+= / - / 0 zoom chords (Serpent-46i9).
 *
 * Pure helpers so matching and step math stay unit-testable outside Electron.
 * Viewer surfaces zoom at the viewport center (0 = fit); browse canvas uses the
 * same exponential step as Ctrl+wheel card-size zoom (0 = default card size).
 */

import {
  CARD_SIZE_MAX,
  CARD_SIZE_MIN,
  DEFAULT_CANVAS_PREFERENCES,
} from "./canvas-preferences";
import type { CommandPlatform } from "./commands/command-types";
import { clampViewerScale } from "./viewer-fit";
import { isEditableKeyboardTarget } from "./video-player-controls";

export type GlobalZoomAction = "in" | "out" | "reset";

/**
 * One keyboard notch ≈ mouse-wheel deltaY of 100 at the shared 0.002 gain
 * used by viewer wheel zoom and browse Ctrl+wheel card zoom.
 */
export const GLOBAL_KEYBOARD_ZOOM_FACTOR = Math.exp(0.2);

export interface GlobalZoomShortcutEvent {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * Match Cmd/Ctrl+=|+ / -|_ / 0. `+` may arrive with Shift (Shift+=); that is
 * allowed only for zoom-in. Alt always rejects. Platform modifiers are exact
 * (mac meta, windows ctrl) — same precision as matchesShortcut.
 */
export function matchGlobalZoomShortcut(
  event: GlobalZoomShortcutEvent,
  platform: CommandPlatform,
): GlobalZoomAction | null {
  if (event.altKey) return null;

  const modOk =
    platform === "mac"
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey;
  if (!modOk) return null;

  const key = event.key;
  if (key === "=" || key === "+" || key === "Add") {
    // Plain `=` must not carry Shift; `+` / numpad Add may.
    if (key === "=" && event.shiftKey) return null;
    return "in";
  }
  if (key === "-" || key === "_" || key === "Subtract") {
    if (key === "-" && event.shiftKey) return null;
    return "out";
  }
  if (key === "0") {
    if (event.shiftKey) return null;
    return "reset";
  }
  return null;
}

export function nextKeyboardZoomScale(
  scale: number,
  action: "in" | "out",
): number {
  const next =
    action === "in"
      ? scale * GLOBAL_KEYBOARD_ZOOM_FACTOR
      : scale / GLOBAL_KEYBOARD_ZOOM_FACTOR;
  return clampViewerScale(next);
}

export function nextKeyboardCardSize(
  size: number,
  action: "in" | "out",
): number {
  const next =
    action === "in"
      ? size * GLOBAL_KEYBOARD_ZOOM_FACTOR
      : size / GLOBAL_KEYBOARD_ZOOM_FACTOR;
  return Math.min(CARD_SIZE_MAX, Math.max(CARD_SIZE_MIN, Math.round(next)));
}

export function defaultKeyboardCardSize(): number {
  return DEFAULT_CANVAS_PREFERENCES.cardSize;
}

/** True when the event target should keep the chord (inputs / dialogs). */
export function shouldIgnoreGlobalZoomShortcut(
  target: EventTarget | null,
): boolean {
  return isEditableKeyboardTarget(target);
}
