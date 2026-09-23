import path from "node:path";

import type { RendererRequest, WorkerCommand } from "../../shared/protocol/requests";
import type { MaterializedExternalLibrarySource } from "../external-library-archive";
import {
  selectOpenDirectory,
  selectOpenFile,
  selectOpenLibrarySource,
  type NativeDialogHost,
} from "../native-dialogs";

export type LibraryCommandRuntime = {
  selectDirectory: (
    dialogId: "createLibrary" | "openLibrary",
  ) => Promise<string | undefined>;
  createNativeDialogHost: () => NativeDialogHost;
  cleanupExternalSource: (sourceRootPath: string | undefined) => Promise<void>;
  getPendingEagleOpenSourcePath: () => string | undefined;
  setPendingEagleOpenSourcePath: (value: string | undefined) => void;
  getPendingBillfishOpenSourcePath: () => string | undefined;
  setPendingBillfishOpenSourcePath: (value: string | undefined) => void;
  materializeSelectedExternalLibrary: (input: {
    readonly sourcePath: string;
    readonly kind: "eagle" | "billfish";
    readonly fallbackDirectory?: string;
  }) => Promise<MaterializedExternalLibrarySource>;
  rememberExternalSource: (materialized: MaterializedExternalLibrarySource) => string;
};

export async function executeLibraryMainCommand(
  request: RendererRequest,
  runtime: LibraryCommandRuntime,
  callbacks?: {
    onBillfishSourceSelected?: () => void;
  },
): Promise<WorkerCommand | undefined> {
  switch (request.type) {
    case "library.create.request": {
      const selectedParentPath = await runtime.selectDirectory("createLibrary");
      return selectedParentPath
        ? {
            type: "library.create",
            displayName: request.displayName,
            selectedParentPath,
          }
        : undefined;
    }
    case "library.open.request": {
      const selectedLibraryPath =
        request.libraryPath ?? (await runtime.selectDirectory("openLibrary"));
      return selectedLibraryPath
        ? {
            type: "library.open",
            selectedLibraryPath,
            ...(request.replaceExisting === true ? { replaceExisting: true } : {}),
          }
        : undefined;
    }
    case "library.recovery-report.request":
      // The Worker resolves the report path from its Main-owned library state;
      // Renderer only receives a shell acknowledgement.
      return { type: "library.recovery-report", libraryId: request.libraryId };
    case "library.inspect-eagle.request": {
      await runtime.cleanupExternalSource(runtime.getPendingEagleOpenSourcePath());
      runtime.setPendingEagleOpenSourcePath(undefined);
      await runtime.cleanupExternalSource(runtime.getPendingBillfishOpenSourcePath());
      runtime.setPendingBillfishOpenSourcePath(undefined);
      const selectedSourcePath = await selectOpenLibrarySource(
        runtime.createNativeDialogHost(),
        "openEagleLibrary",
        process.env.SERPENT_E2E_OPEN_EAGLE_LIBRARY,
        ["zip", "eaglepack", "rar", "7z", "tar", "gz", "tgz", "bz2", "tbz", "tbz2", "xz", "txz"],
      );
      if (!selectedSourcePath) return undefined;
      const materialized = await runtime.materializeSelectedExternalLibrary({
        sourcePath: selectedSourcePath,
        kind: "eagle",
        fallbackDirectory: path.dirname(path.resolve(selectedSourcePath)),
      });
      const sourceRootPath = runtime.rememberExternalSource(materialized);
      return sourceRootPath
        ? { type: "library.inspect-eagle", sourceRootPath }
        : undefined;
    }
    case "library.inspect-billfish.request": {
      await runtime.cleanupExternalSource(runtime.getPendingBillfishOpenSourcePath());
      runtime.setPendingBillfishOpenSourcePath(undefined);
      await runtime.cleanupExternalSource(runtime.getPendingEagleOpenSourcePath());
      runtime.setPendingEagleOpenSourcePath(undefined);
      const selectedSourcePath = await selectOpenFile(
        runtime.createNativeDialogHost(),
        "openBillfishLibrary",
        process.env.SERPENT_E2E_OPEN_BILLFISH_LIBRARY,
        [{ name: "Billfish Pack", extensions: ["billfishpack"] }],
      );
      if (!selectedSourcePath) return undefined;
      callbacks?.onBillfishSourceSelected?.();
      const materialized = await runtime.materializeSelectedExternalLibrary({
        sourcePath: selectedSourcePath,
        kind: "billfish",
        fallbackDirectory: path.dirname(path.resolve(selectedSourcePath)),
      });
      const sourceRootPath = runtime.rememberExternalSource(materialized);
      return sourceRootPath
        ? {
            type: "library.inspect-billfish",
            sourceRootPath,
            ...(materialized.sourceDisplayName === undefined
              ? {}
              : { sourceDisplayName: materialized.sourceDisplayName }),
          }
        : undefined;
    }
    case "library.inspect-eagle.cancel.request":
      await runtime.cleanupExternalSource(runtime.getPendingEagleOpenSourcePath());
      runtime.setPendingEagleOpenSourcePath(undefined);
      return undefined;
    case "library.inspect-billfish.cancel.request":
      await runtime.cleanupExternalSource(runtime.getPendingBillfishOpenSourcePath());
      runtime.setPendingBillfishOpenSourcePath(undefined);
      return undefined;
    case "library.open-eagle.request": {
      const sourceRootPath = runtime.getPendingEagleOpenSourcePath();
      if (!sourceRootPath) return undefined;
      const selectedParentPath = await selectOpenDirectory(
        runtime.createNativeDialogHost(),
        "openEagleLibraryDestination",
        process.env.SERPENT_E2E_OPEN_EAGLE_PARENT,
        { createDirectory: true },
      );
      return selectedParentPath
        ? {
            type: "library.open-eagle",
            sourceRootPath,
            selectedParentPath,
            displayName: request.displayName,
          }
        : undefined;
    }
    case "library.open-billfish.request": {
      const sourceRootPath = runtime.getPendingBillfishOpenSourcePath();
      if (!sourceRootPath) return undefined;
      const selectedParentPath = await selectOpenDirectory(
        runtime.createNativeDialogHost(),
        "openEagleLibraryDestination",
        process.env.SERPENT_E2E_OPEN_BILLFISH_PARENT,
        { createDirectory: true },
      );
      return selectedParentPath
        ? {
            type: "library.open-billfish",
            sourceRootPath,
            selectedParentPath,
            displayName: request.displayName,
          }
        : undefined;
    }
    case "library.close.request":
      return { type: "library.close", libraryId: request.libraryId };
    case "library.rename.request":
      return { type: "library.rename", libraryId: request.libraryId, displayName: request.displayName };
    case "library.delete-from-disk.request":
      return { type: "library.delete-from-disk", libraryId: request.libraryId };
    case "library.list.request":
      return { type: "library.list" };
    case "history.status.request":
      return { type: "history.status", libraryId: request.libraryId };
    case "history.undo.request":
      return {
        type: "history.undo",
        libraryId: request.libraryId,
        expectedHistoryEntryId: request.expectedHistoryEntryId,
      };
    case "history.redo.request":
      return {
        type: "history.redo",
        libraryId: request.libraryId,
        expectedHistoryEntryId: request.expectedHistoryEntryId,
      };
    case "library.list-recent.request":
    case "library.open-recent.request":
    case "library.forget-recent.request":
      // Both are handled directly in handleLibraryRequest: the list comes from
      // the Main-owned recent libraries store, and open-recent validates store
      // membership before building the same library.open command used here.
      // forget-recent only mutates the Main store (Serpent-ucx).
      return undefined;
    case "library.open-cancel.request":
      // Main-only request; handled before Worker dispatch.
      return undefined;
    case "library.choose-path.request":
      // Main-only request (native picker); handled before Worker dispatch.
      return undefined;
    default:
      return undefined;
  }
}
