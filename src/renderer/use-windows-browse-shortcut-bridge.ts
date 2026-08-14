/**
 * Windows Main → Renderer bridge for F2 / Delete (Serpent-g8u9).
 *
 * Hidden menu accelerators and before-input both arrive here. Re-dispatch as
 * a document keydown so folder, collection, and browse handlers share one
 * path. Skip when an editable field or modal already owns the keys.
 */

import { useEffect } from "react";

import {
  BROWSE_KEYBOARD_ACTIONS,
  browseKeyboardActionToDomInit,
  type BrowseKeyboardAction,
} from "../shared/browse-keyboard-shortcuts";

export type BrowseShortcutShell = {
  readonly onBrowseShortcut?: (
    listener: (action: BrowseKeyboardAction) => void,
  ) => () => void;
  readonly setBrowseShortcutAcceleratorsEnabled?: (enabled: boolean) => void;
};

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function isBrowseKeyboardAction(value: string): value is BrowseKeyboardAction {
  return (BROWSE_KEYBOARD_ACTIONS as readonly string[]).includes(value);
}

export function useWindowsBrowseShortcutBridge(args: {
  readonly shell: BrowseShortcutShell | null | undefined;
  readonly enabled: boolean;
  /** True while inputs, dialogs, or preview must keep F2/Delete. */
  readonly acceleratorsBlocked: boolean;
}): void {
  const { shell, enabled, acceleratorsBlocked } = args;

  useEffect(() => {
    shell?.setBrowseShortcutAcceleratorsEnabled?.(
      enabled && !acceleratorsBlocked,
    );
  }, [shell, enabled, acceleratorsBlocked]);

  useEffect(() => {
    if (!enabled || !shell?.onBrowseShortcut) return;

    return shell.onBrowseShortcut((action) => {
      if (!isBrowseKeyboardAction(action)) return;
      if (acceleratorsBlocked) return;
      if (isEditableKeyboardTarget(document.activeElement)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;

      const init = browseKeyboardActionToDomInit(action);
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: init.key,
          code: init.code,
          bubbles: true,
          cancelable: true,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey: init.shiftKey,
        }),
      );
    });
  }, [shell, enabled, acceleratorsBlocked]);
}
