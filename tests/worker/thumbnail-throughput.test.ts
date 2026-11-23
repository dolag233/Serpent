import { mkdirSync, mkdtempSync, realpathSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
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

function delayedSharp(onWrite: () => void, delayMs = 50) {
  const createPipeline = instantSharp();
  return (...args: Parameters<ReturnType<typeof instantSharp>>) => {
    const pipeline = createPipeline(...args);
    const write = pipeline.toFile;
    pipeline.toFile = async function delayedToFile(outputPath: string) {
      onWrite();
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return write.call(this, outputPath);
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

  it('narrows future claims when a newer visible window arrives', async () => {
    const root = temporaryRoot();
    let writeCount = 0;
    let bothWritesStarted!: () => void;
    const twoWritesStarted = new Promise<void>((resolve) => {
      bothWritesStarted = resolve;
    });
    const service = new LibraryService({
      sharpFn: delayedSharp(() => {
        writeCount += 1;
        if (writeCount === 2) bothWritesStarted();
      }, 80),
    });
    const created = service.createLibrary({ displayName: 'PreserveVisibleClaim', selectedParentPath: root });
    const sourceDir = path.join(root, 'sources');
    createDistinctPngs(sourceDir, 3);
    importFolderNoConflict(service, created.libraryId, sourceDir);
    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    expect(assets).toHaveLength(3);
    const [overlapping, stale, outside] = assets;
    expect(service.enqueueThumbnailJobs(created.libraryId, {
      assetIds: [overlapping!.assetId, stale!.assetId, outside!.assetId],
      priority: 350,
    })).toBe(3);

    const claimAssetIdsRef = {
      current: [overlapping!.assetId, stale!.assetId, outside!.assetId],
    };
    const processing = service.processThumbnailQueue(created.libraryId, {
      maxJobs: 3,
      jobKinds: ['generate_thumbnail'],
      assetIds: claimAssetIdsRef.current,
      claimAssetIdsRef,
    });
    await twoWritesStarted;
    claimAssetIdsRef.current = [overlapping!.assetId];
    await processing;

    const statuses = service.listMediaJobs(created.libraryId).jobs;
    expect(statuses.find((job) => job.assetId === overlapping!.assetId && job.kind === 'generate_thumbnail')?.status).toBe('succeeded');
    // Jobs already claimed before the report are allowed to finish; only
    // future claims are narrowed to the latest viewport.
    expect(statuses.find((job) => job.assetId === stale!.assetId && job.kind === 'generate_thumbnail')?.status).toBe('succeeded');
    expect(statuses.find((job) => job.assetId === outside!.assetId && job.kind === 'generate_thumbnail')?.status).toBe('queued');
    service.closeAll();
  });

  it('claims overlay-ranked ids before later ids that share the same persistent priority', async () => {
    const root = temporaryRoot();
    const service = new LibraryService({ sharpFn: instantSharp() });
    const created = service.createLibrary({
      displayName: 'RankedViewportClaim',
      selectedParentPath: root,
    });
    const sourceDir = path.join(root, 'sources');
    createDistinctPngs(sourceDir, 3);
    importFolderNoConflict(service, created.libraryId, sourceDir);
    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    expect(assets).toHaveLength(3);
    const first = assets[0]!;
    const last = assets[2]!;
    expect(service.enqueueThumbnailJobs(created.libraryId, {
      assetIds: assets.map((asset) => asset.assetId),
      priority: 50,
    })).toBe(3);

    const ranked = [last.assetId, first.assetId];
    expect(await service.processThumbnailQueue(created.libraryId, {
      maxJobs: 1,
      jobKinds: ['generate_thumbnail'],
      assetIds: ranked,
      claimAssetIdsRef: { current: ranked },
    })).toBe(1);

    const statuses = service.listMediaJobs(created.libraryId).jobs;
    expect(statuses.find((job) => job.assetId === last.assetId && job.kind === 'generate_thumbnail')?.status)
      .toBe('succeeded');
    expect(statuses.find((job) => job.assetId === first.assetId && job.kind === 'generate_thumbnail')?.status)
      .toBe('queued');
    service.closeAll();
  });

  it('uses the newest rank when an in-flight scope keeps the same asset members', async () => {
    const disk = statfsSync(tmpdir());
    if (disk.bavail * disk.bsize < 8 * 1024 * 1024) throw new Error('Insufficient fixture storage.');
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-thumb-rank-'));
    const ownedRoot = realpathSync(root);
    let releaseWrites!: () => void;
    const blockedWrites = new Promise<void>(resolve => { releaseWrites = resolve; });
    let writeCount = 0;
    const createPipeline = instantSharp();
    const service = new LibraryService({
      sharpFn: () => {
        const pipeline = createPipeline();
        const write = pipeline.toFile;
        pipeline.toFile = async outputPath => {
          writeCount += 1;
          await blockedWrites;
          await write(outputPath);
        };
        return pipeline;
      },
    });
    let processing: Promise<number> | undefined;
    const failures: unknown[] = [];
    try {
      const library = service.createLibrary({ displayName: 'ReorderedViewport', selectedParentPath: root });
      const sourceDir = path.join(root, 'sources');
      createDistinctPngs(sourceDir, 6);
      importFolderNoConflict(service, library.libraryId, sourceDir);
      const assets = service.listAssets({ libraryId: library.libraryId, recursive: true });
      const initial = assets.map(asset => asset.assetId);
      expect(initial).toHaveLength(6);
      expect(service.enqueueThumbnailJobs(library.libraryId, { assetIds: initial, priority: 350 })).toBe(6);
      const scope = { current: initial };
      processing = service.processThumbnailQueue(library.libraryId, {
        maxJobs: 3, jobKinds: ['generate_thumbnail'], assetIds: initial, claimAssetIdsRef: scope,
      });
      void processing.catch(() => undefined);
      await vi.waitFor(() => expect(writeCount).toBe(2));
      const promoted = initial.at(-1)!;
      scope.current = [promoted, ...initial.slice(0, -1)];
      // Both original decodes were already admitted. Only the next claim may
      // change: promote the newly focused/visible item without changing the set.
      releaseWrites();
      expect(await processing).toBe(3);
      const jobs = service.listMediaJobs(library.libraryId).jobs
        .filter(job => job.kind === 'generate_thumbnail');
      expect(jobs.find(job => job.assetId === promoted)?.status).toBe('succeeded');
      expect(jobs.find(job => job.assetId === initial[2])?.status).toBe('queued');
    } catch (error) {
      failures.push(error);
    } finally {
      releaseWrites();
      await Promise.allSettled(processing ? [processing] : []);
      let closed = false;
      try {
        service.closeAll();
        closed = true;
      } catch (error) {
        failures.push(error);
      }
      if (closed) try {
        if (realpathSync(root) !== ownedRoot || path.dirname(ownedRoot) !== realpathSync(tmpdir())) {
          failures.push(new Error('Owned fixture cleanup boundary changed.'));
        } else {
          rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        }
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, 'Rank regression and fixture cleanup failures.');
  });

  it('claims jobs outside the overlay after foreground bands have no queued work', async () => {
    const root = temporaryRoot();
    const service = new LibraryService({ sharpFn: instantSharp() });
    const created = service.createLibrary({
      displayName: 'OverlayThenPersist',
      selectedParentPath: root,
    });
    const sourceDir = path.join(root, 'sources');
    createDistinctPngs(sourceDir, 6);
    importFolderNoConflict(service, created.libraryId, sourceDir);
    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    expect(assets).toHaveLength(6);
    const overlayIds = assets.slice(0, 2).map((asset) => asset.assetId);
    const outsideIds = new Set(assets.slice(2).map((asset) => asset.assetId));
    expect(service.enqueueThumbnailJobs(created.libraryId, {
      assetIds: assets.map((asset) => asset.assetId),
      priority: 50,
    })).toBe(6);

    const claimAssetIdsRef = { current: overlayIds as readonly string[] | undefined };
    expect(await service.processThumbnailQueue(created.libraryId, {
      maxJobs: 4,
      jobKinds: ['generate_thumbnail'],
      claimAssetIdsRef,
    })).toBe(4);

    const statuses = service.listMediaJobs(created.libraryId).jobs
      .filter((job) => job.kind === 'generate_thumbnail' && job.status === 'succeeded')
      .map((job) => job.assetId);
    expect(overlayIds.every((assetId) => statuses.includes(assetId))).toBe(true);
    expect(statuses.some((assetId) => outsideIds.has(assetId))).toBe(true);
    service.closeAll();
  });
});

describe('thumbnail queue wakeable worker pool', () => {
  it('uses an idle worker for a newly visible job before a slow prior job settles', async () => {
    const disk = statfsSync(tmpdir());
    if (disk.bavail * disk.bsize < 8 * 1024 * 1024) throw new Error('Insufficient fixture storage.');
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-thumb-wake-'));
    const ownedRoot = realpathSync(root);
    const failures: unknown[] = [];
    let releaseSlowWrite!: () => void;
    const slowWriteRelease = new Promise<void>(resolve => { releaseSlowWrite = resolve; });
    let service: LibraryService | undefined;
    let processing: Promise<number> | undefined;
    let slowWriteStarted = false;
    let slowWriteFinished = false;
    let fastAssetReady = false;
    let thirdAssetReady = false;
    let writeCount = 0;
    let activeWrites = 0;
    let maxActiveWrites = 0;
    let oldWake: ((maxJobs: number) => boolean) | undefined;

    try {
      expect(workerMediaDecodeConcurrency()).toBe(2);
      const createPipeline = instantSharp();
      service = new LibraryService({
        sharpFn: () => {
          const pipeline = createPipeline();
          const write = pipeline.toFile;
          pipeline.toFile = async function gatedToFile(outputPath: string) {
            const writeNumber = ++writeCount;
            activeWrites += 1;
            maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
            try {
              if (writeNumber === 1) {
                slowWriteStarted = true;
                await slowWriteRelease;
                slowWriteFinished = true;
              }
              return await write.call(this, outputPath);
            } finally {
              activeWrites -= 1;
            }
          };
          return pipeline;
        },
      });
      const library = service.createLibrary({
        displayName: 'WakeableWorkerPool',
        selectedParentPath: root,
      });
      const sourceDir = path.join(root, 'sources');
      createDistinctPngs(sourceDir, 3);
      importFolderNoConflict(service, library.libraryId, sourceDir);
      const assets = service.listAssets({ libraryId: library.libraryId, recursive: true });
      expect(assets).toHaveLength(3);
      const [slowAsset, fastAsset, thirdAsset] = assets;
      if (!slowAsset || !fastAsset || !thirdAsset) throw new Error('Expected three fixture images.');

      expect(service.enqueueThumbnailJobs(library.libraryId, {
        assetIds: [slowAsset.assetId, fastAsset.assetId],
        priority: 350,
      })).toBe(2);

      const scope = { current: [slowAsset.assetId, fastAsset.assetId] as readonly string[] | undefined };
      const wakeRef: { current?: (maxJobs: number) => boolean } = {};
      processing = service.processThumbnailQueue(library.libraryId, {
        maxJobs: 2,
        jobKinds: ['generate_thumbnail'],
        assetIds: scope.current,
        claimAssetIdsRef: scope,
        wakeRef,
        onResult: result => {
          if (result.assetId === fastAsset.assetId && result.artifactId) fastAssetReady = true;
          if (result.assetId === thirdAsset.assetId && result.artifactId) thirdAssetReady = true;
        },
      });
      void processing.catch(() => undefined);

      await vi.waitFor(() => {
        expect(slowWriteStarted).toBe(true);
        expect(fastAssetReady).toBe(true);
      }, { timeout: 10_000, interval: 10 });
      expect(slowWriteFinished).toBe(false);

      oldWake = wakeRef.current;
      if (!oldWake) throw new Error('The active media queue did not publish its wake callback.');
      expect(service.enqueueThumbnailJobs(library.libraryId, {
        assetIds: [thirdAsset.assetId],
        priority: 350,
      })).toBe(1);
      scope.current = [thirdAsset.assetId];
      expect(oldWake(1)).toBe(true);

      await vi.waitFor(() => {
        expect(thirdAssetReady).toBe(true);
        const status = service!.listMediaJobs(library.libraryId).jobs.find(job =>
          job.assetId === thirdAsset.assetId && job.kind === 'generate_thumbnail')?.status;
        expect(status).toBe('succeeded');
      }, { timeout: 10_000, interval: 10 });
      expect(slowWriteFinished).toBe(false);
      expect(maxActiveWrites).toBeLessThanOrEqual(4);

      releaseSlowWrite();
      expect(await processing).toBe(3);
      expect(wakeRef.current).toBeUndefined();
      expect(oldWake(1)).toBe(false);

      const terminalJobs = service.listMediaJobs(library.libraryId).jobs
        .filter(job => job.kind === 'generate_thumbnail'
          && [slowAsset.assetId, fastAsset.assetId, thirdAsset.assetId].includes(job.assetId));
      expect(terminalJobs).toHaveLength(3);
      expect(terminalJobs.every(job => job.status === 'succeeded')).toBe(true);
    } catch (error) {
      failures.push(error);
    } finally {
      releaseSlowWrite();
      await Promise.allSettled(processing ? [processing] : []);
      let serviceClosed = false;
      try {
        service?.closeAll();
        serviceClosed = true;
      } catch (error) {
        failures.push(error);
      }
      if (serviceClosed) {
        try {
          if (realpathSync(root) !== ownedRoot || path.dirname(ownedRoot) !== realpathSync(tmpdir())) {
            failures.push(new Error('Owned wake fixture cleanup boundary changed.'));
          } else {
            rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
          }
        } catch (error) {
          failures.push(error);
        }
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Wakeable thumbnail regression and fixture cleanup failures.');
    }
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

describe('visible thumbnail admission (Serpent-d6)', () => {
  it('keeps model rendering out of the fast visible wave while preserving order', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'VisibleMediaKinds', selectedParentPath: root });

    const sourceDir = path.join(root, 'sources');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(path.join(sourceDir, 'image.png'), distinctPngBytes(1));
    writeFileSync(path.join(sourceDir, 'model.glb'), Buffer.from('glTF-model-placeholder'));
    writeFileSync(path.join(sourceDir, 'second.png'), distinctPngBytes(2));
    importFolderNoConflict(service, created.libraryId, sourceDir);

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    const model = assets.find((asset) => asset.displayName === 'model.glb')!;
    const image = assets.find((asset) => asset.displayName === 'image.png')!;
    const second = assets.find((asset) => asset.displayName === 'second.png')!;
    const selected = [model.assetId, image.assetId, second.assetId, model.assetId];

    expect(service.filterVisibleThumbnailAssetIds(created.libraryId, selected)).toEqual([
      image.assetId,
      second.assetId,
    ]);
    expect(service.enqueueThumbnailJobs(created.libraryId, {
      assetIds: selected,
      priority: 350,
      limit: selected.length,
    })).toBe(3);

    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const modelJob = db.prepare(
      `SELECT COUNT(*) AS count FROM jobs
        WHERE asset_id = ? AND kind = 'generate_thumbnail'`,
    ).get(model.assetId) as { count: number };
    db.close();
    // Filtering is an admission policy for the visible wave, not a format
    // policy: the model remains queueable for startup/mutation processing.
    expect(modelJob.count).toBe(1);
    service.closeAll();
  });

  it('prioritizes image cards ahead of video posters in an interactive wave', async () => {
    const root = temporaryRoot();
    const service = new LibraryService({
      sharpFn: instantSharp(),
      spawnFn: async (_command, args) => {
        const outputPath = args.at(-1);
        if (outputPath) {
          mkdirSync(path.dirname(outputPath), { recursive: true });
          writeFileSync(outputPath, Buffer.from('mock-video-poster'));
        }
        return { stdout: Buffer.alloc(0), stderr: '', exitCode: 0 };
      },
    });
    const created = service.createLibrary({ displayName: 'VisibleImageFirst', selectedParentPath: root });

    const sourceDir = path.join(root, 'sources');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(path.join(sourceDir, 'image.png'), distinctPngBytes(3));
    writeFileSync(path.join(sourceDir, 'video.mp4'), Buffer.from('mock-video-source'));
    importFolderNoConflict(service, created.libraryId, sourceDir);

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    const image = assets.find((asset) => asset.displayName === 'image.png')!;
    const video = assets.find((asset) => asset.displayName === 'video.mp4')!;
    expect(image).toBeDefined();
    expect(video).toBeDefined();
    expect(service.enqueueThumbnailJobs(created.libraryId, {
      assetIds: [video.assetId, image.assetId],
      priority: 350,
      limit: 2,
    })).toBe(2);

    // Make the video the FIFO winner under the old priority/created_at order;
    // the interactive image-first term must still claim the image.
    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const stamp = db.prepare(
      "UPDATE jobs SET created_at = ? WHERE asset_id = ? AND kind = 'generate_thumbnail'",
    );
    stamp.run('2026-01-01T00:00:00.000Z', video.assetId);
    stamp.run('2026-01-01T00:00:01.000Z', image.assetId);
    db.close();

    const completed: string[] = [];
    expect(await service.processThumbnailQueue(created.libraryId, {
      maxJobs: 1,
      jobKinds: ['generate_thumbnail'],
      assetIds: [video.assetId, image.assetId],
      interactive: true,
      onResult: ({ assetId }) => completed.push(assetId),
    })).toBe(1);
    expect(completed).toEqual([image.assetId]);
    service.closeAll();
  });
});
