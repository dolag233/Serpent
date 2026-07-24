import { describe, expect, it } from "vitest";

import { resolveExtensionSaveContext, resolveExtensionSaveRouting } from "../../src/main/extension-save-context";
import type { ActiveContext } from "../../src/shared/protocol/requests";

function contexts(
  entries: Array<[number, ActiveContext]>,
): ReadonlyMap<number, ActiveContext> {
  return new Map(entries);
}

describe("resolveExtensionSaveContext", () => {
  it("uses the focused Serpent window when it has an active library", () => {
    const resolved = resolveExtensionSaveContext({
      focusedWindowId: 2,
      lastTargetWindowId: 1,
      mainWindowId: 1,
      contexts: contexts([
        [1, { libraryId: "lib-a", selectedFolderId: "folder-a" }],
        [2, { libraryId: "lib-b", selectedFolderId: "folder-b" }],
      ]),
    });

    expect(resolved).toEqual({
      libraryId: "lib-b",
      selectedFolderId: "folder-b",
    });
  });

  it("falls back to the last target window when saving from the browser", () => {
    const resolved = resolveExtensionSaveContext({
      focusedWindowId: null,
      lastTargetWindowId: 1,
      mainWindowId: 1,
      contexts: contexts([
        [1, { libraryId: "lib-a", selectedFolderId: "folder-a" }],
      ]),
    });

    expect(resolved).toEqual({
      libraryId: "lib-a",
      selectedFolderId: "folder-a",
    });
  });

  it("falls back to the main window when no last target is recorded", () => {
    const resolved = resolveExtensionSaveContext({
      focusedWindowId: null,
      lastTargetWindowId: null,
      mainWindowId: 9,
      contexts: contexts([[9, { libraryId: "lib-main" }]]),
    });

    expect(resolved).toEqual({ libraryId: "lib-main" });
  });

  it("returns null when no window has an active library", () => {
    const resolved = resolveExtensionSaveContext({
      focusedWindowId: null,
      lastTargetWindowId: 1,
      mainWindowId: 1,
      contexts: contexts([[1, { libraryId: null }]]),
    });

    expect(resolved).toBeNull();
  });

  it("returns the routed target window id for browser saves", () => {
    const routing = resolveExtensionSaveRouting({
      focusedWindowId: null,
      lastTargetWindowId: 1,
      mainWindowId: 9,
      contexts: contexts([
        [1, { libraryId: "lib-a", selectedFolderId: "folder-a" }],
        [9, { libraryId: "lib-main" }],
      ]),
    });

    expect(routing).toEqual({
      targetWindowId: 1,
      context: {
        libraryId: "lib-a",
        selectedFolderId: "folder-a",
      },
    });
  });
});
