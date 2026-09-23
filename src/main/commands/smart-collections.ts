import type { RendererRequest, WorkerCommand } from "../../shared/protocol/requests";

export function executeSmartCollectionMainCommand(
  request: RendererRequest,
): WorkerCommand | undefined {
  switch (request.type) {
    case "smart-collection.list.request":
      return { type: "smart-collection.list", libraryId: request.libraryId };
    case "smart-collection.create.request":
      return {
        type: "smart-collection.create",
        libraryId: request.libraryId,
        name: request.name,
        queryDefinitionJson: request.queryDefinitionJson,
      };
    case "smart-collection.update.request":
      return {
        type: "smart-collection.update",
        libraryId: request.libraryId,
        collectionId: request.collectionId,
        name: request.name,
        queryDefinitionJson: request.queryDefinitionJson,
        position: request.position,
      };
    case "smart-collection.delete.request":
      return {
        type: "smart-collection.delete",
        libraryId: request.libraryId,
        collectionId: request.collectionId,
      };
    case "smart-collection.execute.request":
      return {
        type: "smart-collection.execute",
        libraryId: request.libraryId,
        collectionId: request.collectionId,
        scopeMode: request.scopeMode,
        idsOnly: request.idsOnly,
        layoutOnly: request.layoutOnly,
        limit: request.limit,
        offset: request.offset,
      };
    default:
      return undefined;
  }
}
