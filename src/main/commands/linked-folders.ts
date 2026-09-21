import type { RendererRequest, WorkerCommand } from "../../shared/protocol/requests";
import {
  selectOpenDirectory,
  type NativeDialogHost,
} from "../native-dialogs";

export type LinkedFolderCommandRuntime = {
  createNativeDialogHost: () => NativeDialogHost;
};

export async function executeLinkedFolderMainCommand(
  request: RendererRequest,
  runtime: LinkedFolderCommandRuntime,
): Promise<WorkerCommand | undefined> {
  switch (request.type) {
    case "linked-folder.list.request":
      return { type: "linked-folder.list", libraryId: request.libraryId };
    case "linked-folder.relink.request": {
      const newRootPath = await selectOpenDirectory(
        runtime.createNativeDialogHost(),
        "relinkFolder",
        process.env.SERPENT_E2E_LINKED_NEW_ROOT,
      );
      return newRootPath
        ? {
            type: "linked-folder.relink",
            libraryId: request.libraryId,
            folderId: request.folderId,
            newRootPath,
          }
        : undefined;
    }
    case "linked-folder.rules.get.request":
      return {
        type: "linked-folder.rules.get",
        libraryId: request.libraryId,
        folderId: request.folderId,
      };
    case "linked-folder.rules.set.request":
      return {
        type: "linked-folder.rules.set",
        libraryId: request.libraryId,
        folderId: request.folderId,
        rules: request.rules,
      };
    case "linked-folder.assets.copy.request":
      return {
        type: "linked-folder.assets.copy",
        libraryId: request.libraryId,
        folderId: request.folderId,
        relativePath: request.relativePath,
        assetIds: request.assetIds,
        conflictStrategy: request.conflictStrategy,
      };
    case "linked-folder.convert.request":
      return {
        type: "linked-folder.convert",
        libraryId: request.libraryId,
        folderId: request.folderId,
        targetFolderId: request.targetFolderId,
      };
    default:
      return undefined;
  }
}
