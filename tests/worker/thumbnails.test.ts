import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  LibraryService,
  LibraryServiceError,
} from '../../src/worker/library-service';
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

function importNoConflict(service: LibraryService, libraryId: string, sourcePath: string): void {
  sharedImportNoConflict(service, libraryId, sourcePath);
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

describe('schema v9 migration', () => {
  it('creates revision_artifacts and jobs tables', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'V9', selectedParentPath: root });

    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(db.pragma('user_version', { simple: true })).toBe(26);

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
  it('generates a WebP thumbnail for a PNG asset', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'PNG', selectedParentPath: root });

    const sourcePath = path.join(root, 'test.png');
    createTestImage(sourcePath);
    importNoConflict(service, created.libraryId, sourcePath);

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    expect(assets).toHaveLength(1);

    const result = await service.generateThumbnail({ libraryId: created.libraryId, assetId: assets[0]!.assetId });
    expect(result.artifactId).toBeTruthy();

    // Verify artifact file exists
    const artifactPath = path.join(created.libraryPath, '.serpent', 'artifacts', `${result.artifactId}.webp`);
    expect(existsSync(artifactPath)).toBe(true);

    // Verify revision_artifacts row
    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const row = db.prepare('SELECT kind, status, mime_type, generator_version FROM revision_artifacts WHERE artifact_id = ?').get(result.artifactId) as { kind: string; status: string; mime_type: string; generator_version: string };
    expect(row.kind).toBe('thumbnail');
    expect(row.status).toBe('ready');
    expect(row.mime_type).toBe('image/webp');
    expect(row.generator_version).toContain('sharp@');
    db.close();

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

    const result = await service.generateThumbnail({
      libraryId: created.libraryId,
      assetId: asset.assetId,
    });
    const artifactPath = path.join(
      created.libraryPath,
      '.serpent',
      'artifacts',
      `${result.artifactId}.webp`,
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

  it('generates a WebP thumbnail for a JPEG asset', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'JPEG', selectedParentPath: root });

    const sourcePath = path.join(root, 'test.jpg');
    createTestImage(sourcePath);
    importNoConflict(service, created.libraryId, sourcePath);

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    const result = await service.generateThumbnail({ libraryId: created.libraryId, assetId: assets[0]!.assetId });
    expect(result.artifactId).toBeTruthy();
    expect(existsSync(path.join(created.libraryPath, '.serpent', 'artifacts', `${result.artifactId}.webp`))).toBe(true);

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

  it('waits for a video proxy while it is generating instead of mounting the source', () => {
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

    expect(service.getPreviewArtifact(created.libraryId, asset.assetId)).toMatchObject({
      mediaType: 'video',
      status: 'pending',
      kind: 'webm_proxy',
      mimeType: 'video/webm',
    });

    service.closeAll();
  });

  it('reports a failed video proxy instead of retrying an unreliable source', () => {
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

    expect(service.getPreviewArtifact(created.libraryId, asset.assetId)).toMatchObject({
      mediaType: 'video',
      status: 'failed',
      kind: 'webm_proxy',
      errorCode: 'MEDIA_PROCESSING_FAILED',
    });

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

    expect(service.getPreviewArtifact(created.libraryId, asset.assetId)).toMatchObject({
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

    expect(service.enqueueThumbnailJobs(created.libraryId, { limit: 2 })).toBe(2);
    expect(service.enqueueThumbnailJobs(created.libraryId, {
      assetIds: [assetIds[5]!],
      limit: 1,
      priority: 200,
    })).toBe(1);

    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const jobs = db.prepare(
      "SELECT asset_id, priority FROM jobs WHERE kind = 'generate_thumbnail' ORDER BY priority DESC, created_at",
    ).all() as Array<{ asset_id: string; priority: number }>;
    expect(jobs).toHaveLength(3);
    expect(jobs[0]).toEqual({ asset_id: assetIds[5], priority: 200 });
    db.close();
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
        webp() { return this; },
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
      webp() { return this; },
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
    expect(db.prepare('SELECT COUNT(*) AS count FROM revision_artifacts').get()).toMatchObject({ count: 0 });
    db.close();
    service.closeAll();
  });

  it('limits Sharp work to two concurrent decodes across assets', async () => {
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
        webp() { return this; },
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
    for (let index = 0; index < 3; index += 1) {
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

    await waitFor(() => active === 2);
    expect(maximum).toBe(2);
    releases.splice(0).forEach((release) => release());
    await waitFor(() => releases.length === 1);
    releases.shift()!();
    await Promise.all(operations);
    expect(maximum).toBe(2);
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
    const result = await service.generateThumbnail({ libraryId: created.libraryId, assetId: assets[0]!.assetId });

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

  it('rejects an artifact file replaced by a symlink', async () => {
    if (process.platform === 'win32') return;
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'SymlinkArtifact', selectedParentPath: root });
    const sourcePath = path.join(root, 'source.png');
    createTestImage(sourcePath);
    importNoConflict(service, created.libraryId, sourcePath);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;
    const result = await service.generateThumbnail({ libraryId: created.libraryId, assetId: asset.assetId });
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

    const result = await service.generateThumbnail({
      libraryId: created.libraryId,
      assetId: asset.assetId,
    });
    const artifactPath = path.join(
      created.libraryPath,
      '.serpent',
      'artifacts',
      `${result.artifactId}.webp`,
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
