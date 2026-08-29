import { describe, expect, it } from "vitest";

import { activeLibrarySwitchActivity } from "../../src/renderer/library-switch-safety";
import { createLibraryTransitionLock } from "../../src/renderer/library-transition-lock";

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

  it("warns when a write is in flight even if the shell only says loading", () => {
    expect(
      activeLibrarySwitchActivity({
        ...base,
        uiState: "loading",
        writeOperationInFlight: true,
      }),
    ).toBe("library-write");
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

describe("createLibraryTransitionLock", () => {
  it("runs transitions in submission order", async () => {
    const lock = createLibraryTransitionLock();
    let releaseFirst!: () => void;
    const firstReady = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const events: string[] = [];

    const first = lock(async () => {
      events.push("first:start");
      await firstReady;
      events.push("first:end");
      return "first";
    });
    const second = lock(async () => {
      events.push("second:start");
      return "second";
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(events).toEqual(["first:start"]);
    releaseFirst();
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("releases the queue after a failed transition", async () => {
    const lock = createLibraryTransitionLock();
    const failure = lock(async () => {
      throw new Error("transition failed");
    });
    const following = lock(async () => "following");

    await expect(failure).rejects.toThrow("transition failed");
    await expect(following).resolves.toBe("following");
  });
});
