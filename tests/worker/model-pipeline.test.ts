import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LibraryService,
  LibraryServiceError,
} from '../../src/worker/library-service';
import { importNoConflict as sharedImportNoConflict } from './import-no-conflict';

const VALID_1X1_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const temporaryRoots: string[] = [];
const require = createRequire(import.meta.url);

interface TestDatabaseConnection {
  close(): void;
  prepare(source: string): {
    all(...parameters: unknown[]): unknown[];
    get(...parameters: unknown[]): unknown;
    run(...parameters: unknown[]): unknown;
  };
}

const TestDatabase = require('better-sqlite3') as new (
  filename: string,
) => TestDatabaseConnection;

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-model-'));
  temporaryRoots.push(root);
  return root;
}

function importNoConflict(service: LibraryService, libraryId: string, sourcePath: string): void {
  sharedImportNoConflict(service, libraryId, sourcePath);
}

/**
 * Import a whole directory so library-relative directory structure is
 * preserved (single-file imports flatten to the library root). Companion
 * mapping is exercised against structured trees.
 */
function importFolderNoConflict(service: LibraryService, libraryId: string, sourceDir: string): void {
  const prepared = service.prepareOrExecuteImport({
    libraryId,
    sourceKind: 'folder',
    sourcePaths: [sourceDir],
  });
  if ('importId' in prepared) {
    service.resolveImport({
      importId: prepared.importId,
      suspectedDuplicate: 'create-copy',
      nameConflict: 'keep-both',
    });
  }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    try {
      rmSync(root, { force: true, recursive: true });
    } catch {
      // Cleanup is best-effort.
    }
  }
});

const MODEL_FORMATS = ['character.fbx', 'asset.obj', 'scene.gltf', 'baked.glb', 'part.stl'];

function createSourceFile(root: string, relativePath: string, content = 'model-bytes'): string {
  const abs = path.join(root, relativePath);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}

describe('model asset pipeline (slice A, Serpent-fu2i)', () => {
  it('classifies imported T1 model formats as model with no thumbnail artifact', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Models', selectedParentPath: root });

    for (const filename of MODEL_FORMATS) {
      importNoConflict(service, created.libraryId, createSourceFile(root, `models/${filename}`));
    }
    // A non-model file in the same tree must stay separate.
    importNoConflict(service, created.libraryId, createSourceFile(root, 'models/readme.txt'));

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    expect(assets).toHaveLength(MODEL_FORMATS.length + 1);
    for (const filename of MODEL_FORMATS) {
      const asset = assets.find((a) => a.displayName === filename);
      expect(asset, filename).toBeDefined();
      expect(asset!.mediaType).toBe('model');
      // No Worker raster generator exists: thumbnailStatus stays null so the
      // card shows the generic icon, never a failed badge.
      expect(asset!.thumbnailStatus).toBeNull();
      expect(asset!.thumbnailArtifactId).toBeNull();
    }
    const textAsset = assets.find((a) => a.displayName === 'readme.txt');
    expect(textAsset!.mediaType).toBe('text');

    service.closeAll();
  });

  it('resolves a model preview to the original source URL contract', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Models', selectedParentPath: root });

    importNoConflict(service, created.libraryId, createSourceFile(root, 'characters/hero.fbx'));
    importNoConflict(service, created.libraryId, createSourceFile(root, 'props/chair.glb'));

    const fbx = service.listAssets({ libraryId: created.libraryId, recursive: true })
      .find((a) => a.displayName === 'hero.fbx')!;
    const preview = service.getPreviewArtifact(created.libraryId, fbx.assetId);
    // Main turns playbackMode 'source' + sourceRevisionId into
    // serpent://source/<libraryId>/<assetId>?revision=... (same route as
    // direct-play video), so the viewer opens without a generation gate.
    expect(preview).toMatchObject({
      mediaType: 'model',
      status: 'ready',
      kind: 'thumbnail',
      mimeType: 'model/fbx',
      playbackMode: 'source',
      sourceRevisionId: fbx.currentRevisionId,
      sourceMimeType: 'model/fbx',
    });
    // The async entrypoint (EXR/color-space path) passes models straight
    // through unchanged.
    const viaAsync = await service.resolvePreviewArtifact(created.libraryId, fbx.assetId);
    expect(viaAsync).toEqual(preview);

    const glb = service.listAssets({ libraryId: created.libraryId, recursive: true })
      .find((a) => a.displayName === 'chair.glb')!;
    expect(service.getPreviewArtifact(created.libraryId, glb.assetId))
      .toMatchObject({ mediaType: 'model', mimeType: 'model/gltf-binary' });

    service.closeAll();
  });

  it('degrades generateThumbnail to a no-op for models without writing failures', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Models', selectedParentPath: root });

    importNoConflict(service, created.libraryId, createSourceFile(root, 'robot.fbx'));
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;

    const result = await service.generateThumbnail({
      libraryId: created.libraryId,
      assetId: asset.assetId,
    });
    expect(result).toBeNull();

    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const artifacts = db.prepare('SELECT COUNT(*) AS n FROM revision_artifacts').get() as { n: number };
    const jobs = db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number };
    expect(artifacts.n).toBe(0);
    expect(jobs.n).toBe(0);
    db.close();

    // And the browse view still lists it as model, not failed.
    const listed = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;
    expect(listed.mediaType).toBe('model');
    expect(listed.thumbnailStatus).toBeNull();

    service.closeAll();
  });

  // Slice E migration (Serpent-hnmg): model extensions joined the thumbnail
  // queue because the offscreen GPU renderer now generates their thumbnails.
  // The job kind stays `generate_thumbnail`; the queue routes model jobs to
  // the injected modelThumbnailRenderer instead of sharp/OIIO/FFmpeg.
  it('enqueues model thumbnail jobs through the same queue as images', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Models', selectedParentPath: root });

    importNoConflict(service, created.libraryId, createSourceFile(root, 'scene.fbx'));
    importNoConflict(service, created.libraryId, createSourceFile(root, 'poster.png'));

    const enqueued = service.enqueueThumbnailJobs(created.libraryId, {
      assetIds: service.listAssets({ libraryId: created.libraryId, recursive: true })
        .map((a) => a.assetId),
      limit: 50,
    });
    // Both the PNG and the model qualify now.
    expect(enqueued).toBe(2);

    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const modelJobs = db.prepare(
      `SELECT COUNT(*) AS n
         FROM jobs j
         JOIN assets a ON a.asset_id = j.asset_id
        WHERE j.kind = 'generate_thumbnail'
          AND a.relative_file_path LIKE '%.fbx'`,
    ).get() as { n: number };
    expect(modelJobs.n).toBe(1);
    db.close();

    service.closeAll();
  });

  describe('offscreen model thumbnail queue (slice E, Serpent-hnmg)', () => {
    const PNG_BYTES = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      // A minimal valid-ish payload; the signature check only inspects the
      // first 8 bytes.
    ]);

    it('renders a model job via the offscreen renderer and stores the artifact', async () => {
      const root = temporaryRoot();
      const service = new LibraryService();
      const created = service.createLibrary({ displayName: 'Models', selectedParentPath: root });

      importNoConflict(service, created.libraryId, createSourceFile(root, 'robot.glb'));
      const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;
      service.enqueueThumbnailJobs(created.libraryId, { assetIds: [asset.assetId], limit: 50 });

      const results: Array<{ assetId: string; artifactId?: string; errorCode?: string }> = [];
      const rendererInputs: Array<Record<string, unknown>> = [];
      const processed = await service.processThumbnailQueue(created.libraryId, {
        maxJobs: 1,
        onResult: (result) => results.push(result),
        modelThumbnailRenderer: async (input) => {
          rendererInputs.push({ ...input });
          return { status: 'ok', pngBytes: PNG_BYTES, width: 512, height: 512 };
        },
      });
      expect(processed).toBe(1);

      // The renderer received the job context (no paths leak into the payload
      // beyond the library-relative file name).
      expect(rendererInputs[0]).toMatchObject({
        libraryId: created.libraryId,
        assetId: asset.assetId,
        revisionId: asset.currentRevisionId,
        relativeFilePath: 'robot.glb',
      });

      // The artifact is the standard thumbnail kind, PNG, tagged offscreen-webgl-1.
      const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
      const artifact = db.prepare(
        `SELECT kind, mime_type, byte_size, width, height, status, generator_version
           FROM revision_artifacts WHERE revision_id = ?`,
      ).get(asset.currentRevisionId) as Record<string, unknown>;
      expect(artifact).toMatchObject({
        kind: 'thumbnail',
        mime_type: 'image/png',
        byte_size: PNG_BYTES.byteLength,
        width: 512,
        height: 512,
        status: 'ready',
        generator_version: 'offscreen-webgl-1',
      });
      db.close();

      // The ready event flows to the renderer and the summary shows ready.
      expect(results).toEqual([{ assetId: asset.assetId, artifactId: expect.any(String) }]);
      const listed = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;
      expect(listed.thumbnailStatus).toBe('ready');
      expect(listed.thumbnailArtifactId).toBeTruthy();

      service.closeAll();
    });

    it('does not re-enqueue a model whose thumbnail is already ready', async () => {
      const root = temporaryRoot();
      const service = new LibraryService();
      const created = service.createLibrary({ displayName: 'Models', selectedParentPath: root });

      importNoConflict(service, created.libraryId, createSourceFile(root, 'robot.glb'));
      const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;
      service.enqueueThumbnailJobs(created.libraryId, { assetIds: [asset.assetId], limit: 50 });

      await service.processThumbnailQueue(created.libraryId, {
        maxJobs: 1,
        modelThumbnailRenderer: async () => ({ status: 'ok', pngBytes: PNG_BYTES, width: 512, height: 512 }),
      });
      expect(service.enqueueThumbnailJobs(created.libraryId, { assetIds: [asset.assetId] })).toBe(0);

      service.closeAll();
    });

    it('records a typed failure artifact and benign error code when the render fails', async () => {
      const root = temporaryRoot();
      const service = new LibraryService();
      const created = service.createLibrary({ displayName: 'Models', selectedParentPath: root });

      importNoConflict(service, created.libraryId, createSourceFile(root, 'robot.glb'));
      const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;
      service.enqueueThumbnailJobs(created.libraryId, { assetIds: [asset.assetId], limit: 50 });

      const results: Array<{ assetId: string; artifactId?: string; errorCode?: string }> = [];
      await service.processThumbnailQueue(created.libraryId, {
        maxJobs: 1,
        onResult: (result) => results.push(result),
        modelThumbnailRenderer: async () => ({
          status: 'failed',
          errorCode: 'MODEL_RENDER_TIMEOUT',
          reason: 'no frame',
        }),
      });

      // Failed artifact dedupes the queue and feeds the thumbnailStatus map;
      // the published code is benign (card keeps the generic 3D icon).
      expect(results).toEqual([{ assetId: asset.assetId, errorCode: 'MODEL_RENDER_TIMEOUT' }]);
      const listed = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;
      expect(listed.thumbnailStatus).toBe('failed');
      expect(service.enqueueThumbnailJobs(created.libraryId, { assetIds: [asset.assetId] })).toBe(0);

      const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
      const job = db.prepare('SELECT status, error_code FROM jobs WHERE asset_id = ?').get(asset.assetId) as {
        status: string;
        error_code: string | null;
      };
      expect(job.status).toBe('failed');
      expect(job.error_code).toBe('MODEL_RENDER_TIMEOUT');
      db.close();

      service.closeAll();
    });

    it('keeps the legacy benign no-op when no renderer is wired', async () => {
      const root = temporaryRoot();
      const service = new LibraryService();
      const created = service.createLibrary({ displayName: 'Models', selectedParentPath: root });

      importNoConflict(service, created.libraryId, createSourceFile(root, 'robot.glb'));
      const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;
      service.enqueueThumbnailJobs(created.libraryId, { assetIds: [asset.assetId], limit: 50 });

      const processed = await service.processThumbnailQueue(created.libraryId, { maxJobs: 1 });
      expect(processed).toBe(1);

      const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
      const artifactCount = db.prepare('SELECT COUNT(*) AS n FROM revision_artifacts').get() as { n: number };
      expect(artifactCount.n).toBe(0);
      db.close();

      const listed = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;
      expect(listed.thumbnailStatus).toBeNull();
      expect(listed.thumbnailArtifactId).toBeNull();

      service.closeAll();
    });

    it('refuses oversized models with MODEL_TOO_LARGE (spec 3D-14)', async () => {
      const root = temporaryRoot();
      const service = new LibraryService();
      const created = service.createLibrary({ displayName: 'Models', selectedParentPath: root });

      const hugePath = createSourceFile(root, 'huge.glb');
      // 300 MB cap + 1 byte.
      const huge = Buffer.alloc(300 * 1024 * 1024 + 1, 0);
      writeFileSync(hugePath, huge);
      importNoConflict(service, created.libraryId, hugePath);
      const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;
      service.enqueueThumbnailJobs(created.libraryId, { assetIds: [asset.assetId], limit: 50 });

      const rendererCalled = new Set<string>();
      await service.processThumbnailQueue(created.libraryId, {
        maxJobs: 1,
        modelThumbnailRenderer: async (input) => {
          rendererCalled.add(input.assetId);
          return { status: 'ok', pngBytes: PNG_BYTES, width: 512, height: 512 };
        },
      });

      // The renderer never saw the job; the failed artifact carries the code.
      expect(rendererCalled.size).toBe(0);
      const listed = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;
      expect(listed.thumbnailStatus).toBe('failed');

      service.closeAll();
    });

    it('discards a late render result when the job is cancelled mid-render', async () => {
      const root = temporaryRoot();
      const service = new LibraryService();
      const created = service.createLibrary({ displayName: 'Models', selectedParentPath: root });

      importNoConflict(service, created.libraryId, createSourceFile(root, 'robot.glb'));
      const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;
      service.enqueueThumbnailJobs(created.libraryId, { assetIds: [asset.assetId], limit: 50 });

      let rendererCalled = false;
      let releaseRenderer!: (result: { status: 'ok'; pngBytes: Uint8Array; width: number; height: number }) => void;
      const renderGate = new Promise<{ status: 'ok'; pngBytes: Uint8Array; width: number; height: number }>((resolve) => {
        releaseRenderer = resolve;
      });
      const processing = service.processThumbnailQueue(created.libraryId, {
        maxJobs: 1,
        modelThumbnailRenderer: async () => {
          rendererCalled = true;
          // The render stays in flight until the test releases it.
          return renderGate;
        },
      });

      // Let the job claim, then cancel the media job while the render is in
      // flight (cancelMediaJobs is the media-queue cancel path; cancelJobs is
      // AI-only).
      await vi.waitFor(() => expect(rendererCalled).toBe(true));
      service.cancelMediaJobs(created.libraryId);
      releaseRenderer({ status: 'ok', pngBytes: PNG_BYTES, width: 512, height: 512 });
      await processing;

      const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
      // The late frame must not leave any artifact behind (the queue deletes
      // late artifacts on cancellation).
      const artifactCount = db.prepare(
        'SELECT COUNT(*) AS n FROM revision_artifacts WHERE revision_id = ?',
      ).get(asset.currentRevisionId) as { n: number };
      expect(artifactCount.n).toBe(0);
      db.close();

      service.closeAll();
    });
  });


  describe('model AI four-view sheet (Serpent-6w40)', () => {
    const PNG_BYTES = new Uint8Array(VALID_1X1_PNG);

    it('renders four views and tiles them into a sheet', async () => {
      const root = temporaryRoot();
      const service = new LibraryService();
      const created = service.createLibrary({ displayName: 'ModelsAI', selectedParentPath: root });
      importNoConflict(service, created.libraryId, createSourceFile(root, 'robot.glb'));
      const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;

      const viewsSeen: Array<readonly [number, number, number]> = [];
      const sheet = await service.renderModelViewsSheet(
        { libraryId: created.libraryId, assetId: asset.assetId },
        new AbortController().signal,
        {
          modelAiViewsRenderer: async (input) => {
            viewsSeen.push(...(input.views ?? []));
            return {
              status: 'ok',
              frames: (input.views ?? []).map((view) => ({
                view: [view[0], view[1], view[2]] as [number, number, number],
                pngBytes: PNG_BYTES,
                width: 512,
                height: 512,
              })),
            };
          },
        },
      );

      expect(viewsSeen).toHaveLength(4);
      expect(sheet.mime).toBe('image/png');
      expect(sheet.pngBytes.byteLength).toBeGreaterThan(8);
      service.closeAll();
    });
  });


  describe('resolveModelCompanions', () => {
    it('returns an empty payload when the model directory holds only the model', () => {
      const root = temporaryRoot();
      const service = new LibraryService();
      const created = service.createLibrary({ displayName: 'Models', selectedParentPath: root });

      importNoConflict(service, created.libraryId, createSourceFile(root, 'solo/robot.fbx'));
      const model = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;

      expect(service.resolveModelCompanions({ libraryId: created.libraryId, assetId: model.assetId }))
        .toEqual([]);

      service.closeAll();
    });

    it('lists same-directory and recursive subdirectory companions with relative paths', () => {
      const root = temporaryRoot();
      const service = new LibraryService();
      const created = service.createLibrary({ displayName: 'Models', selectedParentPath: root });

      // The imported folder keeps its own name as the library-root prefix.
      const sourceDir = path.join(root, 'props');
      createSourceFile(sourceDir, 'robot.fbx');
      createSourceFile(sourceDir, 'robot.mtl');
      createSourceFile(sourceDir, 'robot.fbm/albedo.png');
      createSourceFile(sourceDir, 'robot.fbm/normal.jpg');
      importFolderNoConflict(service, created.libraryId, sourceDir);

      const model = service.listAssets({ libraryId: created.libraryId, recursive: true })
        .find((a) => a.displayName === 'robot.fbx')!;
      const companions = service.resolveModelCompanions({
        libraryId: created.libraryId,
        assetId: model.assetId,
      });

      expect(companions).toHaveLength(3);
      expect(companions).toEqual(expect.arrayContaining([
        expect.objectContaining({ relativeFilePath: 'props/robot.mtl', extension: '.mtl' }),
        expect.objectContaining({ relativeFilePath: 'props/robot.fbm/albedo.png', extension: '.png' }),
        expect.objectContaining({ relativeFilePath: 'props/robot.fbm/normal.jpg', extension: '.jpg' }),
      ]));
      for (const companion of companions) {
        expect(companion.assetId).toBeTruthy();
        // Relative POSIX paths only — no absolute path or traversal may leak.
        expect(companion.relativeFilePath).not.toMatch(/^[/\\]|^[A-Za-z]:/u);
        expect(companion.relativeFilePath).not.toContain('\\');
        expect(companion.relativeFilePath).not.toMatch(/(^|\/)\.\.(\/|$)/u);
      }

      service.closeAll();
    });

    it('never returns assets outside the model directory (out-of-bounds rejection)', () => {
      const root = temporaryRoot();
      const service = new LibraryService();
      const created = service.createLibrary({ displayName: 'Models', selectedParentPath: root });

      const sourceDir = path.join(root, 'tree');
      createSourceFile(sourceDir, 'a/robot.fbx');
      createSourceFile(sourceDir, 'a/b/albedo.png');
      createSourceFile(sourceDir, 'a_b/neighbor.png');
      createSourceFile(sourceDir, 'other/outside.png');
      createSourceFile(sourceDir, 'root-level.png');
      importFolderNoConflict(service, created.libraryId, sourceDir);

      const model = service.listAssets({ libraryId: created.libraryId, recursive: true })
        .find((a) => a.displayName === 'robot.fbx')!;
      const companions = service.resolveModelCompanions({
        libraryId: created.libraryId,
        assetId: model.assetId,
      });

      const paths = companions.map((c) => c.relativeFilePath);
      expect(paths).toEqual(['tree/a/b/albedo.png']);
      // LIKE-prefix containment must not over-match sibling names (a_b),
      // parents, or the library root.
      expect(paths).not.toContain('a_b/neighbor.png');
      expect(paths).not.toContain('other/outside.png');
      expect(paths).not.toContain('root-level.png');
      expect(paths).not.toContain('a/robot.fbx');

      service.closeAll();
    });

    it('resolves companions for root-level models', () => {
      const root = temporaryRoot();
      const service = new LibraryService();
      const created = service.createLibrary({ displayName: 'Models', selectedParentPath: root });

      const sourceDir = path.join(root, 'flat');
      createSourceFile(sourceDir, 'robot.obj');
      createSourceFile(sourceDir, 'robot.mtl');
      createSourceFile(sourceDir, 'sub/other.png');
      importFolderNoConflict(service, created.libraryId, sourceDir);

      const model = service.listAssets({ libraryId: created.libraryId, recursive: true })
        .find((a) => a.displayName === 'robot.obj')!;
      const companions = service.resolveModelCompanions({
        libraryId: created.libraryId,
        assetId: model.assetId,
      });
      // The imported folder keeps its name as the library-root prefix; the
      // model's directory is flat/, so the subdirectory asset is included
      // (recursive companion scope), sorted by path.
      expect(companions.map((c) => c.relativeFilePath)).toEqual([
        'flat/robot.mtl',
        'flat/sub/other.png',
      ]);

      service.closeAll();
    });

    it('rejects non-model assets and unknown asset ids', () => {
      const root = temporaryRoot();
      const service = new LibraryService();
      const created = service.createLibrary({ displayName: 'Models', selectedParentPath: root });

      importNoConflict(service, created.libraryId, createSourceFile(root, 'notes.txt'));
      const textAsset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;

      let caught: unknown;
      try {
        service.resolveModelCompanions({
          libraryId: created.libraryId,
          assetId: textAsset.assetId,
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(LibraryServiceError);
      expect((caught as LibraryServiceError).code).toBe('INVALID_IMPORT_DECISION');
      expect((caught as LibraryServiceError).reason).toBe('UNSUPPORTED_FORMAT');

      expect(() => service.resolveModelCompanions({
        libraryId: created.libraryId,
        assetId: 'does-not-exist',
      })).toThrowError('ASSET_NOT_FOUND');

      service.closeAll();
    });
  });
});
