import { describe, expect, it } from "vitest";

import {
  recursiveSubfoldersHintKey,
  shouldFlashRecursiveSubfoldersHint,
} from "../../src/renderer/recursive-subfolders-hint";

describe("recursiveSubfoldersHintKey", () => {
  it("namespaces by library and folder", () => {
    expect(recursiveSubfoldersHintKey("lib-1", "folder-a")).toBe(
      "recursive-subfolders:lib-1:folder-a",
    );
  });
});

describe("shouldFlashRecursiveSubfoldersHint", () => {
  const base = {
    recursiveEnabled: false,
    hintsEnabled: true,
    alreadyDismissed: false,
    hasChildFoldersWithoutDirectAssets: true,
  };

  it("pulses for a folder showing child folders but no direct assets", () => {
    expect(shouldFlashRecursiveSubfoldersHint(base)).toBe(true);
  });

  it("does not pulse while the recursive toggle is already on", () => {
    expect(
      shouldFlashRecursiveSubfoldersHint({ ...base, recursiveEnabled: true }),
    ).toBe(false);
  });

  it("does not pulse when the global feature-hint switch is off", () => {
    expect(
      shouldFlashRecursiveSubfoldersHint({ ...base, hintsEnabled: false }),
    ).toBe(false);
  });

  it("does not pulse once the folder has been expanded (dismissed)", () => {
    expect(
      shouldFlashRecursiveSubfoldersHint({
        ...base,
        alreadyDismissed: true,
      }),
    ).toBe(false);
  });

  it("does not pulse when the folder has content or no child folders", () => {
    expect(
      shouldFlashRecursiveSubfoldersHint({
        ...base,
        hasChildFoldersWithoutDirectAssets: false,
      }),
    ).toBe(false);
  });
});