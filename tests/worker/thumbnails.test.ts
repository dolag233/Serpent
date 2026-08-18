import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const extractAuthorFromExifMock = vi.hoisted(() => vi.fn(async () => null as string | null));
vi.mock('../../src/worker/author-from-exif', () => ({
  extractAuthorFromExif: extractAuthorFromExifMock,
}));

import {
  LibraryService,
  LibraryServiceError,
  SUPPORTED_SCHEMA_VERSION,
  THUMBNAIL_VISIBLE_PAGE_SIZE,
} from '../../src/worker/library-service';
import { workerMediaDecodeConcurrency } from '../../src/worker/media-concurrency';
import { importNoConflict as sharedImportNoConflict } from './import-no-conflict';

const temporaryRoots: string[] = [];
const require = createRequire(import.meta.url);

interface TestDatabaseConnection {
  close(): void;
  exec(source: string): void;
  pragma(source: string, options?: { simple?: boolean }): unknown;
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
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-thumbnail-'));
  temporaryRoots.push(root);
  return root;
}

// Valid 1x1 white PNG bytes (pre-computed)
const VALID_1X1_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64',
);

function createTestImage(destPath: string): void {
  mkdirSync(path.dirname(destPath), { recursive: true });
  writeFileSync(destPath, VALID_1X1_PNG);
}

function createCorruptImage(destPath: string): void {
  mkdirSync(path.dirname(destPath), { recursive: true });
  writeFileSync(destPath, Buffer.from('this is not an image', 'utf-8'));
}

async function createPngBytes(width: number, height: number): Promise<Buffer> {
  const sharp = require('sharp') as (input: unknown) => {
    png(): { toBuffer(): Promise<Buffer> };
  };
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 40, g: 120, b: 220 },
    },
  }).png().toBuffer();
}

function importNoConflict(service: LibraryService, libraryId: string, sourcePath: string): void {
  sharedImportNoConflict(service, libraryId, sourcePath);
}

afterEach(() => {
  extractAuthorFromExifMock.mockReset();
  extractAuthorFromExifMock.mockResolvedValue(null);
  for (const root of temporaryRoots.splice(0)) {
    try {
      rmSync(root, { force: true, recursive: true });
    } catch {
      // Cleanup is best-effort.
    }
  }
});

describe('schema v9 migration', () => {
  it('creates revision_artifacts and jobs tables', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'V9', selectedParentPath: root });

    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(db.pragma('user_version', { simple: true })).toBe(SUPPORTED_SCHEMA_VERSION);
    expect(db.pragma('user_version', { simple: true })).toBe(SUPPORTED_SCHEMA_VERSION);

    const revArtifactCols = (db.prepare("PRAGMA table_info('revision_artifacts')").all() as Array<{ name: string }>).map((c) => c.name);
    expect(revArtifactCols).toContain('artifact_id');
    expect(revArtifactCols).toContain('revision_id');
    expect(revArtifactCols).toContain('kind');
    expect(revArtifactCols).toContain('status');
    expect(revArtifactCols).toContain('file_path');
    expect(revArtifactCols).toContain('generator_version');
    expect(revArtifactCols).toContain('invalidated_at');
    expect(revArtifactCols).toContain('duration_ms');
    expect(revArtifactCols).toContain('dominant_hue');
    expect(revArtifactCols).toContain('dominant_lightness');

    const jobsCols = (db.prepare("PRAGMA table_info('jobs')").all() as Array<{ name: string }>).map((c) => c.name);
    expect(jobsCols).toContain('job_id');
    expect(jobsCols).toContain('asset_id');
    expect(jobsCols).toContain('kind');
    expect(jobsCols).toContain('status');
    expect(jobsCols).toContain('priority');

    db.close();
    service.closeAll();
  });

  it('has unique index on revision_artifacts_current', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Idx', selectedParentPath: root });

    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'revision_artifacts_current'").all() as Array<{ name: string }>);
    expect(indexes).toHaveLength(1);

    db.close();
    service.closeAll();
  });

  it('creates .serpent/artifacts directory', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Artifacts', selectedParentPath: root });

    expect(existsSync(path.join(created.libraryPath, '.serpent', 'artifacts'))).toBe(true);

    service.closeAll();
  });

  it('has jobs_library_status_priority index', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'JobIdx', selectedParentPath: root });

    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'jobs_library_status_priority'").all() as Array<{ name: string }>);
    expect(indexes).toHaveLength(1);

    db.close();
    service.closeAll();
  });
});

describe('detectMediaType', () => {
  it('detects product image types, including OIIO and RAW derivatives', () => {
    for (const filename of [
      'photo.png', 'photo.jpeg', 'photo.gif', 'photo.webp', 'photo.bmp',
      'photo.tiff', 'photo.tga', 'photo.exr', 'photo.ico', 'layer.psd',
      'camera.dng', 'camera.cr2', 'camera.cr3', 'camera.nef', 'camera.arw',
      'camera.raf', 'camera.orf', 'camera.rw2',
    ]) {
      expect(LibraryService.detectMediaType(filename)).toBe('image');
    }
  });

  it('detects video types', () => {
    for (const filename of [
      'video.mp4', 'video.mov', 'video.avi', 'video.wmv', 'video.webm',
      'video.mkv', 'video.m4v',
    ]) {
      expect(LibraryService.detectMediaType(filename)).toBe('video');
    }
  });

  it('returns other only for unknown extensions', () => {
    expect(LibraryService.detectMediaType('file.xyz')).toBe('other');
  });
});

describe('generateThumbnail (sharp)', () => {
  it('uses a bounded plugin artifact from the media queue before native decoding', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'PluginMedia', selectedParentPath: root });
    const sourcePath = path.join(root, 'broken.png');
    createCorruptImage(sourcePath);
    importNoConflict(service, created.libraryId, sourcePath);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;
    const pluginBytes = VALID_1X1_PNG.toString('base64');

    service.enqueueThumbnailJobs(created.libraryId);
    let thumbnailResult: { width?: number; height?: number } | undefined;
    expect(await service.processThumbnailQueue(created.libraryId, {
      maxJobs: 1,
      onResult: (result) => {
        thumbnailResult = result;
      },
      pluginMediaProvider: async ({ assetId }) =>
        (await service.writePluginMediaArtifact({
          libraryId: created.libraryId,
          assetId,
          mimeType: 'image/png',
          bytesBase64: pluginBytes,
          providerId: 'probe-thumbnail',
        })).artifactId,
    })).toBe(1);
    expect(thumbnailResult).toMatchObject({ width: 1, height: 1 });

    const artifact = service.getCurrentArtifact(created.libraryId, asset.assetId, 'thumbnail');
    expect(artifact).toMatchObject({
      status: 'ready',
      mimeType: 'image/png',
      generatorVersion: 'plugin:probe-thumbnail',
      width: 1,
      height: 1,
    });
    expect(readFileSync(service.getArtifactAbsolutePath(created.libraryId, artifact!.artifactId)))
      .toEqual(VALID_1X1_PNG);
    service.closeAll();
  });

  it('serves a plugin image artifact for an otherwise unsupported preview', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'PluginPreview', selectedParentPath: root });
    const sourcePath = path.join(root, 'sample.probe');
    writeFileSync(sourcePath, 'plugin-owned-source');
    importNoConflict(service, created.libraryId, sourcePath);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;

    const artifact = await service.writePluginMediaArtifact({
      libraryId: created.libraryId,
      assetId: asset.assetId,
      mimeType: 'image/png',
      bytesBase64: VALID_1X1_PNG.toString('base64'),
      providerId: 'probe-preview',
    });

    expect(service.getPreviewArtifact(created.libraryId, asset.assetId)).toMatchObject({
      mediaType: 'image',
      status: 'ready',
      artifactId: artifact.artifactId,
      mimeType: 'image/png',
    });
    service.closeAll();
  });

  it('generates a JPEG thumbnail for an opaque PNG asset (Serpent-thumb-perf)', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'PNG', selectedParentPath: root });

    const sourcePath = path.join(root, 'test.png');
    writeFileSync(sourcePath, await createPngBytes(2048, 1024));
    importNoConflict(service, created.libraryId, sourcePath);

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    expect(assets).toHaveLength(1);

    const result = (await service.generateThumbnail({ libraryId: created.libraryId, assetId: assets[0]!.assetId }))!;
    expect(result.artifactId).toBeTruthy();

    // Opaque sources encode as JPEG now — several times faster than WebP.
    const artifactPath = path.join(created.libraryPath, '.serpent', 'artifacts', `${result.artifactId}.jpg`);
    expect(existsSync(artifactPath)).toBe(true);

    // Verify revision_artifacts row
    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const row = db.prepare('SELECT kind, status, mime_type, generator_version FROM revision_artifacts WHERE artifact_id = ?').get(result.artifactId) as { kind: string; status: string; mime_type: string; generator_version: string };
    expect(row.kind).toBe('thumbnail');
    expect(row.status).toBe('ready');
    expect(row.mime_type).toBe('image/jpeg');
    expect(row.generator_version).toContain('sharp@');
    db.close();

    const refreshed = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;
    expect(refreshed).toMatchObject({ width: 2048, height: 1024 });

    service.closeAll();
  });

  it('keeps WebP for an alpha PNG so transparency survives (Serpent-thumb-perf)', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'AlphaPNG', selectedParentPath: root });
    const sharp = require('sharp') as (input: {
      create: { width: number; height: number; channels: number; background: Record<string, number> };
    }) => { png(): { toFile(path: string): Promise<unknown> } };
    const sourcePath = path.join(root, 'alpha.png');
    await sharp({
      create: {
        width: 64,
        height: 48,
        channels: 4,
        background: { r: 10, g: 20, b: 30, alpha: 0.4 },
      },
    }).png().toFile(sourcePath);
    importNoConflict(service, created.libraryId, sourcePath);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;
    const result = (await service.generateThumbnail({ libraryId: created.libraryId, assetId: asset.assetId }))!;
    const webpPath = path.join(created.libraryPath, '.serpent', 'artifacts', `${result.artifactId}.webp`);
    expect(existsSync(webpPath)).toBe(true);
    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const row = db.prepare('SELECT mime_type FROM revision_artifacts WHERE artifact_id = ?').get(result.artifactId) as { mime_type: string };
    db.close();
    expect(row.mime_type).toBe('image/webp');
    service.closeAll();
  });

  it('refreshes source dimensions after plugin-style content replacement', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'ReplaceDimensions', selectedParentPath: root });
    const sourcePath = path.join(root, 'upscale.png');
    writeFileSync(sourcePath, await createPngBytes(256, 128));
    importNoConflict(service, created.libraryId, sourcePath);

    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;
    await service.generateThumbnail({ libraryId: created.libraryId, assetId: asset.assetId });
    expect(service.listAssets({ libraryId: created.libraryId, recursive: true })[0])
      .toMatchObject({ width: 256, height: 128 });

    const upscaled = await createPngBytes(2048, 1024);
    const replacement = service.replaceManagedAssetContent({
      libraryId: created.libraryId,
      assetId: asset.assetId,
      dataBase64: upscaled.toString('base64'),
      expectedRevisionId: asset.currentRevisionId,
    });
    expect(replacement.byteSize).toBe(upscaled.byteLength);

    expect(await service.processThumbnailQueue(created.libraryId, { maxJobs: 1 })).toBe(1);
    expect(service.listAssets({ libraryId: created.libraryId, recursive: true })[0])
      .toMatchObject({
        currentRevisionId: replacement.revisionId,
        byteSize: upscaled.byteLength,
        width: 2048,
        height: 1024,
      });

    service.closeAll();
  });

  it('auto-orients EXIF orientation 6 and writes an sRGB thumbnail', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Orientation', selectedParentPath: root });
    const sourcePath = path.join(root, 'portrait.jpg');
    const sharp = require('sharp') as (input: unknown) => {
      jpeg(): { withMetadata(metadata: { orientation: number }): { toFile(path: string): Promise<unknown> } };
    };
    await sharp({
      create: {
        width: 40,
        height: 20,
        channels: 3,
        background: { r: 200, g: 40, b: 20 },
      },
    }).jpeg().withMetadata({ orientation: 6 }).toFile(sourcePath);
    importNoConflict(service, created.libraryId, sourcePath);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;

    const result = (await service.generateThumbnail({
      libraryId: created.libraryId,
      assetId: asset.assetId,
    }))!;
    const artifactPath = path.join(
      created.libraryPath,
      '.serpent',
      'artifacts',
      `${result.artifactId}.jpg`,
    );
    const metadata = await (require('sharp') as (input: string) => {
      metadata(): Promise<{ width?: number; height?: number; orientation?: number; space?: string }>;
    })(artifactPath).metadata();
    expect(metadata.width).toBe(20);
    expect(metadata.height).toBe(40);
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.space).toBe('srgb');

    service.closeAll();
  });

  it('generates a JPEG thumbnail for a JPEG asset (Serpent-thumb-perf)', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'JPEG', selectedParentPath: root });

    // A real opaque JPEG (the old fixture wrote RGBA PNG bytes with a .jpg
    // name, which reads as an alpha image and would take the webp path).
    const sharp = require('sharp') as (input: {
      create: { width: number; height: number; channels: number; background: Record<string, number> };
    }) => { jpeg(): { toFile(path: string): Promise<unknown> } };
    const sourcePath = path.join(root, 'test.jpg');
    await sharp({
      create: {
        width: 32,
        height: 24,
        channels: 3,
        background: { r: 120, g: 80, b: 40 },
      },
    }).jpeg().toFile(sourcePath);
    importNoConflict(service, created.libraryId, sourcePath);

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    const result = (await service.generateThumbnail({ libraryId: created.libraryId, assetId: assets[0]!.assetId }))!;
    expect(result.artifactId).toBeTruthy();
    expect(existsSync(path.join(created.libraryPath, '.serpent', 'artifacts', `${result.artifactId}.jpg`))).toBe(true);

    service.closeAll();
  });

  it('recovers a truncated JPEG through the bundled FFmpeg fallback', async () => {
    const root = temporaryRoot();
    const service = new LibraryService({
      sharpFn: () => ({
        async metadata() {
          throw new Error('sharp rejected truncated JPEG');
        },
        rotate() { return this; },
        toColourspace() { return this; },
        resize() { return this; },
        composite() { return this; },
        webp() { return this; },
        jpeg() { return this; },
        async toFile() { throw new Error('sharp output should not be used'); },
      }),
      spawnFn: async (_command, args) => {
        const outputPath = args.at(-1)!;
        writeFileSync(outputPath, VALID_1X1_PNG);
        return { stdout: Buffer.alloc(0), stderr: '', exitCode: 0 };
      },
    });
    const created = service.createLibrary({ displayName: 'TruncatedJPEG', selectedParentPath: root });
    const sourcePath = path.join(root, 'truncated.jpg');
    // The decoder seam is the focus of this test; the mock FFmpeg output
    // represents the recoverable scanlines of a real truncated JPEG.
    writeFileSync(sourcePath, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]));
    importNoConflict(service, created.libraryId, sourcePath);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;

    const result = await service.generateThumbnail({
      libraryId: created.libraryId,
      assetId: asset.assetId,
    });
    expect(result?.artifactId).toBeTruthy();
    expect(service.getCurrentArtifact(created.libraryId, asset.assetId, 'thumbnail'))
      .toMatchObject({
        status: 'ready',
        mimeType: 'image/webp',
        generatorVersion: expect.stringContaining('truncated-jpeg-recovery'),
      });

    service.closeAll();
  });

  it('sets status=failed for corrupt images', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Corrupt', selectedParentPath: root });

    const sourcePath = path.join(root, 'corrupt.png');
    createCorruptImage(sourcePath);
    importNoConflict(service, created.libraryId, sourcePath);

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    expect(assets).toHaveLength(1);

    await expect(
      service.generateThumbnail({ libraryId: created.libraryId, assetId: assets[0]!.assetId }),
    ).rejects.toBeInstanceOf(LibraryServiceError);

    // Verify failed artifact exists
    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const row = db.prepare("SELECT status, error_code FROM revision_artifacts WHERE revision_id = ? AND kind = 'thumbnail'").get(assets[0]!.currentRevisionId) as { status: string; error_code: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.status).toBe('failed');
    db.close();

    service.closeAll();
  });

  it('rejects video generation when FFmpeg is missing without returning an empty artifact ID', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Video', selectedParentPath: root });

    const sourcePath = path.join(root, 'video.mp4');
    writeFileSync(sourcePath, Buffer.alloc(1024, 0));
    importNoConflict(service, created.libraryId, sourcePath);

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    await expect(service.generateThumbnail({
      libraryId: created.libraryId,
      assetId: assets[0]!.assetId,
    })).rejects.toMatchObject({ reason: 'MEDIA_PROCESSING_FAILED' });

    // Verify failed artifacts were created
    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const failedCount = db.prepare("SELECT COUNT(*) AS count FROM revision_artifacts WHERE revision_id = ? AND status = 'failed'").get(assets[0]!.currentRevisionId) as { count: number };
    expect(failedCount.count).toBeGreaterThan(0);
    db.close();

    service.closeAll();
  });

  it('rejects EXR assets when oiiotool is missing and writes failed artifact', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'EXR', selectedParentPath: root });

    const sourcePath = path.join(root, 'render.exr');
    writeFileSync(sourcePath, Buffer.alloc(1024, 0));
    importNoConflict(service, created.libraryId, sourcePath);

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    await expect(
      service.generateThumbnail({ libraryId: created.libraryId, assetId: assets[0]!.assetId }),
    ).rejects.toThrow();

    service.closeAll();
  });

  it('handles non-existent asset gracefully', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'NAsset', selectedParentPath: root });

    await expect(
      service.generateThumbnail({ libraryId: created.libraryId, assetId: 'nonexistent-id' }),
    ).rejects.toThrow();

    service.closeAll();
  });
});

describe('getThumbnailArtifact', () => {
  it('returns null when no thumbnail exists', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'NoThumb', selectedParentPath: root });

    const sourcePath = path.join(root, 'test.png');
    createTestImage(sourcePath);
    importNoConflict(service, created.libraryId, sourcePath);

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    expect(service.getThumbnailArtifact(created.libraryId, assets[0]!.assetId)).toBeNull();

    service.closeAll();
  });

  it('returns artifact info after generation', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'WithThumb', selectedParentPath: root });

    const sourcePath = path.join(root, 'test.png');
    createTestImage(sourcePath);
    importNoConflict(service, created.libraryId, sourcePath);

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    await service.generateThumbnail({ libraryId: created.libraryId, assetId: assets[0]!.assetId });

    const artifact = service.getThumbnailArtifact(created.libraryId, assets[0]!.assetId);
    expect(artifact).toBeTruthy();
    expect(artifact!.artifactId).toBeTruthy();
    expect(artifact!.filePath).toBeTruthy();

    service.closeAll();
  });

  it('returns a ready video poster as the card image artifact for native drag previews', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'VideoPoster', selectedParentPath: root });
    const sourcePath = path.join(root, 'test.mp4');
    writeFileSync(sourcePath, Buffer.alloc(1024, 0));
    importNoConflict(service, created.libraryId, sourcePath);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;
    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const posterPath = path.join(created.libraryPath, '.serpent', 'artifacts', 'drag-poster.jpg');
    createTestImage(posterPath);
    db.prepare(
      `INSERT INTO revision_artifacts
         (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
          generator_version, status, generated_at)
       VALUES (?, ?, 'video_poster', 'image/jpeg', ?, ?, 'test', 'ready', ?)`,
    ).run(
      'poster-for-drag',
      asset.currentRevisionId,
      readFileSync(posterPath).byteLength,
      'drag-poster.jpg',
      new Date().toISOString(),
    );
    db.close();

    expect(service.getThumbnailArtifact(created.libraryId, asset.assetId)).toMatchObject({
      artifactId: 'poster-for-drag',
      filePath: 'drag-poster.jpg',
    });
    expect(service.getArtifactAbsolutePath(
      created.libraryId,
      'poster-for-drag',
      'preview',
    )).toBe(posterPath);

    service.closeAll();
  });

  it('invalidates old artifacts on content change', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Invalidate', selectedParentPath: root });

    const assetPath = path.join(root, 'inval.png');
    createTestImage(assetPath);
    importNoConflict(service, created.libraryId, assetPath);

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    await service.generateThumbnail({ libraryId: created.libraryId, assetId: assets[0]!.assetId });

    const oldArtifact = service.getThumbnailArtifact(created.libraryId, assets[0]!.assetId);
    expect(oldArtifact).toBeTruthy();

    // Modify the file inside the library's Assets directory (where refreshManagedAssets scans)
    const managedAssetPath = service.resolveAssetPath(created.libraryId, assets[0]!.assetId);
    writeFileSync(managedAssetPath, Buffer.concat([VALID_1X1_PNG, Buffer.from('extra content')]));

    service.refreshManagedAssets(created.libraryId);

    // Old artifact should be invalidated
    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const oldRow = db.prepare('SELECT invalidated_at FROM revision_artifacts WHERE artifact_id = ?').get(oldArtifact!.artifactId) as { invalidated_at: string | null } | undefined;
    expect(oldRow).toBeTruthy();
    expect(oldRow!.invalidated_at).toBeTruthy();

    // A new thumbnail job should be queued
    const queuedJobs = db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE asset_id = ? AND kind = 'generate_thumbnail' AND status = 'queued'").get(assets[0]!.assetId) as { count: number };
    expect(queuedJobs.count).toBeGreaterThanOrEqual(1);
    db.close();

    service.closeAll();
  });
});

describe('preview availability while derivatives are generated', () => {
  it('serves a native image source immediately while its thumbnail job is queued', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'ImmediateImagePreview', selectedParentPath: root });
    const sourcePath = path.join(root, 'portrait.png');
    createTestImage(sourcePath);
    importNoConflict(service, created.libraryId, sourcePath);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;

    expect(service.enqueueThumbnailJobs(created.libraryId)).toBe(1);
    expect(service.getPreviewArtifact(created.libraryId, asset.assetId)).toMatchObject({
      mediaType: 'image',
      status: 'ready',
      playbackMode: 'source',
      sourceRevisionId: asset.currentRevisionId,
      sourceMimeType: 'image/png',
    });
    expect(service.getCurrentMediaSource(
      created.libraryId,
      asset.assetId,
      asset.currentRevisionId,
    )).toMatchObject({ mimeType: 'image/png' });

    service.closeAll();
  });

  it('keeps a generating video proxy untouched while mounting the source first', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({
      displayName: 'ImmediateVideoPreview',
      selectedParentPath: root,
    });
    const sourcePath = path.join(root, 'clip.mp4');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(service, created.libraryId, sourcePath);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;

    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    db.prepare(
      `INSERT INTO revision_artifacts
         (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
          generator_version, status, generated_at)
       VALUES (?, ?, 'webm_proxy', 'video/webm', 0, ?, 'test', 'generating', ?)`,
    ).run(
      'art-generating-proxy',
      asset.currentRevisionId,
      'artifacts/pending-proxy.webm',
      new Date().toISOString(),
    );
    db.close();

    // Serpent-cljb: even an existing in-flight proxy must not steal playback
    // from the original source. The proxy is only a fallback after a real
    // media-element failure.
    expect(service.getPreviewArtifact(created.libraryId, asset.assetId, 'hover')).toMatchObject({
      mediaType: 'video',
      status: 'ready',
      kind: 'webm_proxy',
      mimeType: 'video/mp4',
      playbackMode: 'source',
      sourceRevisionId: asset.currentRevisionId,
    });
    expect(service.getCurrentArtifact(created.libraryId, asset.assetId, 'webm_proxy'))
      .toMatchObject({ status: 'generating', mimeType: 'video/webm' });

    service.closeAll();
  });

  it('keeps a failed video proxy as fallback state while mounting the source first', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({
      displayName: 'FailedProxyFallsToSource',
      selectedParentPath: root,
    });
    const sourcePath = path.join(root, 'clip.mp4');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(service, created.libraryId, sourcePath);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;

    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    db.prepare(
      `INSERT INTO revision_artifacts
         (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
          generator_version, status, error_code, generated_at)
       VALUES (?, ?, 'webm_proxy', 'video/webm', 0, ?, 'test', 'failed', 'MEDIA_PROCESSING_FAILED', ?)`,
    ).run(
      'art-failed-proxy',
      asset.currentRevisionId,
      'artifacts/failed-proxy.webm',
      new Date().toISOString(),
    );
    db.close();

    expect(service.getPreviewArtifact(created.libraryId, asset.assetId, 'hover')).toMatchObject({
      mediaType: 'video',
      status: 'ready',
      kind: 'webm_proxy',
      mimeType: 'video/mp4',
      playbackMode: 'source',
      sourceRevisionId: asset.currentRevisionId,
    });
    expect(service.getCurrentArtifact(created.libraryId, asset.assetId, 'webm_proxy'))
      .toMatchObject({ status: 'failed', errorCode: 'MEDIA_PROCESSING_FAILED' });

    service.closeAll();
  });

  it('queues an Ogg proxy for WAV playback rather than relying on a source codec', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({
      displayName: 'ProxyFirstWav',
      selectedParentPath: root,
    });
    const sourcePath = path.join(root, 'voice.wav');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(service, created.libraryId, sourcePath);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;

    expect(service.getPreviewArtifact(created.libraryId, asset.assetId, 'hover')).toMatchObject({
      mediaType: 'audio',
      status: 'pending',
      kind: 'audio_proxy',
      mimeType: 'audio/ogg',
    });
    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(
      db.prepare(
        "SELECT kind, status FROM jobs WHERE asset_id = ? AND kind = 'generate_audio_proxy'",
      ).get(asset.assetId),
    ).toMatchObject({ kind: 'generate_audio_proxy', status: 'queued' });
    db.close();
    service.closeAll();
  });

  it('marks an unsupported asset without offering a generatable preview', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'UnsupportedPreview', selectedParentPath: root });
    const sourcePath = path.join(root, 'notes.dat');
    writeFileSync(sourcePath, 'plain text');
    importNoConflict(service, created.libraryId, sourcePath);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;

    expect(service.getPreviewArtifact(created.libraryId, asset.assetId)).toMatchObject({
      mediaType: 'other',
      status: 'missing',
      errorCode: 'UNSUPPORTED_FORMAT',
    });
    expect(service.enqueueThumbnailJobs(created.libraryId)).toBe(0);
    service.closeAll();
  });
});

describe('enqueueThumbnailJobs', () => {
  it('enqueues jobs for assets missing thumbnails', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Enqueue', selectedParentPath: root });

    const png1 = path.join(root, 'a.png');
    const png2 = path.join(root, 'b.png');
    createTestImage(png1);
    createTestImage(png2);
    importNoConflict(service, created.libraryId, png1);
    importNoConflict(service, created.libraryId, png2);

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    await service.generateThumbnail({ libraryId: created.libraryId, assetId: assets[0]!.assetId });

    const enqueued = service.enqueueThumbnailJobs(created.libraryId);
    expect(enqueued).toBe(1);

    service.closeAll();
  });

  it('does not enqueue duplicate jobs', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'NoDup', selectedParentPath: root });

    const png = path.join(root, 'nodup.png');
    createTestImage(png);
    importNoConflict(service, created.libraryId, png);

    expect(service.enqueueThumbnailJobs(created.libraryId)).toBe(1);
    expect(service.enqueueThumbnailJobs(created.libraryId)).toBe(0);

    service.closeAll();
  });

  it('limits startup work, skips unsupported assets, and prioritizes an explicit visible range', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'VisibleFirst', selectedParentPath: root });

    const assetIds: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const source = path.join(root, `image-${String.fromCharCode(97 + index)}.png`);
      createTestImage(source);
      importNoConflict(service, created.libraryId, source);
    }
    const unsupported = path.join(root, 'notes.txt');
    writeFileSync(unsupported, 'not media');
    importNoConflict(service, created.libraryId, unsupported);
    assetIds.push(...service.listAssets({ libraryId: created.libraryId, recursive: true })
      .filter((asset) => asset.displayName.endsWith('.png'))
      .map((asset) => asset.assetId));

    // Serpent-xoaz: the background fill drains most-recently-imported assets
    // first (created_at DESC). Stamp distinct import times so the fill picks
    // a deterministic pair regardless of per-import clock granularity.
    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const base = Date.parse('2026-01-01T00:00:00.000Z');
    const stamp = db.prepare('UPDATE assets SET created_at = ? WHERE asset_id = ?');
    assetIds.forEach((assetId, index) => {
      stamp.run(new Date(base + index * 1000).toISOString(), assetId);
    });
    db.close();

    // Startup fill (limit 2) takes the two newest assets (last two imported).
    expect(service.enqueueThumbnailJobs(created.libraryId, { limit: 2 })).toBe(2);
    // The explicit visible range schedules an asset the fill did not pick yet
    // — the oldest one — at a higher priority.
    expect(service.enqueueThumbnailJobs(created.libraryId, {
      assetIds: [assetIds[0]!],
      limit: 1,
      priority: 200,
    })).toBe(1);

    const db2 = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const jobs = db2.prepare(
      "SELECT asset_id, priority FROM jobs WHERE kind = 'generate_thumbnail' ORDER BY priority DESC, created_at",
    ).all() as Array<{ asset_id: string; priority: number }>;
    db2.close();
    expect(jobs).toHaveLength(3);
    expect(jobs[0]).toEqual({ asset_id: assetIds[0], priority: 200 });
    service.closeAll();
  });

  it('queues a missing startup thumbnail when a library is reopened', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'ReopenQueue', selectedParentPath: root });
    const source = path.join(root, 'reopen.png');
    createTestImage(source);
    importNoConflict(service, created.libraryId, source);
    service.closeAll();

    const reopened = service.openLibrary(created.libraryPath);
    const db = new TestDatabase(path.join(reopened.libraryPath, '.serpent', 'library.db'));
    const queued = db.prepare(
      "SELECT COUNT(*) AS count FROM jobs WHERE kind = 'generate_thumbnail' AND status = 'queued'",
    ).get() as { count: number };
    expect(queued.count).toBe(1);
    db.close();
    service.closeAll();
  });
});

describe('processThumbnailQueue', () => {
  it('processes queued jobs', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Process', selectedParentPath: root });

    const png = path.join(root, 'proc.png');
    createTestImage(png);
    importNoConflict(service, created.libraryId, png);

    service.enqueueThumbnailJobs(created.libraryId);
    const processed = await service.processThumbnailQueue(created.libraryId);
    expect(processed).toBe(2);

    // Verify job is succeeded
    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const job = db.prepare("SELECT status FROM jobs WHERE kind = 'generate_thumbnail' LIMIT 1").get() as { status: string } | undefined;
    expect(job).toBeTruthy();
    expect(job!.status).toBe('succeeded');
    db.close();

    service.closeAll();
  });

  it('keeps decoder paths in diagnostics and out of Renderer-visible job details', async () => {
    const root = temporaryRoot();
    const privatePath = path.join(root, 'private-source.png');
    const diagnostics: unknown[] = [];
    const service = new LibraryService({
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      sharpFn: () => ({
        async metadata() { throw new Error(`decoder failed at ${privatePath}`); },
        rotate() { return this; },
        toColourspace() { return this; },
        resize() { return this; },
        composite() { return this; },
        webp() { return this; },
        jpeg() { return this; },
        async toFile() { throw new Error('unreachable'); },
      }),
    });
    const created = service.createLibrary({ displayName: 'SafeMediaFailure', selectedParentPath: root });
    createTestImage(privatePath);
    importNoConflict(service, created.libraryId, privatePath);

    service.enqueueThumbnailJobs(created.libraryId);
    await service.processThumbnailQueue(created.libraryId);

    const failed = service.listMediaJobs(created.libraryId).jobs[0]!;
    expect(failed.status).toBe('failed');
    expect(failed.errorDetail).toContain('local Serpent log');
    expect(failed.errorDetail).not.toContain(root);
    const diagnosticError = (diagnostics[0] as { error?: Error } | undefined)?.error;
    expect(diagnosticError).toBeInstanceOf(Error);
    expect((diagnosticError?.cause as Error | undefined)?.message).toContain(privatePath);
    service.closeAll();
  });

  it('lists and controls media jobs without touching AI jobs', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'MediaControls', selectedParentPath: root });
    const png = path.join(root, 'controls.png');
    createTestImage(png);
    importNoConflict(service, created.libraryId, png);
    expect(service.enqueueThumbnailJobs(created.libraryId)).toBe(1);

    let status = service.listMediaJobs(created.libraryId);
    expect(status.queued).toBe(1);
    expect(status.jobs[0]).toMatchObject({
      kind: 'generate_thumbnail',
      status: 'queued',
      attemptCount: 0,
    });
    const jobId = status.jobs[0]!.jobId;

    expect(service.pauseMediaJobs(created.libraryId, [jobId])).toEqual({ pausedCount: 1 });
    expect(service.resumeMediaJobs(created.libraryId, [jobId])).toEqual({ resumedCount: 1 });
    expect(service.cancelMediaJobs(created.libraryId, [jobId])).toEqual({ cancelledCount: 1 });
    expect(service.listMediaJobs(created.libraryId).cancelled).toBe(1);

    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    db.prepare(
      "UPDATE jobs SET status = 'failed', attempt_count = 2, error_code = 'TEST_FAILURE' WHERE job_id = ?",
    ).run(jobId);
    db.close();
    expect(service.retryMediaJobs(created.libraryId, [jobId])).toEqual({ retriedCount: 1 });
    status = service.listMediaJobs(created.libraryId);
    expect(status.jobs[0]).toMatchObject({
      status: 'queued',
      attemptCount: 0,
      errorCode: null,
    });

    service.closeAll();
  });

  it('backfills EXIF author metadata from a queued thumbnail job', async () => {
    extractAuthorFromExifMock.mockResolvedValue('Queue Author');
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'ExifQueueAuthor', selectedParentPath: root });
    const png = path.join(root, 'author.png');
    createTestImage(png);
    const { assets } = sharedImportNoConflict(service, created.libraryId, png);

    service.enqueueThumbnailJobs(created.libraryId);
    await service.processThumbnailQueue(created.libraryId);

    expect(service.getAssetMetadata({
      libraryId: created.libraryId,
      assetId: assets[0]!.assetId,
    }).author).toBe('Queue Author');
    expect(extractAuthorFromExifMock).toHaveBeenCalledWith(expect.any(String));
    service.closeAll();
  });

  it('recovers running media jobs as queued without resetting attempt_count', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'MediaRecovery', selectedParentPath: root });
    const png = path.join(root, 'recover.png');
    createTestImage(png);
    importNoConflict(service, created.libraryId, png);
    service.enqueueThumbnailJobs(created.libraryId);
    const jobId = service.listMediaJobs(created.libraryId).jobs[0]!.jobId;
    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    db.prepare("UPDATE jobs SET status = 'running', attempt_count = 2 WHERE job_id = ?").run(jobId);
    db.close();
    service.closeAll();

    const reopened = new LibraryService();
    reopened.openLibrary(created.libraryPath);
    expect(reopened.listMediaJobs(created.libraryId).jobs.find((job) => job.jobId === jobId)).toMatchObject({
      status: 'queued',
      attemptCount: 2,
      errorCode: 'PROCESS_INTERRUPTED',
    });
    reopened.closeAll();
  });

  it('does not retain artifacts completed after an in-flight cancellation', async () => {
    const root = temporaryRoot();
    let releaseDecode!: () => void;
    let decodeStarted!: () => void;
    const started = new Promise<void>((resolve) => { decodeStarted = resolve; });
    const blocked = new Promise<void>((resolve) => { releaseDecode = resolve; });
    const pipeline = {
      metadata: async () => ({ width: 1, height: 1, format: 'png' }),
      rotate() { return this; },
      toColourspace() { return this; },
      resize() { return this; },
      composite() { return this; },
      webp() { return this; },
      jpeg() { return this; },
      async toFile(outputPath: string) {
        decodeStarted();
        await blocked;
        writeFileSync(outputPath, VALID_1X1_PNG);
      },
    };
    const service = new LibraryService({ sharpFn: () => pipeline });
    const created = service.createLibrary({ displayName: 'MediaCancel', selectedParentPath: root });
    const png = path.join(root, 'late.png');
    createTestImage(png);
    importNoConflict(service, created.libraryId, png);
    service.enqueueThumbnailJobs(created.libraryId);
    const jobId = service.listMediaJobs(created.libraryId).jobs[0]!.jobId;

    const processing = service.processThumbnailQueue(created.libraryId, { maxJobs: 1 });
    await started;
    expect(service.cancelMediaJobs(created.libraryId, [jobId])).toEqual({ cancelledCount: 1 });
    releaseDecode();
    await processing;

    expect(service.listMediaJobs(created.libraryId).jobs[0]!.status).toBe('cancelled');
    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    // Header-probed extracted_metadata is intentionally persisted before the
    // decoder is cancelled; the cancellation contract is that no thumbnail
    // artifact from the interrupted job remains.
    expect(db.prepare("SELECT COUNT(*) AS count FROM revision_artifacts WHERE kind = 'thumbnail'").get())
      .toMatchObject({ count: 0 });
    db.close();
    service.closeAll();
  });

  it('caps Sharp work at the CPU-derived pool across assets (Serpent-azf6)', async () => {
    const root = temporaryRoot();
    let active = 0;
    let maximum = 0;
    const releases: Array<() => void> = [];
    const waiters: Array<() => void> = [];
    const changed = (): void => { for (const notify of waiters.splice(0)) notify(); };
    const waitFor = async (predicate: () => boolean): Promise<void> => {
      while (!predicate()) await new Promise<void>((resolve) => waiters.push(resolve));
    };
    const sharpFn = () => {
      const pipeline = {
        metadata: async () => ({ width: 1, height: 1, format: 'png' }),
        rotate() { return this; },
        toColourspace() { return this; },
        resize() { return this; },
        composite() { return this; },
        webp() { return this; },
        jpeg() { return this; },
        async toFile(outputPath: string) {
          active += 1;
          maximum = Math.max(maximum, active);
          changed();
          await new Promise<void>((resolve) => releases.push(resolve));
          writeFileSync(outputPath, VALID_1X1_PNG);
          active -= 1;
          changed();
        },
      };
      return pipeline;
    };
    const targets: Array<{ service: LibraryService; libraryId: string; assetId: string }> = [];
    for (let index = 0; index < 5; index += 1) {
      const service = new LibraryService({ sharpFn });
      const created = service.createLibrary({ displayName: `SharpLimit-${index}`, selectedParentPath: root });
      const source = path.join(root, `limit-${index}.png`);
      createTestImage(source);
      importNoConflict(service, created.libraryId, source);
      targets.push({
        service,
        libraryId: created.libraryId,
        assetId: service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!.assetId,
      });
    }
    const operations = targets.map((target) => target.service.generateThumbnail({
      libraryId: target.libraryId,
      assetId: target.assetId,
    }));

    const expectedMaximum = Math.min(targets.length, workerMediaDecodeConcurrency());
    await waitFor(() => active === expectedMaximum);
    expect(maximum).toBe(expectedMaximum);
    releases.splice(0).forEach((release) => release());
    // The held slots free up; any remaining operation acquires one of them.
    if (expectedMaximum < targets.length) {
      await waitFor(() => releases.length === targets.length - expectedMaximum);
      releases.splice(0).forEach((release) => release());
    }
    await Promise.all(operations);
    expect(maximum).toBe(expectedMaximum);
    for (const target of targets) target.service.closeAll();
  });
});

describe('AssetSummary thumbnail enrichment', () => {
  it('includes thumbnailStatus and mediaType', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Summary', selectedParentPath: root });

    const png = path.join(root, 'sum.png');
    createTestImage(png);
    importNoConflict(service, created.libraryId, png);

    let assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    expect(assets[0]!.mediaType).toBe('image');
    expect(assets[0]!.thumbnailStatus).toBeNull();
    expect(assets[0]!.thumbnailArtifactId).toBeNull();

    await service.generateThumbnail({ libraryId: created.libraryId, assetId: assets[0]!.assetId });

    assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    expect(assets[0]!.thumbnailStatus).toBe('ready');
    expect(assets[0]!.thumbnailArtifactId).toBeTruthy();

    service.closeAll();
  });

  it('detects video mediaType', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'VideoSummary', selectedParentPath: root });

    const mp4 = path.join(root, 'vid.mp4');
    writeFileSync(mp4, Buffer.alloc(1024, 0));
    importNoConflict(service, created.libraryId, mp4);

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    expect(assets[0]!.mediaType).toBe('video');
    expect(assets[0]!.thumbnailStatus).toBeNull();

    service.closeAll();
  });
});

describe('getArtifactAbsolutePath', () => {
  it('resolves artifact path', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'ResolvePath', selectedParentPath: root });

    const png = path.join(root, 'path.png');
    createTestImage(png);
    importNoConflict(service, created.libraryId, png);

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    const result = (await service.generateThumbnail({ libraryId: created.libraryId, assetId: assets[0]!.assetId }))!;

    const absPath = service.getArtifactAbsolutePath(created.libraryId, result.artifactId);
    expect(absPath).toContain('.serpent');
    expect(absPath).toContain('artifacts');
    expect(() => service.getArtifactAbsolutePath(
      created.libraryId,
      result.artifactId,
      'proxy',
    )).toThrow(LibraryServiceError);
    expect(existsSync(absPath)).toBe(true);

    service.closeAll();
  });

  it('reuses validated paths and drops them after artifact invalidation', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'CachedArtifactPath', selectedParentPath: root });
    const png = path.join(root, 'cached.png');
    createTestImage(png);
    importNoConflict(service, created.libraryId, png);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;
    const first = (await service.generateThumbnail({ libraryId: created.libraryId, assetId: asset.assetId }))!;
    const firstPath = service.getArtifactAbsolutePath(created.libraryId, first.artifactId, 'preview');
    expect(service.getArtifactAbsolutePath(created.libraryId, first.artifactId, 'preview')).toBe(firstPath);

    const second = (await service.generateThumbnail({ libraryId: created.libraryId, assetId: asset.assetId }))!;
    expect(second.artifactId).not.toBe(first.artifactId);
    // The cache follows the library change sequence subscription. Give its
    // cross-process polling boundary one tick before checking the old token.
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(() => service.getArtifactAbsolutePath(
      created.libraryId,
      first.artifactId,
      'preview',
    )).toThrow(LibraryServiceError);
    expect(existsSync(service.getArtifactAbsolutePath(created.libraryId, second.artifactId, 'preview'))).toBe(true);
    service.closeAll();
  });

  it('rejects an artifact file replaced by a symlink', async () => {
    if (process.platform === 'win32') return;
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'SymlinkArtifact', selectedParentPath: root });
    const sourcePath = path.join(root, 'source.png');
    createTestImage(sourcePath);
    importNoConflict(service, created.libraryId, sourcePath);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;
    const result = (await service.generateThumbnail({ libraryId: created.libraryId, assetId: asset.assetId }))!;
    const artifactPath = service.getArtifactAbsolutePath(created.libraryId, result.artifactId, 'preview');
    const outsidePath = path.join(root, 'outside-secret.txt');
    writeFileSync(outsidePath, 'must-not-be-served');
    unlinkSync(artifactPath);
    symlinkSync(outsidePath, artifactPath);

    expect(() => service.getArtifactAbsolutePath(
      created.libraryId,
      result.artifactId,
      'preview',
    )).toThrow(LibraryServiceError);

    service.closeAll();
  });

  it('rejects non-existent artifact', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'NoArt', selectedParentPath: root });

    const png = path.join(root, 'noart.png');
    createTestImage(png);
    importNoConflict(service, created.libraryId, png);

    expect(() =>
      service.getArtifactAbsolutePath(created.libraryId, 'nonexistent-artifact'),
    ).toThrow(LibraryServiceError);

    service.closeAll();
  });
});

describe('resolveAssetPath', () => {
  it('resolves managed asset path', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Resolved', selectedParentPath: root });

    const png = path.join(root, 'resolve.png');
    createTestImage(png);
    importNoConflict(service, created.libraryId, png);

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    const assetAbsPath = service.resolveAssetPath(created.libraryId, assets[0]!.assetId);
    expect(existsSync(assetAbsPath)).toBe(true);

    service.closeAll();
  });

  it('maps native dropped managed and linked paths back to live asset ids', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'DropResolve', selectedParentPath: root });

    const managedSource = path.join(root, 'managed.png');
    createTestImage(managedSource);
    importNoConflict(service, created.libraryId, managedSource);
    // The imported source is copied into Assets; use the Worker-owned path as
    // the exact path that Electron would later hand back on a native drop.
    const managedAsset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;
    const managedPath = service.resolveAssetPath(created.libraryId, managedAsset.assetId);

    const linkedRoot = path.join(root, 'linked-source');
    mkdirSync(linkedRoot);
    const linkedPath = path.join(linkedRoot, 'linked.png');
    createTestImage(linkedPath);
    service.importFolderAsLinked({
      libraryId: created.libraryId,
      sourceRootPath: linkedRoot,
    });
    const linkedAsset = service
      .listAssets({ libraryId: created.libraryId, recursive: true })
      .find((asset) => asset.locationKind === 'linked');
    expect(linkedAsset).toBeDefined();

    const linkedDropPath = service.resolveAssetPath(
      created.libraryId,
      linkedAsset!.assetId,
    );

    expect(
      service.resolveAssetIdsByAbsolutePaths(created.libraryId, [
        managedPath,
        managedPath,
        linkedDropPath,
        path.join(root, 'not-managed.png'),
      ]),
    ).toEqual([managedAsset.assetId, linkedAsset!.assetId]);

    service.closeAll();
  });
});

describe('generateThumbnail (animated GIF still page)', () => {
  it('avoids pure-black intro frames for multi-page GIFs', async () => {
    const { execFileSync } = await import('node:child_process');
    const ffmpeg = process.env['SERPENT_FFMPEG_PATH'] ?? 'ffmpeg';
    try {
      execFileSync(ffmpeg, ['-version'], { stdio: 'ignore' });
    } catch {
      return;
    }

    const root = temporaryRoot();
    const frameDir = path.join(root, 'frames');
    mkdirSync(frameDir, { recursive: true });
    const sharp = require('sharp') as (
      input: unknown,
      options?: { page?: number },
    ) => {
      png(): { toFile(path: string): Promise<unknown> };
      raw(): {
        toBuffer(options: { resolveWithObject: true }): Promise<{
          data: Uint8Array;
          info: { channels: number };
        }>;
      };
    };

    for (let i = 0; i < 6; i += 1) {
      const background = i < 3
        ? { r: 0, g: 0, b: 0 }
        : { r: 240, g: 80, b: 40 };
      await sharp({
        create: { width: 32, height: 32, channels: 3, background },
      }).png().toFile(path.join(frameDir, `f${i}.png`));
    }

    const gifPath = path.join(root, 'intro-black.gif');
    execFileSync(
      ffmpeg,
      [
        '-y',
        '-framerate', '2',
        '-i', path.join(frameDir, 'f%d.png'),
        '-frames:v', '6',
        gifPath,
      ],
      { stdio: 'pipe' },
    );

    const service = new LibraryService();
    const created = service.createLibrary({
      displayName: 'GIF Still',
      selectedParentPath: root,
    });
    importNoConflict(service, created.libraryId, gifPath);
    const asset = service.listAssets({
      libraryId: created.libraryId,
      recursive: true,
    })[0]!;

    const result = (await service.generateThumbnail({
      libraryId: created.libraryId,
      assetId: asset.assetId,
    }))!;
    // Serpent-thumb-perf: GIF stills encode as webp when the palette reports
    // alpha, jpeg otherwise — assert through the stored file path instead of
    // hardcoding an extension.
    const dbPathForCheck = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const storedPath = (dbPathForCheck.prepare(
      'SELECT file_path FROM revision_artifacts WHERE artifact_id = ?',
    ).get(result.artifactId) as { file_path: string }).file_path;
    dbPathForCheck.close();
    const artifactPath = path.join(
      created.libraryPath,
      '.serpent',
      'artifacts',
      ...storedPath.split('/'),
    );
    expect(existsSync(artifactPath)).toBe(true);

    const { data, info } = await sharp(artifactPath)
      .raw()
      .toBuffer({ resolveWithObject: true });
    let sum = 0;
    const pixels = Math.floor(data.length / info.channels);
    for (let i = 0; i < pixels; i += 1) {
      const offset = i * info.channels;
      sum += ((data[offset] ?? 0) + (data[offset + 1] ?? 0) + (data[offset + 2] ?? 0)) / 3;
    }
    expect(sum / pixels).toBeGreaterThan(40);

    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const row = db.prepare(
      'SELECT generator_version FROM revision_artifacts WHERE artifact_id = ?',
    ).get(result.artifactId) as { generator_version: string };
    expect(row.generator_version).toContain('gifstill');
    db.close();
    service.closeAll();
  });
});

describe('animated GIF webm proxy (Serpent-azf6)', () => {
  async function buildGif(root: string, frames: number): Promise<string> {
    const { execFileSync } = await import('node:child_process');
    const ffmpeg = process.env['SERPENT_FFMPEG_PATH'] ?? 'ffmpeg';
    try {
      execFileSync(ffmpeg, ['-version'], { stdio: 'ignore' });
    } catch {
      return '';
    }
    const frameDir = path.join(root, 'frames');
    mkdirSync(frameDir, { recursive: true });
    const sharp = require('sharp');
    for (let i = 0; i < frames; i += 1) {
      await sharp({
        create: {
          width: 24,
          height: 24,
          channels: 3,
          background: { r: 200, g: 60 + i * 20, b: 40 },
        },
      }).png().toFile(path.join(frameDir, `f${i}.png`));
    }
    const gifPath = path.join(root, `gif-${frames}-frames.gif`);
    execFileSync(
      ffmpeg,
      ['-y', '-framerate', '2', '-i', path.join(frameDir, 'f%d.png'), '-frames:v', String(frames), gifPath],
      { stdio: 'pipe' },
    );
    return gifPath;
  }

  function openJobs(
    created: { libraryPath: string },
  ): (sql: string, ...params: unknown[]) => unknown[] {
    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    return (sql: string, ...params: unknown[]): unknown[] => {
      const rows = db.prepare(sql).all(...params);
      db.close();
      return rows;
    };
  }

  it('enqueues a low-priority webm proxy job behind the still thumbnail for animated GIFs', async () => {
    const root = temporaryRoot();
    const gifPath = await buildGif(root, 4);
    if (gifPath === '') return; // ffmpeg unavailable in this environment
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'GIF Proxy', selectedParentPath: root });
    importNoConflict(service, created.libraryId, gifPath);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;

    service.enqueueThumbnailJobs(created.libraryId, { assetIds: [asset.assetId] });
    await service.processThumbnailQueue(created.libraryId, { maxJobs: 4 });

    const rows = openJobs(created)(
      `SELECT kind, status, priority FROM jobs
        WHERE asset_id = ? AND kind = 'generate_webm_proxy'`,
      asset.assetId,
    ) as Array<{ kind: string; status: string; priority: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('queued');
    expect(rows[0]!.priority).toBe(100);
    service.closeAll();
  });

  it('resolves the preview through the webm proxy once it is ready', async () => {
    const root = temporaryRoot();
    const gifPath = await buildGif(root, 4);
    if (gifPath === '') return;
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'GIF Proxy', selectedParentPath: root });
    importNoConflict(service, created.libraryId, gifPath);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;

    service.enqueueThumbnailJobs(created.libraryId, { assetIds: [asset.assetId] });
    // Drain 1: still thumbnail (+ proxy enqueued). Drain 2: the proxy itself.
    await service.processThumbnailQueue(created.libraryId, { maxJobs: 4 });
    await service.processThumbnailQueue(created.libraryId, { maxJobs: 4 });

    const preview = await service.resolvePreviewArtifact(created.libraryId, asset.assetId);
    expect(preview.mediaType).toBe('image');
    expect(preview.kind).toBe('webm_proxy');
    expect(preview.playbackMode).toBe('proxy');
    expect(preview.status).toBe('ready');
    service.closeAll();
  });

  it('keeps static single-page GIFs on the plain image path (no proxy job)', async () => {
    const root = temporaryRoot();
    const gifPath = await buildGif(root, 1);
    if (gifPath === '') return;
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'GIF Static', selectedParentPath: root });
    importNoConflict(service, created.libraryId, gifPath);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;

    service.enqueueThumbnailJobs(created.libraryId, { assetIds: [asset.assetId] });
    await service.processThumbnailQueue(created.libraryId, { maxJobs: 4 });

    const rows = openJobs(created)(
      `SELECT kind FROM jobs WHERE asset_id = ? AND kind = 'generate_webm_proxy'`,
      asset.assetId,
    ) as Array<{ kind: string }>;
    expect(rows).toHaveLength(0);
    const preview = await service.resolvePreviewArtifact(created.libraryId, asset.assetId);
    expect(preview.kind).not.toBe('webm_proxy');
    service.closeAll();
  });
});

describe('visible-wave priority boost (Serpent-azf6)', () => {
  it('raises queued preview jobs of the scheduled assets to the scene priority', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Boost', selectedParentPath: root });
    const source = path.join(root, 'boost.png');
    createTestImage(source);
    importNoConflict(service, created.libraryId, source);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;

    // Queue the thumbnail at the mutation-wave priority first.
    service.enqueueThumbnailJobs(created.libraryId, { assetIds: [asset.assetId], priority: 300 });
    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const before = db.prepare(
      'SELECT priority FROM jobs WHERE asset_id = ? AND kind = ? AND status = ?',
    ).get(asset.assetId, 'generate_thumbnail', 'queued') as { priority: number } | undefined;
    expect(before?.priority).toBe(300);

    // The visible browse wave schedules the same asset at 350.
    service.enqueueThumbnailJobs(created.libraryId, { assetIds: [asset.assetId], priority: 350 });
    const after = db.prepare(
      'SELECT priority FROM jobs WHERE asset_id = ? AND kind = ? AND status = ?',
    ).get(asset.assetId, 'generate_thumbnail', 'queued') as { priority: number } | undefined;
    db.close();
    expect(after?.priority).toBe(350);
    service.closeAll();
  });

  it('never lowers the priority of an already-higher queued job', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'BoostKeep', selectedParentPath: root });
    const source = path.join(root, 'boost-keep.png');
    createTestImage(source);
    importNoConflict(service, created.libraryId, source);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;

    service.enqueueThumbnailJobs(created.libraryId, { assetIds: [asset.assetId], priority: 350 });
    service.enqueueThumbnailJobs(created.libraryId, { assetIds: [asset.assetId], priority: 300 });
    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const priority = db.prepare(
      'SELECT priority FROM jobs WHERE asset_id = ? AND kind = ? AND status = ?',
    ).get(asset.assetId, 'generate_thumbnail', 'queued') as { priority: number };
    db.close();
    expect(priority.priority).toBe(350);
    service.closeAll();
  });
});

describe('cover-wave priority (Serpent-d0nv)', () => {
  it('enqueues cover candidates at the cover tier (400) so they beat the visible wave (350)', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'CoverWave', selectedParentPath: root });
    const source = path.join(root, 'cover.png');
    createTestImage(source);
    importNoConflict(service, created.libraryId, source);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;

    // folder.browse-entries schedules the cover scene: limit 100, priority 400.
    service.enqueueThumbnailJobs(created.libraryId, {
      assetIds: [asset.assetId],
      limit: 100,
      priority: 400,
    });
    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const queued = db.prepare(
      'SELECT priority FROM jobs WHERE asset_id = ? AND kind = ? AND status = ?',
    ).get(asset.assetId, 'generate_thumbnail', 'queued') as { priority: number } | undefined;
    expect(queued?.priority).toBe(400);

    // The visible browse wave (350) for the same asset must not lower the
    // queued cover job (MAX boost semantics; covers outrank the current view).
    service.enqueueThumbnailJobs(created.libraryId, {
      assetIds: [asset.assetId],
      priority: 350,
    });
    const after = db.prepare(
      'SELECT priority FROM jobs WHERE asset_id = ? AND kind = ? AND status = ?',
    ).get(asset.assetId, 'generate_thumbnail', 'queued') as { priority: number } | undefined;
    db.close();
    expect(after?.priority).toBe(400);
    service.closeAll();
  });
});

describe('visible page window covers the whole browse page (Serpent-x9xu)', () => {
  it('boosts the entire returned page (300) above the mutation wave and leaves unbrowsed assets at 300', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'VisiblePage', selectedParentPath: root });

    // More assets than the page size so a tail of the library is never part
    // of the current page. Each file gets distinct trailing bytes so content
    // dedup does not collapse the batch into copies.
    const totalCount = THUMBNAIL_VISIBLE_PAGE_SIZE + 20;
    const sourceDir = path.join(root, 'sources');
    mkdirSync(sourceDir, { recursive: true });
    for (let index = 0; index < totalCount; index += 1) {
      const name = `img-${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}.png`;
      const uniqueTrailer = Buffer.from([
        (index >> 24) & 0xff, (index >> 16) & 0xff, (index >> 8) & 0xff, index & 0xff,
      ]);
      writeFileSync(path.join(sourceDir, name), Buffer.concat([VALID_1X1_PNG, uniqueTrailer]));
    }
    const prepared = service.prepareOrExecuteImport({
      libraryId: created.libraryId,
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
    const assetIds = service.listAssets({ libraryId: created.libraryId, recursive: true })
      .map((asset) => asset.assetId);
    expect(assetIds).toHaveLength(totalCount);

    // The import flood has already queued every asset at the mutation tier (300).
    expect(service.enqueueThumbnailJobs(created.libraryId, {
      assetIds,
      priority: 300,
      limit: totalCount,
    })).toBe(totalCount);

    // scheduleThumbnailScene('visible', pageAssetIds) semantics: the current
    // browse page (THUMBNAIL_VISIBLE_PAGE_SIZE assets) is scheduled at 350.
    const pageAssetIds = assetIds.slice(0, THUMBNAIL_VISIBLE_PAGE_SIZE);
    const offPageAssetIds = assetIds.slice(THUMBNAIL_VISIBLE_PAGE_SIZE);
    service.enqueueThumbnailJobs(created.libraryId, {
      assetIds: pageAssetIds,
      limit: THUMBNAIL_VISIBLE_PAGE_SIZE,
      priority: 350,
      repairFailed: true,
      retryFailed: true,
    });

    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const jobs = db.prepare(
      "SELECT asset_id, priority FROM jobs WHERE kind = 'generate_thumbnail' AND status = 'queued' ORDER BY priority DESC, created_at",
    ).all() as Array<{ asset_id: string; priority: number }>;
    db.close();
    expect(jobs).toHaveLength(totalCount);

    // The whole page sits in the 350 tier — the old cap of 100 would have
    // left 200 page assets behind — and it strictly precedes the 300 tier.
    expect(jobs.map((job) => job.priority)).toEqual([
      ...Array.from({ length: THUMBNAIL_VISIBLE_PAGE_SIZE }, () => 350),
      ...Array.from({ length: offPageAssetIds.length }, () => 300),
    ]);
    const boostedIds = new Set(
      jobs.slice(0, THUMBNAIL_VISIBLE_PAGE_SIZE).map((job) => job.asset_id),
    );
    for (const assetId of pageAssetIds) {
      expect(boostedIds.has(assetId)).toBe(true);
    }
    // Unbrowsed assets never take a visible slot: they stay at the mutation
    // tier and none of them appears in the 350 group.
    const remainingIds = new Set(jobs.slice(THUMBNAIL_VISIBLE_PAGE_SIZE).map((job) => job.asset_id));
    for (const assetId of offPageAssetIds) {
      expect(remainingIds.has(assetId)).toBe(true);
    }
    service.closeAll();
  });
});

describe('visible-window header probe (Serpent-visible-window)', () => {
  it('returns header-probed dimensions for visible images, persists them as extracted_metadata, and skips non-images', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'VisibleWindowProbe', selectedParentPath: root });

    const sharp = require('sharp') as (input: {
      create: { width: number; height: number; channels: number; background: Record<string, number> };
    }) => { jpeg(): { toFile(path: string): Promise<unknown> } };
    const jpegPath = path.join(root, 'viewport.jpg');
    await sharp({
      create: {
        width: 32,
        height: 24,
        channels: 3,
        background: { r: 10, g: 90, b: 200 },
      },
    }).jpeg().toFile(jpegPath);
    const textPath = path.join(root, 'notes.txt');
    writeFileSync(textPath, 'not an image', 'utf-8');
    importNoConflict(service, created.libraryId, jpegPath);
    importNoConflict(service, created.libraryId, textPath);

    const byRelativePath = new Map(
      service.listAssets({ libraryId: created.libraryId, recursive: true })
        .map((asset) => [asset.relativeFilePath, asset] as const),
    );
    const jpegAsset = byRelativePath.get('viewport.jpg')!;
    const textAsset = byRelativePath.get('notes.txt')!;
    expect(jpegAsset).toBeTruthy();
    expect(textAsset).toBeTruthy();

    // The import already header-probes its first 64 discovered assets, so the
    // visible-window probe must skip rows that carry extracted_metadata. Clear
    // the JPEG's metadata first to simulate an asset whose dimensions were
    // never probed (e.g. beyond the import cap, or imported before the probe
    // existed).
    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const revision = db.prepare(
      'SELECT current_revision_id FROM assets WHERE asset_id = ?',
    ).get(jpegAsset.assetId) as { current_revision_id: string };
    db.prepare(
      "DELETE FROM revision_artifacts WHERE revision_id = ? AND kind = 'extracted_metadata'",
    ).run(revision.current_revision_id);

    const dimensions = service.persistVisibleWindowImageDimensions(created.libraryId, [
      jpegAsset.assetId,
      textAsset.assetId,
      'missing-asset',
    ]);
    expect(dimensions).toEqual([{ assetId: jpegAsset.assetId, width: 32, height: 24 }]);

    // The probe must leave a ready extracted_metadata artifact so summaries
    // and masonry placeholders read the dimensions without waiting for the
    // thumbnail job.
    const rows = db.prepare(
      "SELECT width, height, status FROM revision_artifacts WHERE revision_id = ? AND kind = 'extracted_metadata' AND invalidated_at IS NULL",
    ).all(revision.current_revision_id) as Array<{ width: number | null; height: number | null; status: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0]).toEqual({ width: 32, height: 24, status: 'ready' });

    // Re-reporting the same visible window must skip the already-probed asset
    // (no re-probe, no event spam) and keep exactly one metadata artifact.
    const again = service.persistVisibleWindowImageDimensions(created.libraryId, [
      jpegAsset.assetId,
    ]);
    expect(again).toEqual([]);
    const count = db.prepare(
      "SELECT COUNT(*) AS n FROM revision_artifacts WHERE revision_id = ? AND kind = 'extracted_metadata' AND invalidated_at IS NULL",
    ).get(revision.current_revision_id) as { n: number };
    expect(count.n).toBe(1);
    db.close();

    service.closeAll();
  });

  it('generates a first-page thumbnail for a PDF asset (Serpent-8ca259)', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'PDF', selectedParentPath: root });

    // Minimal single-page PDF with the text "Hello PDF" (hand-assembled).
    const pdfBytes = Buffer.from(
      '%PDF-1.4\n'
      + '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
      + '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
      + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n'
      + '4 0 obj<</Length 46>>stream\n'
      + 'BT /F1 24 Tf 30 100 Td (Hello PDF) Tj ET\n'
      + 'endstream endobj\n'
      + '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n'
      + 'xref\n0 6\n0000000000 65535 f \n'
      + '0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000290 00000 n \n0000000385 00000 n \n'
      + 'trailer<</Size 6/Root 1 0 R>>\n'
      + 'startxref\n470\n%%EOF\n',
      'latin1',
    );

    const sourcePath = path.join(root, 'sample.pdf');
    writeFileSync(sourcePath, pdfBytes);
    importNoConflict(service, created.libraryId, sourcePath);

    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;
    expect(asset).toMatchObject({ mediaType: 'document' });

    const result = (await service.generateThumbnail({ libraryId: created.libraryId, assetId: asset.assetId }))!;
    expect(result.artifactId).toBeTruthy();

    const artifactPath = path.join(created.libraryPath, '.serpent', 'artifacts', `${result.artifactId}.jpg`);
    expect(existsSync(artifactPath)).toBe(true);

    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const row = db.prepare('SELECT kind, status, mime_type, generator_version FROM revision_artifacts WHERE artifact_id = ?').get(result.artifactId) as { kind: string; status: string; mime_type: string; generator_version: string };
    expect(row.kind).toBe('thumbnail');
    expect(row.status).toBe('ready');
    expect(row.mime_type).toBe('image/jpeg');
    expect(row.generator_version).toContain('pdfjs@');
    db.close();

    service.closeAll();
  });
});
