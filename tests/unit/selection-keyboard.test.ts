import { describe, expect, it } from "vitest";

import {
  INVERT_SELECTION_SHORTCUT,
  SELECT_ALL_SHORTCUT,
  matchSelectionKeyboardAction,
} from "../../src/renderer/selection-keyboard";
import { formatShortcut, matchesShortcut } from "../../src/renderer/commands/command-types";

function event(
  partial: Partial<{
    key: string;
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

describe("selection keyboard chords (Serpent-5fq)", () => {
  it("labels invert as ⌘I / Ctrl+I", () => {
    expect(formatShortcut(INVERT_SELECTION_SHORTCUT, "mac")).toBe("⌘I");
    expect(formatShortcut(INVERT_SELECTION_SHORTCUT, "windows")).toBe("Ctrl+I");
    expect(formatShortcut(SELECT_ALL_SHORTCUT, "mac")).toBe("⌘A");
    expect(formatShortcut(SELECT_ALL_SHORTCUT, "windows")).toBe("Ctrl+A");
  });

  it("matches Cmd+I on mac and Ctrl+I on windows", () => {
    expect(
      matchesShortcut(
        INVERT_SELECTION_SHORTCUT,
        event({ key: "i", metaKey: true }),
        "mac",
      ),
    ).toBe(true);
    expect(
      matchesShortcut(
        INVERT_SELECTION_SHORTCUT,
        event({ key: "i", ctrlKey: true }),
        "windows",
      ),
    ).toBe(true);
    expect(
      matchesShortcut(
        INVERT_SELECTION_SHORTCUT,
        event({ key: "i", ctrlKey: true }),
        "mac",
      ),
    ).toBe(false);
    expect(
      matchesShortcut(
        INVERT_SELECTION_SHORTCUT,
        event({ key: "i", metaKey: true }),
        "windows",
      ),
    ).toBe(false);
  });

  it("resolves select-all / invert / Escape clear", () => {
    expect(
      matchSelectionKeyboardAction(event({ key: "a", metaKey: true }), "mac"),
    ).toBe("select-all");
    expect(
      matchSelectionKeyboardAction(event({ key: "i", ctrlKey: true }), "windows"),
    ).toBe("invert");
    expect(matchSelectionKeyboardAction(event({ key: "Escape" }), "mac")).toBe(
      "clear",
    );
    expect(
      matchSelectionKeyboardAction(event({ key: "Escape", metaKey: true }), "mac"),
    ).toBeNull();
  });
});
