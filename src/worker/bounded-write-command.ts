import type { WorkerCommand } from '../shared/protocol/requests';
import type { WorkerResult } from '../shared/protocol/responses';
import type { LibraryService } from './library-service';

/**
 * Commands whose complete mutation is transaction-only. They execute under a
 * SQLite `BEGIN IMMEDIATE` write transaction plus the durable per-library
 * lease. File-tree transfers and media/AI execution use persisted job phases
 * instead, so they never monopolize a database transaction while performing a
 * download, encode, or large copy.
 *
 * Phase D low-risk automation writes share this fence so Desktop, Script, and
 * MCP cannot bypass the write lease through a parallel dispatcher path.
 */
const BOUNDED_WRITE_COMMAND_TYPES = new Set<string>([
  'asset.rating.set',
  'asset.metadata.set',
  'tag.create',
  'tag.assign',
  'tag.remove',
  'folder.create',
  'collection.create',
  'collection.assets.add',
  'collection.assets.remove',
]);

export function boundedWriteLibraryId(command: WorkerCommand): string | undefined {
  if (!BOUNDED_WRITE_COMMAND_TYPES.has(command.type)) return undefined;
  if (!('libraryId' in command) || typeof command.libraryId !== 'string') {
    throw new Error(`Bounded write command ${command.type} is missing a library id.`);
  }
  return command.libraryId;
}

/**
 * Kept separate from the desktop switch so this narrow, transaction-safe
 * mutation surface cannot silently inherit thumbnail scheduling or a future
 * long-running behavior. New entries require an explicit atomicity review.
 */
export function executeBoundedWriteWorkerCommand(
  libraryService: LibraryService,
  command: WorkerCommand,
): WorkerResult | undefined {
  switch (command.type) {
    case 'asset.rating.set': {
      const { updatedCount, skipped } = libraryService.setAssetsRating(command);
      return { ok: true, type: 'asset.rating.updated', updatedCount, skipped };
    }
    case 'asset.metadata.set': {
      const metadata = libraryService.setAssetMetadata(command);
      return { ok: true, type: 'asset.metadata.updated', metadata };
    }
    case 'tag.create': {
      const tag = libraryService.createTag(command);
      return { ok: true, type: 'tag.created', tag };
    }
    case 'tag.assign': {
      const { assignedCount, skipped } = libraryService.assignTags(command);
      return { ok: true, type: 'tag.assigned', assignedCount, skipped };
    }
    case 'tag.remove': {
      const { removedCount, skipped } = libraryService.removeTags(command);
      return { ok: true, type: 'tag.removed', removedCount, skipped };
    }
    case 'folder.create': {
      const folder = libraryService.createManagedFolder(command);
      return { ok: true, type: 'folder.created', folder };
    }
    case 'collection.create': {
      const collection = libraryService.createCollection(command);
      return { ok: true, type: 'collection.created', collection };
    }
    case 'collection.assets.add': {
      const { collectionId } = libraryService.addCollectionAssets(command);
      return { ok: true, type: 'collection.assets.added', collectionId };
    }
    case 'collection.assets.remove': {
      const { collectionId } = libraryService.removeCollectionAssets(command);
      return { ok: true, type: 'collection.assets.removed', collectionId };
    }
    default:
      return undefined;
  }
}
