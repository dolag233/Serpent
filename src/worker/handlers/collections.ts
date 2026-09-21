import type { WorkerRequest } from '../../shared/protocol/requests';
import type { WorkerResult } from '../../shared/protocol/responses';
import type { LibraryService } from '../library-service';

export function executeCollectionWorkerCommand(
  libraryService: LibraryService,
  request: WorkerRequest,
): WorkerResult | undefined {
  switch (request.command.type) {
    case 'collection.list':
      return {
        ok: true,
        type: 'collection.list',
        collections: libraryService.listCollections(request.command.libraryId),
      };
    case 'collection.create':
      throw new Error('Bounded collection.create write was not dispatched through its transaction fence.');
    case 'collection.update': {
      const collection = libraryService.updateCollection(request.command);
      return { ok: true, type: 'collection.updated', collection };
    }
    case 'collection.reorder': {
      const orderedCollectionIds = libraryService.reorderCollections(request.command);
      return { ok: true, type: 'collection.reordered', orderedCollectionIds };
    }
    case 'collection.delete':
      return {
        ok: true,
        type: 'collection.deleted',
        collectionId: libraryService.deleteCollection(request.command),
      };
    case 'collection.assets.add':
      throw new Error('Bounded collection.assets.add write was not dispatched through its transaction fence.');
    case 'collection.assets.remove':
      throw new Error('Bounded collection.assets.remove write was not dispatched through its transaction fence.');
    case 'collection.assets.reorder': {
      const { collectionId } = libraryService.reorderCollectionAssets(request.command);
      return { ok: true, type: 'collection.assets.reordered', collectionId };
    }
    case 'collection.assets.list': {
      const assets = libraryService.listCollectionAssets(request.command);
      // Serpent-4bdd26 收编 codex/large-library-performance@d5f58088：同
      // asset.list——视口上报（asset.thumbnail.visible-window）才是可见波的唯一触发源。
      return { ok: true, type: 'collection.assets.list', assets };
    }
    case 'collection.assets.memberships': {
      const memberships = libraryService.listAssetCollectionMemberships(
        request.command,
      );
      return { ok: true, type: 'collection.assets.memberships', memberships };
    }
    default:
      return undefined;
  }
}
