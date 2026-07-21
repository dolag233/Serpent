import { Menu, app } from "electron";

import {
  buildApplicationMenuTemplate,
  type ApplicationMenuPlatform,
} from "../shared/application-menu";
import { shouldHideApplicationMenuBar } from "../shared/window-controls";

/**
 * Install Serpent's application menu (no page-zoom accelerator roles).
 * Call once during app ready so macOS defaults cannot steal
 * Cmd/Ctrl+=,-,0 from renderer zoom shortcuts (Serpent-46i9).
 *
 * Windows (Serpent-znex / Serpent-r7gu): hide the menu bar entirely for
 * frameless shell unity. Chromium still handles Ctrl+C/V in inputs;
 * right-click edit menu is Serpent-d8u. Setting null also drops Electron
 * View reload/zoom roles that would otherwise remain as invisible
 * accelerators if we only hid the bar.
 */
export function installApplicationMenu(options?: {
  showDevTools?: boolean;
}): void {
  const platform = process.platform as ApplicationMenuPlatform;
  if (shouldHideApplicationMenuBar(platform)) {
    Menu.setApplicationMenu(null);
    return;
  }
  const showDevTools =
    options?.showDevTools ?? (!app.isPackaged || process.env.SERPENT_E2E === "1");
  const template = buildApplicationMenuTemplate({ platform, showDevTools });
  // Template roles are a vetted subset of Electron's Menu roles; cast keeps
  // the shared pure builder free of the electron import.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      template as Electron.MenuItemConstructorOptions[],
    ),
  );
}
