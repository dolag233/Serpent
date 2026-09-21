import type { WorkerRequest } from '../../shared/protocol/requests';
import type { WorkerResult } from '../../shared/protocol/responses';
import { searchRequestLaneKey } from '../search-request-coordinator';
import type { LibraryService } from '../library-service';

export type AssetQueryHooks = {
  shouldYieldForSearchCoalescing: (libraryId: string) => boolean;
  isLatestSearchRequest: (libraryId: string, laneKey: string, requestId: string) => boolean;
};

export async function executeAssetQueryWorkerCommand(
  libraryService: LibraryService,
  request: WorkerRequest,
  hooks: AssetQueryHooks,
): Promise<WorkerResult | undefined> {
  switch (request.command.type) {
    case 'asset.metadata.get': {
      const metadata = libraryService.getAssetMetadata(request.command);
      return { ok: true, type: 'asset.metadata.got', metadata };
    }
    case 'asset.extracted-metadata.get': {
      const result = libraryService.getExtractedMetadata(request.command);
      return { ok: true, type: 'asset.extracted-metadata.got', result };
    }
    case 'asset.color-space.set': {
      const result = libraryService.setAssetColorSpaceOverride(request.command);
      return { ok: true, type: 'asset.color-space.updated', ...result };
    }
    case 'asset.metadata.set':
      throw new Error('Bounded asset.metadata.set write was not dispatched through its transaction fence.');
    case 'asset.metadata.set-many':
      throw new Error('Bounded asset.metadata.set-many write was not dispatched through its transaction fence.');
    case 'asset.metadata.backfill': {
      const { backfilledCount } = libraryService.backfillAssetMetadata(request.command.libraryId);
      return { ok: true, type: 'asset.metadata.backfilled', backfilledCount };
    }
    case 'asset.rating.set':
      // `handleRequest` routes this command through runBoundedWrite before
      // this legacy desktop switch. Keep the exhaustiveness case explicit so
      // a future dispatcher change cannot silently restore an unfenced path.
      throw new Error('Bounded rating write was not dispatched through its transaction fence.');
    case 'asset.search': {
      // Search is synchronous inside LibraryService. Yield once before
      // entering SQLite so a burst of keystrokes can mark this request stale
      // and discard it while it is still queued in the Worker event loop.
      // The first browse after open is the exception: App posts it before
      // sidebar/count hydration, and yielding here would let that burst enter
      // SQLite ahead of the primary page. Later searches keep the coalescing
      // yield so stale keystrokes are discarded before a synchronous query.
      if (hooks.shouldYieldForSearchCoalescing(request.command.libraryId)) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      const laneKey = searchRequestLaneKey(request.command);
      if (!hooks.isLatestSearchRequest(request.command.libraryId, laneKey, request.requestId)) {
        return {
          ok: true,
          type: 'asset.search.result',
          items: [],
          total: 0,
          offset: request.command.scopeMode ? 0 : (request.command.offset ?? 0),
        };
      }
      const result = libraryService.searchAssets({
        libraryId: request.command.libraryId,
        query: request.command.query,
        filters: request.command.filters ?? null,
        scope: request.command.scope ?? null,
        sort: request.command.sort ?? null,
        scopeMode: request.command.scopeMode ?? false,
        idsOnly: request.command.idsOnly ?? false,
        layoutOnly: request.command.layoutOnly ?? false,
        showIgnored: request.command.showIgnored === true,
        limit: request.command.scopeMode ? null : (request.command.limit ?? 50),
        offset: request.command.scopeMode ? 0 : (request.command.offset ?? 0),
      });
      return {
        ok: true,
        type: 'asset.search.result',
        items: result.items,
        total: result.total,
        offset: result.offset,
        snippets: result.snippets,
        ...(result.assetIds ? { assetIds: result.assetIds } : {}),
        ...(result.layout ? { layout: result.layout } : {}),
      };
    }
    default:
      return undefined;
  }
}
