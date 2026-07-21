import { describe, expect, it } from "vitest";

import {
  applicationMenuHasPageZoomRoles,
  buildApplicationMenuTemplate,
  collectApplicationMenuRoles,
  shouldInstallApplicationMenu,
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
      expect(roles).toContain("editMenu");
      expect(roles).toContain("togglefullscreen");
      expect(roles).toContain("toggleDevTools");
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
});
