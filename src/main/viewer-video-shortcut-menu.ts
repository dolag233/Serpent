/**
 * Windows hidden Menu accelerators (VIEWER-018 + Serpent-g8u9).
 *
 * Electron documents Menu accelerators as the reliable *local* shortcut path.
 * On Windows we hide the bar for the frameless shell; Chromium then has no
 * accelerators for F2/Delete, and renderer keydown is unreliable for those
 * keys (same class of bug as video D/F/X/C under a CJK IME).
 *
 * Hidden items:
 * - always: F11 window fullscreen (Serpent-692279)
 * - always: F2 / Delete / Shift+Delete (browse rename / trash / disk-delete)
 * - while the video viewer is armed: D / F / X / C
 *
 * Disarming video must NOT restore `Menu.setApplicationMenu(null)` — that
 * would drop F2/Delete again and reintroduce View→Zoom roles
 * (Serpent-46i9 / znex). Browse items are disabled while the renderer reports
 * an editable field or modal so search-box Delete still edits text.
 */

import { BrowserWindow, Menu, type BaseWindow, type MenuItem } from "electron";

import type { ShortcutPlatform } from "../shared/shortcut-catalog";
import {
  DEFAULT_SHORTCUT_BINDINGS,
  type ShortcutBindings,
} from "../shared/shortcut-bindings";
import {
  formatElectronAccelerator,
  matchesActionShortcut,
  resolveActionChords,
} from "../shared/shortcut-resolution";
import {
  APPLICATION_MENU_COMMAND_CHANNEL,
  COPY_SELECTION_CHANNEL,
  INVERT_SELECTION_CHANNEL,
} from "../shared/protocol/channels";
import { shouldForwardViewerVideoShortcut } from "../shared/viewer-video-shortcut-dedupe";
import type { BrowseKeyboardAction } from "../shared/browse-keyboard-shortcuts";
import {
  viewerMainShortcutRoutes,
  type ViewerShortcutScope,
  type ViewerVideoShortcutAction,
} from "../shared/viewer-video-shortcuts";
import { shouldHideApplicationMenuBar } from "../shared/window-controls";
import {
  forwardBrowseShortcutToWindow,
  type BrowseShortcutChord,
} from "./browse-shortcut-forward";
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

const COPY_PATH_ACCELERATOR_ACTIONS = [
  "asset.copy-file-path",
  "folder.copy-path",
] as const;

const activeViewerScopes = new Set<ViewerShortcutScope>();
let browseEnabled = true;
let applicationShortcutsEnabled = true;
let menuInstalled = false;
let activeBindings: ShortcutBindings = DEFAULT_SHORTCUT_BINDINGS;

const WINDOWS_MENU_ACTIONS = [
  "edit.undo",
  "edit.redo",
  "asset.copy",
  "asset.cut",
  "asset.paste",
  "selection.select-all",
  "selection.invert",
  "canvas.zoom-in",
  "canvas.zoom-out",
  "canvas.zoom-reset",
  "window.toggle-fullscreen",
] as const;

const MENU_COMMAND_BY_ACTION: Readonly<Record<string, string>> = {
  "edit.undo": "edit.undo",
  "edit.redo": "edit.redo",
  "asset.copy": "copy-selection",
  "asset.cut": "edit.cut",
  "asset.paste": "edit.paste",
  "selection.select-all": "edit.select-all",
  "selection.invert": "invert-selection",
  "canvas.zoom-in": "canvas.zoom-in",
  "canvas.zoom-out": "canvas.zoom-out",
  "canvas.zoom-reset": "canvas.zoom-reset",
  "window.toggle-fullscreen": "window.toggle-fullscreen",
};

type MainMenuShortcutAction = (typeof WINDOWS_MENU_ACTIONS)[number];

function shortcutPlatform(): ShortcutPlatform {
  return process.platform === "darwin" ? "mac" : "windows";
}

function applicationMenuShortcutItems(): Electron.MenuItemConstructorOptions[] {
  const platform = shortcutPlatform();
  return WINDOWS_MENU_ACTIONS.flatMap((actionId) =>
    resolveActionChords(actionId, platform, activeBindings).map((chord, index) => {
      const accelerator = formatElectronAccelerator(chord, platform);
      return {
        id: `shortcut.${actionId}.${index}`,
        label: `Shortcut ${actionId}`,
        ...(accelerator === null ? {} : { accelerator }),
        acceleratorWorksWhenHidden: true,
        enabled: applicationShortcutsEnabled,
        click: (_menuItem: MenuItem, window: BaseWindow | undefined) => {
          forwardApplicationShortcutToWindow(window as BrowserWindow | undefined, actionId);
        },
      };
    }),
  );
}

function viewerAcceleratorItems(): Electron.MenuItemConstructorOptions[] {
  const platform = shortcutPlatform();
  const routes = [...new Map(
    [...activeViewerScopes].flatMap((scope) => viewerMainShortcutRoutes(scope))
      .map((route) => [route.id, route] as const),
  ).values()];
  return routes.flatMap(({ id, label, action }) =>
    resolveActionChords(id, platform, activeBindings).map((chord) => {
      const accelerator = formatElectronAccelerator(chord, platform);
      return {
        id: `shortcut.${id}`,
        label,
        ...(accelerator === null ? {} : { accelerator }),
        acceleratorWorksWhenHidden: true,
        click: (_menuItem: MenuItem, window: BaseWindow | undefined) => {
          forwardViewerVideoShortcutToWindow(
            window as BrowserWindow | undefined,
            action as ViewerVideoShortcutAction,
          );
        },
      };
    }),
  );
}

export function matchWindowsApplicationShortcut(input: {
  readonly key: string;
  readonly code?: string;
  readonly keyCode?: number;
  readonly control?: boolean;
  readonly meta?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
  readonly isAutoRepeat?: boolean;
}): MainMenuShortcutAction | null {
  if (!applicationShortcutsEnabled || input.isAutoRepeat === true) return null;
  const event = {
    key: input.key,
    code: input.code,
    keyCode: input.keyCode,
    ctrlKey: input.control === true,
    metaKey: input.meta === true,
    altKey: input.alt === true,
    shiftKey: input.shift === true,
  };
  return WINDOWS_MENU_ACTIONS.find((actionId) =>
    matchesActionShortcut(actionId, event, "windows", activeBindings),
  ) ?? null;
}

/** True for a matching key even when it is an auto-repeat we must consume. */
export function isWindowsApplicationShortcut(input: {
  readonly key: string;
  readonly code?: string;
  readonly keyCode?: number;
  readonly control?: boolean;
  readonly meta?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
}): boolean {
  return matchWindowsApplicationShortcut(input) !== null;
}

export function forwardApplicationShortcutToWindow(
  window: BrowserWindow | null | undefined,
  actionId: MainMenuShortcutAction,
): void {
  if (!shouldForwardViewerVideoShortcut(`application:${actionId}`)) return;
  const target = window && !window.isDestroyed()
    ? window
    : BrowserWindow.getFocusedWindow();
  if (!target || target.isDestroyed()) return;
  if (actionId === "asset.copy") {
    target.webContents.send(COPY_SELECTION_CHANNEL);
    return;
  }
  if (actionId === "selection.invert") {
    target.webContents.send(INVERT_SELECTION_CHANNEL);
    return;
  }
  target.webContents.send(
    APPLICATION_MENU_COMMAND_CHANNEL,
    MENU_COMMAND_BY_ACTION[actionId],
  );
}

function hideMenuBarOnAllWindows(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.setAutoHideMenuBar(true);
    window.setMenuBarVisibility(false);
  }
}

function browseCopyPathAcceleratorItems(): Electron.MenuItemConstructorOptions[] {
  const platform = shortcutPlatform();
  const seen = new Set<string>();
  const items: Electron.MenuItemConstructorOptions[] = [];
  for (const actionId of COPY_PATH_ACCELERATOR_ACTIONS) {
    resolveActionChords(actionId, platform, activeBindings).forEach((chord, index) => {
      const accelerator = formatElectronAccelerator(chord, platform);
      if (
        accelerator === null
        || seen.has(accelerator)
        || accelerator === "F2"
        || accelerator === "Delete"
        || accelerator === "Shift+Delete"
      ) return;
      seen.add(accelerator);
      const id = `browse.copy-path.${actionId}.${index}`;
      const forwarded: BrowseShortcutChord = {
        key: chord.key,
        ...(chord.code === undefined ? {} : { code: chord.code }),
        ctrlKey: chord.ctrlKey === true,
        metaKey: chord.metaKey === true,
        altKey: chord.altKey === true,
        shiftKey: chord.shiftKey === true,
      };
      items.push({
        id,
        label: "Copy Path",
        accelerator,
        acceleratorWorksWhenHidden: true,
        enabled: true,
        click: (_menuItem: MenuItem, window: BaseWindow | undefined) => {
          forwardBrowseShortcutToWindow(
            window as BrowserWindow | undefined,
            "copy-path",
            forwarded,
          );
        },
      });
    });
  }
  return items;
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
    ...browseCopyPathAcceleratorItems(),
    ...applicationMenuShortcutItems(),
    ...(activeViewerScopes.size > 0 ? viewerAcceleratorItems() : []),
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

function applyApplicationShortcutsEnabled(): void {
  const menu = Menu.getApplicationMenu();
  if (!menu) return;
  for (const actionId of WINDOWS_MENU_ACTIONS) {
    const chords = resolveActionChords(actionId, shortcutPlatform(), activeBindings);
    chords.forEach((_chord, index) => {
      const menuItem = menu.getMenuItemById(`shortcut.${actionId}.${index}`);
      if (menuItem) menuItem.enabled = applicationShortcutsEnabled;
    });
  }
}

/** Install the hidden Windows accelerator menu (browse keys, no video yet). */
export function installWindowsHiddenAcceleratorMenu(
  bindings: ShortcutBindings = activeBindings,
): void {
  activeBindings = bindings;
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

/** App commands remain available in viewers, but yield to text and modal focus. */
export function setWindowsApplicationShortcutAcceleratorsEnabled(
  enabled: boolean,
): void {
  applicationShortcutsEnabled = enabled;
  if (!menuInstalled) return;
  applyApplicationShortcutsEnabled();
}

/**
 * Install or tear down active viewer accelerators on top of browse keys.
 * No-op on macOS/Linux (those keep the normal application menu).
 */
export function setViewerVideoShortcutMenuActive(
  active: boolean,
  scope: ViewerShortcutScope = "viewer.video",
): void {
  if (!shouldHideApplicationMenuBar(process.platform)) {
    return;
  }

  if (active) {
    const wasActive = activeViewerScopes.has(scope);
    activeViewerScopes.add(scope);
    if (wasActive) {
      hideMenuBarOnAllWindows();
      return;
    }
    rebuildWindowsAcceleratorMenu();
    return;
  }

  if (!activeViewerScopes.delete(scope)) return;
  rebuildWindowsAcceleratorMenu();
}

export function isViewerVideoShortcutMenuActiveForTests(): boolean {
  return activeViewerScopes.size > 0;
}

export function resetViewerVideoShortcutMenuForTests(): void {
  activeViewerScopes.clear();
  browseEnabled = true;
  applicationShortcutsEnabled = true;
  menuInstalled = false;
  activeBindings = DEFAULT_SHORTCUT_BINDINGS;
  if (shouldHideApplicationMenuBar(process.platform)) {
    Menu.setApplicationMenu(null);
  }
}
