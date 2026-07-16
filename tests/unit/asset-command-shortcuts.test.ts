import { describe, expect, it } from "vitest";

import {
  assetCommandShortcut,
  isMacPlatform,
  matchesAssetCommandShortcut,
} from "../../src/renderer/asset-command-shortcuts";

const event = (overrides: Partial<Parameters<typeof matchesAssetCommandShortcut>[0]>) => ({
  key: "",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides,
});

describe("asset command shortcuts", () => {
  it("uses platform-native labels", () => {
    expect(assetCommandShortcut("open-external", true)).toBe("⌘O");
    expect(assetCommandShortcut("open-external", false)).toBe("Ctrl+O");
    expect(assetCommandShortcut("move-to-trash", true)).toBe("⌘⌫");
    expect(assetCommandShortcut("move-to-trash", false)).toBe("Delete");
  });

  it("matches the same open command shown in the menu", () => {
    expect(matchesAssetCommandShortcut(event({ key: "o", metaKey: true }), "open-external", true)).toBe(true);
    expect(matchesAssetCommandShortcut(event({ key: "O", ctrlKey: true }), "open-external", false)).toBe(true);
    expect(matchesAssetCommandShortcut(event({ key: "o" }), "open-external", true)).toBe(false);
  });

  it("matches macOS Command+Backspace and Windows Delete only", () => {
    expect(matchesAssetCommandShortcut(event({ key: "Backspace", metaKey: true }), "move-to-trash", true)).toBe(true);
    expect(matchesAssetCommandShortcut(event({ key: "Backspace" }), "move-to-trash", true)).toBe(false);
    expect(matchesAssetCommandShortcut(event({ key: "Delete" }), "move-to-trash", false)).toBe(true);
    expect(matchesAssetCommandShortcut(event({ key: "Delete", ctrlKey: true }), "move-to-trash", false)).toBe(false);
  });

  it("detects desktop macOS without treating mobile user agents as macOS", () => {
    expect(isMacPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X)")).toBe(true);
    expect(isMacPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS) Mobile")).toBe(false);
  });
});
