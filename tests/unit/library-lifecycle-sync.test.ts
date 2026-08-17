import { describe, expect, it } from "vitest";

import {
  shouldApplyLibraryLifecycleEvent,
  shouldDetachLibraryOnOpening,
} from "../../src/renderer/library-lifecycle-sync";

describe("library lifecycle detach rules", () => {
  it("only detaches the current library when opening Eagle or Billfish, not when switching recents", () => {
    expect(
      shouldDetachLibraryOnOpening({
        type: "library.opening",
        operation: "open-eagle",
      }),
    ).toBe(true);
    expect(
      shouldDetachLibraryOnOpening({
        type: "library.opening",
        operation: "open-billfish",
      }),
    ).toBe(true);
    expect(
      shouldDetachLibraryOnOpening({
        type: "library.opening",
        operation: "open",
      }),
    ).toBe(false);
    expect(
      shouldDetachLibraryOnOpening({
        type: "library.opening",
        operation: "create",
      }),
    ).toBe(false);
    expect(
      shouldDetachLibraryOnOpening({
        type: "library.closed",
        libraryId: "meme-library",
      }),
    ).toBe(false);
    expect(
      shouldApplyLibraryLifecycleEvent({
        event: {
          type: "library.opened",
          library: {
            libraryId: "meme-library",
            displayName: "meme",
            displayPath: "/libraries/meme",
          },
          source: "replacement-restore",
        },
        currentLibraryId: undefined,
        scriptSandboxPreviewOpen: false,
      }),
    ).toBe(true);
  });
});
