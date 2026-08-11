import { describe, expect, it } from "vitest";

import {
  applicationMenuHasPageZoomRoles,
  buildApplicationMenuTemplate,
  collectApplicationMenuRoles,
  shouldInstallApplicationMenu,
  type ApplicationMenuItemTemplate,
} from "../../src/shared/application-menu";
import { lookupMessage } from "../../src/renderer/i18n/types";
import { zhCN } from "../../src/renderer/i18n/catalogs/zh-CN";
import { en } from "../../src/renderer/i18n/catalogs/en";

describe("shouldInstallApplicationMenu (Serpent-r7gu)", () => {
  it("keeps the macOS application menu and hides Windows", () => {
    expect(shouldInstallApplicationMenu("darwin")).toBe(true);
    expect(shouldInstallApplicationMenu("win32")).toBe(false);
    // Linux retains a menu until a separate product decision; not Windows.
    expect(shouldInstallApplicationMenu("linux")).toBe(true);
  });
});

describe("buildApplicationMenuTemplate (Serpent-46i9)", () => {
  it("omits Electron page-zoom roles that steal Cmd/Ctrl+=,-,0", () => {
    for (const platform of ["darwin", "win32", "linux"] as const) {
      const template = buildApplicationMenuTemplate({
        platform,
        showDevTools: true,
      });
      expect(applicationMenuHasPageZoomRoles(template)).toBe(false);
      const roles = collectApplicationMenuRoles(template);
      expect(roles).not.toContain("zoomIn");
      expect(roles).not.toContain("zoomOut");
      expect(roles).not.toContain("resetZoom");
      // Window "Zoom" (maximize) on macOS is unrelated and may remain.
      expect(roles).toContain("togglefullscreen");
      expect(roles).toContain("toggleDevTools");
      if (platform === "darwin") {
        expect(roles).not.toContain("editMenu");
        // Serpent-q0b1: undo/redo are business commands, not text-editing roles.
        expect(roles).not.toContain("undo");
        expect(roles).not.toContain("redo");
      } else {
        expect(roles).toContain("editMenu");
      }
    }
  });

  it("hides DevTools role when showDevTools is false", () => {
    const roles = collectApplicationMenuRoles(
      buildApplicationMenuTemplate({
        platform: "darwin",
        showDevTools: false,
      }),
    );
    expect(roles).not.toContain("toggleDevTools");
    expect(roles).toContain("reload");
  });

  it("includes the macOS app menu only on darwin", () => {
    const mac = collectApplicationMenuRoles(
      buildApplicationMenuTemplate({
        platform: "darwin",
        showDevTools: false,
      }),
    );
    expect(mac).toContain("about");
    const nonMac = collectApplicationMenuRoles(
      buildApplicationMenuTemplate({
        platform: "linux",
        showDevTools: false,
      }),
    );
    expect(nonMac).not.toContain("about");
  });

  it("adds macOS Edit invert selection via i18n label key (Serpent-te8p/q0b1)", () => {
    function findCommand(
      items: readonly ApplicationMenuItemTemplate[],
      command: "invert-selection" | "copy-selection",
    ): ApplicationMenuItemTemplate | undefined {
      for (const item of items) {
        if (item.command === command) return item;
        if (item.submenu) {
          const nested = findCommand(item.submenu, command);
          if (nested) return nested;
        }
      }
      return undefined;
    }
    const zh = findCommand(
      buildApplicationMenuTemplate({
        platform: "darwin",
        showDevTools: false,
        locale: "zh-CN",
      }),
      "invert-selection",
    );
    const enCmd = findCommand(
      buildApplicationMenuTemplate({
        platform: "darwin",
        showDevTools: false,
        locale: "en",
      }),
      "invert-selection",
    );
    expect(zh?.labelKey).toBe("shell.mainMenuInvertSelection");
    expect(enCmd?.labelKey).toBe("shell.mainMenuInvertSelection");

    // Serpent-166q: Copy is a custom command (not role:copy) so ⌘C can copy files.
    const zhCopy = findCommand(
      buildApplicationMenuTemplate({
        platform: "darwin",
        showDevTools: false,
        locale: "zh-CN",
      }),
      "copy-selection",
    );
    expect(zhCopy?.labelKey).toBe("shell.mainMenuCopySelection");
  });
});

describe("macOS product menu mirror (Serpent-q0b1)", () => {
  function commandsOf(items: readonly ApplicationMenuItemTemplate[]): string[] {
    const commands: string[] = [];
    for (const item of items) {
      if (item.command) commands.push(item.command);
      if (item.submenu) commands.push(...commandsOf(item.submenu));
    }
    return commands;
  }

  it("mirrors every Windows MainMenu section command on macOS", () => {
    const template = buildApplicationMenuTemplate({
      platform: "darwin",
      showDevTools: false,
      locale: "zh-CN",
    });
    const commands = commandsOf(template);
    expect(commands).toEqual(expect.arrayContaining([
      "edit.undo",
      "edit.redo",
      "file.import-files",
      "file.import-folder",
      "file.import-linked-folder",
      "library.create",
      "library.open",
      "library.close",
      "library.remove",
      "library.delete-from-disk",
      "library.import",
      "library.export",
      "library.settings",
      "window.background-jobs",
      "window.diagnostics",
      "about.serpent",
      "about.github",
      "about.open-source",
      "settings",
    ]));
    // invert/copy stay on their dedicated channels via the edit menu.
    expect(commands).toContain("invert-selection");
    expect(commands).toContain("copy-selection");
  });

  it("uses i18n catalog keys for every custom label (no inline locale strings)", () => {
    const template = buildApplicationMenuTemplate({
      platform: "darwin",
      showDevTools: false,
      locale: "zh-CN",
    });
    const keys: string[] = [];
    const walk = (items: readonly ApplicationMenuItemTemplate[]): void => {
      for (const item of items) {
        if (item.labelKey) keys.push(item.labelKey);
        if (item.submenu) walk(item.submenu);
      }
    };
    walk(template);
    expect(keys.length).toBeGreaterThan(0);
    // No custom item may carry a hardcoded display label — the Serpent app
    // menu name is the only hardcoded label (brand name is not localized).
    const hardcodedLabels = template.filter((item) => typeof item.label === "string");
    expect(hardcodedLabels.map((item) => item.label)).toEqual(["Serpent"]);
    // Every key resolves in BOTH catalogs (zh primary, en fallback).
    for (const key of keys) {
      expect(lookupMessage(zhCN, key), `zh key ${key}`).toBeDefined();
      expect(lookupMessage(en, key), `en key ${key}`).toBeDefined();
    }
  });

  it("keeps the non-macOS template free of product commands", () => {
    for (const platform of ["win32", "linux"] as const) {
      const template = buildApplicationMenuTemplate({
        platform,
        showDevTools: false,
      });
      expect(commandsOf(template)).toEqual([]);
    }
  });
});

describe("shouldHideApplicationMenuBar (Serpent-znex)", () => {
  it("hides the Windows menu bar for frameless shell unity", async () => {
    const { shouldHideApplicationMenuBar } = await import(
      "../../src/shared/window-controls"
    );
    expect(shouldHideApplicationMenuBar("win32")).toBe(true);
    expect(shouldHideApplicationMenuBar("darwin")).toBe(false);
  });
});
