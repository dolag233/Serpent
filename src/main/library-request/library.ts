import path from "node:path";

import type { RendererRequest, WorkerCommand } from "../../shared/protocol/requests";
import type { RendererResult } from "../../shared/protocol/responses";
import { createPublicError } from "../../shared/protocol/errors";
import type { RecentLibraryEntry } from "../../shared/recent-libraries";
import type { LibraryCommandBuildOutcome } from "./command-outcome";

export type LibraryOwnedRequestRuntime = {
  getActiveLibraryOpenCancellation: () => { cancelled: boolean } | undefined;
  logInfo: (scope: string, message: string) => void;
  logError: (scope: string, error: unknown) => void;
  selectDirectory: (dialogId: "openLibrary") => Promise<string | undefined>;
  recentLibraryPath: () => string;
  readRecentLibraryEntries: (
    filePath: string,
    onError?: (error: unknown) => void,
  ) => RecentLibraryEntry[];
  removeRecentLibrary: (
    filePath: string,
    libraryPath: string,
    onError?: (error: unknown) => void,
  ) => void;
  refreshApplicationMenuRecentLibraries: () => void;
  cleanupExternalSource: (sourceRootPath: string | undefined) => Promise<void>;
  getPendingEagleOpenSourcePath: () => string | undefined;
  setPendingEagleOpenSourcePath: (value: string | undefined) => void;
  getPendingBillfishOpenSourcePath: () => string | undefined;
  setPendingBillfishOpenSourcePath: (value: string | undefined) => void;
};

/**
 * Main-owned library requests that return before Worker dispatch.
 * Undefined means the request is not handled here.
 */
export async function tryHandleLibraryOwnedRequest(
  request: RendererRequest,
  runtime: LibraryOwnedRequestRuntime,
): Promise<RendererResult | undefined> {
  switch (request.type) {
    case "library.open-cancel.request": {
      const cancellation = runtime.getActiveLibraryOpenCancellation();
      if (cancellation) {
        cancellation.cancelled = true;
        runtime.logInfo(
          "library.open.cancel-requested",
          "Library opening cancellation requested.",
        );
      }
      return {
        ok: true,
        type: "library.open-cancelled",
      } satisfies RendererResult;
    }
    case "library.choose-path.request": {
      // Dialog only. The renderer starts its loading UI/timer only after this
      // resolves, so the progress overlay never covers the native picker.
      const chosenPath = await runtime.selectDirectory("openLibrary");
      return {
        ok: true,
        type: "library.choose-path",
        path: chosenPath ?? null,
      } satisfies RendererResult;
    }
    case "library.list-recent.request":
      return {
        ok: true,
        type: "library.recent-list",
        libraries: runtime.readRecentLibraryEntries(runtime.recentLibraryPath(), (error) => {
          runtime.logError("recent-library.read", error);
        }),
      } satisfies RendererResult;
    case "library.forget-recent.request": {
      if (!path.isAbsolute(request.libraryPath)) {
        return {
          ok: false,
          error: createPublicError("LIBRARY_NOT_FOUND"),
        } satisfies RendererResult;
      }
      runtime.removeRecentLibrary(runtime.recentLibraryPath(), request.libraryPath, (error) => {
        runtime.logError("recent-library.forget", error);
      });
      runtime.refreshApplicationMenuRecentLibraries();
      return {
        ok: true,
        type: "library.forgotten",
        libraryPath: request.libraryPath,
      } satisfies RendererResult;
    }
    case "library.inspect-eagle.cancel.request":
      await runtime.cleanupExternalSource(runtime.getPendingEagleOpenSourcePath());
      runtime.setPendingEagleOpenSourcePath(undefined);
      return {
        ok: true,
        type: "library.eagle-inspect-cancelled",
      } satisfies RendererResult;
    case "library.inspect-billfish.cancel.request":
      await runtime.cleanupExternalSource(runtime.getPendingBillfishOpenSourcePath());
      runtime.setPendingBillfishOpenSourcePath(undefined);
      return {
        ok: true,
        type: "library.billfish-inspect-cancelled",
      } satisfies RendererResult;
    default:
      return undefined;
  }
}

/**
 * Recent-library reopen that either returns a Worker open command or a
 * LIBRARY_NOT_FOUND result. Undefined means the request is not handled here.
 */
export function tryBuildOpenRecentCommand(
  request: RendererRequest,
  runtime: LibraryOwnedRequestRuntime,
): LibraryCommandBuildOutcome | undefined {
  if (request.type !== "library.open-recent.request") return undefined;
  // The renderer may only reopen a library that Main itself recorded in the
  // recent libraries store — never an arbitrary path. This keeps the same
  // open-by-path pipeline the restart restore uses.
  const recentEntries = runtime.readRecentLibraryEntries(
    runtime.recentLibraryPath(),
    (error) => {
      runtime.logError("recent-library.read", error);
    },
  );
  if (
    !path.isAbsolute(request.libraryPath) ||
    !recentEntries.some((entry) => entry.path === request.libraryPath)
  ) {
    return {
      kind: "result",
      result: {
        ok: false,
        error: createPublicError("LIBRARY_NOT_FOUND"),
      } satisfies RendererResult,
    };
  }
  return {
    kind: "command",
    command: {
      type: "library.open",
      selectedLibraryPath: request.libraryPath,
    } satisfies WorkerCommand,
  };
}
