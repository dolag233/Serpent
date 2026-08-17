/**
 * Windows hidden Menu accelerators (VIEWER-018 + Serpent-g8u9).
 *
 * Electron documents Menu accelerators as the reliable *local* shortcut path.
 * On Windows we hide the bar for the frameless shell; Chromium then has no
 * accelerators for F2/Delete, and renderer keydown is unreliable for those
 * keys (same class of bug as video D/F/X/C under a CJK IME).
 *
 * Hidden items:
 * - always: F2 / Delete / Shift+Delete (browse rename / trash / disk-delete)
 * - while the video viewer is armed: D / F / X / C
 *
 * Disarming video must NOT restore `Menu.setApplicationMenu(null)` — that
 * would drop F2/Delete again and reintroduce View→Zoom roles
 * (Serpent-46i9 / znex). Browse items are disabled while the renderer reports
 * an editable field or modal so search-box Delete still edits text.
 */

import { BrowserWindow, Menu, type BaseWindow, type MenuItem } from "electron";

import type { BrowseKeyboardAction } from "../shared/browse-keyboard-shortcuts";
import type { ViewerVideoShortcutAction } from "../shared/viewer-video-shortcuts";
import { shouldHideApplicationMenuBar } from "../shared/window-controls";
import { forwardBrowseShortcutToWindow } from "./browse-shortcut-forward";
import { forwardViewerVideoShortcutToWindow } from "./viewer-video-shortcut-forward";

const BROWSE_ACCELERATOR_ITEMS: ReadonlyArray<{
  id: string;
  label: string;
  accelerator: string;
  action: BrowseKeyboardAction;
}> = [
  { id: "browse.rename", label: "Rename", accelerator: "F2", action: "rename" },
  {
    id: "browse.trash",
    label: "Move to Trash",
    accelerator: "Delete",
    action: "trash",
  },
  {
    id: "browse.disk-delete",
    label: "Delete from Disk",
    accelerator: "Shift+Delete",
    action: "disk-delete",
  },
];

const VIDEO_ACCELERATOR_ITEMS: ReadonlyArray<{
  label: string;
  accelerator: string;
  action: ViewerVideoShortcutAction;
}> = [
  { label: "Previous frame", accelerator: "D", action: "frame-prev" },
  { label: "Next frame", accelerator: "F", action: "frame-next" },
  { label: "Slower playback", accelerator: "X", action: "rate-slower" },
  { label: "Faster playback", accelerator: "C", action: "rate-faster" },
];

let videoArmed = false;
let browseEnabled = true;
let menuInstalled = false;

function hideMenuBarOnAllWindows(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.setAutoHideMenuBar(true);
    window.setMenuBarVisibility(false);
  }
}

function rebuildWindowsAcceleratorMenu(): void {
  if (!shouldHideApplicationMenuBar(process.platform)) {
    return;
  }

  const submenu: Electron.MenuItemConstructorOptions[] = [
    ...BROWSE_ACCELERATOR_ITEMS.map((item) => ({
      id: item.id,
      label: item.label,
      accelerator: item.accelerator,
      acceleratorWorksWhenHidden: true,
      enabled: browseEnabled,
      click: (_menuItem: MenuItem, window: BaseWindow | undefined) => {
        forwardBrowseShortcutToWindow(window as BrowserWindow | undefined, item.action);
      },
    })),
    ...(videoArmed
      ? VIDEO_ACCELERATOR_ITEMS.map((item) => ({
          label: item.label,
          accelerator: item.accelerator,
          acceleratorWorksWhenHidden: true,
          click: (_menuItem: MenuItem, window: BaseWindow | undefined) => {
            forwardViewerVideoShortcutToWindow(
              window as BrowserWindow | undefined,
              item.action,
            );
          },
        }))
      : []),
  ];

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ label: "Serpent", submenu }]),
  );
  hideMenuBarOnAllWindows();
  menuInstalled = true;
}

function applyBrowseEnabled(): void {
  const menu = Menu.getApplicationMenu();
  if (!menu) return;
  for (const item of BROWSE_ACCELERATOR_ITEMS) {
    const menuItem = menu.getMenuItemById(item.id);
    if (menuItem) menuItem.enabled = browseEnabled;
  }
}

/** Install the hidden Windows accelerator menu (browse keys, no video yet). */
export function installWindowsHiddenAcceleratorMenu(): void {
  videoArmed = false;
  rebuildWindowsAcceleratorMenu();
}

/**
 * Enable/disable F2·Delete accelerators. Renderer sets this false while an
 * input, dialog, or preview owns the keys.
 */
export function setWindowsBrowseShortcutAcceleratorsEnabled(
  enabled: boolean,
): void {
  browseEnabled = enabled;
  if (!menuInstalled) return;
  applyBrowseEnabled();
}

/**
 * Install or tear down the video letter accelerators on top of browse keys.
 * No-op on macOS/Linux (those keep the normal application menu).
 */
export function setViewerVideoShortcutMenuActive(active: boolean): void {
  if (!shouldHideApplicationMenuBar(process.platform)) {
    return;
  }

  if (active) {
    if (videoArmed) {
      hideMenuBarOnAllWindows();
      return;
    }
    videoArmed = true;
    rebuildWindowsAcceleratorMenu();
    return;
  }

  if (!videoArmed) return;
  videoArmed = false;
  rebuildWindowsAcceleratorMenu();
}

export function isViewerVideoShortcutMenuActiveForTests(): boolean {
  return videoArmed;
}

export function resetViewerVideoShortcutMenuForTests(): void {
  videoArmed = false;
  browseEnabled = true;
  menuInstalled = false;
  if (shouldHideApplicationMenuBar(process.platform)) {
    Menu.setApplicationMenu(null);
  }
}
