import type { WorkerCommand } from '../shared/protocol/requests';
import type { WorkerResult } from '../shared/protocol/responses';
import type { LibraryService } from './library-service';

export const READ_ONLY_WORKER_COMMAND_TYPES = [
  'library.open-readonly',
  'library.close',
  'folder.list',
  'linked-folder.list',
  'asset.list',
  'tag.list',
  'collection.list',
  'smart-collection.list',
  'asset.search',
  'media.list-jobs',
  'ai.status',
] as const satisfies readonly WorkerCommand['type'][];

export type ReadOnlyWorkerCommandType =
  (typeof READ_ONLY_WORKER_COMMAND_TYPES)[number];

const readOnlyCommandTypes = new Set<WorkerCommand['type']>(
  READ_ONLY_WORKER_COMMAND_TYPES,
);

export function isReadOnlyWorkerCommand(
  command: WorkerCommand,
): command is Extract<WorkerCommand, { type: ReadOnlyWorkerCommandType }> {
  return readOnlyCommandTypes.has(command.type);
}

export interface ReadOnlyCommandHooks {
  onAssetsListed?(libraryId: string, assetIds: string[]): void;
}

export async function executeReadOnlyWorkerCommand(
  libraryService: LibraryService,
  command: WorkerCommand,
  hooks: ReadOnlyCommandHooks = {},
): Promise<WorkerResult | undefined> {
  if (!isReadOnlyWorkerCommand(command)) return undefined;

  switch (command.type) {
    case 'library.open-readonly':
      return {
        ok: true,
        type: 'library.opened',
        library: libraryService.openLibraryReadOnly(command.selectedLibraryPath),
      };
    case 'library.close':
      libraryService.closeLibrary(command.libraryId);
      return { ok: true, type: 'library.closed', libraryId: command.libraryId };
    case 'folder.list':
      return {
        ok: true,
        type: 'folder.list',
        folders: libraryService.listManagedFolders(command.libraryId, command.showIgnored === true),
      };
    case 'linked-folder.list':
      return {
        ok: true,
        type: 'linked-folder.list',
        folders: libraryService.listLinkedFolders(command.libraryId),
      };
    case 'asset.list': {
      const assets = libraryService.listAssets(command);
      hooks.onAssetsListed?.(
        command.libraryId,
        assets.flatMap((asset) =>
          asset.sequence?.frames.map((frame) => frame.assetId) ?? [asset.assetId],
        ),
      );
      return { ok: true, type: 'asset.list', assets };
    }
    case 'tag.list':
      return {
        ok: true,
        type: 'tag.list',
        tags: libraryService.listTags(command.libraryId),
      };
    case 'collection.list':
      return {
        ok: true,
        type: 'collection.list',
        collections: libraryService.listCollections(command.libraryId),
      };
    case 'smart-collection.list':
      return {
        ok: true,
        type: 'smart-collection.list',
        collections: libraryService.listSmartCollections(command.libraryId),
      };
    case 'asset.search': {
      const result = libraryService.searchAssets({
        libraryId: command.libraryId,
        query: command.query,
        filters: command.filters ?? null,
        scope: command.scope ?? null,
        sort: command.sort ?? null,
        scopeMode: command.scopeMode ?? false,
        limit: command.scopeMode ? null : (command.limit ?? 50),
        offset: command.scopeMode ? 0 : (command.offset ?? 0),
        showIgnored: command.showIgnored === true,
      });
      hooks.onAssetsListed?.(
        command.libraryId,
        result.items.flatMap((asset) =>
          asset.sequence?.frames.map((frame) => frame.assetId) ?? [asset.assetId],
        ),
      );
      return {
        ok: true,
        type: 'asset.search.result',
        items: result.items,
        total: result.total,
        offset: result.offset,
        snippets: result.snippets,
      };
    }
    case 'media.list-jobs': {
      const status = libraryService.listMediaJobs(command.libraryId);
      return {
        ok: true,
        type: 'media.jobs.listed',
        libraryId: command.libraryId,
        ...status,
      };
    }
    case 'ai.status': {
      const status = libraryService.getAiJobStatus(
        command.libraryId,
        command.jobIds,
      );
      return {
        ok: true,
        type: 'ai.jobs.status',
        libraryId: command.libraryId,
        ...status,
      };
    }
  }
}
