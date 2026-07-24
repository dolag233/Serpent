import { describe, expect, it } from "vitest";

import { en } from "../../src/renderer/i18n/catalogs/en";
import { zhCN } from "../../src/renderer/i18n/catalogs/zh-CN";
import { buildRecentLibraryMenuEntries } from "../../src/renderer/LibrarySwitcher";

/**
 * Serpent-y0au / REQ-LIB-002: no-library start + create dialog must expose
 * open-existing copy and list all recents when nothing is open.
 */
describe("no-library open-existing affordances (Serpent-y0au / Serpent-kipk)", () => {
  it("ships zh/en copy for empty-state recents and create-dialog open existing", () => {
    expect(zhCN.empty.recentLibraries.length).toBeGreaterThan(0);
    expect(en.empty.recentLibraries.length).toBeGreaterThan(0);
    expect(zhCN.empty.noLibraryTitle).toBe("创建本地资源库");
    expect(en.empty.noLibraryTitle.toLowerCase()).toContain("library");
    expect(zhCN.dialog.createLibrary.openExisting).toContain("打开");
    expect(en.dialog.createLibrary.openExisting.toLowerCase()).toContain("open");
    expect(zhCN.dialog.createLibrary.existingSection.length).toBeGreaterThan(0);
    expect(en.dialog.createLibrary.existingSection.length).toBeGreaterThan(0);
  });

  it("shows every recent entry on the no-library surface (no current path)", () => {
    const entries = [
      { path: "/libs/a", name: "甲" },
      { path: "/libs/b", name: "乙" },
    ];
    expect(buildRecentLibraryMenuEntries(entries, null)).toEqual(entries);
  });
});
