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
  | "edit.paste"
  | "edit.select-all"
  | "edit.clear-selection"
  | "library.create"
  | "library.open"
  | "library.close"
  | "library.remove"
  | "library.delete-from-disk"
  | "library.import"
  | "library.export"
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
  readonly submenu?: readonly ApplicationMenuItemTemplate[];
  /** Custom Serpent command (wired in Main when installing the menu). */
  readonly command?: "invert-selection" | "copy-selection";
};

export type ApplicationMenuTemplateOptions = {
  readonly platform: ApplicationMenuPlatform;
  /** DevTools toggle — keep for unpackaged / E2E builds. */
  readonly showDevTools: boolean;
  /** App UI locale for custom menu labels (Serpent-te8p). */
  readonly locale?: "zh-CN" | "en";
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
    { role: "reload" },
    { role: "forceReload" },
    ...(options.showDevTools
      ? ([{ role: "toggleDevTools" }] as const)
      : []),
    { type: "separator" },
    // Serpent-46i9: do NOT include zoomIn / zoomOut / resetZoom.
    { role: "togglefullscreen" },
  ];

  const macAppMenu: ApplicationMenuItemTemplate = {
    label: "Serpent",
    submenu: [
      { role: "about" },
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  };

  const windowSubmenu: ApplicationMenuItemTemplate[] = isMac
    ? [
        { role: "close" },
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
      ]
    : [{ role: "minimize" }, { role: "close" }];

  const invertLabel =
    options.locale === "zh-CN" ? "反选" : "Invert Selection";
  const copyLabel = options.locale === "zh-CN" ? "复制" : "Copy";

  const editSubmenu: ApplicationMenuItemTemplate[] = isMac
    ? [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        // Serpent-166q: do not use role:copy — it steals ⌘C from asset file copy.
        { label: copyLabel, command: "copy-selection" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
        { type: "separator" },
        { label: invertLabel, command: "invert-selection" },
      ]
    : [{ role: "editMenu" }];

  return [
    ...(isMac ? [macAppMenu] : []),
    { role: "fileMenu" },
    isMac
      ? { label: "Edit", submenu: editSubmenu }
      : { role: "editMenu" },
    { label: "View", submenu: viewSubmenu },
    isMac
      ? { role: "window", submenu: windowSubmenu }
      : { label: "Window", submenu: windowSubmenu },
  ];
}
