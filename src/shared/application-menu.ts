/**
 * Application menu template without Electron page-zoom roles (Serpent-46i9).
 *
 * Electron's default View menu registers zoomIn / zoomOut / resetZoom with
 * Cmd/Ctrl+=,-,0. Those accelerators steal the chords from Serpent's own
 * viewer/canvas zoom and would apply Chromium page zoom instead. This
 * template keeps Edit/File/Window roles (copy/paste, quit, …) and a View
 * submenu that intentionally omits page-zoom roles.
 *
 * Serpent-r7gu: Windows has no native menu bar — capabilities live in-app
 * (library menu, context menus, commands). macOS keeps the system menu.
 *
 * Serpent-q0b1: the macOS menu mirrors the Windows in-app MainMenu commands
 * and every custom label is an i18n catalog key (`labelKey`) resolved by Main
 * at install time — the shared layer never inlines locale strings.
 *
 * Pure data — Main installs via Menu.buildFromTemplate; unit tests assert
 * the zoom roles stay absent and Windows stays menu-less.
 */

import {
  DEFAULT_SHORTCUT_BINDINGS,
  type ShortcutBindings,
} from "./shortcut-bindings";
import {
  formatElectronAccelerator,
  resolvePrimaryChord,
} from "./shortcut-resolution";

export type ApplicationMenuPlatform = "darwin" | "linux" | "win32";

export type ApplicationMenuRole =
  | "about"
  | "services"
  | "hide"
  | "hideOthers"
  | "unhide"
  | "quit"
  | "fileMenu"
  | "editMenu"
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "pasteAndMatchStyle"
  | "delete"
  | "selectAll"
  | "reload"
  | "forceReload"
  | "toggleDevTools"
  | "togglefullscreen"
  | "window"
  | "minimize"
  | "close"
  | "zoom"
  | "front";

/** Commands sent from the native macOS menu to the canonical renderer menu. */
export type ApplicationMenuCommand =
  | "invert-selection"
  | "copy-selection"
  | "file.import-files"
  | "file.import-folder"
  | "file.import-linked-folder"
  | "file.paste-image"
  | "edit.undo"
  | "edit.redo"
  | "edit.paste"
  | "edit.select-all"
  | "edit.clear-selection"
  | "canvas.zoom-in"
  | "canvas.zoom-out"
  | "canvas.zoom-reset"
  | "window.toggle-fullscreen"
  | "library.create"
  | "library.open"
  | "library.open-recent"
  | "library.close"
  | "library.remove"
  | "library.delete-from-disk"
  | "library.import"
  | "library.import-eagle"
  | "library.export"
  | "library.settings"
  | "library.show-missing-linked"
  | "window.background-jobs"
  | "window.diagnostics"
  | "about.serpent"
  | "about.github"
  | "about.open-source"
  | "about.diagnostics"
  | "settings";

/** A native-menu command click, optionally carrying an item payload. */
export type ApplicationMenuCommandEvent = {
  readonly command: ApplicationMenuCommand;
  /** Item-specific argument, e.g. the recent-library path to open. */
  readonly payload?: string;
};

export type ApplicationMenuItemTemplate = {
  readonly role?: ApplicationMenuRole;
  readonly type?: "separator" | "normal" | "submenu" | "checkbox";
  /** Initial checked state for `type: "checkbox"`. */
  readonly checked?: boolean;
  readonly label?: string;
  /** Native accelerator for custom commands, when the platform has one. */
  readonly accelerator?: string;
  /** Shared shortcut catalog action that owns this accelerator. */
  readonly shortcutActionId?: string;
  /**
   * i18n catalog key (renderer/i18n/catalogs) resolved to the display label
   * by Main at install time using the effective app locale — the shared layer
   * never inlines locale strings (Serpent-q0b1).
   */
  readonly labelKey?: string;
  readonly submenu?: readonly ApplicationMenuItemTemplate[];
  /** Custom Serpent command (wired in Main when installing the menu). */
  readonly command?: ApplicationMenuCommand;
  /** Literal display label; when set it wins over `labelKey`. */
  readonly labelValue?: string;
  /** Extra argument forwarded with the command click (e.g. a library path). */
  readonly payload?: string;
  /** Native enabled state; ignored when a role/command supplies its own. */
  readonly enabled?: boolean;
  /**
   * Closes the focused window from the menu click only.
   * Must not carry an accelerator: ⌘W / Ctrl+W closes the current workspace tab.
   */
  readonly closesWindow?: boolean;
};

export type ApplicationMenuTemplateOptions = {
  readonly platform: ApplicationMenuPlatform;
  /** DevTools toggle — keep for unpackaged / E2E builds. */
  readonly showDevTools: boolean;
  /** App UI locale for custom menu labels (Serpent-te8p). */
  readonly locale?: "zh-CN" | "en";
  /** Current app version for the native About submenu. */
  readonly version?: string;
  /** Known libraries, most recently opened first (native 资源库 menu). */
  readonly recentLibraries?: readonly {
    readonly path: string;
    readonly name: string;
  }[];
  /** Current per-device bindings used to build native accelerator labels. */
  readonly shortcutBindings?: ShortcutBindings;
};

const PAGE_ZOOM_ROLES = new Set(["zoomIn", "zoomOut", "resetZoom"]);

/**
 * Windows: hide the native top menu bar (Serpent-r7gu / Serpent-j5x).
 * macOS: keep a real application menu (system convention).
 * linux: keep a menu for now (not in the Windows product ask).
 */
export function shouldInstallApplicationMenu(
  platform: ApplicationMenuPlatform,
): boolean {
  return platform !== "win32";
}

export function collectApplicationMenuRoles(
  items: readonly ApplicationMenuItemTemplate[],
): string[] {
  const roles: string[] = [];
  for (const item of items) {
    if (item.role) roles.push(item.role);
    if (item.submenu) roles.push(...collectApplicationMenuRoles(item.submenu));
  }
  return roles;
}

/** True when the template would register Chromium page-zoom accelerators. */
export function applicationMenuHasPageZoomRoles(
  items: readonly ApplicationMenuItemTemplate[],
): boolean {
  return collectApplicationMenuRoles(items).some((role) =>
    PAGE_ZOOM_ROLES.has(role),
  );
}

export function buildApplicationMenuTemplate(
  options: ApplicationMenuTemplateOptions,
): ApplicationMenuItemTemplate[] {
  const isMac = options.platform === "darwin";
  const shortcutPlatform = isMac ? "mac" : "windows";
  const shortcutBindings = options.shortcutBindings ?? DEFAULT_SHORTCUT_BINDINGS;
  const shortcutItem = (
    actionId: string,
    labelKey: string,
    command: ApplicationMenuCommand,
  ): ApplicationMenuItemTemplate => {
    const chord = resolvePrimaryChord(actionId, shortcutPlatform, shortcutBindings);
    const accelerator = chord === null
      ? null
      : formatElectronAccelerator(chord, shortcutPlatform);
    return {
      labelKey,
      command,
      shortcutActionId: actionId,
      ...(accelerator === null ? {} : { accelerator }),
    };
  };

  const viewSubmenu: ApplicationMenuItemTemplate[] = [
    { role: "reload", labelKey: "shell.mainMenuReload" },
    { role: "forceReload", labelKey: "shell.mainMenuForceReload" },
    ...(options.showDevTools
      ? ([{ role: "toggleDevTools", labelKey: "shell.mainMenuToggleDevTools" }] as const)
      : []),
    { type: "separator" },
    ...(isMac
      ? [
          shortcutItem("canvas.zoom-in", "preview.zoomIn", "canvas.zoom-in"),
          shortcutItem("canvas.zoom-out", "preview.zoomOut", "canvas.zoom-out"),
          shortcutItem("canvas.zoom-reset", "preview.fitWindow", "canvas.zoom-reset"),
          { type: "separator" } as const,
        ]
      : []),
    // Serpent-46i9: do NOT include Electron zoomIn / zoomOut / resetZoom roles.
    shortcutItem(
      "window.toggle-fullscreen",
      "shell.mainMenuToggleFullscreen",
      "window.toggle-fullscreen",
    ),
  ];

  const macAppMenu: ApplicationMenuItemTemplate = {
    label: "Serpent",
    submenu: [
      { role: "about", labelKey: "shell.mainMenuAboutSerpent" },
      { type: "separator" },
      { role: "services", labelKey: "shell.mainMenuServices" },
      { type: "separator" },
      { role: "hide", labelKey: "shell.mainMenuHide" },
      { role: "hideOthers", labelKey: "shell.mainMenuHideOthers" },
      { role: "unhide", labelKey: "shell.mainMenuUnhide" },
      { type: "separator" },
      { role: "quit", labelKey: "shell.mainMenuQuit" },
    ],
  };

  const closeWindowItem: ApplicationMenuItemTemplate = {
    labelKey: "shell.mainMenuCloseWindow",
    closesWindow: true,
  };
  const windowSubmenu: ApplicationMenuItemTemplate[] = isMac
    ? [
        closeWindowItem,
        { role: "minimize", labelKey: "shell.mainMenuMinimize" },
        { role: "zoom", labelKey: "shell.mainMenuZoom" },
        { type: "separator" },
        { role: "front", labelKey: "shell.mainMenuFront" },
      ]
    : [
        { role: "minimize", labelKey: "shell.mainMenuMinimize" },
        closeWindowItem,
      ];

  const editSubmenu: ApplicationMenuItemTemplate[] = isMac
    ? [
        // Serpent-q0b1: business undo/redo (not the always-available text
        // editing roles) — enabled state mirrors the renderer's undoable
        // operation state, including the redo stack.
        shortcutItem("edit.undo", "shell.mainMenuUndo", "edit.undo"),
        shortcutItem("edit.redo", "shell.mainMenuRedo", "edit.redo"),
        { type: "separator" },
        { role: "cut", labelKey: "shell.mainMenuCut" },
        // Serpent-166q: do not use role:copy — it steals ⌘C from asset file copy.
        shortcutItem("asset.copy", "shell.mainMenuCopySelection", "copy-selection"),
        shortcutItem("asset.paste", "shell.mainMenuPaste", "edit.paste"),
        { role: "pasteAndMatchStyle", labelKey: "shell.mainMenuPasteMatchStyle" },
        { role: "delete", labelKey: "shell.mainMenuDelete" },
        shortcutItem("selection.select-all", "shell.mainMenuSelectAll", "edit.select-all"),
        { type: "separator" },
        shortcutItem("selection.invert", "shell.mainMenuInvertSelection", "invert-selection"),
      ]
    : [{ role: "editMenu" }];

  // Serpent-q0b1: macOS keeps a real application menu, so the product
  // functionality the Windows in-app MainMenu button carries must be mirrored
  // here — same command ids, routed to the same renderer actions. Every label
  // is an i18n catalog key resolved by Main at install time; the shared layer
  // never inlines locale strings.
  const commandItem = (
    command: ApplicationMenuCommand,
    labelKey: string,
  ): ApplicationMenuItemTemplate => ({ labelKey, command });

  const fileSubmenu: ApplicationMenuItemTemplate[] = isMac
    ? [
        commandItem("file.import-files", "toolbar.importFiles"),
        commandItem("file.import-folder", "toolbar.importFolder"),
        commandItem("file.import-linked-folder", "toolbar.importLinkedFolder"),
        commandItem("file.paste-image", "toolbar.pasteImage"),
      ]
    : [];

  // Identical, in order, to the renderer's library switcher menu — including its
  // 其他资源库 section, which opens a recent library directly.
  const recentLibraryItems: ApplicationMenuItemTemplate[] = (
    options.recentLibraries ?? []
  ).map((entry) => ({
    command: "library.open-recent" as const,
    labelValue: entry.name,
    payload: entry.path,
  }));
  // User request: 最近打开 is a first-level menu whose submenu lists the
  // recently opened libraries (the in-app switcher keeps its grouped section).
  const recentLibrariesMenu: ApplicationMenuItemTemplate = {
    labelKey: "shell.recentLibraries",
    submenu:
      recentLibraryItems.length > 0
        ? recentLibraryItems
        : [
            {
              labelKey: "shell.noRecentLibraries",
              enabled: false,
            } as ApplicationMenuItemTemplate,
          ],
  };

  const librarySubmenu: ApplicationMenuItemTemplate[] = isMac
    ? [
        commandItem("library.create", "shell.createLibraryEllipsis"),
        commandItem("library.open", "shell.openLibraryEllipsis"),
        { type: "separator" },
        commandItem("library.close", "shell.closeLibrary"),
        commandItem("library.remove", "shell.removeLibrary"),
        commandItem("library.delete-from-disk", "shell.deleteLibraryFromDisk"),
        { type: "separator" },
        commandItem("library.import", "toolbar.importLibrary"),
        commandItem("library.export", "toolbar.exportLibrary"),
        { type: "separator" },
        commandItem("library.settings", "settings.librarySettings"),
        {
          type: "checkbox",
          labelKey: "shell.showMissingLinkedFiles",
          command: "library.show-missing-linked",
          checked: true,
        },
        { type: "separator" },
        // Hovering 最近打开 expands the recent-library submenu (macOS native
        // submenu behaviour); each entry opens that library.
        recentLibrariesMenu,
      ]
    : [];


  const windowBusinessSubmenu: ApplicationMenuItemTemplate[] = isMac
    ? [
        { type: "separator" },
        commandItem("window.background-jobs", "toolbar.backgroundJobs"),
        commandItem("window.diagnostics", "settings.viewDiagnostics"),
      ]
    : [];

  const helpSubmenu: ApplicationMenuItemTemplate[] = isMac
    ? [
        commandItem("about.serpent", "shell.mainMenuAboutSerpent"),
        commandItem("about.github", "shell.mainMenuVisitGitHub"),
        commandItem("about.open-source", "shell.mainMenuOpenSource"),
        commandItem("about.diagnostics", "settings.viewDiagnostics"),
        { type: "separator" },
        commandItem("settings", "shell.mainMenuSettings"),
      ]
    : [];

  return isMac
    ? [
        macAppMenu,
        // User request: the library menu leads (right after the app menu), with
        // 最近打开 as its own first-level menu beside it.
        { labelKey: "shell.mainMenuLibrary", submenu: librarySubmenu },
        { labelKey: "shell.mainMenuFile", submenu: fileSubmenu },
        { labelKey: "shell.mainMenuEdit", submenu: editSubmenu },
        { labelKey: "shell.mainMenuView", submenu: viewSubmenu },
        {
          labelKey: "shell.mainMenuWindow",
          submenu: [...windowSubmenu, ...windowBusinessSubmenu],
        },
        { labelKey: "shell.mainMenuHelp", submenu: helpSubmenu },
      ]
    : [
        { role: "fileMenu" },
        { role: "editMenu" },
        { labelKey: "shell.mainMenuView", submenu: viewSubmenu },
        { labelKey: "shell.mainMenuWindow", submenu: windowSubmenu },
      ];
}
