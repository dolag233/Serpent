import type { RendererRequest, WorkerCommand } from "../../shared/protocol/requests";

export function executeTagMainCommand(
  request: RendererRequest,
): WorkerCommand | undefined {
  switch (request.type) {
    case "tag.list.request":
      return { type: "tag.list", libraryId: request.libraryId };
    case "tag.create.request":
      return {
        type: "tag.create",
        libraryId: request.libraryId,
        name: request.name,
      };
    case "tag.rename.request":
      return {
        type: "tag.rename",
        libraryId: request.libraryId,
        tagId: request.tagId,
        name: request.name,
      };
    case "tag.delete.request":
      return {
        type: "tag.delete",
        libraryId: request.libraryId,
        tagId: request.tagId,
      };
    case "tag.delete-many.request":
      return {
        type: "tag.delete-many",
        libraryId: request.libraryId,
        tagIds: request.tagIds,
      };
    case "tag.merge.request":
      return {
        type: "tag.merge",
        libraryId: request.libraryId,
        sourceTagIds: request.sourceTagIds,
        name: request.name,
      };
    case "tag.cooccurrence.request":
      return {
        type: "tag.cooccurrence",
        libraryId: request.libraryId,
        minWeight: request.minWeight,
        maxNodes: request.maxNodes,
        maxEdges: request.maxEdges,
      };
    case "tag.assign.request":
      return {
        type: "tag.assign",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
        tagIds: request.tagIds,
      };
    case "tag.remove.request":
      return {
        type: "tag.remove",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
        tagIds: request.tagIds,
      };
    default:
      return undefined;
  }
}
