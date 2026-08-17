// Serpent-5xbg: failed derived artifacts (thumbnail/video_poster/contact_sheet/
// audio_proxy) are re-opened for regeneration when the asset surfaces —
// throttled, permanent failures excluded — instead of blocking forever.
// Video webm_proxy is intentionally excluded: Serpent-cljb only creates it
// after the viewer reports a real source-playback failure.
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import { portablePathIdentity } from '../../src/worker/library-rules';

interface TestDatabase {
  pragma(source: string, options?: { simple: boolean }): unknown;
  prepare(source: string): {
    run(...params: unknown[]): { changes: number };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
}

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as new (filename: string) => TestDatabase;

const temporaryRoots: string[] = [];
const services: LibraryService[] = [];

function newService(): LibraryService {
  const service = new LibraryService();
  services.push(service);
  return service;
}

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-derivative-repair-'));
  temporaryRoots.push(root);
  return root;
}

/** Insert a minimal asset + revision + failed artifact row directly. */
function insertFailedAsset(
  libraryPath: string,
  input: {
    fileName: string;
    kind: 'thumbnail' | 'contact_sheet' | 'webm_proxy';
    errorCode: string;
    failedAt: Date;
    available?: boolean;
  },
): { assetId: string } {
  const dbPath = path.join(libraryPath, '.serpent', 'library.db');
  const db = new Database(dbPath);
  const assetId = randomUUID();
  const revisionId = randomUUID();
  const now = new Date().toISOString();
  // The on-disk fixture file must exactly match the recorded revision
  // (byte_size + mtime), otherwise openLibrary's asset refresh rotates the
  // revision and orphans the failed artifact we insert below. Write the file
  // first, then derive the recorded mtime from the actual file.
  const assetPath = path.join(libraryPath, 'Assets', input.fileName);
  if (input.available !== false) {
    writeFileSync(assetPath, 'x');
  }
  const recordedModifiedAt = input.available === false
    ? now
    : new Date(Number(statSync(assetPath).mtimeMs)).toISOString();
  db.prepare(
    `INSERT INTO assets
       (asset_id, location_kind, managed_folder_id, relative_file_path,
        current_revision_id, availability, created_at, updated_at, path_identity)
     VALUES (?, 'managed', NULL, ?, ?, ?, ?, ?, ?)`,
  ).run(
    assetId,
    input.fileName,
    revisionId,
    input.available === false ? 'missing' : 'available',
    now,
    now,
    portablePathIdentity(input.fileName),
  );
  db.prepare(
    `INSERT INTO revisions
       (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
        original_filename, origin, accepted_at)
     VALUES (?, ?, NULL, 1, ?, ?, 'import', ?)`,
  ).run(revisionId, assetId, recordedModifiedAt, input.fileName, recordedModifiedAt);
  const insertArtifact = db.prepare(
    `INSERT INTO revision_artifacts
       (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
        generator_version, status, error_code, generated_at)
     VALUES (?, ?, ?, 'application/octet-stream', 0, ?, 'test-1', ?, ?, ?)`,
  );
  // contact_sheet jobs require durable metadata (and historically also had a
  // ready poster precondition); webm_proxy jobs require a ready thumbnail/poster
  // (playbackRows semantics); mirror that precondition in the fixture. The
  // artifact file must exist on disk too, otherwise reconcileMissingArtifactFiles
  // invalidates the ready thumbnail on open.
  if (input.kind === 'contact_sheet') {
    const posterRelativePath = 'poster.jpg';
    if (input.available !== false) {
      writeFileSync(path.join(libraryPath, '.serpent', 'artifacts', posterRelativePath), 'poster');
    }
    insertArtifact.run(
      randomUUID(), revisionId, 'video_poster', posterRelativePath,
      'ready', null, now,
    );
    const metadataRelativePath = 'metadata.json';
    if (input.available !== false) {
      writeFileSync(
        path.join(libraryPath, '.serpent', 'artifacts', metadataRelativePath),
        JSON.stringify({ durationMs: 1000, width: 1920, height: 1080 }),
      );
    }
    insertArtifact.run(
      randomUUID(), revisionId, 'extracted_metadata', metadataRelativePath,
      'ready', null, now,
    );
  }
  if (input.kind === 'webm_proxy') {
    // file_path must be relative to the artifacts root (production writes
    // `${artifactId}.png`), otherwise reconcileMissingArtifactFiles resolves
    // the absolute path against the root, misses the file, and invalidates
    // the ready thumbnail on open — which then blocks webm_proxy enqueue.
    const thumbRelativePath = 'thumb.png';
    if (input.available !== false) {
      writeFileSync(path.join(libraryPath, '.serpent', 'artifacts', thumbRelativePath), 'png');
    }
    insertArtifact.run(
      randomUUID(), revisionId, 'thumbnail', thumbRelativePath,
      'ready', null, now,
    );
  }
  insertArtifact.run(
    randomUUID(), revisionId, input.kind, `/tmp/${input.fileName}`,
    'failed', input.errorCode, input.failedAt.toISOString(),
  );
  db.close();
  return { assetId };
}

function queuedJobCount(dbPath: string, kind: string): number {
  const db = new Database(dbPath);
  const row = db
    .prepare(
      "SELECT COUNT(*) AS c FROM jobs WHERE kind = ? AND status = 'queued'",
    )
    .get(kind) as { c: number };
  db.close();
  return row.c;
}

function invalidatedArtifactCount(dbPath: string): number {
  const db = new Database(dbPath);
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM revision_artifacts WHERE status = 'failed' AND invalidated_at IS NOT NULL")
    .get() as { c: number };
  db.close();
  return row.c;
}

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('retryable failed derived artifacts (Serpent-5xbg)', () => {
  it('does not auto-reenqueue a video proxy failure', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: '重试库', selectedParentPath: root });
    service.closeAll();
    const dbPath = path.join(created.libraryPath, '.serpent', 'library.db');
    insertFailedAsset(created.libraryPath, {
      fileName: 'video.mp4',
      kind: 'webm_proxy',
      errorCode: 'FFMPEG_REQUIRED',
      failedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });

    service.openLibrary(created.libraryPath); // startup enqueue retries once
    service.enqueueThumbnailJobs(created.libraryId, { retryFailed: true });

    expect(queuedJobCount(dbPath, 'generate_webm_proxy')).toBe(0);
    expect(invalidatedArtifactCount(dbPath)).toBe(0);
  });

  it('re-enqueues a failed contact sheet when metadata and poster are ready', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: '联系表重试库', selectedParentPath: root });
    service.closeAll();
    const dbPath = path.join(created.libraryPath, '.serpent', 'library.db');
    insertFailedAsset(created.libraryPath, {
      fileName: 'video.mp4',
      kind: 'contact_sheet',
      errorCode: 'CONTACT_SHEET_GENERATION_FAILED',
      failedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });

    service.openLibrary(created.libraryPath);
    service.enqueueThumbnailJobs(created.libraryId, { retryFailed: true });

    expect(queuedJobCount(dbPath, 'generate_contact_sheet')).toBe(1);
    expect(invalidatedArtifactCount(dbPath)).toBe(1);
  });

  it('never retries permanent failures (missing source, unsupported format)', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: '永久失败库', selectedParentPath: root });
    service.closeAll();
    const dbPath = path.join(created.libraryPath, '.serpent', 'library.db');
    insertFailedAsset(created.libraryPath, {
      fileName: 'broken.png',
      kind: 'thumbnail',
      errorCode: 'SOURCE_NOT_FOUND',
      failedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
    insertFailedAsset(created.libraryPath, {
      fileName: 'weird.xyz',
      kind: 'thumbnail',
      errorCode: 'UNSUPPORTED_FORMAT',
      failedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });

    service.openLibrary(created.libraryId ? created.libraryPath : created.libraryPath);
    service.enqueueThumbnailJobs(created.libraryId, { retryFailed: true });

    expect(queuedJobCount(dbPath, 'generate_thumbnail')).toBe(0);
    expect(invalidatedArtifactCount(dbPath)).toBe(0);
  });

  it('respects the backoff window (recent failures wait)', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: '节流库', selectedParentPath: root });
    service.closeAll();
    const dbPath = path.join(created.libraryPath, '.serpent', 'library.db');
    insertFailedAsset(created.libraryPath, {
      fileName: 'fresh.mp4',
      kind: 'webm_proxy',
      errorCode: 'MEDIA_PROCESSING_FAILED',
      failedAt: new Date(Date.now() - 60 * 1000),
    });

    service.openLibrary(created.libraryPath);
    service.enqueueThumbnailJobs(created.libraryId, { retryFailed: true });

    expect(queuedJobCount(dbPath, 'generate_webm_proxy')).toBe(0);
    expect(invalidatedArtifactCount(dbPath)).toBe(0);
  });

  it('does not retry when the source asset is missing on disk', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: '源缺失库', selectedParentPath: root });
    service.closeAll();
    const dbPath = path.join(created.libraryPath, '.serpent', 'library.db');
    insertFailedAsset(created.libraryPath, {
      fileName: 'gone.mp4',
      kind: 'webm_proxy',
      errorCode: 'MEDIA_PROCESSING_FAILED',
      failedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      available: false,
    });

    service.openLibrary(created.libraryPath);
    service.enqueueThumbnailJobs(created.libraryId, { retryFailed: true });

    expect(queuedJobCount(dbPath, 'generate_webm_proxy')).toBe(0);
    expect(invalidatedArtifactCount(dbPath)).toBe(0);
  });

  it('keeps video proxy retry explicit and idempotent', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: '幂等库', selectedParentPath: root });
    service.closeAll();
    const dbPath = path.join(created.libraryPath, '.serpent', 'library.db');
    insertFailedAsset(created.libraryPath, {
      fileName: 'video.mp4',
      kind: 'webm_proxy',
      errorCode: 'FFMPEG_REQUIRED',
      failedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });

    service.openLibrary(created.libraryPath);
    service.enqueueThumbnailJobs(created.libraryId, { retryFailed: true });
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;
    const firstJob = service.enqueueArtifactRetry({
      libraryId: created.libraryId,
      assetId: asset.assetId,
      kind: 'webm_proxy',
    });
    const secondJob = service.enqueueArtifactRetry({
      libraryId: created.libraryId,
      assetId: asset.assetId,
      kind: 'webm_proxy',
    });

    expect(queuedJobCount(dbPath, 'generate_webm_proxy')).toBe(1);
    expect(secondJob).toBe(firstJob);
  });
});
