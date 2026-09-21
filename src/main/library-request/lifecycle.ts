import type { RendererRequest, WorkerCommand } from "../../shared/protocol/requests";
import type {
  RendererLifecycleEvent,
  RendererResult,
  WorkerResult,
} from "../../shared/protocol/responses";
import { createPublicError } from "../../shared/protocol/errors";
import {
  LibraryParentError,
  resolveWritableLibraryParent,
} from "../../worker/library-parent";

export type LibraryOpenOperation =
  | "create"
  | "open"
  | "import"
  | "open-eagle"
  | "open-billfish";

export type LibraryLifecyclePrepareRuntime = {
  closeOpenLibrariesBeforeReplacement: () => Promise<string[]>;
  publishOpening: (operation: LibraryOpenOperation) => void;
};

export type LibraryLifecyclePrepareOutcome =
  | { kind: "result"; result: RendererResult }
  | {
      kind: "continue";
      command: WorkerCommand;
      operation: LibraryOpenOperation | undefined;
      previousLibraryPaths: string[];
      clearPendingEagle: boolean;
      clearPendingBillfish: boolean;
    };

export async function prepareLibraryLifecycle(
  command: WorkerCommand,
  input: {
    operation: LibraryOpenOperation | undefined;
    lifecyclePublished: boolean;
  },
  runtime: LibraryLifecyclePrepareRuntime,
): Promise<LibraryLifecyclePrepareOutcome> {
  let nextCommand = command;
  let operation = input.operation;
  let previousLibraryPaths: string[] = [];
  let clearPendingEagle = false;
  let clearPendingBillfish = false;

  if (nextCommand.type === "library.create") operation = "create";
  if (nextCommand.type === "library.open") operation = "open";
  if (
    nextCommand.type === "library.import-folder" ||
    nextCommand.type === "library.import-zip"
  )
    operation = "import";
  // Billfish inspection is the first point at which a validated source is
  // ready to replace the active library. Detach the old library before the
  // name panel appears, so a slow archive/metadata read is visible as an
  // opening operation instead of looking like a stale browse session.
  if (nextCommand.type === "library.inspect-billfish") operation = "open-billfish";
  if (nextCommand.type === "library.open-eagle" || nextCommand.type === "library.open-billfish") {
    try {
      const selectedParentPath = resolveWritableLibraryParent({
        selectedParentPath: nextCommand.selectedParentPath,
        sourceRootPath: nextCommand.sourceRootPath,
        createIfMissing: true,
      });
      nextCommand = { ...nextCommand, selectedParentPath };
    } catch (error) {
      if (error instanceof LibraryParentError) {
        return {
          kind: "result",
          result: {
            ok: false,
            error: createPublicError(error.code, error.reason),
          } satisfies RendererResult,
        };
      }
      throw error;
    }
    if (nextCommand.type === "library.open-eagle") {
      clearPendingEagle = true;
      operation = "open-eagle";
    } else {
      clearPendingBillfish = true;
      operation = "open-billfish";
    }
  }
  if (operation && !input.lifecyclePublished) runtime.publishOpening(operation);
  if (nextCommand.type === "library.open-eagle" || nextCommand.type === "library.open-billfish") {
    previousLibraryPaths = await runtime.closeOpenLibrariesBeforeReplacement();
  }

  return {
    kind: "continue",
    command: nextCommand,
    operation,
    previousLibraryPaths,
    clearPendingEagle,
    clearPendingBillfish,
  };
}

export type LibraryWorkerSideEffectRuntime = {
  rememberOpenedLibrary: (libraryPath: string, displayName: string, libraryId?: string) => void;
  removeRecentLibrary: (
    filePath: string,
    libraryPath: string,
    onError?: (error: unknown) => void,
  ) => void;
  recentLibraryPath: () => string;
  logError: (scope: string, error: unknown, context?: Record<string, unknown>) => void;
  setPendingEagleOpenSourcePath: (value: string | undefined) => void;
  setPendingBillfishOpenSourcePath: (value: string | undefined) => void;
  purgePreviewLibrary: (libraryId: string) => void;
  pendingCleanupPath: () => string;
  readPendingCleanupAsidePaths: (
    filePath: string,
    onError?: (error: unknown) => void,
  ) => string[];
  writePendingCleanupAsidePaths: (
    filePath: string,
    paths: string[],
    onError?: (error: unknown) => void,
  ) => void;
  retryPendingLibraryCleanups: () => void;
  clearRelinkLibrary: (libraryId: string) => void;
  clearSourcePathLibrary: (libraryId: string) => void;
  clearArtifactPathCache: (libraryId: string) => void;
  cancelArtifactPathBatches: (libraryId: string) => void;
  clearPendingImportsForLibrary: (libraryId: string) => void;
  processAiQueue: (libraryId: string) => void;
  notifyLibraryOpened: (input: { libraryId: string; libraryDirectory: string }) => void;
  onLibraryClosed: (libraryId: string) => void;
};

/**
 * Recent-list, pending-source, cache, and plugin side effects after Worker returns.
 */
export function applyLibraryWorkerSideEffects(
  request: RendererRequest,
  command: WorkerCommand,
  workerResult: WorkerResult,
  runtime: LibraryWorkerSideEffectRuntime,
): void {
  if (workerResult.ok && workerResult.type === "library.opened") {
    runtime.rememberOpenedLibrary(
      workerResult.library.libraryPath,
      workerResult.library.displayName,
      workerResult.library.libraryId,
    );
  } else if (
    workerResult.ok &&
    workerResult.type === "library.eagle-inspected" &&
    command.type === "library.inspect-eagle"
  ) {
    runtime.setPendingEagleOpenSourcePath(command.sourceRootPath);
  } else if (
    workerResult.ok &&
    workerResult.type === "library.billfish-inspected" &&
    command.type === "library.inspect-billfish"
  ) {
    runtime.setPendingBillfishOpenSourcePath(command.sourceRootPath);
  } else if (workerResult.ok && workerResult.type === "library.renamed") {
    runtime.rememberOpenedLibrary(
      workerResult.library.libraryPath,
      workerResult.library.displayName,
      workerResult.library.libraryId,
    );
  } else if (workerResult.ok && workerResult.type === "library.imported") {
    runtime.rememberOpenedLibrary(workerResult.libraryPath, workerResult.displayName, workerResult.libraryId);
  } else if (workerResult.ok && workerResult.type === "library.deleted") {
    runtime.removeRecentLibrary(
      runtime.recentLibraryPath(),
      workerResult.libraryPath,
      (error) => {
        runtime.logError("recent-library.remove", error);
      },
    );
    if ("libraryId" in request) {
      runtime.purgePreviewLibrary(request.libraryId);
    }
    if (workerResult.pendingAsidePath) {
      const pendingPath = runtime.pendingCleanupPath();
      const current = runtime.readPendingCleanupAsidePaths(pendingPath, (error) => {
        runtime.logError("pending-library-cleanup.read", error);
      });
      runtime.writePendingCleanupAsidePaths(
        pendingPath,
        [...current, workerResult.pendingAsidePath],
        (error) => {
          runtime.logError("pending-library-cleanup.write", error);
        },
      );
      runtime.retryPendingLibraryCleanups();
    }
  }

  if (workerResult.ok && request.type === "library.close.request") {
    runtime.clearRelinkLibrary(request.libraryId);
    runtime.clearPendingImportsForLibrary(request.libraryId);
    runtime.clearArtifactPathCache(request.libraryId);
    runtime.cancelArtifactPathBatches(request.libraryId);
  }
  if (workerResult.ok && request.type === "library.delete-from-disk.request") {
    runtime.clearRelinkLibrary(request.libraryId);
    runtime.clearSourcePathLibrary(request.libraryId);
    runtime.clearArtifactPathCache(request.libraryId);
    runtime.cancelArtifactPathBatches(request.libraryId);
    runtime.clearPendingImportsForLibrary(request.libraryId);
  }

  if (
    workerResult.ok &&
    (request.type === "ai.resume-jobs.request" ||
      request.type === "ai.retry-jobs.request")
  ) {
    runtime.processAiQueue(request.libraryId);
  }
  if (
    workerResult.ok &&
    (workerResult.type === "library.opened" ||
      workerResult.type === "library.imported")
  ) {
    const openedLibraryId =
      workerResult.type === "library.opened"
        ? workerResult.library.libraryId
        : workerResult.libraryId;
    const openedLibraryPath =
      workerResult.type === "library.opened"
        ? workerResult.library.libraryPath
        : workerResult.libraryPath;
    runtime.notifyLibraryOpened({
      libraryId: openedLibraryId,
      libraryDirectory: openedLibraryPath,
    });
  }
  if (workerResult.ok && workerResult.type === "library.closed") {
    runtime.clearSourcePathLibrary(workerResult.libraryId);
    runtime.clearArtifactPathCache(workerResult.libraryId);
    runtime.cancelArtifactPathBatches(workerResult.libraryId);
    runtime.onLibraryClosed(workerResult.libraryId);
  }
}

export type RecoveryReportRuntime = {
  showItemInFolder: (absolutePath: string) => void;
  logError: (scope: string, error: unknown) => void;
};

export function tryHandleRecoveryReport(
  request: RendererRequest,
  workerResult: WorkerResult,
  runtime: RecoveryReportRuntime,
): RendererResult | undefined {
  if (
    !(
      workerResult.ok &&
      request.type === "library.recovery-report.request" &&
      workerResult.type === "library.recovery-report"
    )
  ) {
    return undefined;
  }
  try {
    // Keep the report path Main-owned. Showing the containing directory
    // also lets users inspect the quarantined damaged database beside it.
    runtime.showItemInFolder(workerResult.reportPath);
    return {
      ok: true,
      type: "library.recovery-report.requested",
      libraryId: request.libraryId,
    } satisfies RendererResult;
  } catch (error) {
    runtime.logError("main.recovery-report", error);
    return {
      ok: false,
      error: createPublicError("INTERNAL_ERROR"),
    } satisfies RendererResult;
  }
}

export type ExternalSourceCleanupRuntime = {
  cleanupExternalSource: (sourceRootPath: string | undefined) => Promise<void>;
};

/**
 * Eagle/Billfish temp-source cleanup after Worker returns.
 * Inspect success retains the source until the follow-up open/import.
 */
export async function applyExternalLibrarySourceCleanup(
  command: WorkerCommand,
  workerResult: WorkerResult,
  runtime: ExternalSourceCleanupRuntime,
): Promise<{ retainExternalSource: boolean }> {
  if (
    command.type === "library.open-eagle" ||
    command.type === "library.open-billfish" ||
    command.type === "asset.import-eagle" ||
    command.type === "asset.import-billfish"
  ) {
    await runtime.cleanupExternalSource(command.sourceRootPath);
    return { retainExternalSource: false };
  }
  if (
    command.type === "library.inspect-eagle" ||
    command.type === "library.inspect-billfish"
  ) {
    const expectedType = command.type === "library.inspect-eagle"
      ? "library.eagle-inspected"
      : "library.billfish-inspected";
    if (workerResult.ok && workerResult.type === expectedType) {
      return { retainExternalSource: true };
    }
    await runtime.cleanupExternalSource(command.sourceRootPath);
    return { retainExternalSource: false };
  }
  return { retainExternalSource: false };
}

/**
 * A Billfish archive has no stable library root name after extraction:
 * the worker sees a temporary `serpent-external-library-*` directory.
 * Keep the archive stem as the user-facing default all the way through
 * the Main→Renderer boundary, even if an older worker response falls
 * back to that temporary directory name.
 */
export function mapBillfishInspectedDisplayName(
  command: WorkerCommand,
  workerResult: WorkerResult,
): WorkerResult {
  if (
    workerResult.ok &&
    workerResult.type === "library.billfish-inspected" &&
    command.type === "library.inspect-billfish" &&
    command.sourceDisplayName
  ) {
    return { ...workerResult, displayName: command.sourceDisplayName };
  }
  return workerResult;
}

export type LibraryRendererLifecycleRuntime = {
  removeRecentLibrary: (
    filePath: string,
    libraryPath: string,
    onError?: (error: unknown) => void,
  ) => void;
  recentLibraryPath: () => string;
  logError: (scope: string, error: unknown) => void;
  unblockLibraryMediaReads: (libraryId: string) => void;
  publishLifecycle: (event: RendererLifecycleEvent) => void;
  clearNativeAssetDragCache: (libraryId: string) => void;
  clearActiveRecentLibrary: (
    filePath: string,
    onError?: (error: unknown) => void,
  ) => void;
};

/**
 * Renderer-facing library open/close/delete lifecycle after toRendererResult.
 */
export function applyLibraryRendererLifecycle(
  command: WorkerCommand,
  result: RendererResult,
  workerResult: WorkerResult,
  operation: LibraryOpenOperation | undefined,
  runtime: LibraryRendererLifecycleRuntime,
): void {
  if (!result.ok) {
    if (operation) {
      runtime.publishLifecycle({
        type: "library.open-failed",
        operation,
        error: result.error,
      });
      // Serpent-s0oq: an invalid recent library (folder gone, corrupt, or
      // unmigratable) must disappear from every recent list — the switcher
      // menu and the no-library create dialog share the same store. Only
      // deterministic invalid-open codes remove the entry; transient
      // failures (picker cancel, busy) and same-catalog identity prompts
      // (LIBRARY_ALREADY_OPEN) keep it.
      if (
        operation === "open" &&
        command.type === "library.open" &&
        (result.error?.code === "LIBRARY_NOT_FOUND" ||
          result.error?.code === "LIBRARY_CORRUPT" ||
          result.error?.code === "LIBRARY_MIGRATION_FAILED" ||
          result.error?.code === "LIBRARY_VERSION_TOO_NEW")
      ) {
        runtime.removeRecentLibrary(
          runtime.recentLibraryPath(),
          command.selectedLibraryPath,
          (error) => {
            runtime.logError("recent-library.remove-invalid", error);
          },
        );
      }
    }
    return;
  }
  if (result.type === "library.opened") {
    runtime.unblockLibraryMediaReads(result.library.libraryId);
    runtime.publishLifecycle({ type: "library.opened", library: result.library });
  } else if (workerResult.ok && workerResult.type === "library.imported") {
    runtime.unblockLibraryMediaReads(workerResult.libraryId);
    runtime.publishLifecycle({
      type: "library.opened",
      library: {
        libraryId: workerResult.libraryId,
        displayName: workerResult.displayName,
        displayPath: workerResult.libraryPath,
      },
    });
  } else if (result.type === "library.closed") {
    runtime.clearNativeAssetDragCache(result.libraryId);
    runtime.clearActiveRecentLibrary(runtime.recentLibraryPath(), (error) => {
      runtime.logError("recent-library.clear", error);
    });
    runtime.publishLifecycle({ type: "library.closed", libraryId: result.libraryId });
  } else if (result.type === "library.deleted") {
    runtime.clearNativeAssetDragCache(result.libraryId);
    runtime.publishLifecycle({ type: "library.closed", libraryId: result.libraryId });
  }
}

export type LibraryDeleteFromDiskRuntime = {
  beginFence: (libraryId: string) => void;
  clearNativeAssetDragCache: (libraryId: string) => void;
};

/**
 * Drop serpent:// file handles before the Worker tries to rm the root.
 * Always end this fence in `finally`; ZIP import preserves library_id.
 */
export function maybeBeginLibraryDeleteFromDisk(
  request: RendererRequest,
  runtime: LibraryDeleteFromDiskRuntime,
): string | undefined {
  if (request.type !== "library.delete-from-disk.request") return undefined;
  runtime.beginFence(request.libraryId);
  runtime.clearNativeAssetDragCache(request.libraryId);
  return request.libraryId;
}

export type LibraryReplacementAfterWorkerRuntime = {
  closeOpenedLibrary: (libraryId: string) => Promise<void>;
  logError: (scope: string, error: unknown, context?: Record<string, unknown>) => void;
  reopenLibrariesAfterFailedReplacement: (paths: string[]) => Promise<void>;
  publishLifecycle: (event: RendererLifecycleEvent) => void;
};

/**
 * Cancel-during-open closes the replacement library and restores the previous
 * one. A failed replacement also reopens the previous libraries.
 */
export async function applyLibraryReplacementAfterWorker(
  workerResult: WorkerResult,
  input: {
    cancelled: boolean;
    previousLibraryPaths: string[];
    operation: LibraryOpenOperation | undefined;
  },
  runtime: LibraryReplacementAfterWorkerRuntime,
): Promise<RendererResult | undefined> {
  if (input.cancelled) {
    if (workerResult.ok && workerResult.type === "library.opened") {
      try {
        await runtime.closeOpenedLibrary(workerResult.library.libraryId);
      } catch (error) {
        runtime.logError("library.open.cancel-close", error, {
          libraryId: workerResult.library.libraryId,
        });
      }
    }
    if (input.previousLibraryPaths.length > 0) {
      await runtime.reopenLibrariesAfterFailedReplacement(input.previousLibraryPaths);
    }
    if (input.operation) {
      runtime.publishLifecycle({
        type: "library.open-failed",
        operation: input.operation,
        error: createPublicError("CANCELLED"),
      });
    }
    return {
      ok: false,
      error: createPublicError("CANCELLED"),
    } satisfies RendererResult;
  }
  if (!workerResult.ok && input.previousLibraryPaths.length > 0) {
    await runtime.reopenLibrariesAfterFailedReplacement(input.previousLibraryPaths);
  }
  return undefined;
}

export type E2eTrashDelayRuntime = {
  isUnpackagedE2e: () => boolean;
  env: (name: string) => string | undefined;
  delay: (ms: number) => Promise<void>;
};

/**
 * Deterministic E2E seam for optimistic asset deletion. The renderer must
 * remove the card before this real IPC/Worker request resolves; production
 * never delays requests because this branch is gated by SERPENT_E2E.
 */
export async function maybeDelayE2eTrash(
  command: WorkerCommand,
  runtime: E2eTrashDelayRuntime,
): Promise<void> {
  if (!runtime.isUnpackagedE2e() || command.type !== "asset.trash") return;
  const delayMs = Number.parseInt(runtime.env("SERPENT_E2E_TRASH_DELAY_MS") ?? "", 10);
  if (Number.isInteger(delayMs) && delayMs > 0 && delayMs <= 10_000) {
    await runtime.delay(delayMs);
  }
}

export function externalSourceRootFromCommand(
  command: WorkerCommand | undefined,
): string | undefined {
  return command?.type === "library.inspect-eagle" ||
    command?.type === "library.open-eagle" ||
    command?.type === "asset.import-eagle" ||
    command?.type === "library.inspect-billfish" ||
    command?.type === "library.open-billfish" ||
    command?.type === "asset.import-billfish"
      ? command.sourceRootPath
      : undefined;
}
