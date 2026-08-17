import { createPublicError } from '../shared/protocol/errors';
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
  'library.change-sequence',
  'folder.list',
  'linked-folder.list',
  'asset.list',
  'asset.metadata.get',
  'asset.extracted-metadata.get',
  'asset.search',
  'asset.list-trash',
  'asset.palette.aggregate-recent',
  'asset.content.read',
  'automation.file-operation-plan',
  'tag.list',
  'tag.cooccurrence',
  'linked-folder.rules.get',
  'collection.list',
  'collection.assets.memberships',
  'collection.assets.list',
  'smart-collection.list',
  'smart-collection.execute',
  'media.get-thumbnail-artifact',
  'media.list-jobs',
  'ai.status',
  'ai.content.get',
  'automation.file-import-plan',
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
    case 'library.change-sequence':
      return {
        ok: true,
        type: 'library.change-sequence',
        libraryId: command.libraryId,
        changeSequence: libraryService.getChangeSequence(command.libraryId),
      };
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
    case 'asset.content.read':
      return {
        ok: true,
        type: 'asset.content.read',
        ...libraryService.readManagedAssetContent(command),
      };
    case 'automation.file-operation-plan':
      return {
        ok: true,
        type: 'automation.file-operation-planned',
        ...libraryService.previewAutomationFileOperation(command),
      };
    case 'automation.file-import-plan':
      return {
        ok: true,
        type: 'automation.file-import-planned',
        plan: libraryService.previewAutomationImport(command),
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
    case 'collection.assets.list':
      return {
        ok: true,
        type: 'collection.assets.list',
        assets: libraryService.listCollectionAssets(command),
      };
    case 'smart-collection.list':
      return {
        ok: true,
        type: 'smart-collection.list',
        collections: libraryService.listSmartCollections(command.libraryId),
      };
    case 'smart-collection.execute': {
      const result = libraryService.executeSmartCollection(command);
      return {
        ok: true,
        type: 'smart-collection.executed',
        items: result.items,
        total: result.total,
        offset: result.offset,
      };
    }
    case 'media.get-thumbnail-artifact': {
      const info = libraryService.getThumbnailArtifact(command.libraryId, command.assetId);
      if (!info) return { ok: false, error: createPublicError('ASSET_NOT_FOUND') };
      return {
        ok: true,
        type: 'media.thumbnail-artifact',
        artifactId: info.artifactId,
        filePath: info.filePath,
        width: info.width,
        height: info.height,
      };
    }
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
    case 'ai.content.get': {
      const rows = libraryService.getAiContent(command.libraryId, command.assetId);
      const tags = libraryService.listAiTagNames(command.libraryId, command.assetId);
      let description: string | null = null;
      let rating: number | null = null;
      let modelVersion: string | null = null;
      for (const row of rows) {
        modelVersion = row.modelVersion;
        if (row.fieldName === 'description') description = row.value;
        if (row.fieldName === 'rating') {
          const parsed = Number.parseInt(row.value, 10);
          if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 5) {
            rating = parsed;
          }
        }
      }
      if (!modelVersion) {
        modelVersion = libraryService.getAiTagModelVersion(command.libraryId, command.assetId);
      }
      return {
        ok: true,
        type: 'ai.content.got',
        assetId: command.assetId,
        description,
        tags,
        rating,
        modelVersion,
      };
    }
  }
}
