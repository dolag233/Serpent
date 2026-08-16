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
  | "edit.undo"
  | "edit.redo"
  | "edit.paste"
  | "edit.select-all"
  | "edit.clear-selection"
  | "library.create"
  | "library.open"
  | "library.close"
  | "library.remove"
  | "library.delete-from-disk"
  | "library.import"
  | "library.import-eagle"
  | "library.export"
  | "library.rename"
  | "library.settings"
  | "window.background-jobs"
  | "window.diagnostics"
  | "about.serpent"
  | "about.github"
  | "about.open-source"
  | "settings";

export type ApplicationMenuItemTemplate = {
  readonly role?: ApplicationMenuRole;
  readonly type?: "separator" | "normal" | "submenu";
  readonly label?: string;
  /** Native accelerator for custom commands, when the platform has one. */
  readonly accelerator?: string;
  /**
   * i18n catalog key (renderer/i18n/catalogs) resolved to the display label
   * by Main at install time using the effective app locale — the shared layer
   * never inlines locale strings (Serpent-q0b1).
   */
  readonly labelKey?: string;
  readonly submenu?: readonly ApplicationMenuItemTemplate[];
  /** Custom Serpent command (wired in Main when installing the menu). */
  readonly command?: ApplicationMenuCommand;
};

export type ApplicationMenuTemplateOptions = {
  readonly platform: ApplicationMenuPlatform;
  /** DevTools toggle — keep for unpackaged / E2E builds. */
  readonly showDevTools: boolean;
  /** App UI locale for custom menu labels (Serpent-te8p). */
  readonly locale?: "zh-CN" | "en";
  /** Current app version for the native About submenu. */
  readonly version?: string;
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

  const viewSubmenu: ApplicationMenuItemTemplate[] = [
    { role: "reload", labelKey: "shell.mainMenuReload" },
    { role: "forceReload", labelKey: "shell.mainMenuForceReload" },
    ...(options.showDevTools
      ? ([{ role: "toggleDevTools", labelKey: "shell.mainMenuToggleDevTools" }] as const)
      : []),
    { type: "separator" },
    // Serpent-46i9: do NOT include zoomIn / zoomOut / resetZoom.
    { role: "togglefullscreen", labelKey: "shell.mainMenuToggleFullscreen" },
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

  const windowSubmenu: ApplicationMenuItemTemplate[] = isMac
    ? [
        { role: "close", labelKey: "shell.mainMenuCloseWindow" },
        { role: "minimize", labelKey: "shell.mainMenuMinimize" },
        { role: "zoom", labelKey: "shell.mainMenuZoom" },
        { type: "separator" },
        { role: "front", labelKey: "shell.mainMenuFront" },
      ]
    : [
        { role: "minimize", labelKey: "shell.mainMenuMinimize" },
        { role: "close", labelKey: "shell.mainMenuCloseWindow" },
      ];

  const editSubmenu: ApplicationMenuItemTemplate[] = isMac
    ? [
        // Serpent-q0b1: business undo/redo (not the always-available text
        // editing roles) — enabled state mirrors the renderer's undoable
        // operation state, including the redo stack.
        { labelKey: "shell.mainMenuUndo", command: "edit.undo", accelerator: "Cmd+Z" },
        { labelKey: "shell.mainMenuRedo", command: "edit.redo", accelerator: "Cmd+Shift+Z" },
        { type: "separator" },
        { role: "cut", labelKey: "shell.mainMenuCut" },
        // Serpent-166q: do not use role:copy — it steals ⌘C from asset file copy.
        { labelKey: "shell.mainMenuCopySelection", command: "copy-selection" },
        { role: "paste", labelKey: "shell.mainMenuPaste" },
        { role: "pasteAndMatchStyle", labelKey: "shell.mainMenuPasteMatchStyle" },
        { role: "delete", labelKey: "shell.mainMenuDelete" },
        { role: "selectAll", labelKey: "shell.mainMenuSelectAll" },
        { type: "separator" },
        { labelKey: "shell.mainMenuInvertSelection", command: "invert-selection" },
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
      ]
    : [];

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
        {
          type: "submenu",
          labelKey: "toolbar.importExternalLibrary",
          submenu: [
            commandItem("library.import-eagle", "toolbar.importEagleLibrary"),
          ],
        },
        commandItem("library.export", "toolbar.exportLibrary"),
        { type: "separator" },
        commandItem("library.rename", "shell.renameLibrary"),
        commandItem("library.settings", "settings.librarySettings"),
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
        { type: "separator" },
        commandItem("settings", "shell.mainMenuSettings"),
      ]
    : [];

  return isMac
    ? [
        macAppMenu,
        { labelKey: "shell.mainMenuFile", submenu: fileSubmenu },
        { labelKey: "shell.mainMenuEdit", submenu: editSubmenu },
        { labelKey: "shell.mainMenuView", submenu: viewSubmenu },
        { labelKey: "shell.mainMenuLibrary", submenu: librarySubmenu },
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
