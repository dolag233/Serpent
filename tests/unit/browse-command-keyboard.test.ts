import { describe, expect, it } from "vitest";

import {
  FOCUS_SEARCH_SHORTCUT,
  matchFocusSearchShortcut,
} from "../../src/renderer/workspace-discovery-shortcuts";
import {
  matchesShortcut,
  type ShortcutEvent,
} from "../../src/renderer/commands/command-types";
import { assetCommandDefinitions } from "../../src/renderer/commands/asset-commands";

const event = (overrides: Partial<ShortcutEvent>): ShortcutEvent => ({
  key: "",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides,
});

describe("workspace-discovery-shortcuts (Serpent-x78x)", () => {
  it("matches Ctrl+F / ⌘F for search focus", () => {
    expect(
      matchFocusSearchShortcut(
        event({ key: "f", ctrlKey: true }),
        "windows",
      ),
    ).toBe(true);
    expect(
      matchFocusSearchShortcut(
        event({ key: "f", metaKey: true }),
        "mac",
      ),
    ).toBe(true);
  });
});

describe("REQ-COMMAND-004 asset shortcuts", () => {
  const paste = assetCommandDefinitions.find((d) => d.id === "asset.paste")!
    .shortcut!;
  const reveal = assetCommandDefinitions.find(
    (d) => d.id === "asset.reveal-in-folder",
  )!.shortcut!;
  const diskDelete = assetCommandDefinitions.find(
    (d) => d.id === "asset.delete-from-disk",
  )!.shortcut!;
  const copyFilePath = assetCommandDefinitions.find(
    (d) => d.id === "asset.copy-file-path",
  )!.shortcut!;

  it("wires paste Ctrl+V / ⌘V", () => {
    expect(
      matchesShortcut(paste, event({ key: "v", ctrlKey: true }), "windows"),
    ).toBe(true);
    expect(
      matchesShortcut(paste, event({ key: "v", metaKey: true }), "mac"),
    ).toBe(true);
  });

  it("wires reveal Ctrl+Shift+S / ⌘⇧S", () => {
    expect(
      matchesShortcut(
        reveal,
        event({ key: "s", ctrlKey: true, shiftKey: true }),
        "windows",
      ),
    ).toBe(true);
    expect(
      matchesShortcut(
        reveal,
        event({ key: "s", metaKey: true, shiftKey: true }),
        "mac",
      ),
    ).toBe(true);
  });

  it("separates Shift+Delete disk delete from plain Delete trash", () => {
    const trash = assetCommandDefinitions.find(
      (d) => d.id === "asset.move-to-trash",
    )!.shortcut!;
    expect(
      matchesShortcut(
        diskDelete,
        event({ key: "Delete", shiftKey: true }),
        "windows",
      ),
    ).toBe(true);
    expect(
      matchesShortcut(trash, event({ key: "Delete" }), "windows"),
    ).toBe(true);
    expect(
      matchesShortcut(
        diskDelete,
        event({ key: "Delete", shiftKey: true }),
        "windows",
      ) &&
        matchesShortcut(trash, event({ key: "Delete" }), "windows"),
    ).toBe(true);
    expect(
      matchesShortcut(trash, event({ key: "Delete", shiftKey: true }), "windows"),
    ).toBe(false);
  });

  it("matches mac ⌥⌘Delete for disk delete", () => {
    expect(
      matchesShortcut(
        diskDelete,
        event({ key: "Delete", metaKey: true, altKey: true }),
        "mac",
      ),
    ).toBe(true);
    expect(
      matchesShortcut(
        FOCUS_SEARCH_SHORTCUT,
        event({ key: "f", metaKey: true, altKey: true }),
        "mac",
      ),
    ).toBe(false);
  });

  it("matches Ctrl+Shift+C / ⌥⌘C for copying the selected file path", () => {
    expect(
      matchesShortcut(
        copyFilePath,
        event({ key: "c", ctrlKey: true, shiftKey: true }),
        "windows",
      ),
    ).toBe(true);
    expect(
      matchesShortcut(
        copyFilePath,
        event({ key: "c", metaKey: true, altKey: true }),
        "mac",
      ),
    ).toBe(true);
  });
});
