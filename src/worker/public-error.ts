import {
  createPublicError,
  toPublicError,
  type PublicError,
} from '../shared/protocol/errors';
import { LibraryServiceError } from './library-service';
import { LibraryWriteCoordinatorError } from './library-write-coordinator';
import { HistoryTransitionError } from './operation-history';

/** Serpent-033e: any write against a read-only (newer-schema) library. */
function isSqliteReadonlyFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'SQLITE_READONLY' || error.code === 'SQLITE_READONLY_CANTINIT')
  );
}

/**
 * Serpent-verg.8 (0031 §1.3): a write referencing a column the library
 * structure does not have (lenient read tolerates it; writes stay strict)
 * surfaces as an actionable structure error instead of an opaque failure.
 */
function isSqliteStructureFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'SQLITE_ERROR' &&
    error instanceof Error &&
    /no such column/i.test(error.message)
  );
}

export function publicErrorForWorkerFailure(error: unknown): PublicError {
  if (isSqliteReadonlyFailure(error)) {
    // A newer build wrote this library; the SQLite-level read-only connection
    // rejects the write. Surface the actionable code instead of an opaque
    // INTERNAL_ERROR so the renderer can show the upgrade banner.
    return createPublicError('LIBRARY_READ_ONLY');
  }
  if (isSqliteStructureFailure(error)) {
    return createPublicError('LIBRARY_STRUCTURE_MISMATCH');
  }
  if (error instanceof LibraryWriteCoordinatorError) {
    return createPublicError(error.code);
  }
  if (error instanceof HistoryTransitionError) {
    return createPublicError(error.code);
  }
  if (error instanceof LibraryServiceError) {
    try {
      return createPublicError(
        error.code,
        error.reason,
        error.currentEntityVersion,
      );
    } catch {
      // A malformed internal error must never turn failure reporting into a
      // second Worker protocol failure or expose validation diagnostics.
      return toPublicError(error);
    }
  }
  return toPublicError(error);
}
