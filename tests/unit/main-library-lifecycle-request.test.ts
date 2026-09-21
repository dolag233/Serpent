import { expect, test, vi } from "vitest";

import { createPublicError } from "../../src/shared/protocol/errors";
import {
  applyExternalLibrarySourceCleanup,
  applyLibraryRendererLifecycle,
  applyLibraryWorkerSideEffects,
  mapBillfishInspectedDisplayName,
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

test("eagle inspect success retains the external source", async () => {
  const cleanupExternalSource = vi.fn(async () => undefined);
  await expect(applyExternalLibrarySourceCleanup(
    {
      type: "library.inspect-eagle",
      sourceRootPath: "C:\\libraries\\eagle-source",
    },
    { ok: true, type: "library.eagle-inspected", displayName: "Eagle" },
    { cleanupExternalSource },
  )).resolves.toEqual({ retainExternalSource: true });
  expect(cleanupExternalSource).not.toHaveBeenCalled();
});

test("billfish inspect keeps the archive stem as the display name", () => {
  expect(mapBillfishInspectedDisplayName(
    {
      type: "library.inspect-billfish",
      sourceRootPath: "C:\\libraries\\archive.zip",
      sourceDisplayName: "Archive",
    },
    { ok: true, type: "library.billfish-inspected", displayName: "serpent-external-library-temp" },
  )).toEqual({
    ok: true,
    type: "library.billfish-inspected",
    displayName: "Archive",
  });
});

test("invalid recent opens drop the path from every recent list", () => {
  const removeRecentLibrary = vi.fn();
  const publishLifecycle = vi.fn();
  applyLibraryRendererLifecycle(
    {
      type: "library.open",
      selectedLibraryPath: "C:\\libraries\\gone",
    },
    { ok: false, error: createPublicError("LIBRARY_NOT_FOUND") },
    { ok: false, error: { code: "LIBRARY_NOT_FOUND", message: "unused" } },
    "open",
    {
      removeRecentLibrary,
      recentLibraryPath: () => "recent.json",
      logError: vi.fn(),
      unblockLibraryMediaReads: vi.fn(),
      publishLifecycle,
      clearNativeAssetDragCache: vi.fn(),
      clearActiveRecentLibrary: vi.fn(),
    },
  );
  expect(publishLifecycle).toHaveBeenCalledWith({
    type: "library.open-failed",
    operation: "open",
    error: createPublicError("LIBRARY_NOT_FOUND"),
  });
  expect(removeRecentLibrary).toHaveBeenCalledWith(
    "recent.json",
    "C:\\libraries\\gone",
    expect.any(Function),
  );
});
