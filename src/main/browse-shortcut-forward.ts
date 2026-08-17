/**
 * Shared IPC forward for browse F2 / Delete (Menu vs before-input).
 */

import { BrowserWindow, type WebContents } from "electron";

import { BROWSE_SHORTCUT_CHANNEL } from "../shared/protocol/channels";
import {
  resetBrowseShortcutForwardForTests as resetDedupe,
  shouldForwardBrowseShortcut,
} from "../shared/browse-shortcut-dedupe";
import type { BrowseKeyboardAction } from "../shared/browse-keyboard-shortcuts";

export { shouldForwardBrowseShortcut };

export function forwardBrowseShortcut(
  contents: WebContents | null | undefined,
  action: BrowseKeyboardAction,
): void {
  if (!contents || contents.isDestroyed()) return;
  if (!shouldForwardBrowseShortcut(action)) return;
  contents.send(BROWSE_SHORTCUT_CHANNEL, { action });
}

export function forwardBrowseShortcutToWindow(
  window: BrowserWindow | null | undefined,
  action: BrowseKeyboardAction,
): void {
  const target =
    window && !window.isDestroyed()
      ? window
      : BrowserWindow.getFocusedWindow();
  if (!target || target.isDestroyed()) return;
  forwardBrowseShortcut(target.webContents, action);
}

export function resetBrowseShortcutForwardForTests(): void {
  resetDedupe();
}
