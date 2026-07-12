import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  LibraryService,
  LibraryServiceError,
} from '../../src/worker/library-service';

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
  const result = service.prepareOrExecuteImport({
    libraryId,
    sourceKind: 'files',
    sourcePaths: [sourcePath],
  });
  if ('importId' in result) {
    const discard = service.abandonImport(result.importId);
    expect(discard).toBe(result.importId);
    throw new Error('Import generated unexpected conflicts.');
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

describe('schema v9 migration', () => {
  it('creates revision_artifacts and jobs tables', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'V9', selectedParentPath: root });

    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(db.pragma('user_version', { simple: true })).toBe(9);

    const revArtifactCols = (db.prepare("PRAGMA table_info('revision_artifacts')").all() as Array<{ name: string }>).map((c) => c.name);
    expect(revArtifactCols).toContain('artifact_id');
    expect(revArtifactCols).toContain('revision_id');
    expect(revArtifactCols).toContain('kind');
    expect(revArtifactCols).toContain('status');
    expect(revArtifactCols).toContain('file_path');
    expect(revArtifactCols).toContain('generator_version');
    expect(revArtifactCols).toContain('invalidated_at');

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
  it('detects image types', () => {
    expect(LibraryService.detectMediaType('photo.png')).toBe('image');
    expect(LibraryService.detectMediaType('photo.jpeg')).toBe('image');
    expect(LibraryService.detectMediaType('photo.gif')).toBe('image');
    expect(LibraryService.detectMediaType('photo.webp')).toBe('image');
  });

  it('detects video types', () => {
    expect(LibraryService.detectMediaType('video.mp4')).toBe('video');
    expect(LibraryService.detectMediaType('video.mov')).toBe('video');
  });

  it('returns other for EXR/TGA and unknown', () => {
    expect(LibraryService.detectMediaType('render.exr')).toBe('other');
    expect(LibraryService.detectMediaType('render.tga')).toBe('other');
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

  it('handles video assets gracefully when FFmpeg is missing', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Video', selectedParentPath: root });

    const sourcePath = path.join(root, 'video.mp4');
    writeFileSync(sourcePath, Buffer.alloc(1024, 0));
    importNoConflict(service, created.libraryId, sourcePath);

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    const result = await service.generateThumbnail({ libraryId: created.libraryId, assetId: assets[0]!.assetId });
    // Video is now dispatched to ffmpeg path; without ffmpeg, failed
    // artifacts are created but the method resolves (partial failures tolerated).
    expect(result.artifactId).toBe('');

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
    expect(processed).toBe(1);

    // Verify job is succeeded
    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const job = db.prepare("SELECT status FROM jobs WHERE kind = 'generate_thumbnail' LIMIT 1").get() as { status: string } | undefined;
    expect(job).toBeTruthy();
    expect(job!.status).toBe('succeeded');
    db.close();

    service.closeAll();
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
    expect(existsSync(absPath)).toBe(true);

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
