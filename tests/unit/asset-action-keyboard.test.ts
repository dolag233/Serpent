import { describe, expect, it } from "vitest";

import { matchAssetActionKeyboardCommand } from "../../src/renderer/asset-action-keyboard";
import { formatShortcut } from "../../src/renderer/commands/command-types";
import { assetCommandDefinitions } from "../../src/renderer/commands/asset-commands";
import { createCommandRegistry } from "../../src/renderer/commands/command-registry";

function event(
  partial: Partial<{
    key: string;
    code: string;
    keyCode: number;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
  }>,
) {
  return {
    key: "a",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...partial,
  };
}

const registry = createCommandRegistry(assetCommandDefinitions);

describe("asset action keyboard chords (Serpent-uye)", () => {
  it("shares shortcut specs with the asset command registry", () => {
    expect(formatShortcut(registry.get("asset.open-external")!.shortcut!, "mac")).toBe(
      "⌘O",
    );
    expect(
      formatShortcut(registry.get("asset.open-external")!.shortcut!, "windows"),
    ).toBe("Ctrl+O");
    expect(formatShortcut(registry.get("asset.rename")!.shortcut!, "mac")).toBe(
      "F2",
    );
    expect(
      formatShortcut(registry.get("asset.move-to-trash")!.shortcut!, "mac"),
    ).toBe("⌘⌫");
  });

  it("matches open-external / trash / rename on mac and windows", () => {
    expect(
      matchAssetActionKeyboardCommand(
        "asset.open-external",
        event({ key: "o", metaKey: true }),
        "mac",
      ),
    ).toBe(true);
    expect(
      matchAssetActionKeyboardCommand(
        "asset.open-external",
        event({ key: "o", ctrlKey: true }),
        "windows",
      ),
    ).toBe(true);
    expect(
      matchAssetActionKeyboardCommand(
        "asset.rename",
        event({ key: "F2" }),
        "windows",
      ),
    ).toBe(true);
    expect(
      matchAssetActionKeyboardCommand(
        "asset.rename",
        event({ key: "F2" }),
        "mac",
      ),
    ).toBe(true);
    expect(
      matchAssetActionKeyboardCommand(
        "asset.move-to-trash",
        event({ key: "Backspace", metaKey: true }),
        "mac",
      ),
    ).toBe(true);
    expect(
      matchAssetActionKeyboardCommand(
        "asset.move-to-trash",
        event({ key: "Delete" }),
        "windows",
      ),
    ).toBe(true);
    expect(
      matchAssetActionKeyboardCommand(
        "asset.copy",
        event({ key: "c", metaKey: true }),
        "mac",
      ),
    ).toBe(true);
    expect(
      matchAssetActionKeyboardCommand(
        "asset.copy",
        event({ key: "c", ctrlKey: true }),
        "windows",
      ),
    ).toBe(true);
  });

  it("rejects wrong modifier or key", () => {
    expect(
      matchAssetActionKeyboardCommand(
        "asset.open-external",
        event({ key: "o" }),
        "mac",
      ),
    ).toBe(false);
    expect(
      matchAssetActionKeyboardCommand(
        "asset.rename",
        event({ key: "F2", metaKey: true }),
        "mac",
      ),
    ).toBe(false);
  });

  it("matches F2 rename via code/keyCode when key is IME-noisy (Serpent-g8u9)", () => {
    expect(
      matchAssetActionKeyboardCommand(
        "asset.rename",
        event({ key: "", code: "F2" }),
        "windows",
      ),
    ).toBe(true);
    expect(
      matchAssetActionKeyboardCommand(
        "asset.rename",
        event({ key: "Process", code: "F2" }),
        "windows",
      ),
    ).toBe(true);
    expect(
      matchAssetActionKeyboardCommand(
        "asset.rename",
        event({ key: "", keyCode: 113 }),
        "windows",
      ),
    ).toBe(true);
  });
});
