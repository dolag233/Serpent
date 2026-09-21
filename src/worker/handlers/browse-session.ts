import { localCatalogSequenceFields } from '../../shared/performance-contract';
import type { WorkerRequest } from '../../shared/protocol/requests';
import type { WorkerResult } from '../../shared/protocol/responses';
import { browseCatalogSequenceStale } from '../catalog-sequence-admission';
import type { LibraryService } from '../library-service';

export function executeBrowseSessionWorkerCommand(
  libraryService: LibraryService,
  currentLibraryGeneration: (libraryId: string) => number,
  request: WorkerRequest,
): WorkerResult | undefined {
  switch (request.command.type) {
    case 'browse.session.open': {
      const result = libraryService.createBrowseSession({
        libraryId: request.command.libraryId,
        libraryGeneration: currentLibraryGeneration(request.command.libraryId),
        query: request.command.query,
        filters: request.command.filters ?? null,
        scope: request.command.scope ?? null,
        sort: request.command.sort ?? null,
        smartCollectionId: request.command.smartCollectionId ?? null,
        limit: request.command.limit ?? 100,
        showIgnored: request.command.showIgnored === true,
      });
      return {
        ok: true,
        type: 'browse.session.opened',
        sessionId: result.session.sessionId,
        libraryGeneration: result.session.libraryGeneration,
        changeSequence: result.session.changeSequence,
        ...localCatalogSequenceFields(result.session.changeSequence),
        queryFingerprint: result.session.queryFingerprint,
        items: result.items,
        total: result.total,
        offset: result.offset,
        ...(result.snippets ? { snippets: result.snippets } : {}),
      };
    }
    case 'browse.session.page': {
      const result = libraryService.readBrowseSessionPage({
        libraryId: request.command.libraryId,
        libraryGeneration: currentLibraryGeneration(request.command.libraryId),
        sessionId: request.command.sessionId,
        limit: request.command.limit ?? 100,
        offset: request.command.offset ?? 0,
      });
      if (result.status !== 'ready') {
        return {
          ok: true,
          type: 'browse.session.stale',
          sessionId: request.command.sessionId,
          reason: result.status === 'missing' ? 'missing' : result.reason,
        };
      }
      const pageStale = browseCatalogSequenceStale(
        result.session.sessionId,
        result.session.changeSequence,
        request.performance?.minCatalogSequence,
      );
      if (pageStale) return pageStale;
      return {
        ok: true,
        type: 'browse.session.page',
        sessionId: result.session.sessionId,
        changeSequence: result.session.changeSequence,
        ...localCatalogSequenceFields(result.session.changeSequence),
        items: result.items,
        total: result.total,
        offset: result.offset,
        ...(result.snippets ? { snippets: result.snippets } : {}),
      };
    }
    case 'browse.session.ids': {
      const result = libraryService.readBrowseSessionAssetIds({
        libraryId: request.command.libraryId,
        libraryGeneration: currentLibraryGeneration(request.command.libraryId),
        sessionId: request.command.sessionId,
      });
      if (result.status !== 'ready') {
        return {
          ok: true,
          type: 'browse.session.stale',
          sessionId: request.command.sessionId,
          reason: result.status === 'missing' ? 'missing' : result.reason,
        };
      }
      const idsStale = browseCatalogSequenceStale(
        result.session.sessionId,
        result.session.changeSequence,
        request.performance?.minCatalogSequence,
      );
      if (idsStale) return idsStale;
      return {
        ok: true,
        type: 'browse.session.ids',
        libraryId: request.command.libraryId,
        sessionId: result.session.sessionId,
        changeSequence: result.session.changeSequence,
        ...localCatalogSequenceFields(result.session.changeSequence),
        assetIds: result.assetIds,
      };
    }
    case 'browse.session.close':
      libraryService.closeBrowseSession(request.command);
      return {
        ok: true,
        type: 'browse.session.closed',
        sessionId: request.command.sessionId,
      };
    default:
      return undefined;
  }
}
