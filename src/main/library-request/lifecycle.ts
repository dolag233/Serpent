import type { RendererRequest, WorkerCommand } from "../../shared/protocol/requests";
import type { RendererResult, WorkerResult } from "../../shared/protocol/responses";
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
