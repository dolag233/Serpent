import { describe, expect, it } from "vitest";

import {
  PLATFORM_SHORTCUT_TABLE,
  findPlatformShortcut,
  windowsUsesCtrlForMacMeta,
} from "../../src/shared/platform-shortcut-table";
import { assetCommandDefinitions } from "../../src/renderer/commands/asset-commands";
import { sidebarCommandDefinitions } from "../../src/renderer/commands/sidebar-commands";
import {
  formatShortcut,
  matchesShortcut,
} from "../../src/renderer/commands/command-types";

describe("PLATFORM_SHORTCUT_TABLE (Serpent-4ojz / Serpent-vf8x)", () => {
  it("gives every mac meta chord a windows Ctrl twin", () => {
    for (const row of PLATFORM_SHORTCUT_TABLE) {
      expect(windowsUsesCtrlForMacMeta(row), row.id).toBe(true);
      expect(row.windows.label.includes("⌘")).toBe(false);
      if (row.id !== "asset.delete-from-disk") {
        expect(Boolean(row.mac.shiftKey)).toBe(Boolean(row.windows.shiftKey));
        expect(Boolean(row.mac.altKey)).toBe(Boolean(row.windows.altKey));
      }
    }
  });

  it("keeps open-external / rename / trash aligned with asset commands", () => {
    const open = assetCommandDefinitions.find(
      (d) => d.id === "asset.open-external",
    );
    const rename = assetCommandDefinitions.find((d) => d.id === "asset.rename");
    const trash = assetCommandDefinitions.find(
      (d) => d.id === "asset.move-to-trash",
    );
    expect(open?.shortcut).toBeDefined();
    expect(rename?.shortcut).toBeDefined();
    expect(trash?.shortcut).toBeDefined();

    const tableOpen = findPlatformShortcut("asset.open-external");
    const tableRename = findPlatformShortcut("asset.rename");
    const tableTrash = findPlatformShortcut("asset.move-to-trash");
    expect(formatShortcut(open!.shortcut!, "windows")).toBe(
      tableOpen!.windows.label,
    );
    expect(formatShortcut(rename!.shortcut!, "windows")).toBe(
      tableRename!.windows.label,
    );
    expect(formatShortcut(trash!.shortcut!, "windows")).toBe(
      tableTrash!.windows.label,
    );

    expect(
      matchesShortcut(
        open!.shortcut!,
        { key: "o", metaKey: false, ctrlKey: true, altKey: false, shiftKey: false },
        "windows",
      ),
    ).toBe(true);
    expect(
      matchesShortcut(
        trash!.shortcut!,
        {
          key: "Delete",
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        },
        "windows",
      ),
    ).toBe(true);
  });

  it("keeps folder create / rename / trash aligned with sidebar commands", () => {
    const create = sidebarCommandDefinitions.find(
      (d) => d.id === "folder.create-subfolder",
    );
    const rename = sidebarCommandDefinitions.find((d) => d.id === "folder.rename");
    const trash = sidebarCommandDefinitions.find(
      (d) => d.id === "folder.move-to-trash",
    );
    expect(create?.shortcut).toBeDefined();
    expect(rename?.shortcut).toBeDefined();
    expect(trash?.shortcut).toBeDefined();

    const tableCreate = findPlatformShortcut("folder.create-subfolder");
    const tableRename = findPlatformShortcut("folder.rename");
    const tableTrash = findPlatformShortcut("folder.move-to-trash");
    expect(formatShortcut(create!.shortcut!, "windows")).toBe(
      tableCreate!.windows.label,
    );
    expect(formatShortcut(rename!.shortcut!, "windows")).toBe(
      tableRename!.windows.label,
    );
    expect(formatShortcut(trash!.shortcut!, "windows")).toBe(
      tableTrash!.windows.label,
    );
    expect(formatShortcut(create!.shortcut!, "mac")).toBe("⌘⇧N");

    expect(
      matchesShortcut(
        create!.shortcut!,
        {
          key: "n",
          metaKey: false,
          ctrlKey: true,
          altKey: false,
          shiftKey: true,
        },
        "windows",
      ),
    ).toBe(true);
    expect(
      matchesShortcut(
        trash!.shortcut!,
        {
          key: "Delete",
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        },
        "windows",
      ),
    ).toBe(true);
  });
});
