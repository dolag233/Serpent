import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
} from '../../src/worker/library-service';
import { workerMediaDecodeConcurrency } from '../../src/worker/media-concurrency';

const temporaryRoots: string[] = [];
const require = createRequire(import.meta.url);

interface TestDatabaseConnection {
  close(): void;
  exec(source: string): void;
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
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-thumb-throughput-'));
  temporaryRoots.push(root);
  return root;
}

// A valid 2049×1 PNG deliberately sits just above the source-direct long-edge
// limit. These tests exercise derived-thumbnail queue ordering, not the
// source-direct image path; a distinct 4-byte trailer keeps every imported
// file's content hash unique so library-level content dedup never collapses
// the batch.
const THUMBNAIL_REQUIRED_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAACAEAAAABCAIAAAAqtLKbAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAOklEQVRYhe3YQQ0AAAgDMeRMImInBh+kySno8yZbESBAgAABAgQIECBAgAABAgQIECBAgAABAnk3zA9mXOIiDxU7WQAAAABJRU5ErkJggg==',
  'base64',
);

function distinctPngBytes(index: number): Buffer {
  const trailer = Buffer.from([
    (index >> 24) & 0xff, (index >> 16) & 0xff, (index >> 8) & 0xff, index & 0xff,
  ]);
  return Buffer.concat([THUMBNAIL_REQUIRED_PNG, trailer]);
}

/**
 * Instant mock decoder: the decode itself costs ~0ms, so a
 * processThumbnailQueue wave is dominated by the queue's per-job DB work —
 * exactly what the Serpent-xoaz batching assertions target.
 */
function instantSharp() {
  return () => {
    const pipeline = {
      metadata: async () => ({ width: 1, height: 1, format: 'png', pages: 1 }),
      rotate() { return this; },
      toColourspace() { return this; },
      resize() { return this; },
      composite() { return this; },
      webp() { return this; },
      jpeg() { return this; },
      async toFile(outputPath: string) {
        writeFileSync(outputPath, THUMBNAIL_REQUIRED_PNG);
      },
    };
    return pipeline;
  };
}

function createDistinctPngs(directory: string, count: number): void {
  mkdirSync(directory, { recursive: true });
  for (let index = 0; index < count; index += 1) {
    const name = `img-${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}.png`;
    writeFileSync(path.join(directory, name), distinctPngBytes(index));
  }
}

function importFolderNoConflict(service: LibraryService, libraryId: string, folderPath: string): void {
  const prepared = service.prepareOrExecuteImport({
    libraryId,
    sourceKind: 'folder',
    sourcePaths: [folderPath],
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

describe('thumbnail queue DB-write batching (Serpent-xoaz)', () => {
  it('returns control between successive claim rounds', async () => {
    const root = temporaryRoot();
    let claimCount = 0;
    let eventLoopYielded = false;
    let thirdClaimBeforeYield = false;
    const service = new LibraryService({
      sharpFn: instantSharp(),
      onDbStatement: (sql) => {
        if (!sql.includes("UPDATE jobs SET status = 'running'")) return;
        claimCount += 1;
        if (claimCount === 2) {
          setImmediate(() => {
            eventLoopYielded = true;
          });
        } else if (claimCount === 3 && !eventLoopYielded) {
          thirdClaimBeforeYield = true;
        }
      },
    });
    const created = service.createLibrary({ displayName: 'ClaimYield', selectedParentPath: root });

    const sourceDir = path.join(root, 'sources');
    createDistinctPngs(sourceDir, 6);
    importFolderNoConflict(service, created.libraryId, sourceDir);
    expect(service.enqueueThumbnailJobs(created.libraryId, { limit: 500 })).toBe(6);

    expect(await service.processThumbnailQueue(created.libraryId, { maxJobs: 6 })).toBe(6);
    expect(claimCount).toBe(6);
    expect(thirdClaimBeforeYield).toBe(false);
    service.closeAll();
  });

  it('flushes one batched success UPDATE per worker instead of one per job', async () => {
    const root = temporaryRoot();
    const statements: string[] = [];
    const service = new LibraryService({
      sharpFn: instantSharp(),
      onDbStatement: (sql) => statements.push(sql),
    });
    const created = service.createLibrary({ displayName: 'BatchWrites', selectedParentPath: root });

    const jobCount = 48;
    const sourceDir = path.join(root, 'sources');
    createDistinctPngs(sourceDir, jobCount);
    importFolderNoConflict(service, created.libraryId, sourceDir);
    const assetCount = service.listAssets({ libraryId: created.libraryId, recursive: true }).length;
    expect(assetCount).toBe(jobCount);

    expect(service.enqueueThumbnailJobs(created.libraryId, { limit: 500 })).toBe(jobCount);

    // Count only the statements executed while the queue drains.
    statements.length = 0;
    const processed = await service.processThumbnailQueue(created.libraryId, { maxJobs: jobCount });
    expect(processed).toBe(jobCount);

    const successUpdates = statements.filter((sql) =>
      sql.includes("status = 'succeeded'") && sql.includes('UPDATE jobs'),
    );
    // Every success transition must go through the batched form.
    expect(successUpdates.length).toBeGreaterThan(0);
    expect(successUpdates.every((sql) => sql.includes('job_id IN ('))).toBe(true);
    // At most one flush per worker; the old code issued one UPDATE per job.
    expect(successUpdates.length).toBeLessThanOrEqual(workerMediaDecodeConcurrency());

    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const summary = db.prepare(
      `SELECT status, COUNT(*) AS count FROM jobs
        WHERE kind = 'generate_thumbnail' GROUP BY status`,
    ).all() as Array<{ status: string; count: number }>;
    db.close();
    const succeeded = summary.find((row) => row.status === 'succeeded');
    expect(succeeded?.count).toBe(jobCount);
    expect(summary.some((row) => row.status === 'queued')).toBe(false);
    expect(summary.some((row) => row.status === 'failed')).toBe(false);
    service.closeAll();
  });
});

describe('thumbnail fill order (Serpent-xoaz)', () => {
  it('drains most-recently-imported assets first (created_at DESC) instead of pure path order', async () => {
    const root = temporaryRoot();
    const service = new LibraryService({ sharpFn: instantSharp() });
    const created = service.createLibrary({ displayName: 'FillOrder', selectedParentPath: root });

    const sourceDir = path.join(root, 'sources');
    createDistinctPngs(sourceDir, 6);
    importFolderNoConflict(service, created.libraryId, sourceDir);

    // Stamp distinct import times on the assets (base + i seconds) so the
    // fill order is fully deterministic; path order is the opposite of this.
    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const assets = db.prepare(
      'SELECT asset_id, relative_file_path FROM assets ORDER BY relative_file_path',
    ).all() as Array<{ asset_id: string; relative_file_path: string }>;
    expect(assets).toHaveLength(6);
    const base = Date.parse('2026-01-01T00:00:00.000Z');
    const stamp = db.prepare('UPDATE assets SET created_at = ? WHERE asset_id = ?');
    assets.forEach((asset, index) => {
      stamp.run(new Date(base + index * 1000).toISOString(), asset.asset_id);
    });
    db.close();

    // A 3-job fill wave must pick the three most recently imported assets.
    expect(service.enqueueThumbnailJobs(created.libraryId, { limit: 3 })).toBe(3);
    const db2 = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const queued = db2.prepare(
      "SELECT a.relative_file_path FROM jobs j JOIN assets a ON a.asset_id = j.asset_id WHERE j.kind = 'generate_thumbnail' AND j.status = 'queued' ORDER BY j.priority DESC, j.created_at",
    ).all() as Array<{ relative_file_path: string }>;
    db2.close();

    const newestPaths = assets.slice(3).map((asset) => asset.relative_file_path).sort();
    expect(queued.map((row) => row.relative_file_path).sort()).toEqual(newestPaths);
    service.closeAll();
  });

  it('keeps the caller id order for explicit waves regardless of created_at (Serpent-x9xu follow-up)', async () => {
    const root = temporaryRoot();
    const service = new LibraryService({ sharpFn: instantSharp() });
    const created = service.createLibrary({ displayName: 'ExplicitOrder', selectedParentPath: root });

    const sourceDir = path.join(root, 'sources');
    createDistinctPngs(sourceDir, 6);
    importFolderNoConflict(service, created.libraryId, sourceDir);

    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const assets = db.prepare(
      'SELECT asset_id FROM assets ORDER BY relative_file_path',
    ).all() as Array<{ asset_id: string }>;
    expect(assets).toHaveLength(6);
    const base = Date.parse('2026-01-01T00:00:00.000Z');
    const stamp = db.prepare('UPDATE assets SET created_at = ? WHERE asset_id = ?');
    // Path-first assets are the OLDEST imports; path-last are the newest —
    // created_at DESC would flip the caller order.
    assets.forEach((asset, index) => {
      stamp.run(new Date(base + index * 1000).toISOString(), asset.asset_id);
    });
    db.close();

    // Caller requests the path-first three in their list order.
    const requested = assets.slice(0, 3).map((asset) => asset.asset_id);
    expect(service.enqueueThumbnailJobs(created.libraryId, { assetIds: requested, priority: 350 })).toBe(3);
    const db2 = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const jobs = db2.prepare(
      "SELECT asset_id FROM jobs WHERE kind = 'generate_thumbnail' AND status = 'queued' ORDER BY rowid",
    ).all() as Array<{ asset_id: string }>;
    db2.close();
    // Insertion order follows the caller's id sequence, not created_at DESC.
    expect(jobs.map((job) => job.asset_id)).toEqual(requested);
    service.closeAll();
  });
});
