/**
 * Coordinates VIEWER-018 letter-shortcut capture for a webContents:
 * Windows Menu accelerators + IMM32 IME suspend + before-input arm flag.
 */

import { BrowserWindow, type WebContents } from "electron";

import { resetViewerVideoShortcutForwardForTests } from "../shared/viewer-video-shortcut-dedupe";
import {
  DEFAULT_SHORTCUT_BINDINGS,
  shortcutPlatformFromProcess,
  type ShortcutBindings,
} from "../shared/shortcut-bindings";
import {
  viewerVideoShortcutNeedsImeSuspension,
  type ViewerShortcutScope,
} from "../shared/viewer-video-shortcuts";
import { setViewerVideoShortcutMenuActive } from "./viewer-video-shortcut-menu";
import {
  restoreWindowsIme,
  suspendWindowsIme,
  type WindowsImeSuspendToken,
} from "./windows-ime";

const imeTokensByContentsId = new Map<number, WindowsImeSuspendToken>();
const activeScopeByContentsId = new Map<number, ViewerShortcutScope>();
const imeSuspendByContentsId = new Map<number, boolean>();

function refreshViewerMenus(): void {
  const activeScopes = new Set(activeScopeByContentsId.values());
  setViewerVideoShortcutMenuActive(activeScopes.has("viewer.video"), "viewer.video");
  setViewerVideoShortcutMenuActive(activeScopes.has("viewer.audio"), "viewer.audio");
}

export function isViewerVideoShortcutContentsActive(
  contentsId: number,
): boolean {
  return activeScopeByContentsId.has(contentsId);
}

export function viewerShortcutScopeForContents(
  contentsId: number,
): ViewerShortcutScope | null {
  return activeScopeByContentsId.get(contentsId) ?? null;
}

export function setViewerVideoShortcutCaptureActive(
  contents: WebContents,
  active: boolean,
  bindings: ShortcutBindings = DEFAULT_SHORTCUT_BINDINGS,
  scope: ViewerShortcutScope = "viewer.video",
  suspendIme = scope !== "viewer.video",
): void {
  const contentsId = contents.id;
  if (active) {
    const previousScope = activeScopeByContentsId.get(contentsId);
    const previousSuspend = imeSuspendByContentsId.get(contentsId) ?? false;
    const shouldSuspend = suspendIme && viewerVideoShortcutNeedsImeSuspension(
      bindings,
      shortcutPlatformFromProcess(process.platform),
      scope,
    );
    activeScopeByContentsId.set(contentsId, scope);
    imeSuspendByContentsId.set(contentsId, shouldSuspend);
    refreshViewerMenus();
    if (previousScope === scope && previousSuspend === shouldSuspend) return;

    const previousToken = imeTokensByContentsId.get(contentsId) ?? null;
    imeTokensByContentsId.delete(contentsId);
    restoreWindowsIme(previousToken);

    // Letter shortcuts still use the hidden menu accelerator. Closing the
    // input method is optional, so an open IME is left alone unless requested.
    if (shouldSuspend) {
      const window = BrowserWindow.fromWebContents(contents);
      const token = suspendWindowsIme(window);
      if (token) {
        imeTokensByContentsId.set(contentsId, token);
      }
    }
    return;
  }

  activeScopeByContentsId.delete(contentsId);
  imeSuspendByContentsId.delete(contentsId);
  const token = imeTokensByContentsId.get(contentsId) ?? null;
  imeTokensByContentsId.delete(contentsId);
  restoreWindowsIme(token);
  refreshViewerMenus();
}

export function clearViewerVideoShortcutCapture(contentsId: number): void {
  if (
    !activeScopeByContentsId.has(contentsId) &&
    !imeTokensByContentsId.has(contentsId)
  ) {
    return;
  }
  activeScopeByContentsId.delete(contentsId);
  imeSuspendByContentsId.delete(contentsId);
  const token = imeTokensByContentsId.get(contentsId) ?? null;
  imeTokensByContentsId.delete(contentsId);
  restoreWindowsIme(token);
  refreshViewerMenus();
}

export function resetViewerVideoShortcutCaptureForTests(): void {
  for (const token of imeTokensByContentsId.values()) {
    restoreWindowsIme(token);
  }
  imeTokensByContentsId.clear();
  activeScopeByContentsId.clear();
  imeSuspendByContentsId.clear();
  resetViewerVideoShortcutForwardForTests();
  setViewerVideoShortcutMenuActive(false);
}
