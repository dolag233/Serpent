import { describe, expect, it, beforeEach } from "vitest";

import {
  matchBrowseKeyboardShortcut,
} from "../../src/shared/browse-keyboard-shortcuts";
import {
  resetBrowseShortcutForwardForTests,
  shouldForwardBrowseShortcut,
} from "../../src/shared/browse-shortcut-dedupe";

describe("matchBrowseKeyboardShortcut", () => {
  it("matches F2 / Delete / Shift+Delete without modifiers", () => {
    expect(matchBrowseKeyboardShortcut({ key: "F2", code: "F2" })).toBe(
      "rename",
    );
    expect(matchBrowseKeyboardShortcut({ key: "Delete" })).toBe("trash");
    expect(matchBrowseKeyboardShortcut({ key: "Del" })).toBe("trash");
    expect(
      matchBrowseKeyboardShortcut({ key: "Delete", shift: true }),
    ).toBe("disk-delete");
  });

  it("ignores chords with Ctrl/Alt/Meta", () => {
    expect(
      matchBrowseKeyboardShortcut({ key: "Delete", control: true }),
    ).toBeNull();
    expect(matchBrowseKeyboardShortcut({ key: "F2", meta: true })).toBeNull();
  });
});

describe("shouldForwardBrowseShortcut", () => {
  beforeEach(() => {
    resetBrowseShortcutForwardForTests();
  });

  it("dedupes the same action within 50ms", () => {
    expect(shouldForwardBrowseShortcut("rename", 1000)).toBe(true);
    expect(shouldForwardBrowseShortcut("rename", 1020)).toBe(false);
    expect(shouldForwardBrowseShortcut("trash", 1025)).toBe(true);
    expect(shouldForwardBrowseShortcut("rename", 1130)).toBe(true);
  });
});
