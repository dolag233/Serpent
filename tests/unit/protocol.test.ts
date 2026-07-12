import { describe, expect, it } from 'vitest';

import {
  parseRendererRequest,
  parseWorkerRequest,
} from '../../src/shared/protocol/requests';
import { createPublicError, toPublicError } from '../../src/shared/protocol/errors';
import {
  importConflictPlanSchema,
  parseAssetChangeEvent,
  parseRendererLifecycleEvent,
} from '../../src/shared/protocol/responses';

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
    expect(() =>
      parseRendererRequest({
        type: 'asset.import-files.request',
        libraryId: 'library-01',
        targetFolderId: 'folder-01',
        sourcePaths: ['/private/forged/path'],
      }),
    ).toThrow();
  });

  it('accepts semantic asset and folder requests without filesystem paths', () => {
    expect(
      parseRendererRequest({
        type: 'folder.create.request',
        libraryId: 'library-01',
        parentFolderId: 'folder-01',
        name: 'References',
      }),
    ).toMatchObject({ type: 'folder.create.request', name: 'References' });
    expect(
      parseRendererRequest({
        type: 'asset.import.resolve',
        importId: 'import-01',
        suspectedDuplicate: 'skip',
        nameConflict: 'keep-both',
      }),
    ).toEqual({
      type: 'asset.import.resolve',
      importId: 'import-01',
      suspectedDuplicate: 'skip',
      nameConflict: 'keep-both',
    });
    expect(parseRendererRequest({ type: 'asset.import.abandon', importId: 'import-01' }))
      .toEqual({ type: 'asset.import.abandon', importId: 'import-01' });
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

  it('accepts source paths only on the internal prepare-import command', () => {
    expect(
      parseWorkerRequest({
        requestId: 'req-02',
        command: {
          type: 'asset.import.prepare',
          libraryId: 'library-01',
          sourceKind: 'files',
          sourcePaths: ['/private/selected/source.png'],
        },
      }),
    ).toMatchObject({
      command: { type: 'asset.import.prepare', sourceKind: 'files' },
    });
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

  it('carries only a stable renderer-safe failure reason', () => {
    expect(createPublicError('IMPORT_APPLY_FAILED', 'PATH_LIMIT_EXCEEDED')).toEqual({
      code: 'IMPORT_APPLY_FAILED',
      message: 'Serpent could not apply the import safely.',
      reason: 'PATH_LIMIT_EXCEEDED',
    });
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

describe('renderer-safe import plans', () => {
  it('rejects examples containing source paths', () => {
    expect(() => importConflictPlanSchema.parse({
      importId: 'import-01',
      fileCount: 1,
      totalBytes: 100,
      suspectedDuplicateCount: 1,
      nameConflictCount: 0,
      examples: [{ displayName: '/private/source.png', kind: 'suspected-duplicate' }],
    })).toThrow();
  });
});

describe('background asset change events', () => {
  it('accepts semantic summaries and rejects paths or asset payloads', () => {
    expect(parseAssetChangeEvent({
      type: 'asset.changed',
      libraryId: 'library-01',
      changedCount: 3,
      missingCount: 1,
    })).toEqual({
      type: 'asset.changed',
      libraryId: 'library-01',
      changedCount: 3,
      missingCount: 1,
    });
    expect(() => parseAssetChangeEvent({
      type: 'asset.changed',
      libraryId: 'library-01',
      changedCount: 1,
      missingCount: 0,
      sourcePath: '/private/source.png',
    })).toThrow();
  });
});
