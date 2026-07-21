import { describe, expect, it } from "vitest";

import {
  PLATFORM_SHORTCUT_TABLE,
  findPlatformShortcut,
  windowsUsesCtrlForMacMeta,
} from "../../src/shared/platform-shortcut-table";
import { assetCommandDefinitions } from "../../src/renderer/commands/asset-commands";
import { formatShortcut, matchesShortcut } from "../../src/renderer/commands/command-types";

describe("PLATFORM_SHORTCUT_TABLE (Serpent-4ojz / vf8x peek)", () => {
  it("gives every mac meta chord a windows Ctrl twin", () => {
    for (const row of PLATFORM_SHORTCUT_TABLE) {
      expect(windowsUsesCtrlForMacMeta(row), row.id).toBe(true);
      expect(row.windows.label.includes("⌘")).toBe(false);
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
});
