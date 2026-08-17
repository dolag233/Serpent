/**
 * Video viewer letter shortcuts (VIEWER-018 / Serpent-80c3).
 *
 * Product rule: unmodified letter chords (D/F/X/C) must work under **any**
 * IME — including Chinese. Unmodified letters often never reach the Renderer
 * while an IME is composing. On Windows the Main process:
 * 1. installs hidden Menu accelerators for D/F/X/C while the viewer is armed,
 * 2. temporarily suspends IMM32 conversion (ImmAssociateContext / SetOpenStatus),
 * 3. keeps `before-input-event` as a cross-platform fallback.
 * Focusing a text field or closing the viewer restores IME and clears the menu.
 */

export const VIEWER_VIDEO_SHORTCUT_ACTIONS = [
  "frame-prev",
  "frame-next",
  "rate-slower",
  "rate-faster",
] as const;

export type ViewerVideoShortcutAction =
  (typeof VIEWER_VIDEO_SHORTCUT_ACTIONS)[number];

/** DOM / Electron physical key → action (USB code first, then keyCode). */
const CODE_TO_ACTION: Readonly<Record<string, ViewerVideoShortcutAction>> = {
  KeyD: "frame-prev",
  KeyF: "frame-next",
  KeyX: "rate-slower",
  KeyC: "rate-faster",
};

/** Windows IME sessions sometimes omit `code` but still set keyCode. */
const KEY_CODE_TO_ACTION: Readonly<Record<number, ViewerVideoShortcutAction>> =
  {
    68: "frame-prev", // D
    70: "frame-next", // F
    88: "rate-slower", // X
    67: "rate-faster", // C
  };

const KEY_TO_ACTION: Readonly<Record<string, ViewerVideoShortcutAction>> = {
  d: "frame-prev",
  D: "frame-prev",
  f: "frame-next",
  F: "frame-next",
  x: "rate-slower",
  X: "rate-slower",
  c: "rate-faster",
  C: "rate-faster",
};

export type ViewerVideoShortcutInput = {
  readonly type?: string;
  readonly code?: string;
  readonly key?: string;
  /** Electron Input.keyCode / legacy DOM keyCode. */
  readonly keyCode?: number;
  readonly control?: boolean;
  readonly ctrlKey?: boolean;
  readonly meta?: boolean;
  readonly metaKey?: boolean;
  readonly alt?: boolean;
  readonly altKey?: boolean;
  readonly shift?: boolean;
  readonly shiftKey?: boolean;
};

function hasCtrl(input: ViewerVideoShortcutInput): boolean {
  return Boolean(input.control ?? input.ctrlKey);
}

function hasMeta(input: ViewerVideoShortcutInput): boolean {
  return Boolean(input.meta ?? input.metaKey);
}

function hasAlt(input: ViewerVideoShortcutInput): boolean {
  return Boolean(input.alt ?? input.altKey);
}

function isKeyDown(input: ViewerVideoShortcutInput): boolean {
  // Electron uses "keyDown"; DOM uses "keydown". Accept both.
  const type = input.type ?? "keyDown";
  return type === "keyDown" || type === "keydown";
}

/**
 * Match unmodified D/F/X/C from a Main `before-input-event` or DOM keydown.
 * Prefer `code`, then `keyCode` (IME on Windows), then `key`.
 */
export function matchViewerVideoLetterShortcut(
  input: ViewerVideoShortcutInput,
): ViewerVideoShortcutAction | null {
  if (!isKeyDown(input)) return null;
  if (hasCtrl(input) || hasMeta(input) || hasAlt(input)) return null;

  if (input.code && CODE_TO_ACTION[input.code]) {
    return CODE_TO_ACTION[input.code] ?? null;
  }
  if (
    typeof input.keyCode === "number" &&
    KEY_CODE_TO_ACTION[input.keyCode]
  ) {
    return KEY_CODE_TO_ACTION[input.keyCode] ?? null;
  }
  if (input.key && KEY_TO_ACTION[input.key]) {
    return KEY_TO_ACTION[input.key] ?? null;
  }
  return null;
}
