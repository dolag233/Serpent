/**
 * Shared IPC forward for VIEWER-018 (Menu vs before-input).
 */

import { BrowserWindow, type WebContents } from "electron";

import { VIEWER_VIDEO_SHORTCUT_CHANNEL } from "../shared/protocol/channels";
import {
  resetViewerVideoShortcutForwardForTests as resetDedupe,
  shouldForwardViewerVideoShortcut,
} from "../shared/viewer-video-shortcut-dedupe";
import type { ViewerVideoShortcutAction } from "../shared/viewer-video-shortcuts";

export { shouldForwardViewerVideoShortcut };

export function forwardViewerVideoShortcut(
  contents: WebContents | null | undefined,
  action: ViewerVideoShortcutAction,
): void {
  if (!contents || contents.isDestroyed()) return;
  if (!shouldForwardViewerVideoShortcut(action)) return;
  contents.send(VIEWER_VIDEO_SHORTCUT_CHANNEL, { action });
}

export function forwardViewerVideoShortcutToWindow(
  window: BrowserWindow | null | undefined,
  action: ViewerVideoShortcutAction,
): void {
  const target =
    window && !window.isDestroyed()
      ? window
      : BrowserWindow.getFocusedWindow();
  if (!target || target.isDestroyed()) return;
  forwardViewerVideoShortcut(target.webContents, action);
}

export function resetViewerVideoShortcutForwardForTests(): void {
  resetDedupe();
}
