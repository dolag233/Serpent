/**
 * Browse-canvas F2 / Delete / Shift+Delete (Serpent-g8u9).
 *
 * Windows frameless shell has no application menu, so these keys must be
 * matched from Main `before-input-event` / hidden accelerators as well as
 * Renderer `keydown`. Keep the matcher independent of DOM KeyboardEvent.
 */

export const BROWSE_KEYBOARD_ACTIONS = [
  "rename",
  "trash",
  "disk-delete",
] as const;

export type BrowseKeyboardAction = (typeof BROWSE_KEYBOARD_ACTIONS)[number];

export type BrowseKeyboardInput = {
  readonly type?: string;
  readonly key?: string;
  readonly code?: string;
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

function isKeyDown(input: BrowseKeyboardInput): boolean {
  const type = input.type ?? "keyDown";
  return type === "keyDown" || type === "keydown";
}

function hasCtrl(input: BrowseKeyboardInput): boolean {
  return Boolean(input.control ?? input.ctrlKey);
}

function hasMeta(input: BrowseKeyboardInput): boolean {
  return Boolean(input.meta ?? input.metaKey);
}

function hasAlt(input: BrowseKeyboardInput): boolean {
  return Boolean(input.alt ?? input.altKey);
}

function isF2(input: BrowseKeyboardInput): boolean {
  const key = (input.key ?? "").toLowerCase();
  const code = (input.code ?? "").toLowerCase();
  return key === "f2" || code === "f2" || input.keyCode === 113;
}

function isDelete(input: BrowseKeyboardInput): boolean {
  const key = (input.key ?? "").toLowerCase();
  const code = (input.code ?? "").toLowerCase();
  return (
    key === "delete" ||
    key === "del" ||
    code === "delete" ||
    code === "del" ||
    input.keyCode === 46
  );
}

/**
 * Match unmodified F2 / Delete / Shift+Delete from Main before-input or DOM.
 */
export function matchBrowseKeyboardShortcut(
  input: BrowseKeyboardInput,
): BrowseKeyboardAction | null {
  if (!isKeyDown(input)) return null;
  if (hasCtrl(input) || hasMeta(input) || hasAlt(input)) return null;

  const shift = Boolean(input.shift ?? input.shiftKey);
  if (isF2(input) && !shift) return "rename";
  if (isDelete(input) && shift) return "disk-delete";
  if (isDelete(input) && !shift) return "trash";
  return null;
}

export function browseKeyboardActionToDomInit(
  action: BrowseKeyboardAction,
): {
  readonly key: string;
  readonly code: string;
  readonly keyCode: number;
  readonly shiftKey: boolean;
} {
  if (action === "rename") {
    return { key: "F2", code: "F2", keyCode: 113, shiftKey: false };
  }
  if (action === "disk-delete") {
    return { key: "Delete", code: "Delete", keyCode: 46, shiftKey: true };
  }
  return { key: "Delete", code: "Delete", keyCode: 46, shiftKey: false };
}
