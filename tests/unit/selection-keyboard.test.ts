import { describe, expect, it, vi } from "vitest";

import {
  INVERT_SELECTION_SHORTCUT,
  SELECT_ALL_SHORTCUT,
  dispatchSelectionKeyboardAction,
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

describe("dispatchSelectionKeyboardAction (Serpent-ws4k async select-all/invert)", () => {
  it("invokes select-all only on a non-empty scope and consumes the keydown", () => {
    const onSelectAll = vi.fn();
    expect(
      dispatchSelectionKeyboardAction("select-all", {
        browseScopeEmpty: false,
        selectionEmpty: true,
        onSelectAll,
      }),
    ).toBe(true);
    expect(onSelectAll).toHaveBeenCalledTimes(1);
  });

  it("no-ops select-all on an empty scope without consuming", () => {
    const onSelectAll = vi.fn();
    expect(
      dispatchSelectionKeyboardAction("select-all", {
        browseScopeEmpty: true,
        selectionEmpty: true,
        onSelectAll,
      }),
    ).toBe(false);
    expect(onSelectAll).not.toHaveBeenCalled();
  });

  it("invokes invert only on a non-empty scope and consumes the keydown", () => {
    const onInvert = vi.fn();
    expect(
      dispatchSelectionKeyboardAction("invert", {
        browseScopeEmpty: false,
        selectionEmpty: true,
        onInvert,
      }),
    ).toBe(true);
    expect(onInvert).toHaveBeenCalledTimes(1);
    expect(
      dispatchSelectionKeyboardAction("invert", {
        browseScopeEmpty: true,
        selectionEmpty: false,
        onInvert,
      }),
    ).toBe(false);
    expect(onInvert).toHaveBeenCalledTimes(1);
  });

  it("invokes Escape-clear only with a non-empty selection", () => {
    const onClear = vi.fn();
    expect(
      dispatchSelectionKeyboardAction("clear", {
        browseScopeEmpty: false,
        selectionEmpty: true,
        onClear,
      }),
    ).toBe(false);
    expect(onClear).not.toHaveBeenCalled();
    expect(
      dispatchSelectionKeyboardAction("clear", {
        browseScopeEmpty: false,
        selectionEmpty: false,
        onClear,
      }),
    ).toBe(true);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("does not consume unmapped actions", () => {
    expect(
      dispatchSelectionKeyboardAction(null, {
        browseScopeEmpty: false,
        selectionEmpty: false,
      }),
    ).toBe(false);
  });
});
