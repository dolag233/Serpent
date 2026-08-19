import { describe, expect, it } from 'vitest';

import { PUBLIC_ERROR_MESSAGES } from '../../src/shared/protocol/errors';
import { parseRendererResult, parseWorkerResponse } from '../../src/shared/protocol/responses';
import { LibraryServiceError } from '../../src/worker/library-service';
import { LibraryWriteCoordinatorError } from '../../src/worker/library-write-coordinator';
import { publicErrorForWorkerFailure } from '../../src/worker/public-error';
import { DriverUnsupportedError, RemoteStorageError } from '../../src/worker/sync/remote-storage';

describe('Library Worker public error boundary', () => {
  it('preserves the current entity version for optimistic-lock conflicts', () => {
    const error = new LibraryServiceError('VERSION_CONFLICT', {
      currentEntityVersion: 4,
    });
    const workerResponse = parseWorkerResponse({
      requestId: 'metadata-conflict',
      result: { ok: false, error: publicErrorForWorkerFailure(error) },
    });

    expect(parseRendererResult(workerResponse.result)).toEqual({
      ok: false,
      error: {
        code: 'VERSION_CONFLICT',
        message: 'The metadata has been modified by another operation. Please refresh and try again.',
        currentEntityVersion: 4,
      },
    });
  });

  it('continues to sanitize unknown internal failures', () => {
    expect(publicErrorForWorkerFailure(
      new Error('SQLITE_CANTOPEN at /Users/private/library.db'),
    )).toEqual({
      code: 'INTERNAL_ERROR',
      message: PUBLIC_ERROR_MESSAGES.INTERNAL_ERROR,
    });
  });

  it('maps invalid metadata to its stable actionable public error', () => {
    expect(publicErrorForWorkerFailure(
      new LibraryServiceError('INVALID_ASSET_METADATA'),
    )).toEqual({
      code: 'INVALID_ASSET_METADATA',
      message: 'Choose valid asset metadata values, including six-digit hex colors and an HTTP(S) source page URL.',
    });
  });

  it('exposes a lease conflict as a retryable library-busy result without filesystem details', () => {
    expect(publicErrorForWorkerFailure(
      new LibraryWriteCoordinatorError('Another process owns /private/Library/.serpent/library.db', 'timed-out'),
    )).toEqual({
      code: 'LIBRARY_BUSY',
      message: PUBLIC_ERROR_MESSAGES.LIBRARY_BUSY,
    });
  });

  it('maps a missing-column write failure to LIBRARY_STRUCTURE_MISMATCH', () => {
    const sqliteError = new Error('no such column: mandatory_tag');
    Object.assign(sqliteError, { code: 'SQLITE_ERROR' });
    expect(publicErrorForWorkerFailure(sqliteError)).toEqual({
      code: 'LIBRARY_STRUCTURE_MISMATCH',
      message:
        PUBLIC_ERROR_MESSAGES.LIBRARY_STRUCTURE_MISMATCH,
    });
  });

  it('maps a locked SQLite database to LIBRARY_BUSY instead of INTERNAL_ERROR', () => {
    const sqliteError = new Error('database is locked');
    Object.assign(sqliteError, { code: 'SQLITE_ERROR' });
    expect(publicErrorForWorkerFailure(sqliteError)).toEqual({
      code: 'LIBRARY_BUSY',
      message: PUBLIC_ERROR_MESSAGES.LIBRARY_BUSY,
    });
  });

  it('safely degrades malformed LibraryServiceError states', () => {
    for (const malformed of [
      new LibraryServiceError('VERSION_CONFLICT'),
      new LibraryServiceError('ASSET_NOT_FOUND', { currentEntityVersion: 2 }),
    ]) {
      expect(() => publicErrorForWorkerFailure(malformed)).not.toThrow();
      expect(publicErrorForWorkerFailure(malformed)).toEqual({
        code: 'INTERNAL_ERROR',
        message: PUBLIC_ERROR_MESSAGES.INTERNAL_ERROR,
      });
    }
  });

  it('maps sync connection failures to a readable reason (Serpent-xffq)', () => {
    expect(publicErrorForWorkerFailure(
      new RemoteStorageError('AUTH_FAILED', '认证失败：用户名或密码不正确。'),
    )).toEqual({
      code: 'SYNC_CONNECTION_FAILED',
      message: PUBLIC_ERROR_MESSAGES.SYNC_CONNECTION_FAILED,
      reason: 'SYNC_AUTH_FAILED',
    });
    expect(publicErrorForWorkerFailure(
      new RemoteStorageError('PERMISSION_DENIED', '没有权限执行该操作，请检查账号权限。'),
    )).toEqual({
      code: 'SYNC_CONNECTION_FAILED',
      message: PUBLIC_ERROR_MESSAGES.SYNC_CONNECTION_FAILED,
      reason: 'SYNC_PERMISSION_DENIED',
    });
  });

  it('maps NAS SQLite IOERR to LIBRARY_NETWORK_SHARE (Serpent-4f44f1)', () => {
    const sqliteError = new Error('disk I/O error');
    Object.assign(sqliteError, { code: 'SQLITE_IOERR_IN_PAGE' });
    expect(publicErrorForWorkerFailure(sqliteError)).toEqual({
      code: 'LIBRARY_NETWORK_SHARE',
      message: PUBLIC_ERROR_MESSAGES.LIBRARY_NETWORK_SHARE,
    });
  });

  it('maps SQLITE_CANTOPEN codes without leaking the path', () => {
    const sqliteError = new Error('unable to open database file: /Users/private/library.db');
    Object.assign(sqliteError, { code: 'SQLITE_CANTOPEN' });
    const publicError = publicErrorForWorkerFailure(sqliteError);
    expect(publicError).toEqual({
      code: 'LIBRARY_NOT_WRITABLE',
      message: PUBLIC_ERROR_MESSAGES.LIBRARY_NOT_WRITABLE,
      reason: 'IO_ERROR',
    });
    expect(JSON.stringify(publicError)).not.toContain('/Users/private');
  });

  it('maps WebDAV MOVE-unsupported to a sync method reason', () => {
    expect(publicErrorForWorkerFailure(
      new DriverUnsupportedError('WebDAV 服务器不支持 MOVE。'),
    )).toEqual({
      code: 'SYNC_CONNECTION_FAILED',
      message: PUBLIC_ERROR_MESSAGES.SYNC_CONNECTION_FAILED,
      reason: 'SYNC_METHOD_NOT_ALLOWED',
    });
  });

  it('maps unclassified HTTP status codes to SYNC_HTTP_ERROR', () => {
    expect(publicErrorForWorkerFailure(
      new RemoteStorageError('HTTP_502', '服务器返回错误（502）。'),
    )).toEqual({
      code: 'SYNC_CONNECTION_FAILED',
      message: PUBLIC_ERROR_MESSAGES.SYNC_CONNECTION_FAILED,
      reason: 'SYNC_HTTP_ERROR',
    });
  });
});
