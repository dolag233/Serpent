/**
 * Coordinates VIEWER-018 letter-shortcut capture for a webContents:
 * Windows Menu accelerators + IMM32 IME suspend + before-input arm flag.
 */

import { BrowserWindow, type WebContents } from "electron";

import { resetViewerVideoShortcutForwardForTests } from "../shared/viewer-video-shortcut-dedupe";
import { setViewerVideoShortcutMenuActive } from "./viewer-video-shortcut-menu";
import {
  restoreWindowsIme,
  suspendWindowsIme,
  type WindowsImeSuspendToken,
} from "./windows-ime";

const imeTokensByContentsId = new Map<number, WindowsImeSuspendToken>();
const activeContentsIds = new Set<number>();

export function isViewerVideoShortcutContentsActive(
  contentsId: number,
): boolean {
  return activeContentsIds.has(contentsId);
}

export function setViewerVideoShortcutCaptureActive(
  contents: WebContents,
  active: boolean,
): void {
  const contentsId = contents.id;
  if (active) {
    const alreadyArmed = activeContentsIds.has(contentsId);
    activeContentsIds.add(contentsId);
    setViewerVideoShortcutMenuActive(true);
    if (alreadyArmed) return;

    const window = BrowserWindow.fromWebContents(contents);
    const token = suspendWindowsIme(window);
    if (token) {
      imeTokensByContentsId.set(contentsId, token);
    }
    return;
  }

  activeContentsIds.delete(contentsId);
  const token = imeTokensByContentsId.get(contentsId) ?? null;
  imeTokensByContentsId.delete(contentsId);
  restoreWindowsIme(token);
  if (activeContentsIds.size === 0) {
    setViewerVideoShortcutMenuActive(false);
  }
}

export function clearViewerVideoShortcutCapture(contentsId: number): void {
  if (
    !activeContentsIds.has(contentsId) &&
    !imeTokensByContentsId.has(contentsId)
  ) {
    return;
  }
  activeContentsIds.delete(contentsId);
  const token = imeTokensByContentsId.get(contentsId) ?? null;
  imeTokensByContentsId.delete(contentsId);
  restoreWindowsIme(token);
  if (activeContentsIds.size === 0) {
    setViewerVideoShortcutMenuActive(false);
  }
}

export function resetViewerVideoShortcutCaptureForTests(): void {
  for (const token of imeTokensByContentsId.values()) {
    restoreWindowsIme(token);
  }
  imeTokensByContentsId.clear();
  activeContentsIds.clear();
  resetViewerVideoShortcutForwardForTests();
  setViewerVideoShortcutMenuActive(false);
}
