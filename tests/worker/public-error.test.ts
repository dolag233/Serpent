import { describe, expect, it } from 'vitest';

import { parseRendererResult, parseWorkerResponse } from '../../src/shared/protocol/responses';
import { LibraryServiceError } from '../../src/worker/library-service';
import { LibraryWriteCoordinatorError } from '../../src/worker/library-write-coordinator';
import { publicErrorForWorkerFailure } from '../../src/worker/public-error';

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
      message: 'Serpent could not complete the request.',
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
      message: 'This library is being updated by another Serpent session. Try again in a moment.',
    });
  });

  it('maps a missing-column write failure to LIBRARY_STRUCTURE_MISMATCH', () => {
    const sqliteError = new Error('no such column: mandatory_tag');
    Object.assign(sqliteError, { code: 'SQLITE_ERROR' });
    expect(publicErrorForWorkerFailure(sqliteError)).toEqual({
      code: 'LIBRARY_STRUCTURE_MISMATCH',
      message:
        'This library has an incompatible structure for this operation. Upgrade Serpent to the latest version.',
    });
  });

  it('keeps unrelated SQLITE_ERROR failures generic', () => {
    const sqliteError = new Error('database is locked');
    Object.assign(sqliteError, { code: 'SQLITE_ERROR' });
    expect(publicErrorForWorkerFailure(sqliteError)).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Serpent could not complete the request.',
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
        message: 'Serpent could not complete the request.',
      });
    }
  });
});
