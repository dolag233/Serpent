import type { RendererRequest, WorkerCommand } from "../../shared/protocol/requests";
import type { MaterializedExternalLibrarySource } from "../external-library-archive";
import {
  selectOpenDirectory,
  selectOpenFile,
  selectOpenLibrarySource,
  type NativeDialogHost,
} from "../native-dialogs";
import { createWebImportCommand } from "../web-ingestion";

export type AssetIngestionCommandRuntime = {
  selectImportSources: (sourceKind: "files" | "folder") => Promise<string[] | undefined>;
  createNativeDialogHost: () => NativeDialogHost;
  materializeSelectedExternalLibrary: (input: {
    readonly sourcePath: string;
    readonly kind: "eagle" | "billfish";
    readonly fallbackDirectory?: string;
  }) => Promise<MaterializedExternalLibrarySource>;
  rememberExternalSource: (materialized: MaterializedExternalLibrarySource) => string;
  fallbackDirectoryForLibraryId: (libraryId: string) => string | undefined;
  isUnpackagedE2e: () => boolean;
};

export async function executeAssetIngestionMainCommand(
  request: RendererRequest,
  runtime: AssetIngestionCommandRuntime,
): Promise<WorkerCommand | undefined> {
  switch (request.type) {
    case "asset.import-files.request": {
      const sourcePaths = await runtime.selectImportSources("files");
      return sourcePaths
        ? {
            type: "asset.import.prepare",
            libraryId: request.libraryId,
            targetFolderId: request.targetFolderId,
            sourceKind: "files" as const,
            sourcePaths,
            expandImageSequences: runtime.isUnpackagedE2e(),
            ...(request.detectImageSequences === false ||
            request.autoDetectImageSequences === false
              ? { createImageSequence: false }
              : {}),
            imageSequenceFps: runtime.isUnpackagedE2e() ? 30 : undefined,
          }
        : undefined;
    }
    case "asset.import-folder.request": {
      const sourcePaths = await runtime.selectImportSources("folder");
      return sourcePaths
        ? {
            type: "asset.import.prepare",
            libraryId: request.libraryId,
            targetFolderId: request.targetFolderId,
            sourceKind: "folder",
            sourcePaths,
            ...(request.detectImageSequences === false ||
            request.autoDetectImageSequences === false
              ? { createImageSequence: false }
              : {}),
          }
        : undefined;
    }
    case "asset.import-eagle.request": {
      const selectedSourcePath = await selectOpenLibrarySource(
        runtime.createNativeDialogHost(),
        "importEagleLibrary",
        process.env.SERPENT_E2E_IMPORT_EAGLE_LIBRARY,
        ["zip", "eaglepack", "rar", "7z", "tar", "gz", "tgz", "bz2", "tbz", "tbz2", "xz", "txz"],
      );
      if (!selectedSourcePath) return undefined;
      const materialized = await runtime.materializeSelectedExternalLibrary({
        sourcePath: selectedSourcePath,
        kind: "eagle",
        fallbackDirectory: runtime.fallbackDirectoryForLibraryId(request.libraryId),
      });
      const sourceRootPath = runtime.rememberExternalSource(materialized);
      return sourceRootPath
        ? {
            type: "asset.import-eagle",
            libraryId: request.libraryId,
            sourceRootPath,
          }
        : undefined;
    }
    case "asset.import-billfish.request": {
      const selectedSourcePath = await selectOpenFile(
        runtime.createNativeDialogHost(),
        "importBillfishLibrary",
        process.env.SERPENT_E2E_IMPORT_BILLFISH_LIBRARY,
        [{ name: "Billfish Pack", extensions: ["billfishpack"] }],
      );
      if (!selectedSourcePath) return undefined;
      const materialized = await runtime.materializeSelectedExternalLibrary({
        sourcePath: selectedSourcePath,
        kind: "billfish",
        fallbackDirectory: runtime.fallbackDirectoryForLibraryId(request.libraryId),
      });
      const sourceRootPath = runtime.rememberExternalSource(materialized);
      return sourceRootPath
        ? {
            type: "asset.import-billfish",
            libraryId: request.libraryId,
            sourceRootPath,
          }
        : undefined;
    }
    case "asset.import-drop.request":
      // Classified in handleLibraryRequest because classification failures need
      // a renderer-safe, specific public error instead of an INTERNAL_ERROR.
      return undefined;
    case "asset.resolve-dropped-paths.request":
      return {
        type: "media.resolve-asset-paths",
        libraryId: request.libraryId,
        sourcePaths: request.sourcePaths,
      };
    case "asset.import-sequence.confirm":
      // Resolved against Main-held offer paths in handleLibraryRequest.
      return undefined;
    case "asset.import-drop-invalid.report":
      return undefined;
    case "asset.import-web.request":
      return createWebImportCommand(request);
    case "asset.import-web-invalid.report":
      return undefined;
    case "asset.import-clipboard.request":
      // Clipboard bytes are read and staged in handleLibraryRequest. Renderer
      // never sends clipboard bytes or a source path.
      return undefined;
    case "asset.import.resolve":
      return {
        type: "asset.import.resolve",
        importId: request.importId,
        suspectedDuplicate: request.suspectedDuplicate,
        nameConflict: request.nameConflict,
      };
    case "asset.import.skip-source-failure":
      return {
        type: "asset.import.skip-source-failure",
        importId: request.importId,
        applyToRest: request.applyToRest,
      };
    case "asset.import.abandon":
      return { type: "asset.import.abandon", importId: request.importId };
    case "asset.refresh.request":
      return { type: "asset.refresh", libraryId: request.libraryId };
    case "asset.import-linked.request": {
      const sourceRootPath = await selectOpenDirectory(
        runtime.createNativeDialogHost(),
        "linkFolder",
        process.env.SERPENT_E2E_LINKED_SOURCE,
      );
      return sourceRootPath
        ? {
            type: "asset.import-linked",
            libraryId: request.libraryId,
            displayName: request.displayName,
            sourceRootPath,
            parentFolderId: request.parentFolderId,
          }
        : undefined;
    }
    default:
      return undefined;
  }
}
