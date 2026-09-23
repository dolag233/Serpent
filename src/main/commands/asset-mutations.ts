import type { RendererRequest, WorkerCommand } from "../../shared/protocol/requests";
import {
  selectOpenDirectory,
  selectOpenFile,
  type NativeDialogHost,
} from "../native-dialogs";

export type AssetMutationCommandRuntime = {
  createNativeDialogHost: () => NativeDialogHost;
  consumeRelinkPreview: (libraryId: string, previewId: string) => string | undefined;
};

export async function executeAssetMutationMainCommand(
  request: RendererRequest,
  runtime: AssetMutationCommandRuntime,
): Promise<WorkerCommand | undefined> {
  switch (request.type) {
    case "asset.trash.request":
      return {
        type: "asset.trash",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
      };
    case "asset.sequence.create.request":
      return {
        type: "asset.sequence.create",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
        fps: request.fps,
      };
    case "asset.sequence.dissolve.request":
      return {
        type: "asset.sequence.dissolve",
        libraryId: request.libraryId,
        sequenceId: request.sequenceId,
      };
    case "asset.sequence.dissolve-batch.request":
      return {
        type: "asset.sequence.dissolve-batch",
        libraryId: request.libraryId,
        sequenceIds: request.sequenceIds,
      };
    case "asset.sequence.set-fps.request":
      return {
        type: "asset.sequence.set-fps",
        libraryId: request.libraryId,
        sequenceId: request.sequenceId,
        fps: request.fps,
      };
    case "asset.restore.request":
      return {
        type: "asset.restore",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
        targetFolderId: request.targetFolderId,
        conflictStrategy: request.conflictStrategy,
      };
    case "asset.restore-preview.request":
      return {
        type: "asset.restore-preview",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
        targetFolderId: request.targetFolderId,
      };
    case "asset.move.request":
      return {
        type: "asset.move",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
        targetFolderId: request.targetFolderId,
        conflictStrategy: request.conflictStrategy,
      };
    case "asset.move-undo.request":
      return {
        type: "asset.move-undo",
        libraryId: request.libraryId,
        operationId: request.operationId,
        conflictStrategy: request.conflictStrategy,
      };
    case "asset.copy.request":
      return {
        type: "asset.copy",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
        targetFolderId: request.targetFolderId,
        conflictStrategy: request.conflictStrategy,
      };
    case "asset.copy-undo.request":
      return {
        type: "asset.copy-undo",
        libraryId: request.libraryId,
        operationId: request.operationId,
        conflictStrategy: request.conflictStrategy,
      };
    case "asset.rename-file.request":
      return {
        type: "asset.rename-file",
        libraryId: request.libraryId,
        assetId: request.assetId,
        ...(request.newBaseName === undefined ? {} : { newBaseName: request.newBaseName }),
        ...(request.newFileName === undefined ? {} : { newFileName: request.newFileName }),
      };
    case "asset.text.read.request":
      return {
        type: "asset.text.read",
        libraryId: request.libraryId,
        assetId: request.assetId,
        maxBytes: request.maxBytes,
      };
    case "asset.text.save.request":
      return {
        type: "asset.text.save",
        libraryId: request.libraryId,
        assetId: request.assetId,
        content: request.content,
        expectedRevisionId: request.expectedRevisionId,
        createRevision: request.createRevision,
      };
    case "asset.delete-permanent.request":
      return {
        type: "asset.delete-permanent",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
      };
    case "asset.delete-from-disk.request":
      return {
        type: "asset.delete-from-disk",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
      };
    case "trash.list.request":
      return { type: "asset.list-trash", libraryId: request.libraryId };
    case "trash.list-folders.request":
      return { type: "folder.list-trashed", libraryId: request.libraryId };
    case "trash.restore-folder.request":
      return {
        type: "folder.restore-trashed",
        libraryId: request.libraryId,
        tombstoneId: request.tombstoneId,
      };
    case "trash.purge.request":
      return { type: "asset.purge-trash", libraryId: request.libraryId };
    case "asset.delete-linked.request":
      return {
        type: "asset.delete-linked",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
        deleteSourceFile: request.deleteSourceFile,
      };
    case "asset.relink.request": {
      const newAbsolutePath = await selectOpenFile(
        runtime.createNativeDialogHost(),
        "locateMissingAsset",
        process.env.SERPENT_E2E_RELINK_FILE,
      );
      return newAbsolutePath
        ? {
            type: "asset.relink",
            libraryId: request.libraryId,
            assetId: request.assetId,
            newAbsolutePath,
          }
        : undefined;
    }
    case "asset.relink-batch.preview-at-root.request": {
      return {
        type: "asset.relink-batch.preview",
        libraryId: request.libraryId,
        newRootPath: request.newRootPath,
      };
    }
    case "asset.relink-batch.request": {
      const newRootPath = await selectOpenDirectory(
        runtime.createNativeDialogHost(),
        "selectRelinkRoot",
        process.env.SERPENT_E2E_RELINK_ROOT,
      );
      if (newRootPath) {
        return {
          type: "asset.relink-batch.preview",
          libraryId: request.libraryId,
          newRootPath,
        };
      }
      return undefined;
    }
    case "asset.relink-batch.apply.request": {
      const newRootPath = runtime.consumeRelinkPreview(
        request.libraryId,
        request.previewId,
      );
      if (!newRootPath) return undefined;
      return {
        type: "asset.relink-batch.apply",
        libraryId: request.libraryId,
        newRootPath,
        keepMetadata: request.keepMetadata,
      };
    }
    case "asset.relink-batch.cancel.request":
      // Handled directly in handleLibraryRequest; no root path crosses to Worker.
      return undefined;
    default:
      return undefined;
  }
}
