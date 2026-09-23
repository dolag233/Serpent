import { expect, test } from "vitest";

import { toRendererResult } from "../../src/main/library-request/renderer-result";

test("library.opened keeps the recovery report inside Main", () => {
  expect(toRendererResult({
    ok: true,
    type: "library.opened",
    library: {
      libraryId: "lib-1",
      displayName: "Studio",
      libraryPath: "C:\\libraries\\studio",
      recovery: {
        mode: "backup-1",
        reportPath: "C:\\libraries\\studio\\recovery.txt",
        recoveredAssetCount: 3,
      },
    },
  })).toEqual({
    ok: true,
    type: "library.opened",
    library: {
      libraryId: "lib-1",
      displayName: "Studio",
      displayPath: "C:\\libraries\\studio",
      recovery: {
        mode: "backup-1",
        reportAvailable: true,
        recoveredAssetCount: 3,
      },
    },
  });
});

test("library.deleted surfaces deferred cleanup without the aside path", () => {
  expect(toRendererResult({
    ok: true,
    type: "library.deleted",
    libraryId: "lib-1",
    displayName: "Studio",
    libraryPath: "C:\\libraries\\studio",
    pendingAsidePath: "C:\\libraries\\studio.del-1",
  })).toEqual({
    ok: true,
    type: "library.deleted",
    libraryId: "lib-1",
    displayName: "Studio",
    pendingCleanup: true,
  });
});

test("relink preview requires the Main-owned token", () => {
  expect(() => toRendererResult({
    ok: true,
    type: "asset.relink-batch.preview",
    matchedCount: 1,
    unmatchedCount: 0,
    totalCount: 1,
    examples: [{ relativeFilePath: "shot.png", matched: true }],
  })).toThrow("Batch relink preview is missing its Main-process token.");
});
