import type { WorkerCommand } from '../shared/protocol/requests';
import type { WorkerResult } from '../shared/protocol/responses';
import type { LibraryService } from './library-service';

/**
 * Read-only Worker commands available through the Automation Gateway. Keep
 * this list intentionally small: adding a command requires Registry metadata,
 * Gateway tests and an explicit side-effect review.
 */
export const AUTOMATION_READ_ONLY_WORKER_COMMAND_TYPES = [
  'library.list',
  'folder.list',
  'linked-folder.list',
  'asset.list',
  'asset.metadata.get',
  'asset.extracted-metadata.get',
  'asset.search',
  'asset.list-trash',
  'asset.palette.aggregate-recent',
  'automation.file-operation-plan',
  'tag.list',
  'collection.list',
  'collection.assets.memberships',
  'smart-collection.list',
  'media.list-jobs',
  'ai.status',
] as const satisfies readonly WorkerCommand['type'][];

export type AutomationReadOnlyWorkerCommandType =
  (typeof AUTOMATION_READ_ONLY_WORKER_COMMAND_TYPES)[number];

const commandTypes = new Set<WorkerCommand['type']>(AUTOMATION_READ_ONLY_WORKER_COMMAND_TYPES);

export function isAutomationReadOnlyWorkerCommand(
  command: WorkerCommand,
): command is Extract<WorkerCommand, { type: AutomationReadOnlyWorkerCommandType }> {
  return commandTypes.has(command.type);
}

/**
 * This path deliberately does not call scheduleThumbnailScene, enqueue jobs,
 * start watchers or close a library. The desktop dispatch retains those
 * behaviors; automation reads must not mutate the library as a side effect.
 */
export function executeAutomationReadOnlyWorkerCommand(
  libraryService: LibraryService,
  command: WorkerCommand,
): WorkerResult | undefined {
  if (!isAutomationReadOnlyWorkerCommand(command)) return undefined;

  switch (command.type) {
    case 'library.list':
      return { ok: true, type: 'library.list', libraries: libraryService.listLibraries() };
    case 'folder.list':
      return {
        ok: true,
        type: 'folder.list',
        folders: libraryService.listManagedFolders(command.libraryId),
      };
    case 'linked-folder.list':
      return {
        ok: true,
        type: 'linked-folder.list',
        folders: libraryService.listLinkedFolders(command.libraryId),
      };
    case 'asset.list':
      return { ok: true, type: 'asset.list', assets: libraryService.listAssets(command) };
    case 'asset.metadata.get':
      return {
        ok: true,
        type: 'asset.metadata.got',
        metadata: libraryService.getAssetMetadata(command),
      };
    case 'asset.extracted-metadata.get':
      return {
        ok: true,
        type: 'asset.extracted-metadata.got',
        result: libraryService.getExtractedMetadata(command),
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
      });
      return {
        ok: true,
        type: 'asset.search.result',
        items: result.items,
        total: result.total,
        offset: result.offset,
        snippets: result.snippets,
      };
    }
    case 'asset.list-trash':
      return {
        ok: true,
        type: 'asset.list-trash',
        assets: libraryService.listTrash(command.libraryId),
      };
    case 'asset.palette.aggregate-recent':
      return {
        ok: true,
        type: 'asset.palette.aggregated-recent',
        ...libraryService.aggregateRecentAssetPalette(command),
      };
    case 'automation.file-operation-plan':
      return {
        ok: true,
        type: 'automation.file-operation-planned',
        ...libraryService.previewAutomationFileOperation(command),
      };
    case 'tag.list':
      return { ok: true, type: 'tag.list', tags: libraryService.listTags(command.libraryId) };
    case 'collection.list':
      return {
        ok: true,
        type: 'collection.list',
        collections: libraryService.listCollections(command.libraryId),
      };
    case 'collection.assets.memberships':
      return {
        ok: true,
        type: 'collection.assets.memberships',
        memberships: libraryService.listAssetCollectionMemberships(command),
      };
    case 'smart-collection.list':
      return {
        ok: true,
        type: 'smart-collection.list',
        collections: libraryService.listSmartCollections(command.libraryId),
      };
    case 'media.list-jobs':
      return {
        ok: true,
        type: 'media.jobs.listed',
        libraryId: command.libraryId,
        ...libraryService.listMediaJobs(command.libraryId),
      };
    case 'ai.status':
      return {
        ok: true,
        type: 'ai.jobs.status',
        libraryId: command.libraryId,
        ...libraryService.getAiJobStatus(command.libraryId, command.jobIds),
      };
  }
}
