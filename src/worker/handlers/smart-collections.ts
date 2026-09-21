import type { WorkerRequest } from '../../shared/protocol/requests';
import type { WorkerResult } from '../../shared/protocol/responses';
import type { LibraryService } from '../library-service';

export function executeSmartCollectionWorkerCommand(
  libraryService: LibraryService,
  request: WorkerRequest,
): WorkerResult | undefined {
  switch (request.command.type) {
    case 'smart-collection.list':
      return {
        ok: true,
        type: 'smart-collection.list',
        collections: libraryService.listSmartCollections(request.command.libraryId),
      };
    case 'smart-collection.create': {
      const sc = libraryService.createSmartCollection(request.command);
      return { ok: true, type: 'smart-collection.created', collection: sc };
    }
    case 'smart-collection.update': {
      const sc = libraryService.updateSmartCollection(request.command);
      return { ok: true, type: 'smart-collection.updated', collection: sc };
    }
    case 'smart-collection.delete':
      return {
        ok: true,
        type: 'smart-collection.deleted',
        collectionId: libraryService.deleteSmartCollection(request.command),
      };
    case 'smart-collection.execute': {
      const result = libraryService.executeSmartCollection(request.command);
      return {
        ok: true,
        type: 'smart-collection.executed',
        items: result.items,
        total: result.total,
        offset: result.offset,
        ...(result.assetIds ? { assetIds: result.assetIds } : {}),
        ...(result.layout ? { layout: result.layout } : {}),
      };
    }
    default:
      return undefined;
  }
}
