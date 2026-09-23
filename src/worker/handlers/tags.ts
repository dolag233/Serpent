import type { WorkerRequest } from '../../shared/protocol/requests';
import type { WorkerResult } from '../../shared/protocol/responses';
import type { LibraryService } from '../library-service';

export function executeTagWorkerCommand(
  libraryService: LibraryService,
  request: WorkerRequest,
): WorkerResult | undefined {
  switch (request.command.type) {
    case 'tag.list':
      return {
        ok: true,
        type: 'tag.list',
        tags: libraryService.listTags(request.command.libraryId),
      };
    case 'tag.create':
      throw new Error('Bounded tag.create write was not dispatched through its transaction fence.');
    case 'tag.rename': {
      const tag = libraryService.renameTag(request.command);
      return { ok: true, type: 'tag.renamed', tag };
    }
    case 'tag.delete':
      return {
        ok: true,
        type: 'tag.deleted',
        tagId: libraryService.deleteTag(request.command),
      };
    case 'tag.delete-many': {
      const { deletedTagIds } = libraryService.deleteTags(request.command);
      return { ok: true, type: 'tag.deleted-many', deletedTagIds };
    }
    case 'tag.merge': {
      const tag = libraryService.mergeTags(request.command);
      return {
        ok: true,
        type: 'tag.merged',
        tag,
        mergedTagIds: request.command.sourceTagIds,
      };
    }
    case 'tag.cooccurrence':
      return {
        ok: true,
        type: 'tag.cooccurrence',
        graph: libraryService.getTagCooccurrenceGraph(request.command),
      };
    case 'tag.assign':
      throw new Error('Bounded tag.assign write was not dispatched through its transaction fence.');
    case 'tag.remove':
      throw new Error('Bounded tag.remove write was not dispatched through its transaction fence.');
    default:
      return undefined;
  }
}
