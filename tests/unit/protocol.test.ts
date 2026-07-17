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
  parseWorkerResponse,
  parseRendererLifecycleEvent,
  parseAiProgressEvent,
  parseAiAnalysisCompletedEvent,
} from '../../src/shared/protocol/responses';

describe('renderer request protocol', () => {
  it('requires an opaque preview token to apply or cancel batch relinking', () => {
    expect(parseRendererRequest({
      type: 'asset.relink-batch.apply.request',
      libraryId: 'library-01',
      previewId: 'preview-01',
      keepMetadata: true,
    })).toMatchObject({ previewId: 'preview-01' });
    expect(parseRendererRequest({
      type: 'asset.relink-batch.cancel.request',
      libraryId: 'library-01',
      previewId: 'preview-01',
    })).toMatchObject({ previewId: 'preview-01' });

    expect(() => parseRendererRequest({
      type: 'asset.relink-batch.apply.request',
      libraryId: 'library-01',
      keepMetadata: true,
    })).toThrow();
    expect(() => parseRendererRequest({
      type: 'asset.relink-batch.apply.request',
      libraryId: 'library-01',
      previewId: 'preview-01',
      keepMetadata: true,
      newRootPath: '/must-not-cross-the-renderer-boundary',
    })).toThrow();
  });

  it('exposes the relink preview token only on the renderer response', () => {
    const preview = {
      ok: true as const,
      type: 'asset.relink-batch.preview' as const,
      matchedCount: 1,
      unmatchedCount: 1,
      totalCount: 2,
      examples: [{ relativeFilePath: 'image.png', matched: true }],
    };
    expect(parseWorkerResponse({
      requestId: 'relink-preview-01',
      result: preview,
    }).result).not.toHaveProperty('previewId');
    expect(parseRendererResult({ ...preview, previewId: 'preview-01' }))
      .toMatchObject({ previewId: 'preview-01' });
    expect(() => parseRendererResult(preview)).toThrow();
    expect(parseRendererResult({
      ok: true,
      type: 'asset.relink-batch.cancelled',
      previewId: 'preview-01',
    })).toMatchObject({ previewId: 'preview-01' });

    for (const unsafePath of ['/tmp/private.png', 'C:\\private.png', '\\\\server\\share\\private.png']) {
      expect(() => parseWorkerResponse({
        requestId: 'unsafe-worker-preview',
        result: {
          ...preview,
          examples: [{ relativeFilePath: unsafePath, matched: true }],
        },
      })).toThrow();
      expect(() => parseRendererResult({
        ...preview,
        previewId: 'preview-unsafe',
        examples: [{ relativeFilePath: unsafePath, matched: true }],
      })).toThrow();
    }
  });

  it('round-trips persisted linked-folder rule identifiers without requiring UUIDs', () => {
    const rule = { ruleId: 'folder-id:default:0', action: 'exclude' as const, target: 'folder' as const, pattern: '.git', enabled: true };
    expect(parseWorkerRequest({
      requestId: 'rules-request',
      command: { type: 'linked-folder.rules.set', libraryId: 'library', folderId: 'folder', rules: [rule] },
    }).command).toMatchObject({ rules: [rule] });
    expect(parseRendererResult({ ok: true, type: 'linked-folder.rules', rules: [rule] }))
      .toEqual({ ok: true, type: 'linked-folder.rules', rules: [rule] });
  });
  it('validates typed technical metadata filter ranges', () => {
    expect(parseRendererRequest({
      type: 'asset.search.request',
      libraryId: 'library-01',
      query: null,
      filters: [
        { field: 'width', ranges: [{ min: 1920 }], exclude: false },
        { field: 'aspect_ratio', ranges: [{ min: 1.7, max: 1.8 }], exclude: false },
        { field: 'duration_ms', ranges: [{ max: 30_000 }], exclude: true },
      ],
    })).toMatchObject({ type: 'asset.search.request' });
    expect(() => parseRendererRequest({
      type: 'asset.search.request',
      libraryId: 'library-01',
      query: null,
      filters: [{ field: 'width', ranges: [{ min: 2000, max: 1000 }], exclude: false }],
    })).toThrow();
    expect(() => parseRendererRequest({
      type: 'asset.search.request',
      libraryId: 'library-01',
      query: null,
      filters: [{ field: 'aspect_ratio', ranges: [{}], exclude: false }],
    })).toThrow();
  });

  it('rejects the retired Label field in search clauses', () => {
    expect(() => parseRendererRequest({
      type: 'asset.search.request',
      libraryId: 'library-01',
      query: {
        clauses: [{ field: 'label', values: ['legacy alias'], exclude: false }],
      },
    })).toThrow();
  });

  it('accepts only explicit six-digit hex colors for manual palettes', () => {
    const validPalette = ['#000000', '#a1B2c3', '#FFFFFF'];
    expect(parseRendererRequest({
      type: 'asset.metadata.set.request',
      libraryId: 'library-01',
      assetId: 'asset-01',
      expectedVersion: 0,
      palette: validPalette,
    })).toMatchObject({ palette: validPalette });
    expect(parseWorkerRequest({
      requestId: 'palette-01',
      command: {
        type: 'asset.metadata.set',
        libraryId: 'library-01',
        assetId: 'asset-01',
        expectedVersion: 0,
        palette: validPalette,
      },
    })).toMatchObject({ command: { palette: validPalette } });

    for (const invalidColor of ['red', '#FFF', '#12345G', 'rgb(1, 2, 3)', ' #112233']) {
      expect(() => parseRendererRequest({
        type: 'asset.metadata.set.request',
        libraryId: 'library-01',
        assetId: 'asset-01',
        expectedVersion: 0,
        palette: [invalidColor],
      })).toThrow();
      expect(() => parseWorkerRequest({
        requestId: 'palette-invalid',
        command: {
          type: 'asset.metadata.set',
          libraryId: 'library-01',
          assetId: 'asset-01',
          expectedVersion: 0,
          palette: [invalidColor],
        },
      })).toThrow();
    }

    const twentyColors = Array.from({ length: 20 }, (_, index) =>
      `#${index.toString(16).padStart(6, '0')}`);
    expect(parseRendererRequest({
      type: 'asset.metadata.set.request',
      libraryId: 'library-01',
      assetId: 'asset-01',
      expectedVersion: 0,
      palette: twentyColors,
    })).toMatchObject({ palette: twentyColors });
    expect(() => parseWorkerRequest({
      requestId: 'palette-too-large',
      command: {
        type: 'asset.metadata.set',
        libraryId: 'library-01',
        assetId: 'asset-01',
        expectedVersion: 0,
        palette: [...twentyColors, '#FFFFFF'],
      },
    })).toThrow();
  });

  it('accepts empty metadata text fields as explicit clear operations', () => {
    const rendererRequest = parseRendererRequest({
      type: 'asset.metadata.set.request',
      libraryId: 'library-01',
      assetId: 'asset-01',
      expectedVersion: 3,
      description: '',
      sourcePageUrl: '',
    });
    expect(rendererRequest).toMatchObject({
      description: '',
      sourcePageUrl: '',
    });

    const workerRequest = parseWorkerRequest({
      requestId: 'metadata-clear',
      command: {
        type: 'asset.metadata.set',
        libraryId: 'library-01',
        assetId: 'asset-01',
        expectedVersion: 3,
        description: '',
        sourcePageUrl: '',
      },
    });
    expect(workerRequest.command).toMatchObject({
      description: '',
      sourcePageUrl: '',
    });
  });

  it('accepts only empty or HTTP(S) source-page URLs up to the URL limit', () => {
    const longValidUrl = `https://example.com/${'a'.repeat(300)}`;
    expect(parseRendererRequest({
      type: 'asset.metadata.set.request',
      libraryId: 'library-01',
      assetId: 'asset-01',
      expectedVersion: 0,
      sourcePageUrl: longValidUrl,
    })).toMatchObject({ sourcePageUrl: longValidUrl });
    expect(parseWorkerRequest({
      requestId: 'metadata-source-url',
      command: {
        type: 'asset.metadata.set',
        libraryId: 'library-01',
        assetId: 'asset-01',
        expectedVersion: 0,
        sourcePageUrl: 'http://example.com/source',
      },
    })).toMatchObject({ command: { sourcePageUrl: 'http://example.com/source' } });

    for (const invalidUrl of [
      'ftp://example.com/source',
      '/relative/source',
      'https://user:secret@example.com/source',
      ' https://example.com/source ',
      '   ',
      `https://example.com/${'a'.repeat(8_193)}`,
    ]) {
      expect(() => parseRendererRequest({
        type: 'asset.metadata.set.request',
        libraryId: 'library-01',
        assetId: 'asset-01',
        expectedVersion: 0,
        sourcePageUrl: invalidUrl,
      })).toThrow();
      expect(() => parseWorkerRequest({
        requestId: 'metadata-source-url-invalid',
        command: {
          type: 'asset.metadata.set',
          libraryId: 'library-01',
          assetId: 'asset-01',
          expectedVersion: 0,
          sourcePageUrl: invalidUrl,
        },
      })).toThrow();
    }
  });

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

  it('accepts path-free reveal-in-folder and copy-file-path requests by asset id only', () => {
    expect(parseRendererRequest({
      type: 'asset.reveal-in-folder.request',
      libraryId: 'library-01',
      assetId: 'asset-01',
    })).toEqual({
      type: 'asset.reveal-in-folder.request',
      libraryId: 'library-01',
      assetId: 'asset-01',
    });
    expect(parseRendererRequest({
      type: 'asset.copy-file-path.request',
      libraryId: 'library-01',
      assetId: 'asset-01',
    })).toEqual({
      type: 'asset.copy-file-path.request',
      libraryId: 'library-01',
      assetId: 'asset-01',
    });
    // REQ-COMMAND-003: the renderer must never supply filesystem paths.
    expect(() => parseRendererRequest({
      type: 'asset.reveal-in-folder.request',
      libraryId: 'library-01',
      assetId: 'asset-01',
      absolutePath: '/private/forged/path',
    })).toThrow();
    expect(() => parseRendererRequest({
      type: 'asset.copy-file-path.request',
      libraryId: 'library-01',
      assetId: 'asset-01',
      absolutePath: '/private/forged/path',
    })).toThrow();
    expect(() => parseRendererRequest({
      type: 'asset.reveal-in-folder.request',
      libraryId: 'library-01',
    })).toThrow();
    expect(() => parseRendererRequest({
      type: 'asset.copy-file-path.request',
      libraryId: 'library-01',
    })).toThrow();
  });

  it('accepts asset file rename by id and extension-less base name only', () => {
    expect(parseRendererRequest({
      type: 'asset.rename-file.request',
      libraryId: 'library-01',
      assetId: 'asset-01',
      newBaseName: 'hero concept',
    })).toEqual({
      type: 'asset.rename-file.request',
      libraryId: 'library-01',
      assetId: 'asset-01',
      newBaseName: 'hero concept',
    });
    expect(parseWorkerRequest({
      requestId: 'rename-01',
      command: {
        type: 'asset.rename-file',
        libraryId: 'library-01',
        assetId: 'asset-01',
        newBaseName: 'hero concept',
      },
    }).command).toEqual({
      type: 'asset.rename-file',
      libraryId: 'library-01',
      assetId: 'asset-01',
      newBaseName: 'hero concept',
    });
  });

  it('rejects path-shaped and malformed asset rename base names at the schema layer', () => {
    const rejectedBaseNames = [
      '../escape',
      '..',
      '.',
      '/abs/path',
      'nested/name',
      'back\\slash',
      'C:\\Windows\\system32',
      '',
    ];
    for (const newBaseName of rejectedBaseNames) {
      expect(() => parseRendererRequest({
        type: 'asset.rename-file.request',
        libraryId: 'library-01',
        assetId: 'asset-01',
        newBaseName,
      })).toThrow();
      expect(() => parseWorkerRequest({
        requestId: 'rename-injection',
        command: {
          type: 'asset.rename-file',
          libraryId: 'library-01',
          assetId: 'asset-01',
          newBaseName,
        },
      })).toThrow();
    }
    // Control characters, blank, and overlong input are rejected on both boundaries.
    for (const newBaseName of ['line\nbreak', '\tab', '', '   ', 'a'.repeat(256)]) {
      expect(() => parseRendererRequest({
        type: 'asset.rename-file.request',
        libraryId: 'library-01',
        assetId: 'asset-01',
        newBaseName,
      })).toThrow();
      expect(() => parseWorkerRequest({
        requestId: 'rename-malformed',
        command: {
          type: 'asset.rename-file',
          libraryId: 'library-01',
          assetId: 'asset-01',
          newBaseName,
        },
      })).toThrow();
    }
    // REQ-COMMAND-003: the renderer must never supply filesystem paths.
    expect(() => parseRendererRequest({
      type: 'asset.rename-file.request',
      libraryId: 'library-01',
      assetId: 'asset-01',
      newBaseName: 'hero',
      absolutePath: '/private/forged/path',
    })).toThrow();
    // Semantic name rules (reserved DOS names, trailing dot/space, byte limit)
    // are service-layer concerns; these shapes still parse so the Worker can
    // answer with a typed INVALID_ASSET_FILE_NAME error.
    expect(parseRendererRequest({
      type: 'asset.rename-file.request',
      libraryId: 'library-01',
      assetId: 'asset-01',
      newBaseName: 'CON',
    })).toMatchObject({ newBaseName: 'CON' });
    expect(parseRendererRequest({
      type: 'asset.rename-file.request',
      libraryId: 'library-01',
      assetId: 'asset-01',
      newBaseName: 'trailing.',
    })).toMatchObject({ newBaseName: 'trailing.' });
  });

  it('round-trips the asset file-renamed response on both boundaries', () => {
    const asset = {
      assetId: 'asset-01',
      locationKind: 'managed' as const,
      managedFolderId: 'folder-01',
      relativeFilePath: 'Shots/bravo.png',
      displayName: 'bravo.png',
      currentRevisionId: 'revision-01',
      byteSize: 4,
      modifiedAt: '2026-07-18T00:00:00.000Z',
      availability: 'available' as const,
      rating: 0,
      favorite: false,
      deletedAt: null,
      trashedFromPath: null,
      remainingDays: null,
      thumbnailStatus: null,
      thumbnailArtifactId: null,
      mediaType: 'image' as const,
      width: null,
      height: null,
    };
    expect(parseRendererResult({ ok: true, type: 'asset.file-renamed', asset }))
      .toMatchObject({ type: 'asset.file-renamed', asset: { relativeFilePath: 'Shots/bravo.png' } });
    expect(parseWorkerResponse({
      requestId: 'rename-response',
      result: { ok: true, type: 'asset.file-renamed', asset },
    }).result).toMatchObject({ type: 'asset.file-renamed' });
    // The response carries no absolute path, and extra fields are stripped by schema.
    expect(() => parseRendererResult({
      ok: true,
      type: 'asset.file-renamed',
      asset: { ...asset, absolutePath: '/private/leak' },
    })).toThrow();
  });

  it('accepts managed folder rename by id and display name only', () => {
    expect(parseRendererRequest({
      type: 'folder.rename.request',
      libraryId: 'library-01',
      folderId: 'folder-01',
      newName: 'References 2026',
    })).toEqual({
      type: 'folder.rename.request',
      libraryId: 'library-01',
      folderId: 'folder-01',
      newName: 'References 2026',
    });
    expect(parseWorkerRequest({
      requestId: 'folder-rename-01',
      command: {
        type: 'folder.rename',
        libraryId: 'library-01',
        folderId: 'folder-01',
        newName: 'References 2026',
      },
    }).command).toEqual({
      type: 'folder.rename',
      libraryId: 'library-01',
      folderId: 'folder-01',
      newName: 'References 2026',
    });
  });

  it('rejects injected and malformed folder rename requests at the schema layer', () => {
    // REQ-COMMAND-003: the renderer must never supply filesystem paths.
    expect(() => parseRendererRequest({
      type: 'folder.rename.request',
      libraryId: 'library-01',
      folderId: 'folder-01',
      newName: 'Renamed',
      absolutePath: '/private/forged/path',
    })).toThrow();
    expect(() => parseWorkerRequest({
      requestId: 'folder-rename-injection',
      command: {
        type: 'folder.rename',
        libraryId: 'library-01',
        folderId: 'folder-01',
        newName: 'Renamed',
        relativePath: 'forged/path',
      },
    })).toThrow();
    // Blank, missing, and overlong names are rejected on both boundaries.
    for (const newName of ['', '   ', 'a'.repeat(256)]) {
      expect(() => parseRendererRequest({
        type: 'folder.rename.request',
        libraryId: 'library-01',
        folderId: 'folder-01',
        newName,
      })).toThrow();
      expect(() => parseWorkerRequest({
        requestId: 'folder-rename-malformed',
        command: {
          type: 'folder.rename',
          libraryId: 'library-01',
          folderId: 'folder-01',
          newName,
        },
      })).toThrow();
    }
    expect(() => parseRendererRequest({
      type: 'folder.rename.request',
      libraryId: 'library-01',
      newName: 'Renamed',
    })).toThrow();
    // Semantic name rules (separators, dot segments, reserved DOS names) are
    // service-layer concerns; these shapes still parse so the Worker can
    // answer with a typed INVALID_FOLDER_NAME error.
    expect(parseRendererRequest({
      type: 'folder.rename.request',
      libraryId: 'library-01',
      folderId: 'folder-01',
      newName: 'a/b',
    })).toMatchObject({ newName: 'a/b' });
    expect(parseRendererRequest({
      type: 'folder.rename.request',
      libraryId: 'library-01',
      folderId: 'folder-01',
      newName: '..',
    })).toMatchObject({ newName: '..' });
  });

  it('round-trips the folder.renamed response on both boundaries', () => {
    const folder = {
      folderId: 'folder-01',
      parentFolderId: null,
      name: 'Renamed',
      relativePath: 'Renamed',
    };
    expect(parseRendererResult({ ok: true, type: 'folder.renamed', folder }))
      .toMatchObject({ type: 'folder.renamed', folder: { relativePath: 'Renamed' } });
    expect(parseWorkerResponse({
      requestId: 'folder-rename-response',
      result: { ok: true, type: 'folder.renamed', folder },
    }).result).toMatchObject({ type: 'folder.renamed' });
    // The response carries no absolute path, and extra fields are stripped by schema.
    expect(() => parseRendererResult({
      ok: true,
      type: 'folder.renamed',
      folder: { ...folder, absolutePath: '/private/leak' },
    })).toThrow();
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

  it('accepts path-free managed move and one-shot undo requests', () => {
    expect(parseRendererRequest({
      type: 'asset.move.request',
      libraryId: 'library-01',
      assetIds: ['asset-01', 'asset-02'],
      targetFolderId: null,
      conflictStrategy: 'keep-both',
    })).toMatchObject({ type: 'asset.move.request', targetFolderId: null });
    expect(parseRendererRequest({
      type: 'asset.move-undo.request',
      libraryId: 'library-01',
      operationId: 'operation-01',
      conflictStrategy: 'error',
    })).toMatchObject({ type: 'asset.move-undo.request', conflictStrategy: 'error' });
    expect(() => parseRendererRequest({
      type: 'asset.move.request',
      libraryId: 'library-01',
      assetIds: ['asset-01', 'asset-01'],
      targetFolderId: 'folder-01',
    })).toThrow();
    expect(() => parseRendererRequest({
      type: 'asset.move.request',
      libraryId: 'library-01',
      assetIds: ['asset-01'],
      targetFolderId: 'folder-01',
      destinationPath: '/forged/path',
    })).toThrow();
  });

  it('accepts preload-resolved drops and path-free clipboard requests', () => {
    expect(parseRendererRequest({
      type: 'asset.import-drop.request',
      libraryId: 'library-01',
      targetFolderId: 'folder-01',
      targetCollectionId: 'collection-01',
      sourcePaths: ['/private/preload-resolved/asset.png'],
    })).toMatchObject({ type: 'asset.import-drop.request', sourcePaths: ['/private/preload-resolved/asset.png'] });
    expect(parseRendererRequest({
      type: 'asset.import-clipboard.request',
      libraryId: 'library-01',
      targetFolderId: 'folder-01',
    })).toEqual({
      type: 'asset.import-clipboard.request',
      libraryId: 'library-01',
      targetFolderId: 'folder-01',
    });
    expect(() => parseRendererRequest({
      type: 'asset.import-clipboard.request',
      libraryId: 'library-01',
      sourcePath: '/private/forged/clipboard.png',
    })).toThrow();
    expect(parseRendererRequest({
      type: 'asset.import-drop-invalid.report',
      libraryId: 'library-01',
    })).toEqual({ type: 'asset.import-drop-invalid.report', libraryId: 'library-01' });
    expect(parseRendererRequest({
      type: 'asset.import-web.request',
      libraryId: 'library-01',
      targetFolderId: 'folder-01',
      targetCollectionId: 'collection-01',
      mediaUrl: 'https://cdn.example.com/image.png',
      mediaType: 'image',
    })).toMatchObject({ type: 'asset.import-web.request', mediaUrl: 'https://cdn.example.com/image.png' });
    expect(parseRendererRequest({
      type: 'asset.import-web-invalid.report',
      libraryId: 'library-01',
      failure: 'WEB_MEDIA_URL_INVALID',
    })).toMatchObject({ failure: 'WEB_MEDIA_URL_INVALID' });
    expect(() => parseRendererRequest({
      type: 'asset.import-web.request',
      libraryId: 'library-01',
      mediaUrl: 'file:///private/forged.png',
    })).toThrow();
    expect(() => parseRendererRequest({
      type: 'asset.import-web.request',
      libraryId: 'library-01',
      mediaUrl: 'https://user:secret@example.com/forged.png',
    })).toThrow();
    expect(() => parseRendererRequest({
      type: 'asset.import-web.request',
      libraryId: 'library-01',
      mediaUrl: 'https://cdn.example.com/image.png',
      sourcePageUrl: 'https://example.com/forged-source-page',
    })).toThrow();
  });

  it('accepts explicit restore destinations and conflict strategies', () => {
    expect(parseRendererRequest({
      type: 'asset.restore.request',
      libraryId: 'library-01',
      assetIds: ['asset-01'],
      targetFolderId: null,
      conflictStrategy: 'replace',
    })).toMatchObject({ targetFolderId: null, conflictStrategy: 'replace' });
    expect(() => parseRendererRequest({
      type: 'asset.restore.request',
      libraryId: 'library-01',
      assetIds: ['asset-01'],
      conflictStrategy: 'overwrite',
    })).toThrow();
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

  it('accepts media job controls by opaque IDs and rejects empty selections', () => {
    expect(parseRendererRequest({
      type: 'media.list-jobs.request',
      libraryId: 'library-01',
    })).toMatchObject({ type: 'media.list-jobs.request' });
    expect(parseRendererRequest({
      type: 'media.cancel-jobs.request',
      libraryId: 'library-01',
      jobIds: ['job-01'],
    })).toMatchObject({ jobIds: ['job-01'] });
    expect(() => parseRendererRequest({
      type: 'media.retry-jobs.request',
      libraryId: 'library-01',
      jobIds: [],
    })).toThrow();
  });

  it('accepts one atomic collection sibling order and rejects duplicates only at the domain layer', () => {
    expect(parseRendererRequest({
      type: 'collection.reorder.request',
      libraryId: 'library-01',
      orderedCollectionIds: ['collection-03', 'collection-01', 'collection-02'],
    })).toMatchObject({ orderedCollectionIds: ['collection-03', 'collection-01', 'collection-02'] });
    expect(() => parseRendererRequest({
      type: 'collection.reorder.request',
      libraryId: 'library-01',
      orderedCollectionIds: [],
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

  it('validates the renderer-safe media job listing', () => {
    expect(parseRendererResult({
      ok: true,
      type: 'media.jobs.listed',
      libraryId: 'library-01',
      queued: 1,
      running: 0,
      succeeded: 0,
      failed: 0,
      paused: 0,
      cancelled: 0,
      jobs: [{
        jobId: 'job-01',
        assetId: 'asset-01',
        revisionId: 'revision-01',
        kind: 'extract_palette',
        status: 'queued',
        progress: 0,
        attemptCount: 0,
        errorCode: null,
        errorDetail: null,
        createdAt: '2026-07-13T00:00:00.000Z',
        updatedAt: '2026-07-13T00:00:00.000Z',
      }],
    })).toMatchObject({ type: 'media.jobs.listed', queued: 1 });
  });

  it('validates automatic palette provenance without exposing artifact paths', () => {
    const result = parseRendererResult({
      ok: true,
      type: 'asset.metadata.got',
      metadata: {
        assetId: 'asset-01',
        description: null,
        rating: 0,
        favorite: false,
        palette: null,
        automaticPalette: [{ hex: '#FF0000', ratio: 0.75 }, { hex: '#0000FF', ratio: 0.25 }],
        effectivePalette: ['#FF0000', '#0000FF'],
        paletteSource: 'automatic',
        sourcePageUrl: null,
        entityVersion: 0,
        updatedAt: '1970-01-01T00:00:00.000Z',
      },
    });
    expect(result).toMatchObject({
      type: 'asset.metadata.got',
      metadata: { paletteSource: 'automatic', effectivePalette: ['#FF0000', '#0000FF'] },
    });
    expect(JSON.stringify(result)).not.toContain('.serpent');
  });

  it('carries only the asset id for reveal-in-folder and copy-file-path results', () => {
    expect(parseRendererResult({
      ok: true,
      type: 'asset.reveal-in-folder.requested',
      assetId: 'asset-01',
    })).toEqual({
      ok: true,
      type: 'asset.reveal-in-folder.requested',
      assetId: 'asset-01',
    });
    expect(parseRendererResult({
      ok: true,
      type: 'asset.copy-file-path.requested',
      assetId: 'asset-01',
    })).toEqual({
      ok: true,
      type: 'asset.copy-file-path.requested',
      assetId: 'asset-01',
    });
    // REQ-COMMAND-003: absolute paths never cross back to the renderer.
    expect(() => parseRendererResult({
      ok: true,
      type: 'asset.reveal-in-folder.requested',
      assetId: 'asset-01',
      absolutePath: '/private/forged/path',
    })).toThrow();
    expect(() => parseRendererResult({
      ok: true,
      type: 'asset.copy-file-path.requested',
      assetId: 'asset-01',
      absolutePath: '/private/forged/path',
    })).toThrow();
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
  it('accepts a path-free remote media command and rejects non-HTTP addresses', () => {
    expect(parseWorkerRequest({
      requestId: 'request-web-drop',
      command: {
        type: 'extension.save-from-url',
        libraryId: 'library-1',
        targetFolderId: 'folder-1',
        mediaUrl: 'https://cdn.example.com/image.png',
      },
    })).toMatchObject({ command: { type: 'extension.save-from-url' } });
    expect(() => parseWorkerRequest({
      requestId: 'request-web-drop-invalid',
      command: {
        type: 'extension.save-from-url',
        libraryId: 'library-1',
        mediaUrl: 'http://user:secret@example.com/image.png',
      },
    })).toThrow();
  });

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
        enabledFields: { description: true, tags: true, structuredMetadata: false },
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

  it('accepts AI job status commands and complete status results', () => {
    expect(parseRendererRequest({
      type: 'ai.status.request',
      libraryId: 'library-1',
    })).toMatchObject({ type: 'ai.status.request', libraryId: 'library-1' });

    expect(parseWorkerRequest({
      requestId: 'request-ai-status',
      command: { type: 'ai.status', libraryId: 'library-1' },
    })).toMatchObject({ command: { type: 'ai.status' } });

    expect(parseRendererResult({
      ok: true,
      type: 'ai.jobs.status',
      libraryId: 'library-1',
      queued: 1,
      running: 0,
      succeeded: 2,
      failed: 1,
      paused: 0,
      cancelled: 3,
      jobs: [{
        jobId: 'job-1',
        assetId: 'asset-1',
        kind: 'ai.image.analysis',
        status: 'queued',
        errorCode: null,
        errorDetail: null,
        updatedAt: '2026-07-13T00:00:00.000Z',
      }],
    })).toMatchObject({ type: 'ai.jobs.status', queued: 1, cancelled: 3 });
  });

  it('validates AI progress and completion events before Main forwards them', () => {
    expect(parseAiProgressEvent({
      type: 'ai.progress',
      libraryId: 'library-1',
      queued: 2,
      running: 1,
      succeeded: 4,
      failed: 1,
    })).toMatchObject({ running: 1, succeeded: 4 });
    expect(parseAiAnalysisCompletedEvent({
      type: 'ai.analysis.completed',
      libraryId: 'library-1',
      assetId: 'asset-1',
      fieldCount: 2,
      tagCount: 3,
    })).toMatchObject({ assetId: 'asset-1', tagCount: 3 });
    expect(() => parseAiProgressEvent({
      type: 'ai.progress', libraryId: 'library-1', queued: -1,
      running: 0, succeeded: 0, failed: 0,
    })).toThrow();
  });

  it('keeps media and AI job commands as distinct protocol variants', () => {
    expect(parseWorkerRequest({
      requestId: 'request-media-1',
      command: {
        type: 'media.pause-jobs',
        libraryId: 'library-1',
        jobIds: ['media-job-1'],
      },
    }).command.type).toBe('media.pause-jobs');
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

  it('exposes a specific safe error for invalid asset metadata', () => {
    expect(createPublicError('INVALID_ASSET_METADATA')).toEqual({
      code: 'INVALID_ASSET_METADATA',
      message: 'Choose valid asset metadata values, including six-digit hex colors and an HTTP(S) source page URL.',
    });
  });

  it('preserves the current metadata version through Worker and Preload validation', () => {
    const conflict = createPublicError('VERSION_CONFLICT', undefined, 7);
    const workerResponse = parseWorkerResponse({
      requestId: 'metadata-conflict',
      result: { ok: false, error: conflict },
    });
    const rendererResult = parseRendererResult(workerResponse.result);

    expect(rendererResult).toEqual({
      ok: false,
      error: {
        code: 'VERSION_CONFLICT',
        message: 'The metadata has been modified by another operation. Please refresh and try again.',
        currentEntityVersion: 7,
      },
    });
    expect(() => parseRendererResult({
      ok: false,
      error: {
        code: 'VERSION_CONFLICT',
        message: 'The metadata has been modified by another operation. Please refresh and try again.',
      },
    })).toThrow();
    expect(() => parseRendererResult({
      ok: false,
      error: {
        code: 'ASSET_NOT_FOUND',
        message: 'The requested asset could not be found.',
        currentEntityVersion: 7,
      },
    })).toThrow();
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
