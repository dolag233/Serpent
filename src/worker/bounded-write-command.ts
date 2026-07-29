import type { WorkerCommand } from '../shared/protocol/requests';
import type { WorkerResult } from '../shared/protocol/responses';
import type { LibraryService } from './library-service';

/**
 * Commands whose complete mutation is transaction-only. They execute under a
 * SQLite `BEGIN IMMEDIATE` write transaction plus the durable per-library
 * lease. File-tree transfers and media/AI execution use persisted job phases
 * instead, so they never monopolize a database transaction while performing a
 * download, encode, or large copy.
 */
const BOUNDED_WRITE_COMMAND_TYPES = new Set<string>([
  'asset.rating.set',
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
  if (command.type !== 'asset.rating.set') return undefined;
  const { updatedCount, skipped } = libraryService.setAssetsRating(command);
  return { ok: true, type: 'asset.rating.updated', updatedCount, skipped };
}
