import { Menu, app, type BrowserWindow } from "electron";

import {
  buildApplicationMenuTemplate,
  type ApplicationMenuItemTemplate,
  type ApplicationMenuPlatform,
} from "../shared/application-menu";
import { INVERT_SELECTION_CHANNEL } from "../shared/protocol/channels";
import { shouldHideApplicationMenuBar } from "../shared/window-controls";

function enrichMenuTemplate(
  items: readonly ApplicationMenuItemTemplate[],
): Electron.MenuItemConstructorOptions[] {
  return items.map((item) => {
    if (item.command === "invert-selection") {
      return {
        label: item.label,
        accelerator: process.platform === "darwin" ? "Cmd+I" : "Ctrl+I",
        click: (_menuItem, window) => {
          const target = window as BrowserWindow | undefined;
          target?.webContents.send(INVERT_SELECTION_CHANNEL);
        },
      };
    }
    if (item.submenu) {
      return {
        ...item,
        submenu: enrichMenuTemplate(item.submenu),
      } as Electron.MenuItemConstructorOptions;
    }
    return { ...item } as Electron.MenuItemConstructorOptions;
  });
}

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
  locale?: "zh-CN" | "en";
}): void {
  const platform = process.platform as ApplicationMenuPlatform;
  if (shouldHideApplicationMenuBar(platform)) {
    Menu.setApplicationMenu(null);
    return;
  }
  const showDevTools =
    options?.showDevTools ?? (!app.isPackaged || process.env.SERPENT_E2E === "1");
  const template = buildApplicationMenuTemplate({
    platform,
    showDevTools,
    locale: options?.locale,
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(enrichMenuTemplate(template)),
  );
}
