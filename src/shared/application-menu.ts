/**
 * Application menu template without Electron page-zoom roles (Serpent-46i9).
 *
 * Electron's default View menu registers zoomIn / zoomOut / resetZoom with
 * Cmd/Ctrl+=,-,0. Those accelerators steal the chords from Serpent's own
 * viewer/canvas zoom and would apply Chromium page zoom instead. This
 * template keeps Edit/File/Window roles (copy/paste, quit, …) and a View
 * submenu that intentionally omits page-zoom roles.
 *
 * Pure data — Main installs via Menu.buildFromTemplate; unit tests assert
 * the zoom roles stay absent.
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
  | "reload"
  | "forceReload"
  | "toggleDevTools"
  | "togglefullscreen"
  | "window"
  | "minimize"
  | "close"
  | "zoom"
  | "front";

export type ApplicationMenuItemTemplate = {
  readonly role?: ApplicationMenuRole;
  readonly type?: "separator" | "normal" | "submenu";
  readonly label?: string;
  readonly submenu?: readonly ApplicationMenuItemTemplate[];
};

export type ApplicationMenuTemplateOptions = {
  readonly platform: ApplicationMenuPlatform;
  /** DevTools toggle — keep for unpackaged / E2E builds. */
  readonly showDevTools: boolean;
};

const PAGE_ZOOM_ROLES = new Set(["zoomIn", "zoomOut", "resetZoom"]);

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

  return [
    ...(isMac ? [macAppMenu] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    { label: "View", submenu: viewSubmenu },
    isMac
      ? { role: "window", submenu: windowSubmenu }
      : { label: "Window", submenu: windowSubmenu },
  ];
}
