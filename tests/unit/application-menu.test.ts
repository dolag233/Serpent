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
import { setShortcutOverrides, DEFAULT_SHORTCUT_BINDINGS } from "../../src/shared/shortcut-bindings";

function findMenuItem(
  items: readonly ApplicationMenuItemTemplate[],
  predicate: (item: ApplicationMenuItemTemplate) => boolean,
): ApplicationMenuItemTemplate | undefined {
  for (const item of items) {
    if (predicate(item)) return item;
    if (item.submenu) {
      const nested = findMenuItem(item.submenu, predicate);
      if (nested) return nested;
    }
  }
  return undefined;
}

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
      // Fullscreen is a custom command so clearing its binding cannot restore
      // Electron's implicit role accelerator.
      expect(roles).not.toContain("togglefullscreen");
      expect(roles).not.toContain("close");
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

  it("closes the window from the menu click and leaves ⌘W / Ctrl+W for tabs", () => {
    for (const platform of ["darwin", "win32", "linux"] as const) {
      const template = buildApplicationMenuTemplate({
        platform,
        showDevTools: false,
      });
      const closeItem = findMenuItem(
        template,
        (item) => item.labelKey === "shell.mainMenuCloseWindow",
      );
      expect(closeItem?.closesWindow).toBe(true);
      expect(closeItem?.role).toBeUndefined();
      expect(closeItem?.accelerator).toBeUndefined();
      expect(closeItem?.command).toBeUndefined();
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

  it("declares native accelerators for business undo and redo", () => {
    const template = buildApplicationMenuTemplate({
      platform: "darwin",
      showDevTools: false,
      locale: "zh-CN",
    });
    const findCommand = (
      items: readonly ApplicationMenuItemTemplate[],
      command: "edit.undo" | "edit.redo",
    ): ApplicationMenuItemTemplate | undefined => {
      for (const item of items) {
        if (item.command === command) return item;
        if (item.submenu) {
          const nested = findCommand(item.submenu, command);
          if (nested) return nested;
        }
      }
      return undefined;
    };

    expect(findCommand(template, "edit.undo")?.accelerator).toBe("Cmd+Z");
    expect(findCommand(template, "edit.redo")?.accelerator).toBe("Cmd+Shift+Z");
  });

  it("builds native Edit and View accelerators from the active custom bindings", () => {
    const bindings = setShortcutOverrides(DEFAULT_SHORTCUT_BINDINGS, "mac", {
      "edit.undo": { key: "y", code: "KeyY", metaKey: true },
      "asset.copy": { key: "c", code: "KeyC", metaKey: true, shiftKey: true },
      "asset.paste": { key: "v", code: "KeyV", metaKey: true, shiftKey: true },
      "selection.select-all": { key: "a", code: "KeyA", metaKey: true, shiftKey: true },
      "selection.invert": { key: "i", code: "KeyI", metaKey: true, shiftKey: true },
      "canvas.zoom-in": { key: "k", code: "KeyK", metaKey: true, shiftKey: true },
      "window.toggle-fullscreen": { key: "f", code: "KeyF", metaKey: true, shiftKey: true },
    });
    const template = buildApplicationMenuTemplate({
      platform: "darwin",
      showDevTools: false,
      shortcutBindings: bindings,
    });
    const findAction = (actionId: string): ApplicationMenuItemTemplate | undefined => {
      const visit = (items: readonly ApplicationMenuItemTemplate[]): ApplicationMenuItemTemplate | undefined => {
        for (const item of items) {
          if (item.shortcutActionId === actionId) return item;
          const nested = item.submenu ? visit(item.submenu) : undefined;
          if (nested) return nested;
        }
        return undefined;
      };
      return visit(template);
    };

    expect(findAction("edit.undo")?.accelerator).toBe("Cmd+Y");
    expect(findAction("asset.copy")?.accelerator).toBe("Cmd+Shift+C");
    expect(findAction("asset.paste")?.accelerator).toBe("Cmd+Shift+V");
    expect(findAction("selection.select-all")?.accelerator).toBe("Cmd+Shift+A");
    expect(findAction("selection.invert")?.accelerator).toBe("Cmd+Shift+I");
    expect(findAction("canvas.zoom-in")?.accelerator).toBe("Cmd+Shift+K");
    expect(findAction("window.toggle-fullscreen")?.accelerator).toBe("Cmd+Shift+F");
    expect(findAction("window.toggle-fullscreen")?.role).toBeUndefined();
  });

  it("keeps the fullscreen menu command while omitting unsupported mouse accelerators", () => {
    const bindings = setShortcutOverrides(DEFAULT_SHORTCUT_BINDINGS, "mac", {
      "window.toggle-fullscreen": { key: "MouseForward", metaKey: true },
    });
    const template = buildApplicationMenuTemplate({
      platform: "darwin",
      showDevTools: false,
      shortcutBindings: bindings,
    });
    const visit = (items: readonly ApplicationMenuItemTemplate[]): ApplicationMenuItemTemplate | undefined => {
      for (const item of items) {
        if (item.shortcutActionId === "window.toggle-fullscreen") return item;
        const nested = item.submenu ? visit(item.submenu) : undefined;
        if (nested) return nested;
      }
      return undefined;
    };
    const fullscreen = visit(template);
    expect(fullscreen?.command).toBe("window.toggle-fullscreen");
    expect(fullscreen?.accelerator).toBeUndefined();
    expect(fullscreen?.role).toBeUndefined();
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
      "library.show-missing-linked",
      "window.background-jobs",
      "window.diagnostics",
      "about.serpent",
      "about.github",
      "about.open-source",
      "about.diagnostics",
      "settings",
    ]));
    // invert/copy stay on their dedicated channels via the edit menu.
    expect(commands).toContain("invert-selection");
    expect(commands).toContain("copy-selection");
  });

  it("does not nest Import Eagle under a separate Import external library item on macOS", () => {
    const template = buildApplicationMenuTemplate({
      platform: "darwin",
      showDevTools: false,
      locale: "zh-CN",
    });
    const libraryMenu = template.find((item) => item.labelKey === "shell.mainMenuLibrary");
    expect(
      libraryMenu?.submenu?.some((item) => item.labelKey === "toolbar.importExternalLibrary"),
    ).toBe(false);
    expect(libraryMenu?.submenu?.some((item) => item.command === "library.import")).toBe(true);
    expect(libraryMenu?.submenu?.some((item) => item.command === "library.open")).toBe(true);
    expect(libraryMenu?.submenu?.some((item) => item.labelKey === "shell.renameLibrary")).toBe(false);
    expect(libraryMenu?.submenu?.some((item) => item.labelKey === "shell.openSyncLibraryEllipsis")).toBe(false);
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
      expect(commandsOf(template)).toEqual(["window.toggle-fullscreen"]);
    }
  });

  it("keeps native Cut and Paste-and-Match-Style roles outside custom accelerators", () => {
    const template = buildApplicationMenuTemplate({
      platform: "darwin",
      showDevTools: false,
      locale: "en",
    });
    const findRole = (
      items: readonly ApplicationMenuItemTemplate[],
      role: "cut" | "pasteAndMatchStyle",
    ): ApplicationMenuItemTemplate | undefined => {
      for (const item of items) {
        if (item.role === role) return item;
        const nested = item.submenu ? findRole(item.submenu, role) : undefined;
        if (nested) return nested;
      }
      return undefined;
    };

    expect(findRole(template, "cut")).toMatchObject({ role: "cut" });
    expect(findRole(template, "cut")?.accelerator).toBeUndefined();
    expect(findRole(template, "pasteAndMatchStyle")).toMatchObject({
      role: "pasteAndMatchStyle",
    });
    expect(findRole(template, "pasteAndMatchStyle")?.accelerator).toBeUndefined();
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
