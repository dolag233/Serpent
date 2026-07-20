import { Menu, app } from "electron";

import {
  buildApplicationMenuTemplate,
  type ApplicationMenuPlatform,
} from "../shared/application-menu";

/**
 * Install Serpent's application menu (no page-zoom accelerator roles).
 * Call once during app ready so macOS/Windows defaults cannot steal
 * Cmd/Ctrl+=,-,0 from renderer zoom shortcuts (Serpent-46i9).
 */
export function installApplicationMenu(options?: {
  showDevTools?: boolean;
}): void {
  const platform = process.platform as ApplicationMenuPlatform;
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
