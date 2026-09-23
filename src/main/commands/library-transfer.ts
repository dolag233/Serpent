import path from "node:path";

import type { RendererRequest, WorkerCommand } from "../../shared/protocol/requests";
import { libraryExportDefaultName } from "../../shared/library-export-name";
import {
  selectOpenDirectory,
  selectOpenFile,
  selectSavePath,
  type NativeDialogHost,
} from "../native-dialogs";

export type LibraryTransferCommandRuntime = {
  createNativeDialogHost: () => NativeDialogHost;
  downloadsPath: () => string;
  pendingImportSources: Map<string, string>;
};

export async function executeLibraryTransferMainCommand(
  request: RendererRequest,
  runtime: LibraryTransferCommandRuntime,
): Promise<WorkerCommand | undefined> {
  switch (request.type) {
    case "library.export.request": {
      const host = runtime.createNativeDialogHost();
      const defaultExportName = libraryExportDefaultName(
        request.libraryName ?? "serpent-library-export",
        request.format,
      );
      // Windows 的保存对话框对文件名-only 的 defaultPath 不预填文件名
      // （electron#812：SetDefaultFolder vs SetFolder），macOS 特判可用——
      // 统一拼上 downloads 目录的完整路径，两平台都预填库名。
      const defaultExportPath = path.join(
        runtime.downloadsPath(),
        defaultExportName,
      );
      const destinationPath =
        request.format === "zip"
          ? await selectSavePath(
              host,
              "exportZip",
              process.env.SERPENT_E2E_EXPORT_DEST_ZIP,
              {
                defaultPath: defaultExportPath,
                filters: [{ name: "ZIP", extensions: ["zip"] }],
              },
            )
          : await selectSavePath(
              host,
              "exportFolder",
              process.env.SERPENT_E2E_EXPORT_DEST,
              { defaultPath: defaultExportPath },
            );
      return destinationPath
        ? {
            type: "library.export",
            libraryId: request.libraryId,
            destinationPath,
            format: request.format,
            includeLinkedContent: request.includeLinkedContent,
          }
        : undefined;
    }
    case "library.export.cancel.request":
      return { type: "library.export-cancel", exportId: request.exportId };
    case "library.import.request": {
      const sourceFolderPath = await selectOpenDirectory(
        runtime.createNativeDialogHost(),
        "importLibraryFolder",
        process.env.SERPENT_E2E_IMPORT_SOURCE,
      );
      if (!sourceFolderPath) return undefined;
      // Store source path for later use in copy/in-place decision.
      const importId = `import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      runtime.pendingImportSources.set(importId, sourceFolderPath);
      return { type: "library.import-validate", importId, sourceFolderPath };
    }
    case "library.import-zip.request": {
      const host = runtime.createNativeDialogHost();
      const sourceZipPath = await selectOpenFile(
        host,
        "importZip",
        process.env.SERPENT_E2E_IMPORT_SOURCE_ZIP,
        [{ name: "ZIP", extensions: ["zip"] }],
      );
      if (!sourceZipPath) return undefined;
      const destinationParentPath = await selectOpenDirectory(
        host,
        "importZipDestination",
        process.env.SERPENT_E2E_IMPORT_COPY_PARENT,
        { createDirectory: true },
      );
      if (!destinationParentPath) return undefined;
      return {
        type: "library.import-zip",
        sourceZipPath,
        destinationParentPath,
      };
    }
    case "library.import.cancel.request":
      return {
        type: "library.import-cancel",
        importId: request.importId,
        ...(request.mode === undefined ? {} : { mode: request.mode }),
      };
    case "asset.delete-cancel.request":
      return { type: "asset.delete-cancel", operationId: request.operationId };
    case "library.import.copy.request": {
      const importId = request.importId;
      const sourcePath = runtime.pendingImportSources.get(importId);
      if (!sourcePath) return undefined;
      const copyToParentPath = await selectOpenDirectory(
        runtime.createNativeDialogHost(),
        "importCopyDestination",
        process.env.SERPENT_E2E_IMPORT_COPY_PARENT,
        { createDirectory: true },
      );
      runtime.pendingImportSources.delete(importId);
      if (!copyToParentPath) return undefined;
      return {
        type: "library.import-folder",
        sourceFolderPath: sourcePath,
        copyToParentPath,
      };
    }
    case "library.import.open-in-place.request": {
      const importId = request.importId;
      const sourcePath = runtime.pendingImportSources.get(importId);
      if (!sourcePath) return undefined;
      runtime.pendingImportSources.delete(importId);
      return { type: "library.import-folder", sourceFolderPath: sourcePath };
    }
    default:
      return undefined;
  }
}
