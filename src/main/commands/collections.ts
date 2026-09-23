import type { RendererRequest, WorkerCommand } from "../../shared/protocol/requests";

export function executeCollectionMainCommand(
  request: RendererRequest,
): WorkerCommand | undefined {
  switch (request.type) {
    case "collection.list.request":
      return { type: "collection.list", libraryId: request.libraryId };
    case "collection.create.request":
      return {
        type: "collection.create",
        libraryId: request.libraryId,
        parentId: request.parentId,
        name: request.name,
      };
    case "collection.update.request":
      return {
        type: "collection.update",
        libraryId: request.libraryId,
        collectionId: request.collectionId,
        name: request.name,
        parentId: request.parentId,
        description: request.description,
        coverAssetId: request.coverAssetId,
        position: request.position,
      };
    case "collection.reorder.request":
      return {
        type: "collection.reorder",
        libraryId: request.libraryId,
        orderedCollectionIds: request.orderedCollectionIds,
      };
    case "collection.delete.request":
      return {
        type: "collection.delete",
        libraryId: request.libraryId,
        collectionId: request.collectionId,
      };
    case "collection.assets.add.request":
      return {
        type: "collection.assets.add",
        libraryId: request.libraryId,
        collectionId: request.collectionId,
        assetIds: request.assetIds,
      };
    case "collection.assets.remove.request":
      return {
        type: "collection.assets.remove",
        libraryId: request.libraryId,
        collectionId: request.collectionId,
        assetIds: request.assetIds,
      };
    case "collection.assets.reorder.request":
      return {
        type: "collection.assets.reorder",
        libraryId: request.libraryId,
        collectionId: request.collectionId,
        orderedAssetIds: request.orderedAssetIds,
      };
    case "collection.assets.list.request":
      return {
        type: "collection.assets.list",
        libraryId: request.libraryId,
        collectionId: request.collectionId,
        recursive: request.recursive,
      };
    case "collection.assets.memberships.request":
      return {
        type: "collection.assets.memberships",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
      };
    default:
      return undefined;
  }
}
