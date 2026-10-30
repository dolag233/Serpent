// ---------------------------------------------------------------------------
// Shortcut resolution and matching (pure functions).
//
// The Renderer matchers, settings page and Main fallback all use these helpers.
// Defaults live in shortcut-catalog.ts; user overrides live in
// shortcut-bindings.ts.
// ---------------------------------------------------------------------------

import {
  SHORTCUT_ACTIONS,
  findShortcutAction,
  shortcutScopesOverlap,
  type ShortcutActionDefinition,
  type ShortcutChord,
  type ShortcutPlatform,
  type ShortcutScope,
} from "./shortcut-catalog";
import {
  platformBindings,
  type ShortcutBindings,
} from "./shortcut-bindings";

export type ShortcutKeyboardEventLike = {
  readonly kind?: "keyboard";
  readonly key: string;
  readonly code?: string;
  readonly keyCode?: number;
  readonly location?: number;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
  readonly repeat?: boolean;
};

/** Side-button input remains a mouse event all the way through matching. */
export type ShortcutMouseEventLike = {
  readonly kind: "mouse";
  readonly button: 3 | 4;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly repeat?: boolean;
};

export type ShortcutEventLike =
  | ShortcutKeyboardEventLike
  | ShortcutMouseEventLike;

export type ShortcutConflict = {
  readonly actionId: string;
  readonly labelKey: string;
  readonly scopes: readonly ShortcutScope[];
  readonly chords: readonly ShortcutChord[];
  readonly customizable: boolean;
};

export type ShortcutValidationReason =
  | "modifier-only"
  | "no-key"
  | "system"
  | "bare-key"
  | "mouse-modifier-required"
  | "mouse-button"
  | "ime-route-required";

export type ShortcutMouseLabels = {
  readonly mouseBack?: string;
  readonly mouseForward?: string;
  readonly wheel?: string;
};

const NAMED_KEY_CODES: Readonly<Record<string, number>> = {
  backspace: 8,
  tab: 9,
  enter: 13,
  escape: 27,
  space: 32,
  delete: 46,
  f1: 112,
  f2: 113,
  f3: 114,
  f4: 115,
  f5: 116,
  f6: 117,
  f7: 118,
  f8: 119,
  f9: 120,
  f10: 121,
  f11: 122,
  f12: 123,
};

const MODIFIER_KEYS = new Set([
  "shift",
  "control",
  "alt",
  "meta",
  "os",
  "altgraph",
  "capslock",
]);

const KEY_LABELS: Readonly<Record<string, string>> = {
  " ": "Space",
  space: "Space",
  escape: "Esc",
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  backspace: "Backspace",
  delete: "Delete",
  enter: "Enter",
  tab: "Tab",
};

function keyLabel(
  chord: ShortcutChord,
  platform: ShortcutPlatform,
  mouseLabels: ShortcutMouseLabels = {},
): string {
  const normalized = chord.key.toLowerCase();
  if (normalized === "mouseback") return mouseLabels.mouseBack ?? "Mouse Back";
  if (normalized === "mouseforward") return mouseLabels.mouseForward ?? "Mouse Forward";
  if (normalized === "wheel") return mouseLabels.wheel ?? "Mouse Wheel";
  if (platform === "mac" && normalized === "backspace") return "⌫";
  if (platform === "mac" && normalized === "enter") return "↵";
  if (KEY_LABELS[normalized] !== undefined) return KEY_LABELS[normalized];
  if (/^f\d{1,2}$/u.test(normalized)) return normalized.toUpperCase();
  if (chord.key.length === 1) return chord.key.toUpperCase();
  return chord.key;
}

/** Format one chord with the same symbols used by Serpent menus. */
export function formatShortcutChord(
  chord: ShortcutChord,
  platform: ShortcutPlatform,
  mouseLabels?: ShortcutMouseLabels,
): string {
  const key = keyLabel(chord, platform, mouseLabels);
  if (platform === "mac") {
    return [
      chord.ctrlKey === true ? "⌃" : "",
      chord.altKey === true ? "⌥" : "",
      chord.metaKey === true ? "⌘" : "",
      chord.shiftKey === true ? "⇧" : "",
    ].join("") + key;
  }
  return [
    chord.ctrlKey === true ? "Ctrl" : "",
    chord.altKey === true ? "Alt" : "",
    chord.metaKey === true ? "Win" : "",
    chord.shiftKey === true ? "Shift" : "",
    key,
  ].filter(Boolean).join("+");
}

export function formatShortcutChords(
  chords: readonly ShortcutChord[],
  platform: ShortcutPlatform,
  mouseLabels?: ShortcutMouseLabels,
): string {
  return chords.map((chord) => formatShortcutChord(chord, platform, mouseLabels)).join(" / ");
}

/** Electron's accelerator syntax for native/hidden menu registration. */
export function formatElectronAccelerator(
  chord: ShortcutChord,
  platform: ShortcutPlatform,
): string | null {
  const key = chord.key.toLowerCase();
  if (key === "mouseback" || key === "mouseforward" || key === "wheel") return null;
  const electronKey = key === "add" || chord.code?.toLowerCase() === "numpadadd"
    ? "numadd"
    : key === "subtract" || chord.code?.toLowerCase() === "numpadsubtract"
      ? "numsub"
      : key === "+"
        ? "Plus"
        : key === "space" || key === " "
    ? "Space"
    : key === "escape"
      ? "Esc"
      : key === "arrowleft"
        ? "Left"
        : key === "arrowright"
          ? "Right"
          : key === "arrowup"
            ? "Up"
            : key === "arrowdown"
              ? "Down"
              : key === "."
                ? "Period"
                : key === ","
                  ? "Comma"
                  : key === "delete"
                    ? "Delete"
                    : key === "backspace"
                      ? "Backspace"
                      : /^f\d{1,2}$/u.test(key)
                        ? key.toUpperCase()
                        : chord.key.length === 1
                          ? chord.key.toUpperCase()
                          : chord.key;
  return [
    chord.ctrlKey ? "Ctrl" : "",
    chord.altKey ? "Alt" : "",
    chord.metaKey ? (platform === "mac" ? "Cmd" : "Super") : "",
    chord.shiftKey ? "Shift" : "",
    electronKey,
  ].filter(Boolean).join("+");
}

function overrideFor(
  bindings: ShortcutBindings,
  platform: ShortcutPlatform,
  actionId: string,
): ShortcutChord | null | undefined {
  const overrides = platformBindings(bindings, platform);
  return Object.prototype.hasOwnProperty.call(overrides, actionId)
    ? overrides[actionId]
    : undefined;
}

/** Effective chords: the override replaces the primary, aliases stay. */
export function resolveActionChords(
  actionId: string,
  platform: ShortcutPlatform,
  bindings: ShortcutBindings,
): readonly ShortcutChord[] {
  const action = findShortcutAction(actionId);
  if (!action) return [];
  const defaults = action.defaults[platform];
  const override = overrideFor(bindings, platform, actionId);
  if (override === undefined) return defaults;
  if (override === null) return defaults.slice(1);
  return [override, ...defaults.slice(1)];
}

export function resolvePrimaryChord(
  actionId: string,
  platform: ShortcutPlatform,
  bindings: ShortcutBindings,
): ShortcutChord | null {
  return resolveActionChords(actionId, platform, bindings)[0] ?? null;
}

export function formatActionShortcut(
  actionId: string,
  platform: ShortcutPlatform,
  bindings: ShortcutBindings,
): string | null {
  const primary = resolveActionChords(actionId, platform, bindings)[0];
  return primary === undefined ? null : formatShortcutChord(primary, platform);
}

function normalizedChordKey(chord: ShortcutChord): string {
  const code = chord.code?.toLowerCase();
  if (code !== undefined) {
    if (/^key[a-z]$/u.test(code)) return code.slice(3);
    if (/^digit[0-9]$/u.test(code)) return code.slice(5);
  }
  return chord.key.toLowerCase();
}

export function shortcutChordsEqual(
  left: ShortcutChord,
  right: ShortcutChord,
): boolean {
  return (
    normalizedChordKey(left) === normalizedChordKey(right) &&
    (left.metaKey ?? false) === (right.metaKey ?? false) &&
    (left.ctrlKey ?? false) === (right.ctrlKey ?? false) &&
    (left.altKey ?? false) === (right.altKey ?? false) &&
    (left.shiftKey ?? false) === (right.shiftKey ?? false)
  );
}

function eventMatchesChordKey(
  chord: ShortcutChord,
  event: ShortcutEventLike,
): boolean {
  if (event.kind === "mouse") {
    const expectedButton = chord.key.toLowerCase() === "mouseback"
      ? 3
      : chord.key.toLowerCase() === "mouseforward"
        ? 4
        : null;
    return expectedButton !== null && event.button === expectedButton;
  }
  if (chord.key.toLowerCase() === "mouseback" || chord.key.toLowerCase() === "mouseforward") {
    return false;
  }
  const expected = chord.key.toLowerCase();
  const key = event.key.toLowerCase();
  const code = event.code?.toLowerCase();
  if (chord.code !== undefined && code !== undefined && code.length > 0) {
    const expectedCode = chord.code.toLowerCase();
    if (code === expectedCode) return true;
    if (expectedCode === "numpaddecimal" && code === "decimal") return true;
    return false;
  }
  if (chord.code?.toLowerCase() === "numpaddecimal") {
    if (key === "decimal" || key === "numpaddecimal") return true;
    if (key === "." && event.location === 3) return true;
    return false;
  }
  if (key.length > 0 && key !== "process" && key === expected) return true;
  if (expected === "delete" && key === "del") return true;
  if (expected === "space" && key === " ") return true;
  if (expected === " " && key === "space") return true;

  if (code !== undefined && code.length > 0) {
    if (code === expected) return true;
    if (expected === "delete" && (key === "del" || code === "del")) return true;
    if (expected === "space" && code === "space") return true;
    if (expected.length === 1 && code === `key${expected}`) return true;
    if (expected.length === 1 && code === `digit${expected}`) return true;
    if (expected === "=" && code === "equal") return true;
    if (expected === "+" && (code === "equal" || code === "add")) return true;
    if (expected === "-" && (code === "minus" || code === "subtract")) return true;
    if (expected === "0" && code === "digit0") return true;
    if (expected === "." && (code === "numpaddecimal" || code === "decimal")) return true;
    if (expected === "+" && (code === "numpadadd" || code === "add")) return true;
    if (expected === "-" && (code === "numpadsubtract" || code === "subtract")) return true;
  }

  const keyCode = event.keyCode;
  if (keyCode !== undefined && keyCode !== 0) {
    const named = NAMED_KEY_CODES[expected];
    if (named !== undefined && keyCode === named) return true;
    if (expected.length === 1) {
      const upper = expected.toUpperCase();
      if (upper >= "A" && upper <= "Z" && keyCode === upper.charCodeAt(0)) return true;
      if (expected >= "0" && expected <= "9" && keyCode === expected.charCodeAt(0)) return true;
    }
  }
  return false;
}

export function matchesShortcutChord(
  chord: ShortcutChord,
  event: ShortcutEventLike,
): boolean {
  if (event.repeat === true) return false;
  if ((event.altKey ?? false) !== (chord.altKey ?? false)) return false;
  if ((event.metaKey ?? false) !== (chord.metaKey ?? false)) return false;
  if ((event.ctrlKey ?? false) !== (chord.ctrlKey ?? false)) return false;
  if ((event.shiftKey ?? false) !== (chord.shiftKey ?? false)) return false;
  return eventMatchesChordKey(chord, event);
}

export function matchesActionShortcut(
  actionId: string,
  event: ShortcutEventLike,
  platform: ShortcutPlatform,
  bindings: ShortcutBindings,
): boolean {
  return resolveActionChords(actionId, platform, bindings).some((chord) =>
    matchesShortcutChord(chord, event),
  );
}

export function findShortcutConflictsForChord(
  actionId: string,
  chord: ShortcutChord,
  platform: ShortcutPlatform,
  bindings: ShortcutBindings,
): ShortcutConflict[] {
  const action = findShortcutAction(actionId);
  if (!action) return [];
  const conflicts: ShortcutConflict[] = [];
  for (const candidate of SHORTCUT_ACTIONS) {
    if (candidate.id === actionId) continue;
    if (!shortcutScopesOverlap(action.scopes, candidate.scopes)) continue;
    const chords = resolveActionChords(candidate.id, platform, bindings);
    if (chords.some((candidateChord) => shortcutChordsEqual(chord, candidateChord))) {
      conflicts.push({
        actionId: candidate.id,
        labelKey: candidate.labelKey,
        scopes: candidate.scopes,
        chords,
        customizable: candidate.customizable,
      });
    }
  }
  return conflicts;
}

export function findAllShortcutConflicts(
  platform: ShortcutPlatform,
  bindings: ShortcutBindings,
): ShortcutConflict[] {
  const byAction = new Map<string, ShortcutConflict[]>();
  for (let leftIndex = 0; leftIndex < SHORTCUT_ACTIONS.length; leftIndex += 1) {
    const left = SHORTCUT_ACTIONS[leftIndex]!;
    const leftChords = resolveActionChords(left.id, platform, bindings);
    if (leftChords.length === 0) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < SHORTCUT_ACTIONS.length; rightIndex += 1) {
      const right = SHORTCUT_ACTIONS[rightIndex]!;
      if (!shortcutScopesOverlap(left.scopes, right.scopes)) continue;
      const rightChords = resolveActionChords(right.id, platform, bindings);
      if (rightChords.length === 0) continue;
      const shared = leftChords.filter((leftChord) =>
        rightChords.some((rightChord) => shortcutChordsEqual(leftChord, rightChord)),
      );
      if (shared.length === 0) continue;
      const leftEntry: ShortcutConflict = {
        actionId: right.id,
        labelKey: right.labelKey,
        scopes: right.scopes,
        chords: rightChords,
        customizable: right.customizable,
      };
      const rightEntry: ShortcutConflict = {
        actionId: left.id,
        labelKey: left.labelKey,
        scopes: left.scopes,
        chords: leftChords,
        customizable: left.customizable,
      };
      byAction.set(left.id, [...(byAction.get(left.id) ?? []), leftEntry]);
      byAction.set(right.id, [...(byAction.get(right.id) ?? []), rightEntry]);
    }
  }
  return [...byAction.keys()].map((actionId) => {
    const action = findShortcutAction(actionId)!;
    return {
      actionId,
      labelKey: action.labelKey,
      scopes: action.scopes,
      chords: resolveActionChords(actionId, platform, bindings),
      customizable: action.customizable,
    };
  });
}

/** Validate an imported/persisted platform map before writing it. */
export function validateShortcutBindings(
  bindings: ShortcutBindings,
  platform: ShortcutPlatform,
): string | null {
  for (const [actionId, override] of Object.entries(platformBindings(bindings, platform))) {
    if (override === null) continue;
    const action = findShortcutAction(actionId);
    if (!action) continue;
    if (!action.customizable) return "shortcut-fixed";
    if (validateShortcutChord(override, platform, action.scopes, actionId) !== null) {
      return "invalid-shortcut-chord";
    }
  }
  if (findAllShortcutConflicts(platform, bindings).length > 0) {
    return "shortcut-conflict";
  }
  return null;
}

function normalizedKey(chord: ShortcutChord): string {
  return normalizedChordKey(chord);
}

function hasCommandModifier(chord: ShortcutChord): boolean {
  return chord.metaKey === true || chord.ctrlKey === true || chord.altKey === true;
}

function isFunctionKey(chord: ShortcutChord): boolean {
  return /^f\d{1,2}$/u.test(normalizedKey(chord));
}

/** System/Electron combinations that must not be assigned. */
export function reservedShortcutReason(
  chord: ShortcutChord,
  platform: ShortcutPlatform,
): "system" | null {
  const key = normalizedKey(chord);
  if (key === "escape" || key === "tab") return "system";
  if (platform === "mac") {
    // Electron's native Edit roles own these text-editing chords. Keeping
    // them out of the custom catalog lets Cut and Paste-and-Match-Style keep
    // their native menu behavior even when application accelerators change.
    if (
      chord.metaKey && !chord.ctrlKey && !chord.altKey && !chord.shiftKey
      && key === "x"
    ) return "system";
    if (
      chord.metaKey && !chord.ctrlKey && chord.altKey && chord.shiftKey
      && key === "v"
    ) return "system";
    if (chord.metaKey && !chord.ctrlKey && !chord.altKey && !chord.shiftKey) {
      if (["q", "w", "tab", "space", "h", "m"].includes(key)) return "system";
    }
    if (chord.metaKey && chord.altKey && key === "escape") return "system";
    if (chord.metaKey && chord.shiftKey && ["3", "4", "5"].includes(key)) return "system";
    if (chord.ctrlKey && !chord.metaKey && !chord.altKey && key.startsWith("arrow")) return "system";
    if (key === "f11") return "system";
    if (chord.metaKey && !chord.altKey && ["r", "p"].includes(key)) return "system";
    if (chord.metaKey && chord.altKey && ["i", "j", "c"].includes(key)) return "system";
  } else {
    // Windows text editing and Chromium's paste-as-plain-text gesture are
    // native ownership too; application shortcuts may not replace them.
    if (
      chord.ctrlKey && !chord.metaKey && !chord.altKey && !chord.shiftKey
      && key === "x"
    ) return "system";
    if (
      chord.ctrlKey && !chord.metaKey && !chord.altKey && chord.shiftKey
      && key === "v"
    ) return "system";
    if (chord.altKey && ["f4", "tab", "space"].includes(key)) return "system";
    if (chord.ctrlKey && chord.altKey && key === "delete") return "system";
    if (chord.metaKey) return "system";
    if (chord.ctrlKey && chord.shiftKey && key === "escape") return "system";
    if (chord.ctrlKey && !chord.altKey && !chord.shiftKey && ["r", "p"].includes(key)) return "system";
    if (chord.ctrlKey && chord.shiftKey && ["i", "j"].includes(key)) return "system";
    if (!chord.ctrlKey && !chord.altKey && key === "f10") return "system";
    if (chord.ctrlKey && !chord.altKey && key === "escape") return "system";
  }
  return null;
}

export function validateShortcutChord(
  chord: ShortcutChord,
  platform: ShortcutPlatform,
  scopes: readonly ShortcutScope[],
  actionId?: string,
): ShortcutValidationReason | null {
  const key = normalizedKey(chord);
  if (key === "wheel") return actionId === "viewer.image.wheel-zoom" ? null : "mouse-button";
  if (actionId === "viewer.image.wheel-zoom") return "mouse-button";
  if (key.length === 0 || key === "process" || key === "dead" || key === "unidentified") {
    return "no-key";
  }
  if (key.startsWith("mouse")) {
    if (key !== "mouseback" && key !== "mouseforward") return "mouse-button";
    if (!(chord.ctrlKey || chord.altKey || chord.shiftKey || chord.metaKey)) {
      return "mouse-modifier-required";
    }
    return null;
  }
  if (MODIFIER_KEYS.has(key)) return "modifier-only";
  if (reservedShortcutReason(chord, platform) !== null) return "system";
  const action = actionId === undefined ? undefined : findShortcutAction(actionId);
  const bareLetter = /^[a-z]$/iu.test(key)
    && !chord.ctrlKey && !chord.metaKey && !chord.altKey && !chord.shiftKey;
  if (
    bareLetter && action?.category === "viewer" &&
    (!action.surfaces.includes("hidden-accelerator") ||
      !action.surfaces.includes("before-input"))
  ) {
    return "ime-route-required";
  }
  const needsModifier = scopes.some(
    (scope) => scope === "app" || scope === "browse" || scope.startsWith("sidebar"),
  );
  // Named keys (Delete, Backspace, arrows, …) are meaningful on their own.
  // Only bare letters/digits are rejected outside a text field.
  const isNamedKey = key.length > 1 && !isFunctionKey(chord);
  if (
    needsModifier &&
    !hasCommandModifier(chord) &&
    !isFunctionKey(chord) &&
    !isNamedKey
  ) {
    return "bare-key";
  }
  return null;
}

/** Convert a DOM keydown into a stored chord, tolerating IME key="Process". */
export function chordFromKeyboardEvent(event: {
  readonly key: string;
  readonly code?: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}): ShortcutChord | null {
  const rawKey = event.key;
  if (MODIFIER_KEYS.has(rawKey.toLowerCase())) return null;
  if (rawKey === "Dead" || rawKey === "Unidentified") return null;

  let key = rawKey;
  if (!key || key === "Process") {
    const code = event.code ?? "";
    if (/^Key[A-Z]$/u.test(code)) key = code.slice(3).toLowerCase();
    else if (/^Digit[0-9]$/u.test(code)) key = code.slice(5);
    else if (/^F\d{1,2}$/u.test(code)) key = code;
    else key = code;
  }
  if (key.length === 1) key = key.toLowerCase();
  if (key === " ") key = "Space";
  if (!key) return null;

  return {
    key,
    ...(event.code === undefined ? {} : { code: event.code }),
    ...(event.metaKey ? { metaKey: true } : {}),
    ...(event.ctrlKey ? { ctrlKey: true } : {}),
    ...(event.altKey ? { altKey: true } : {}),
    ...(event.shiftKey ? { shiftKey: true } : {}),
  };
}

export function shortcutActionForId(
  actionId: string,
): ShortcutActionDefinition | undefined {
  return findShortcutAction(actionId);
}
