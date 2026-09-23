import type { WorkerRequest } from '../../shared/protocol/requests';
import type { WorkerResult } from '../../shared/protocol/responses';
import type { LibraryService } from '../library-service';

export type IgnoreCommandHooks = {
  scheduleRefreshThumbnails: (libraryId: string) => void;
};

export function executeIgnoreWorkerCommand(
  libraryService: LibraryService,
  request: WorkerRequest,
  hooks: IgnoreCommandHooks,
): WorkerResult | undefined {
  switch (request.command.type) {
    case 'ignore.list':
      return {
        ok: true,
        type: 'ignore.list',
        paths: libraryService.listIgnoredPaths(request.command.libraryId),
      };
    case 'ignore.gitignore.get':
      return {
        ok: true,
        type: 'ignore.gitignore',
        content: libraryService.getGitignore(request.command.libraryId).content,
      };
    case 'ignore.gitignore.preview':
      return {
        ok: true,
        type: 'ignore.gitignore.preview',
        preview: libraryService.previewGitignore(request.command.libraryId, request.command.content),
      };
    case 'ignore.gitignore.set': {
      const result = libraryService.setGitignore(request.command);
      hooks.scheduleRefreshThumbnails(request.command.libraryId);
      return { ok: true, type: 'ignore.gitignore.updated', content: result.content };
    }
    case 'ignore.set': {
      const result = libraryService.setIgnore(request.command);
      hooks.scheduleRefreshThumbnails(request.command.libraryId);
      return { ok: true, type: 'ignore.updated', ...result };
    }
    default:
      return undefined;
  }
}
