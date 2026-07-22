import { describe, expect, it } from "vitest";

import {
  applicationMenuHasPageZoomRoles,
  buildApplicationMenuTemplate,
  collectApplicationMenuRoles,
  shouldInstallApplicationMenu,
  type ApplicationMenuItemTemplate,
} from "../../src/shared/application-menu";

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
        expect(roles).toContain("undo");
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
    const win = collectApplicationMenuRoles(
      buildApplicationMenuTemplate({
        platform: "win32",
        showDevTools: false,
      }),
    );
    expect(mac).toContain("about");
    expect(mac).toContain("quit");
    expect(win).not.toContain("about");
  });

  it("adds macOS Edit invert selection with locale label (Serpent-te8p)", () => {
    function findInvert(
      items: readonly ApplicationMenuItemTemplate[],
    ): ApplicationMenuItemTemplate | undefined {
      for (const item of items) {
        if (item.command === "invert-selection") return item;
        if (item.submenu) {
          const nested = findInvert(item.submenu);
          if (nested) return nested;
        }
      }
      return undefined;
    }
    const zh = findInvert(
      buildApplicationMenuTemplate({
        platform: "darwin",
        showDevTools: false,
        locale: "zh-CN",
      }),
    );
    const en = findInvert(
      buildApplicationMenuTemplate({
        platform: "darwin",
        showDevTools: false,
        locale: "en",
      }),
    );
    expect(zh?.label).toBe("反选");
    expect(en?.label).toBe("Invert Selection");
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
