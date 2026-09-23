import type { RendererRequest, WorkerCommand } from "../../shared/protocol/requests";

export function executeAssetQueryMainCommand(
  request: RendererRequest,
): WorkerCommand | undefined {
  switch (request.type) {
    case "asset.list.request":
      return {
        type: "asset.list",
        libraryId: request.libraryId,
        folderId: request.folderId,
        recursive: request.recursive,
        showIgnored: request.showIgnored,
        ...(request.assetIds && request.assetIds.length > 0
          ? { assetIds: request.assetIds }
          : {}),
      };
    case "asset.metadata.get.request":
      return {
        type: "asset.metadata.get",
        libraryId: request.libraryId,
        assetId: request.assetId,
      };
    case "asset.extracted-metadata.get.request":
      return {
        type: "asset.extracted-metadata.get",
        libraryId: request.libraryId,
        assetId: request.assetId,
      };
    case "asset.color-space.set.request":
      return {
        type: "asset.color-space.set",
        libraryId: request.libraryId,
        assetId: request.assetId,
        colorSpace: request.colorSpace,
      };
    case "asset.metadata.set.request":
      return {
        type: "asset.metadata.set",
        libraryId: request.libraryId,
        assetId: request.assetId,
        expectedVersion: request.expectedVersion,
        description: request.description,
        rating: request.rating,
        favorite: request.favorite,
        palette: request.palette,
        sourcePageUrl: request.sourcePageUrl,
        author: request.author,
      };
    case "asset.metadata.backfill.request":
      return { type: "asset.metadata.backfill", libraryId: request.libraryId };
    case "asset.rating.set.request":
      return {
        type: "asset.rating.set",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
        rating: request.rating,
      };
    case "asset.search.request":
      return {
        type: "asset.search",
        libraryId: request.libraryId,
        query: request.query,
        filters: request.filters,
        scope: request.scope,
        sort: request.sort,
        scopeMode: request.scopeMode,
        idsOnly: request.idsOnly,
        layoutOnly: request.layoutOnly,
        limit: request.limit,
        offset: request.offset,
        showIgnored: request.showIgnored,
      };
    default:
      return undefined;
  }
}
