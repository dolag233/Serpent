import {
  classifyUnknownFailure,
  createPublicError,
  toPublicError,
  type PublicError,
  type PublicErrorReason,
} from '../shared/protocol/errors';
import { LibraryServiceError } from './library-service';
import { LibraryWriteCoordinatorError } from './library-write-coordinator';
import { HistoryTransitionError } from './operation-history';
import { RemoteStorageError } from './sync/remote-storage';

/** Serpent-033e: SQLite rejected a write because the file or connection is read-only. */
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

function syncReasonForRemoteStorageCode(code: string): PublicErrorReason | undefined {
  switch (code) {
    case 'AUTH_FAILED': return 'SYNC_AUTH_FAILED';
    case 'INVALID_URL': return 'SYNC_INVALID_URL';
    case 'PERMISSION_DENIED': return 'SYNC_PERMISSION_DENIED';
    case 'NOT_FOUND': return 'SYNC_NOT_FOUND';
    case 'TIMEOUT': return 'SYNC_TIMEOUT';
    case 'TLS_ERROR': return 'SYNC_TLS';
    case 'DNS_ERROR': return 'SYNC_DNS';
    case 'CONNECTION_REFUSED': return 'SYNC_CONNECTION_REFUSED';
    case 'NETWORK_ERROR': return 'SYNC_NETWORK';
    case 'QUOTA_EXCEEDED': return 'SYNC_QUOTA_EXCEEDED';
    case 'LOCKED': return 'SYNC_LOCKED';
    case 'CONFLICT': return 'SYNC_CONFLICT';
    case 'PRECONDITION_FAILED': return 'SYNC_CONFLICT';
    case 'METHOD_NOT_ALLOWED': return 'SYNC_METHOD_NOT_ALLOWED';
    case 'WRITE_UNSUPPORTED': return 'SYNC_WRITE_UNSUPPORTED';
    default:
      return code.startsWith('HTTP_') ? 'SYNC_HTTP_ERROR' : undefined;
  }
}

export function publicErrorForWorkerFailure(error: unknown): PublicError {
  const classified = classifyUnknownFailure(error);
  if (classified) {
    return createPublicError(classified.code, classified.reason);
  }
  if (isSqliteReadonlyFailure(error)) {
    // The SQLite file or connection itself is read-only (OS attribute,
    // inspection handle, or a probe connection). Desktop never opens a
    // user library this way.
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
  if (error instanceof RemoteStorageError) {
    // Serpent-fatf: URL 无法解析/协议不受支持 → SYNC_CONNECTION_FAILED
    // + SYNC_INVALID_URL reason（可读提示），而不是落到 INTERNAL_ERROR。
    return createPublicError(
      'SYNC_CONNECTION_FAILED',
      syncReasonForRemoteStorageCode(error.code),
    );
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
