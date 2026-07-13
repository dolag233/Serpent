import type { RendererRequest, WorkerCommand } from '../shared/protocol/requests';

type WebImportRequest = Extract<RendererRequest, { type: 'asset.import-web.request' }>;

export function createWebImportCommand(request: WebImportRequest): Extract<WorkerCommand, { type: 'extension.save-from-url' }> {
  return {
    type: 'extension.save-from-url',
    libraryId: request.libraryId,
    targetFolderId: request.targetFolderId,
    mediaUrl: request.mediaUrl,
    mediaType: request.mediaType,
  };
}

export function createWebImportCollectionCommand(
  request: WebImportRequest,
  assetId: string,
): Extract<WorkerCommand, { type: 'collection.assets.add' }> | undefined {
  return request.targetCollectionId
    ? {
        type: 'collection.assets.add',
        libraryId: request.libraryId,
        collectionId: request.targetCollectionId,
        assetIds: [assetId],
      }
    : undefined;
}
