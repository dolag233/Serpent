import { describe, expect, it } from "vitest";

import { findShortcutAction } from "../../src/shared/shortcut-catalog";
import {
  reservedShortcutReason,
  validateShortcutChord,
  type ShortcutEventLike,
} from "../../src/shared/shortcut-resolution";
import {
  matchWorkspaceTabShortcut,
  workspaceTabShortcutEffect,
} from "../../src/renderer/use-workspace-tab-shortcuts";

function key(
  letter: string,
  modifiers: { readonly meta?: boolean; readonly ctrl?: boolean } = {},
): ShortcutEventLike {
  return {
    kind: "keyboard",
    key: letter,
    code: `Key${letter.toUpperCase()}`,
    metaKey: modifiers.meta === true,
    ctrlKey: modifiers.ctrl === true,
    altKey: false,
    shiftKey: false,
    repeat: false,
  };
}

describe("workspace tab shortcuts", () => {
  it("binds new and close tab to ⌘T/⌘W and Ctrl+T/Ctrl+W", () => {
    expect(matchWorkspaceTabShortcut(key("t", { meta: true }), "mac")).toBe("new");
    expect(matchWorkspaceTabShortcut(key("w", { meta: true }), "mac")).toBe("close");
    expect(matchWorkspaceTabShortcut(key("t", { ctrl: true }), "windows")).toBe("new");
    expect(matchWorkspaceTabShortcut(key("w", { ctrl: true }), "windows")).toBe("close");
    expect(matchWorkspaceTabShortcut(key("t", { ctrl: true }), "mac")).toBeNull();
    expect(matchWorkspaceTabShortcut(key("w", { meta: true }), "windows")).toBeNull();
    expect(matchWorkspaceTabShortcut(key("w"), "mac")).toBeNull();
  });

  it("lets ⌘W be a product shortcut instead of a system reservation", () => {
    const close = findShortcutAction("workspace.close-tab");
    const open = findShortcutAction("workspace.new-tab");
    expect(close?.defaults.mac[0]).toBeDefined();
    expect(open?.defaults.mac[0]).toBeDefined();
    expect(reservedShortcutReason(close!.defaults.mac[0]!, "mac")).toBeNull();
    expect(validateShortcutChord(close!.defaults.mac[0]!, "mac", close!.scopes, close!.id)).toBeNull();
    expect(validateShortcutChord(open!.defaults.windows[0]!, "windows", open!.scopes, open!.id)).toBeNull();
    expect(reservedShortcutReason({ key: "q", metaKey: true }, "mac")).toBe("system");
  });

  it("creates a tab, closes only when another tab remains, and never closes the window", () => {
    expect(workspaceTabShortcutEffect({
      command: "new",
      libraryOpen: true,
      busy: false,
      tabCount: 1,
      surfaceBlocked: false,
      previewOpen: false,
    })).toBe("new-tab");
    expect(workspaceTabShortcutEffect({
      command: "close",
      libraryOpen: true,
      busy: false,
      tabCount: 2,
      surfaceBlocked: false,
      previewOpen: false,
    })).toBe("close-tab");
    expect(workspaceTabShortcutEffect({
      command: "close",
      libraryOpen: true,
      busy: false,
      tabCount: 1,
      surfaceBlocked: false,
      previewOpen: false,
    })).toBe("swallow");
    expect(workspaceTabShortcutEffect({
      command: "close",
      libraryOpen: false,
      busy: false,
      tabCount: 1,
      surfaceBlocked: false,
      previewOpen: false,
    })).toBe("ignore");
    expect(workspaceTabShortcutEffect({
      command: "new",
      libraryOpen: true,
      busy: false,
      tabCount: 2,
      surfaceBlocked: false,
      previewOpen: true,
    })).toBe("new-tab");
    expect(workspaceTabShortcutEffect({
      command: "close",
      libraryOpen: true,
      busy: false,
      tabCount: 2,
      surfaceBlocked: false,
      previewOpen: true,
    })).toBe("swallow");
  });

  it("swallows the chord in a text field, dialog, or while the library is busy", () => {
    for (const command of ["new", "close"] as const) {
      expect(workspaceTabShortcutEffect({
        command,
        libraryOpen: true,
        busy: true,
        tabCount: 3,
        surfaceBlocked: false,
        previewOpen: false,
      })).toBe("swallow");
      expect(workspaceTabShortcutEffect({
        command,
        libraryOpen: true,
        busy: false,
        tabCount: 3,
        surfaceBlocked: true,
        previewOpen: false,
      })).toBe("swallow");
    }
  });
});
