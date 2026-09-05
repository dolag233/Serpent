import { describe, expect, it } from "vitest";

import {
  LINKED_FOLDER_ADD_HINT_KEY,
  shouldShowLinkedFolderAddHint,
} from "../../src/renderer/linked-folder-add-hint";

describe("LINKED_FOLDER_ADD_HINT_KEY", () => {
  it("has a stable persisted key", () => {
    expect(LINKED_FOLDER_ADD_HINT_KEY).toBe("linked-folder-add-hint");
  });
});

describe("shouldShowLinkedFolderAddHint", () => {
  const base = {
    hintsEnabled: true,
    alreadyDismissed: false,
    hasLinkedFolders: false,
  };

  it("shows for a library that has never used linked folders", () => {
    expect(shouldShowLinkedFolderAddHint(base)).toBe(true);
  });

  it("hides when the global feature-hint switch is off", () => {
    expect(
      shouldShowLinkedFolderAddHint({ ...base, hintsEnabled: false }),
    ).toBe(false);
  });

  it("hides once the hint has been dismissed (hovered or linked used)", () => {
    expect(
      shouldShowLinkedFolderAddHint({ ...base, alreadyDismissed: true }),
    ).toBe(false);
  });

  it("hides once the library already has linked folders", () => {
    expect(
      shouldShowLinkedFolderAddHint({ ...base, hasLinkedFolders: true }),
    ).toBe(false);
  });
});