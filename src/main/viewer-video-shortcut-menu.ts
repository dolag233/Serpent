/**
 * Windows local Menu accelerators for video letter shortcuts (VIEWER-018).
 *
 * Electron documents Menu accelerators as the reliable *local* shortcut path.
 * On Windows we normally set `Menu.setApplicationMenu(null)` for the frameless
 * shell; while the video viewer is armed we install a hidden bar with D/F/X/C
 * so keys are handled natively even when a CJK IME is open. Disarm restores
 * `null` so we do not reintroduce View→Zoom roles (Serpent-46i9 / znex).
 */

import { BrowserWindow, Menu } from "electron";

import type { ViewerVideoShortcutAction } from "../shared/viewer-video-shortcuts";
import { shouldHideApplicationMenuBar } from "../shared/window-controls";
import { forwardViewerVideoShortcutToWindow } from "./viewer-video-shortcut-forward";

const ACCELERATOR_ITEMS: ReadonlyArray<{
  label: string;
  accelerator: string;
  action: ViewerVideoShortcutAction;
}> = [
  { label: "Previous frame", accelerator: "D", action: "frame-prev" },
  { label: "Next frame", accelerator: "F", action: "frame-next" },
  { label: "Slower playback", accelerator: "X", action: "rate-slower" },
  { label: "Faster playback", accelerator: "C", action: "rate-faster" },
];

let menuArmed = false;

function hideMenuBarOnAllWindows(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.setAutoHideMenuBar(true);
    window.setMenuBarVisibility(false);
  }
}

/**
 * Install or tear down the hidden Windows accelerator menu.
 * No-op on macOS/Linux (those keep the normal application menu).
 */
export function setViewerVideoShortcutMenuActive(active: boolean): void {
  if (!shouldHideApplicationMenuBar(process.platform)) {
    return;
  }

  if (active) {
    if (menuArmed) {
      hideMenuBarOnAllWindows();
      return;
    }
    const menu = Menu.buildFromTemplate([
      {
        label: "Viewer",
        submenu: ACCELERATOR_ITEMS.map((item) => ({
          label: item.label,
          accelerator: item.accelerator,
          acceleratorWorksWhenHidden: true,
          click: (_menuItem, browserWindow) => {
            forwardViewerVideoShortcutToWindow(
              browserWindow as BrowserWindow | undefined,
              item.action,
            );
          },
        })),
      },
    ]);
    Menu.setApplicationMenu(menu);
    hideMenuBarOnAllWindows();
    menuArmed = true;
    return;
  }

  if (!menuArmed) return;
  Menu.setApplicationMenu(null);
  menuArmed = false;
}

export function isViewerVideoShortcutMenuActiveForTests(): boolean {
  return menuArmed;
}

export function resetViewerVideoShortcutMenuForTests(): void {
  if (menuArmed) {
    Menu.setApplicationMenu(null);
  }
  menuArmed = false;
}
