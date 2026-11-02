/**
 * Workspace tab chords (⌘T / Ctrl+T, ⌘W / Ctrl+W).
 *
 * The native Window menu must not own ⌘W. This listener closes the current
 * tab instead, and does nothing when the last tab, a text field, a modal,
 * or the viewer already owns the key. The window stays open.
 */

import { useEffect, useRef } from "react";

import type { ShortcutPlatform } from "../shared/shortcut-catalog";
import type { ShortcutEventLike } from "../shared/shortcut-resolution";
import { isEditableAssetActionKeyboardTarget } from "./asset-action-keyboard";
import { isImeKeyboardEvent } from "./ime-safe-dismiss";
import { listenForShortcutInputs, matchesRuntimeShortcut } from "./shortcut-runtime";
import { hasActiveModalDialog } from "./use-dialog-focus-trap";

export type WorkspaceTabShortcutCommand = "new" | "close";

export type WorkspaceTabShortcutEffect = "new-tab" | "close-tab" | "swallow" | "ignore";

export function matchWorkspaceTabShortcut(
  input: ShortcutEventLike,
  platform: ShortcutPlatform,
): WorkspaceTabShortcutCommand | null {
  if (matchesRuntimeShortcut("workspace.new-tab", input, platform) === true) return "new";
  if (matchesRuntimeShortcut("workspace.close-tab", input, platform) === true) return "close";
  return null;
}

export function workspaceTabShortcutEffect(input: {
  readonly command: WorkspaceTabShortcutCommand | null;
  readonly libraryOpen: boolean;
  readonly busy: boolean;
  readonly tabCount: number;
  /** Text field or modal owns the key. */
  readonly surfaceBlocked: boolean;
  /** Viewer is open: close-tab must not remove the tab underneath it. */
  readonly previewOpen: boolean;
}): WorkspaceTabShortcutEffect {
  if (!input.libraryOpen || input.command === null) return "ignore";
  if (input.surfaceBlocked || input.busy) return "swallow";
  if (input.command === "new") return "new-tab";
  if (input.previewOpen || input.tabCount <= 1) return "swallow";
  return "close-tab";
}

export function useWorkspaceTabShortcuts(args: {
  readonly enabled: boolean;
  readonly platform: ShortcutPlatform;
  readonly busy: boolean;
  readonly tabCount: number;
  readonly previewOpen: boolean;
  readonly onNewTab: () => void;
  readonly onCloseTab: () => void;
}): void {
  const handlersRef = useRef({
    onNewTab: args.onNewTab,
    onCloseTab: args.onCloseTab,
  });
  useEffect(() => {
    handlersRef.current = {
      onNewTab: args.onNewTab,
      onCloseTab: args.onCloseTab,
    };
  }, [args.onCloseTab, args.onNewTab]);

  useEffect(() => {
    if (!args.enabled) return;
    const onShortcut = (input: ShortcutEventLike, event: KeyboardEvent | MouseEvent) => {
      if (!(event instanceof KeyboardEvent)) return;
      if (isImeKeyboardEvent(event)) return;
      const effect = workspaceTabShortcutEffect({
        command: matchWorkspaceTabShortcut(input, args.platform),
        libraryOpen: true,
        busy: args.busy,
        tabCount: args.tabCount,
        surfaceBlocked: hasActiveModalDialog()
          || isEditableAssetActionKeyboardTarget(event.target),
        previewOpen: args.previewOpen,
      });
      if (effect === "ignore") return;
      event.preventDefault();
      event.stopPropagation();
      if (effect === "new-tab") handlersRef.current.onNewTab();
      else if (effect === "close-tab") handlersRef.current.onCloseTab();
    };
    return listenForShortcutInputs(document, onShortcut, true);
  }, [args.busy, args.enabled, args.platform, args.previewOpen, args.tabCount]);
}
