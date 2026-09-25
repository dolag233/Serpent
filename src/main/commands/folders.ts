import type { RendererRequest, WorkerCommand } from "../../shared/protocol/requests";

export async function executeFolderMainCommand(
  request: RendererRequest,
): Promise<WorkerCommand | undefined> {
  switch (request.type) {
    case "folder.create.request":
      return {
        type: "folder.create",
        libraryId: request.libraryId,
        parentFolderId: request.parentFolderId,
        name: request.name,
      };
    case "folder.rename.request":
      return {
        type: "folder.rename",
        libraryId: request.libraryId,
        folderId: request.folderId,
        newName: request.newName,
      };
    case "appearance.set.request":
      return {
        type: "appearance.set",
        libraryId: request.libraryId,
        target: request.target,
        appearance: request.appearance,
      };
    case "folder.list.request":
      return { type: "folder.list", libraryId: request.libraryId, showIgnored: request.showIgnored };
    case "folder.browse-entries.request":
      return {
        type: "folder.browse-entries",
        libraryId: request.libraryId,
        parentFolderId: request.parentFolderId,
        showIgnored: request.showIgnored,
      };
    case "folder.entries-request":
      return {
        type: "folder.entries",
        libraryId: request.libraryId,
        refs: request.refs,
      };
    case "folder.indexed-bytes.request":
      return {
        type: "folder.indexed-bytes",
        libraryId: request.libraryId,
        refs: request.refs,
      };
    case "folder.trash.request":
      return {
        type: "folder.trash",
        libraryId: request.libraryId,
        folderId: request.folderId,
      };
    case "selection.trash.request":
      return {
        type: "selection.trash",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
        folderIds: request.folderIds,
      };
    case "folder.delete-from-disk.request":
      return {
        type: "folder.delete-from-disk",
        libraryId: request.libraryId,
        folderId: request.folderId,
      };
    case "linked-folder.remove.request":
      return {
        type: "linked-folder.remove",
        libraryId: request.libraryId,
        folderId: request.folderId,
      };
    case "linked-folder.delete-subtree.request":
      return {
        type: "linked-folder.delete-subtree",
        libraryId: request.libraryId,
        linkedFolderId: request.linkedFolderId,
        relativePath: request.relativePath,
        deleteFromDisk: request.deleteFromDisk,
      };
    case "linked-folder.create-directory.request":
      return {
        type: "linked-folder.create-directory",
        libraryId: request.libraryId,
        linkedFolderId: request.linkedFolderId,
        relativePath: request.relativePath,
        name: request.name,
      };
    case "linked-folder.rename-directory.request":
      return {
        type: "linked-folder.rename-directory",
        libraryId: request.libraryId,
        linkedFolderId: request.linkedFolderId,
        relativePath: request.relativePath,
        newName: request.newName,
      };
    case "folder.open-in-file-manager.request":
      // Handled directly in handleLibraryRequest because it requires shell.openPath.
      return {
        type: "folder.get-path",
        libraryId: request.libraryId,
        folderId: request.folderId,
      };
    case "folder.open-with.request":
      // Handled directly in handleLibraryRequest (macOS picker / Windows Open With).
      return {
        type: "folder.get-path",
        libraryId: request.libraryId,
        folderId: request.folderId,
      };
    case "folder.copy-path.request":
      // Handled directly in handleLibraryRequest because it requires clipboard.writeText.
      return {
        type: "folder.get-path",
        libraryId: request.libraryId,
        folderId: request.folderId,
      };
    case "folder.copy.request":
      // OS file clipboard (clarification #5); path resolved then written in Main.
      return {
        type: "folder.get-path",
        libraryId: request.libraryId,
        folderId: request.folderId,
      };
    case "folder.paste.request":
      // Clipboard paths are read in handleLibraryRequest, then imported.
      return undefined;
    case "folder.clone.request":
      return {
        type: "folder.clone",
        libraryId: request.libraryId,
        folderId: request.folderId,
      };
    case "folder.move.request":
      return {
        type: "folder.move",
        libraryId: request.libraryId,
        folderIds: request.folderIds,
        targetParentFolderId: request.targetParentFolderId,
        conflictStrategy: request.conflictStrategy,
      };
    default:
      return undefined;
  }
}
