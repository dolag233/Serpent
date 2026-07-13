import { describe, expect, it } from 'vitest';

import {
  parseRendererRequest,
  parseWorkerRequest,
} from '../../src/shared/protocol/requests';
import { createPublicError, toPublicError } from '../../src/shared/protocol/errors';
import {
  importConflictPlanSchema,
  parseAssetChangeEvent,
  parseRendererResult,
  parseRendererLifecycleEvent,
} from '../../src/shared/protocol/responses';

describe('renderer request protocol', () => {
  it('accepts semantic video preview and proxy retry requests without paths', () => {
    expect(parseRendererRequest({
      type: 'asset.preview.request',
      libraryId: 'library-01',
      assetId: 'asset-01',
      mode: 'fullscreen',
    })).toMatchObject({ type: 'asset.preview.request', mode: 'fullscreen' });
    expect(parseRendererRequest({
      type: 'asset.retry-artifact.request',
      libraryId: 'library-01',
      assetId: 'asset-01',
      kind: 'webm_proxy',
    })).toMatchObject({ kind: 'webm_proxy' });
  });

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

  it('accepts transfer cancellation by opaque operation id only', () => {
    expect(parseRendererRequest({
      type: 'library.export.cancel.request',
      exportId: 'export-01',
    })).toEqual({ type: 'library.export.cancel.request', exportId: 'export-01' });
    expect(parseRendererRequest({
      type: 'library.import.cancel.request',
      importId: 'import-01',
    })).toEqual({ type: 'library.import.cancel.request', importId: 'import-01' });
    expect(() => parseRendererRequest({
      type: 'library.export.cancel.request',
      exportId: 'export-01',
      destinationPath: '/private/forged/path',
    })).toThrow();
  });

  it('rejects unknown channels and malformed values', () => {
    expect(() => parseRendererRequest({ type: 'ipc.send', channel: '*' })).toThrow();
    expect(() =>
      parseRendererRequest({ type: 'library.close.request', libraryId: '' }),
    ).toThrow();
  });
});

describe('preview response protocol', () => {
  it('carries only opaque URLs and actionable artifact state', () => {
    const result = parseRendererResult({
      ok: true,
      type: 'asset.preview.resolved',
      assetId: 'asset-01',
      mediaType: 'video',
      status: 'failed',
      kind: 'webm_proxy',
      posterUrl: 'serpent://preview/library-01/poster-01',
      errorCode: 'FFMPEG_REQUIRED',
    });
    expect(result).toMatchObject({ status: 'failed', errorCode: 'FFMPEG_REQUIRED' });
    expect(JSON.stringify(result)).not.toContain('/Users/');
  });
});

describe('linked asset delete response protocol', () => {
  it('reports partial failures with stable IDs and safe reasons only', () => {
    expect(parseRendererResult({
      ok: true,
      type: 'asset.deleted-linked',
      deletedCount: 1,
      failedCount: 1,
      failures: [{ assetId: 'asset-02', reason: 'SOURCE_TRASH_FAILED' }],
    })).toEqual({
      ok: true,
      type: 'asset.deleted-linked',
      deletedCount: 1,
      failedCount: 1,
      failures: [{ assetId: 'asset-02', reason: 'SOURCE_TRASH_FAILED' }],
    });

    expect(() => parseRendererResult({
      ok: true,
      type: 'asset.deleted-linked',
      deletedCount: 0,
      failedCount: 1,
      failures: [{
        assetId: 'asset-02',
        reason: 'SOURCE_TRASH_FAILED',
        sourcePath: '/private/linked/asset.png',
      }],
    })).toThrow();

    expect(() => parseRendererResult({
      ok: true,
      type: 'asset.deleted-linked',
      deletedCount: 0,
      failedCount: 0,
      failures: [{ assetId: 'asset-02', reason: 'SOURCE_TRASH_FAILED' }],
    })).toThrow();
  });
});

describe('worker request protocol', () => {
  it('bounds linked source deletion and rejects duplicate asset IDs', () => {
    const request = {
      requestId: 'request-linked-delete',
      command: {
        type: 'asset.delete-linked',
        libraryId: 'library-1',
        assetIds: ['asset-1'],
        deleteSourceFile: true,
      },
    } as const;
    expect(parseWorkerRequest(request).command).toEqual(request.command);
    expect(() => parseWorkerRequest({
      ...request,
      command: { ...request.command, assetIds: ['asset-1', 'asset-1'] },
    })).toThrow();
    expect(() => parseWorkerRequest({
      ...request,
      command: {
        ...request.command,
        assetIds: Array.from({ length: 21 }, (_, index) => `asset-${index}`),
      },
    })).toThrow();
  });

  it('accepts a bounded AI queue-processing command with ephemeral credentials', () => {
    const parsed = parseWorkerRequest({
      requestId: 'request-ai-1',
      command: {
        type: 'ai.process-queue',
        libraryId: 'library-1',
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: 'ephemeral-key',
        enabledFields: { label: true, description: true, tags: true, structuredMetadata: false },
        language: 'zh-CN',
        maxJobs: 10,
      },
    });
    expect(parsed.command.type).toBe('ai.process-queue');
    expect(() => parseWorkerRequest({
      requestId: 'request-ai-2',
      command: { ...parsed.command, maxJobs: 101 },
    })).toThrow();
  });

  it('round-trips the Main-owned import id for library validation', () => {
    expect(parseWorkerRequest({
      requestId: 'request-1',
      command: {
        type: 'library.import-validate',
        importId: 'import-1',
        sourceFolderPath: '/tmp/library',
      },
    }).command).toEqual({
      type: 'library.import-validate',
      importId: 'import-1',
      sourceFolderPath: '/tmp/library',
    });
  });

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
  it.each([
    'AI_AUTH',
    'AI_PERMISSION',
    'AI_QUOTA',
    'AI_RATE_LIMIT',
    'AI_NETWORK',
    'AI_TIMEOUT',
    'AI_INVALID_RESPONSE',
  ] as const)('accepts safe actionable AI reason %s', (reason) => {
    expect(createPublicError('AI_ANALYSIS_FAILED', reason)).toMatchObject({
      code: 'AI_ANALYSIS_FAILED',
      reason,
    });
  });

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
