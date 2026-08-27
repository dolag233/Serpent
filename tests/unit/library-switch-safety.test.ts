import { describe, expect, it } from "vitest";

import { activeLibrarySwitchActivity } from "../../src/renderer/library-switch-safety";

const base = {
  uiState: "ready" as const,
  importProgress: null,
  exportProgress: null,
  syncProgress: null,
};

describe("activeLibrarySwitchActivity", () => {
  it("does not warn for ordinary browse loading", () => {
    expect(activeLibrarySwitchActivity({ ...base, uiState: "loading" })).toBeNull();
  });

  it.each([
    ["creating", "library-operation"],
    ["opening", "library-operation"],
    ["closing", "library-operation"],
    ["importing", "asset-import"],
  ] as const)("warns for %s", (uiState, expected) => {
    expect(activeLibrarySwitchActivity({ ...base, uiState })).toBe(expected);
  });

  it("detects active transfer progress even when the shell is ready", () => {
    expect(
      activeLibrarySwitchActivity({
        ...base,
        importProgress: {
          type: "import.progress",
          importId: "import-1",
          phase: "copy",
          cancelable: true,
          filesProcessed: 1,
          totalFiles: 2,
          bytesProcessed: 1,
          totalBytes: 2,
        },
      }),
    ).toBe("asset-import");
    expect(
      activeLibrarySwitchActivity({
        ...base,
        exportProgress: {
          type: "export.progress",
          exportId: "export-1",
          libraryId: "library-1",
          phase: "copy",
          filesProcessed: 1,
          totalFiles: 2,
          bytesProcessed: 1,
          totalBytes: 2,
        },
      }),
    ).toBe("library-export");
    expect(
      activeLibrarySwitchActivity({
        ...base,
        syncProgress: {
          type: "sync.progress",
          libraryId: "library-1",
          phase: "run",
          filesDone: 1,
          filesTotal: 2,
          bytesDone: 1,
          bytesTotal: 2,
        },
      }),
    ).toBe("sync");
  });
});
