import type { RendererRequest, WorkerCommand } from "../../shared/protocol/requests";

export function executeIgnoreMainCommand(
  request: RendererRequest,
): WorkerCommand | undefined {
  switch (request.type) {
    case "ignore.list.request":
      return { type: "ignore.list", libraryId: request.libraryId };
    case "ignore.gitignore.get.request":
      return { type: "ignore.gitignore.get", libraryId: request.libraryId };
    case "ignore.gitignore.preview.request":
      return {
        type: "ignore.gitignore.preview",
        libraryId: request.libraryId,
        content: request.content,
      };
    case "ignore.gitignore.set.request":
      return {
        type: "ignore.gitignore.set",
        libraryId: request.libraryId,
        content: request.content,
      };
    case "ignore.set.request":
      return {
        type: "ignore.set",
        libraryId: request.libraryId,
        locationKind: request.locationKind,
        linkedFolderId: request.linkedFolderId,
        relativePath: request.relativePath,
        pathKind: request.pathKind,
        ignored: request.ignored,
      };
    default:
      return undefined;
  }
}
