import { Menu, app, type BrowserWindow } from "electron";

import {
  buildApplicationMenuTemplate,
  type ApplicationMenuItemTemplate,
  type ApplicationMenuPlatform,
} from "../shared/application-menu";
import {
  APPLICATION_MENU_COMMAND_CHANNEL,
  INVERT_SELECTION_CHANNEL,
  COPY_SELECTION_CHANNEL,
} from "../shared/protocol/channels";
import { shouldHideApplicationMenuBar } from "../shared/window-controls";
import { lookupMessage } from "../renderer/i18n/types";
import { zhCN } from "../renderer/i18n/catalogs/zh-CN";
import { en } from "../renderer/i18n/catalogs/en";

/**
 * Serpent-q0b1: the template carries i18n catalog keys; the effective app
 * locale resolves them here (English fallback, then the raw key) — the menu
 * text lives in the same catalogs as the renderer UI, never inline ternaries.
 */
function resolveLabelKey(
  labelKey: string | undefined,
  locale: "zh-CN" | "en" | undefined,
): string | undefined {
  if (labelKey === undefined) return undefined;
  const primary = locale === "zh-CN" ? zhCN : en;
  const resolved = lookupMessage(primary, labelKey) ?? lookupMessage(en, labelKey);
  return resolved ?? labelKey;
}

function acceleratorForCommand(
  command: NonNullable<ApplicationMenuItemTemplate["command"]>,
): string | undefined {
  if (command === "invert-selection") {
    return process.platform === "darwin" ? "Cmd+I" : "Ctrl+I";
  }
  if (command === "copy-selection") {
    return process.platform === "darwin" ? "Cmd+C" : "Ctrl+C";
  }
  if (command === "edit.undo") {
    return process.platform === "darwin" ? "Cmd+Z" : "Ctrl+Z";
  }
  if (command === "edit.redo") {
    return process.platform === "darwin" ? "Cmd+Shift+Z" : "Ctrl+Shift+Z";
  }
  return undefined;
}

/**
 * Serpent-q0b1: the renderer drives item enabled-state (e.g. business undo is
 * only enabled while an undoable operation exists). Menu items are addressed
 * by their command id, set at install time in enrichMenuTemplate.
 */
export function setApplicationMenuCommandEnabled(
  command: string,
  enabled: boolean,
): void {
  const menu = Menu.getApplicationMenu();
  const item = menu?.getMenuItemById(command);
  if (item) item.enabled = enabled;
}

/**
 * Every template item with a `command` is wired here: the focused window's
 * renderer receives the command over APPLICATION_MENU_COMMAND_CHANNEL and
 * runs the SAME canonical action the Windows in-app MainMenu button uses
 * (Serpent-q0b1) — invert/copy keep their platform accelerators; the rest are
 * plain clicks routed identically.
 */
function enrichMenuTemplate(
  items: readonly ApplicationMenuItemTemplate[],
  locale: "zh-CN" | "en" | undefined,
): Electron.MenuItemConstructorOptions[] {
  return items.map((item) => {
    const resolvedLabel = resolveLabelKey(item.labelKey, locale);
    if (item.command === "invert-selection" || item.command === "copy-selection") {
      // Serpent-166q/te8p: invert/copy keep their dedicated channels and
      // renderer handlers (asset file copy must not be stolen by role:copy).
      const channel =
        item.command === "invert-selection"
          ? INVERT_SELECTION_CHANNEL
          : COPY_SELECTION_CHANNEL;
      return {
        label: resolvedLabel,
        accelerator: acceleratorForCommand(item.command),
        click: (_menuItem, window) => {
          const target = window as BrowserWindow | undefined;
          target?.webContents.send(channel);
        },
      };
    }
    if (item.command !== undefined) {
      const command = item.command;
      return {
        id: command,
        label: resolvedLabel,
        click: (_menuItem, window) => {
          const target = window as BrowserWindow | undefined;
          target?.webContents.send(APPLICATION_MENU_COMMAND_CHANNEL, command);
        },
      };
    }
    if (item.submenu) {
      return {
        ...item,
        // Serpent review: keep hardcoded brand labels ("Serpent" app menu)
        // when the item carries no labelKey.
        label: resolvedLabel ?? item.label,
        submenu: enrichMenuTemplate(item.submenu, locale),
      } as Electron.MenuItemConstructorOptions;
    }
    return {
      ...item,
      label: resolvedLabel ?? item.label,
    } as Electron.MenuItemConstructorOptions;
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
    Menu.buildFromTemplate(enrichMenuTemplate(template, options?.locale)),
  );
}
