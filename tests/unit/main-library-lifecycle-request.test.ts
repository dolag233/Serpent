import { expect, test, vi } from "vitest";

import {
  applyLibraryWorkerSideEffects,
  prepareLibraryLifecycle,
  tryHandleRecoveryReport,
} from "../../src/main/library-request/lifecycle";

test("library.create tags the opening operation without closing the current library", async () => {
  const publishOpening = vi.fn();
  const closeOpenLibrariesBeforeReplacement = vi.fn(async () => ["C:\\libraries\\old"]);
  await expect(prepareLibraryLifecycle(
    {
      type: "library.create",
      displayName: "Studio",
      selectedParentPath: "C:\\libraries",
    },
    { operation: undefined, lifecyclePublished: false },
    { closeOpenLibrariesBeforeReplacement, publishOpening },
  )).resolves.toEqual({
    kind: "continue",
    command: {
      type: "library.create",
      displayName: "Studio",
      selectedParentPath: "C:\\libraries",
    },
    operation: "create",
    previousLibraryPaths: [],
    clearPendingEagle: false,
    clearPendingBillfish: false,
  });
  expect(publishOpening).toHaveBeenCalledWith("create");
  expect(closeOpenLibrariesBeforeReplacement).not.toHaveBeenCalled();
});

test("library.closed clears caches through the side-effect hook", () => {
  const onLibraryClosed = vi.fn();
  const clearSourcePathLibrary = vi.fn();
  const clearArtifactPathCache = vi.fn();
  const cancelArtifactPathBatches = vi.fn();
  applyLibraryWorkerSideEffects(
    { type: "library.close.request", libraryId: "lib-1" },
    { type: "library.close", libraryId: "lib-1" },
    { ok: true, type: "library.closed", libraryId: "lib-1" },
    {
      rememberOpenedLibrary: vi.fn(),
      removeRecentLibrary: vi.fn(),
      recentLibraryPath: () => "recent.json",
      logError: vi.fn(),
      setPendingEagleOpenSourcePath: vi.fn(),
      setPendingBillfishOpenSourcePath: vi.fn(),
      purgePreviewLibrary: vi.fn(),
      pendingCleanupPath: () => "pending.json",
      readPendingCleanupAsidePaths: () => [],
      writePendingCleanupAsidePaths: vi.fn(),
      retryPendingLibraryCleanups: vi.fn(),
      clearRelinkLibrary: vi.fn(),
      clearSourcePathLibrary,
      clearArtifactPathCache,
      cancelArtifactPathBatches,
      clearPendingImportsForLibrary: vi.fn(),
      processAiQueue: vi.fn(),
      notifyLibraryOpened: vi.fn(),
      onLibraryClosed,
    },
  );
  expect(onLibraryClosed).toHaveBeenCalledWith("lib-1");
  expect(clearSourcePathLibrary).toHaveBeenCalledWith("lib-1");
  expect(clearArtifactPathCache).toHaveBeenCalledWith("lib-1");
  expect(cancelArtifactPathBatches).toHaveBeenCalledWith("lib-1");
});

test("recovery-report reveals the Main-owned report path", () => {
  const showItemInFolder = vi.fn();
  expect(tryHandleRecoveryReport(
    { type: "library.recovery-report.request", libraryId: "lib-1" },
    {
      ok: true,
      type: "library.recovery-report",
      reportPath: "C:\\libraries\\recovery.txt",
    },
    { showItemInFolder, logError: vi.fn() },
  )).toEqual({
    ok: true,
    type: "library.recovery-report.requested",
    libraryId: "lib-1",
  });
  expect(showItemInFolder).toHaveBeenCalledWith("C:\\libraries\\recovery.txt");
});
