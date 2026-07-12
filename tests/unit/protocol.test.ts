import { describe, expect, it } from 'vitest';

import {
  parseRendererRequest,
  parseWorkerRequest,
} from '../../src/shared/protocol/requests';
import { toPublicError } from '../../src/shared/protocol/errors';
import { parseRendererLifecycleEvent } from '../../src/shared/protocol/responses';

describe('renderer request protocol', () => {
  it('accepts the semantic create-library request', () => {
    expect(
      parseRendererRequest({
        type: 'library.create.request',
        displayName: 'Concept Art',
      }),
    ).toEqual({
      type: 'library.create.request',
      displayName: 'Concept Art',
    });
  });

  it('rejects paths supplied by the renderer', () => {
    expect(() =>
      parseRendererRequest({
        type: 'library.create.request',
        displayName: 'Concept Art',
        selectedParentPath: '/private/forged/path',
      }),
    ).toThrow();
  });

  it('rejects unknown channels and malformed values', () => {
    expect(() => parseRendererRequest({ type: 'ipc.send', channel: '*' })).toThrow();
    expect(() =>
      parseRendererRequest({ type: 'library.close.request', libraryId: '' }),
    ).toThrow();
  });
});

describe('worker request protocol', () => {
  it('requires an internal request id and a selected path', () => {
    expect(
      parseWorkerRequest({
        requestId: 'req-01',
        command: {
          type: 'library.open',
          selectedLibraryPath: '/Users/example/Library',
        },
      }),
    ).toEqual({
      requestId: 'req-01',
      command: {
        type: 'library.open',
        selectedLibraryPath: '/Users/example/Library',
      },
    });

    expect(() =>
      parseWorkerRequest({
        requestId: 'req-01',
        command: { type: 'library.open' },
      }),
    ).toThrow();
  });
});

describe('public errors', () => {
  it('does not expose internal errors or paths', () => {
    const publicError = toPublicError(
      new Error('SQLITE_CANTOPEN at /Users/private/secret/library.db'),
    );

    expect(publicError).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Serpent could not complete the request.',
    });
    expect(JSON.stringify(publicError)).not.toContain('/Users/private');
    expect(JSON.stringify(publicError)).not.toContain('SQLITE');
  });
});

describe('renderer lifecycle events', () => {
  it('accepts stable lifecycle events and rejects unknown data', () => {
    expect(
      parseRendererLifecycleEvent({ type: 'library.opening', operation: 'create' }),
    ).toEqual({ type: 'library.opening', operation: 'create' });
    expect(() =>
      parseRendererLifecycleEvent({ type: 'library.opened', libraryPath: '/private/path' }),
    ).toThrow();
  });
});
