import { execFile, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  LibraryService,
  type LibraryServiceDiagnostic,
} from '../../src/worker/library-service';
import { mediaResourceGuard } from '../../src/worker/media-resource-guard';
import { isSourceDirectPreview } from '../../src/shared/preview-policy';
import type { LargeLibraryFixtureManifest } from './large-library-fixture';

/**
 * This is an operator-run benchmark, not a CI smoke test. It deliberately
 * deletes only visual artifacts in a disposable clone, then measures a cold
 * native decode wave repeatedly. The query benchmark and Electron scroll
 * benchmark cannot expose decoder RSS or FFmpeg child pressure.
 */
const fixturePath = process.env.SERPENT_MEDIA_TASK_PERF_PATH;
const enabled = process.env.SERPENT_MEDIA_TASK_PERF === '1';
const requestedAssetCount = Math.max(
  20,
  Math.min(200, Math.trunc(Number(process.env.SERPENT_MEDIA_TASK_PERF_ASSETS ?? 100))),
);
const roundCount = Math.max(
  1,
  Math.min(5, Math.trunc(Number(process.env.SERPENT_MEDIA_TASK_PERF_ROUNDS ?? 3))),
);
const maxRssDeltaMb = Math.max(
  128,
  Number(process.env.SERPENT_MEDIA_TASK_PERF_MAX_RSS_DELTA_MB ?? 768),
);
const reuseLibraryPath = process.env.SERPENT_MEDIA_TASK_PERF_REUSE_LIBRARY;

type Database = new (filename: string, options?: { readonly?: boolean }) => {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): {
    all(...parameters: unknown[]): unknown[];
    run(...parameters: unknown[]): { changes: number };
  };
};

type BenchAsset = {
  assetId: string;
  byteSize: number | null;
  height: number | null;
  relativeFilePath: string;
  width: number | null;
};

type RssSample = {
  rssBytes: number;
  atMs: number;
};

type MemorySampler = {
  stop(): Promise<{
    peakRssBytes: number;
    maxEventLoopLagMs: number;
  }>;
};

const require = createRequire(import.meta.url);
const TestDatabase = require('better-sqlite3') as Database;
let temporaryRoot = '';
let temporaryLibraryPath = '';
let manifest: LargeLibraryFixtureManifest;
let service: LibraryService | undefined;
const diagnostics: LibraryServiceDiagnostic[] = [];

function cloneFixture(sourcePath: string, destinationPath: string): void {
  if (process.platform === 'win32') {
    try {
      execFileSync(
        'robocopy',
        [sourcePath, destinationPath, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'],
        { stdio: 'ignore' },
      );
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (typeof status !== 'number' || status >= 8) throw error;
    }
    return;
  }
  // APFS clone keeps the benchmark isolated without copying a multi-gigabyte
  // fixture. Linux has no portable clone flag in coreutils, so use archive
  // mode there; the suite is explicitly opt-in on that platform as well.
  execFileSync('cp', process.platform === 'darwin'
    ? ['-cR', sourcePath, destinationPath]
    : ['-a', sourcePath, destinationPath]);
}

function databasePath(libraryPath: string): string {
  return path.join(libraryPath, '.serpent', 'library.db');
}

function loadSupportedAssets(libraryPath: string): BenchAsset[] {
  const database = new TestDatabase(databasePath(libraryPath), { readonly: true });
  try {
    const rows = database.prepare(
      `SELECT a.asset_id, a.relative_file_path, r.byte_size,
              (SELECT width
                 FROM revision_artifacts metadata
                WHERE metadata.revision_id = a.current_revision_id
                  AND metadata.kind = 'extracted_metadata'
                  AND metadata.status = 'ready'
                  AND metadata.invalidated_at IS NULL
                LIMIT 1) AS width,
              (SELECT height
                 FROM revision_artifacts metadata
                WHERE metadata.revision_id = a.current_revision_id
                  AND metadata.kind = 'extracted_metadata'
                  AND metadata.status = 'ready'
                  AND metadata.invalidated_at IS NULL
                LIMIT 1) AS height
         FROM assets a
         LEFT JOIN revisions r ON r.revision_id = a.current_revision_id
        WHERE a.deleted_at IS NULL
          AND a.availability = 'available'
         ORDER BY a.relative_file_path`,
    ).all() as Array<{
      asset_id: string;
      byte_size: number | null;
      height: number | null;
      relative_file_path: string;
      width: number | null;
    }>;
    return rows
      .filter((row) => {
        const extension = path.extname(row.relative_file_path).toLowerCase();
        if (![
          '.jpg', '.jpeg', '.png', '.webp', '.gif', '.tiff', '.tif',
          '.mp4', '.webm', '.mov', '.wav',
        ].includes(extension)) return false;
        // Source-direct images intentionally have no thumbnail job. Exclude
        // them so this benchmark measures the native generation path and its
        // memory envelope rather than failing the enqueue cardinality check.
        return !isSourceDirectPreview({
          fileName: row.relative_file_path,
          mediaType: 'image',
          byteSize: row.byte_size ?? 0,
          width: row.width,
          height: row.height,
        });
      })
      .map((row) => ({
        assetId: row.asset_id,
        byteSize: row.byte_size,
        height: row.height,
        relativeFilePath: row.relative_file_path,
        width: row.width,
      }));
  } finally {
    database.close();
  }
}

function selectAssets(libraryPath: string, count: number): BenchAsset[] {
  const all = loadSupportedAssets(libraryPath);
  const groups = new Map<string, BenchAsset[]>();
  for (const asset of all) {
    const extension = path.extname(asset.relativeFilePath).toLowerCase();
    const group = extension === '.tif' || extension === '.tiff'
      ? 'oiio'
      : extension === '.mp4' || extension === '.webm' || extension === '.mov'
        ? 'video'
        : extension === '.wav'
          ? 'audio'
          : 'sharp';
    const entries = groups.get(group) ?? [];
    entries.push(asset);
    groups.set(group, entries);
  }

  const selected: BenchAsset[] = [];
  const selectedIds = new Set<string>();
  const take = (group: string, target: number): void => {
    for (const asset of groups.get(group) ?? []) {
      if (selected.length >= count || selected.length >= target || selectedIds.has(asset.assetId)) break;
      selected.push(asset);
      selectedIds.add(asset.assetId);
    }
  };
  // Keep all native lanes represented. The proportions are intentionally not
  // a product mix assertion; they make a small benchmark exercise every
  // decoder lane before filling the rest with the common Sharp path.
  take('sharp', Math.max(1, Math.round(count * 0.65)));
  take('oiio', Math.max(selected.length + 1, Math.round(count * 0.75)));
  take('video', Math.max(selected.length + 1, Math.round(count * 0.9)));
  take('audio', count);
  for (const asset of all) {
    if (selected.length >= count) break;
    if (selectedIds.has(asset.assetId)) continue;
    selected.push(asset);
    selectedIds.add(asset.assetId);
  }
  return selected;
}

function processTreeRssBytes(stdout: string): number {
  const children = new Map<number, number[]>();
  const rssByPid = new Map<number, number>();
  for (const line of stdout.trim().split('\n')) {
    const fields = line.trim().split(/\s+/u).map(Number);
    if (fields.length !== 3 || fields.some((value) => !Number.isFinite(value))) continue;
    const [pid, parentPid, rssKb] = fields;
    rssByPid.set(pid!, rssKb! * 1024);
    const siblings = children.get(parentPid!) ?? [];
    siblings.push(pid!);
    children.set(parentPid!, siblings);
  }
  const included = new Set<number>([process.pid]);
  const pending = [process.pid];
  while (pending.length > 0) {
    const parentPid = pending.pop()!;
    for (const childPid of children.get(parentPid) ?? []) {
      if (included.has(childPid)) continue;
      included.add(childPid);
      pending.push(childPid);
    }
  }
  return [...included].reduce((total, pid) => total + (rssByPid.get(pid) ?? 0), 0);
}

function startMemorySampler(): MemorySampler {
  const intervalMs = 10;
  const startedAt = performance.now();
  let previousTick = startedAt;
  let peakRssBytes = process.memoryUsage().rss;
  let maxEventLoopLagMs = 0;
  let stopped = false;
  let psInFlight = false;
  let psFinished: (() => void) | undefined;
  const samples: RssSample[] = [];

  const updateRss = (rssBytes: number): void => {
    if (!Number.isFinite(rssBytes) || rssBytes <= 0) return;
    peakRssBytes = Math.max(peakRssBytes, rssBytes);
    samples.push({ rssBytes, atMs: performance.now() - startedAt });
  };
  const sampleProcessTree = (): void => {
    if (process.platform === 'win32' || psInFlight || stopped) return;
    psInFlight = true;
    execFile(
      'ps',
      ['-axo', 'pid=,ppid=,rss='],
      { encoding: 'utf8' },
      (_error, stdout) => {
        psInFlight = false;
        if (!stopped) updateRss(processTreeRssBytes(String(stdout)));
        psFinished?.();
        psFinished = undefined;
      },
    );
  };
  const timer = setInterval(() => {
    const now = performance.now();
    maxEventLoopLagMs = Math.max(maxEventLoopLagMs, Math.max(0, now - previousTick - intervalMs));
    previousTick = now;
    updateRss(process.memoryUsage().rss);
    sampleProcessTree();
  }, intervalMs);

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      if (psInFlight) {
        await new Promise<void>((resolve) => { psFinished = resolve; });
      }
      // Keep the local sample array alive until the final result is assembled;
      // it is useful when this benchmark is inspected under a debugger.
      void samples;
      return { peakRssBytes, maxEventLoopLagMs };
    },
  };
}

function removeVisualArtifacts(libraryPath: string, assets: readonly BenchAsset[]): number {
  if (assets.length === 0) return 0;
  const database = new TestDatabase(databasePath(libraryPath));
  const placeholders = assets.map(() => '?').join(',');
  const rows = database.prepare(
    `SELECT ra.artifact_id, ra.file_path
       FROM revision_artifacts ra
       JOIN assets a ON a.current_revision_id = ra.revision_id
      WHERE a.asset_id IN (${placeholders})
        AND ra.kind IN ('thumbnail', 'video_poster')`,
  ).all(...assets.map((asset) => asset.assetId)) as Array<{
    artifact_id: string;
    file_path: string;
  }>;
  const artifactsRoot = path.resolve(path.join(libraryPath, '.serpent', 'artifacts'));
  const deleteArtifact = database.prepare('DELETE FROM revision_artifacts WHERE artifact_id = ?');
  const cancelJob = database.prepare(
    `UPDATE jobs
        SET status = 'cancelled', updated_at = ?
      WHERE asset_id IN (${placeholders})
        AND kind = 'generate_thumbnail'
        AND status IN ('queued', 'paused', 'running')`,
  );
  database.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      const artifactPath = path.resolve(artifactsRoot, row.file_path);
      if (artifactPath !== artifactsRoot && !artifactPath.startsWith(`${artifactsRoot}${path.sep}`)) {
        throw new Error(`Benchmark artifact escaped its disposable root: ${row.file_path}`);
      }
      rmSync(artifactPath, { force: true });
      deleteArtifact.run(row.artifact_id);
    }
    cancelJob.run(new Date().toISOString(), ...assets.map((asset) => asset.assetId));
    database.exec('COMMIT');
    return rows.length;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
}

describe.skipIf(!enabled || !fixturePath)('native media task performance benchmark', () => {
  beforeAll(() => {
    if (!fixturePath) throw new Error('Set SERPENT_MEDIA_TASK_PERF_PATH to a 20k fixture.');
    const manifestFile = path.join(fixturePath, '.serpent', 'large-library-fixture.json');
    if (!existsSync(manifestFile)) throw new Error(`Missing fixture manifest: ${manifestFile}`);
    manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as LargeLibraryFixtureManifest;
    if (reuseLibraryPath) {
      temporaryLibraryPath = path.resolve(reuseLibraryPath);
    } else {
      temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-media-task-performance-'));
      temporaryLibraryPath = path.join(temporaryRoot, 'library');
      cloneFixture(fixturePath, temporaryLibraryPath);
    }
    service = new LibraryService({
      observerFactory: () => ({ close() {} }),
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    service.openLibrary(temporaryLibraryPath);
  }, 300_000);

  afterAll(() => {
    service?.closeAll();
    mediaResourceGuard.reset();
    if (temporaryRoot) rmSync(temporaryRoot, { force: true, recursive: true });
  });

  it('keeps cold mixed-media waves bounded and repeatable', async () => {
    if (!service) throw new Error('Benchmark service was not initialized.');
    const assets = selectAssets(temporaryLibraryPath, requestedAssetCount);
    expect(assets.length).toBe(requestedAssetCount);
    if (manifest.assetProfile !== 'images-only') {
      expect(assets.some((asset) => ['.mp4', '.webm', '.mov'].includes(path.extname(asset.relativeFilePath).toLowerCase())))
        .toBe(true);
    }

    const rounds: Array<Record<string, number>> = [];
    for (let round = 0; round < roundCount; round += 1) {
      service.closeAll();
      const removed = removeVisualArtifacts(temporaryLibraryPath, assets);
      service.openLibrary(temporaryLibraryPath);
      const activeJobs = service.listMediaJobs(manifest.libraryId).jobs
        .filter((job) => assets.some((asset) => asset.assetId === job.assetId)
          && ['queued', 'paused', 'running'].includes(job.status))
        .map((job) => job.jobId);
      if (activeJobs.length > 0) service.cancelMediaJobs(manifest.libraryId, activeJobs);
      const enqueued = service.enqueueThumbnailJobs(manifest.libraryId, {
        assetIds: assets.map((asset) => asset.assetId),
        limit: assets.length,
        priority: 350,
        skipStaleRepair: true,
        retryFailed: true,
      });
      expect(enqueued).toBe(assets.length);

      const baselineRssBytes = process.memoryUsage().rss;
      const sampler = startMemorySampler();
      const completed = new Set<string>();
      const resultByAsset = new Map<string, { artifactId?: string; errorCode?: string }>();
      const startedAt = performance.now();
      const processed = await service.processThumbnailQueue(manifest.libraryId, {
        maxJobs: assets.length,
        jobKinds: ['generate_thumbnail'],
        assetIds: assets.map((asset) => asset.assetId),
        onResult: (result) => {
          resultByAsset.set(result.assetId, result);
          if (result.artifactId) completed.add(result.assetId);
        },
      });
      const elapsedMs = performance.now() - startedAt;
      const memory = await sampler.stop();
      const rssDeltaMb = (memory.peakRssBytes - baselineRssBytes) / (1024 * 1024);
      const resourceFailures = diagnostics.filter(
        (diagnostic) => diagnostic.scope === 'media-job.resource-exhausted',
      ).length;
      rounds.push({
        round: round + 1,
        requested: assets.length,
        visualArtifactsRemoved: removed,
        enqueued,
        processed,
        completed: completed.size,
        elapsedMs: Number(elapsedMs.toFixed(1)),
        throughputPerSecond: Number((completed.size / Math.max(0.001, elapsedMs / 1_000)).toFixed(2)),
        baselineRssMb: Number((baselineRssBytes / (1024 * 1024)).toFixed(1)),
        peakProcessTreeRssMb: Number((memory.peakRssBytes / (1024 * 1024)).toFixed(1)),
        rssDeltaMb: Number(rssDeltaMb.toFixed(1)),
        maxEventLoopLagMs: Number(memory.maxEventLoopLagMs.toFixed(1)),
        resourceFailures,
      });

      if (completed.size !== assets.length) {
        const selectedIds = new Set(assets.map((asset) => asset.assetId));
        const incomplete = assets
          .filter((asset) => !completed.has(asset.assetId))
          .map((asset) => ({
            ...asset,
            result: resultByAsset.get(asset.assetId) ?? null,
            job: service?.listMediaJobs(manifest.libraryId).jobs
              .find((candidate) => candidate.assetId === asset.assetId) ?? null,
          }));
        console.info(`MEDIA_TASK_PERF_INCOMPLETE ${JSON.stringify({
          round: round + 1,
          completed: completed.size,
          incompleteCount: incomplete.length,
          completedSample: [...completed].slice(0, 10),
          completedOutsideSelected: [...completed].filter((assetId) => !selectedIds.has(assetId)).length,
          assetSample: assets.slice(0, 10).map((asset) => asset.assetId),
          sample: incomplete.slice(0, 10),
        })}`);
      }

      expect(processed).toBe(assets.length);
      expect(completed.size).toBe(assets.length);
      expect(resourceFailures).toBe(0);
      expect(rssDeltaMb).toBeLessThan(maxRssDeltaMb);
      expect(memory.maxEventLoopLagMs).toBeLessThan(250);
    }

    const result = {
      suite: 'native-media-task-performance',
      fixtureAssets: manifest.assetCount,
      requestedAssets: assets.length,
      rounds,
      maxRssDeltaMb,
    };
    const resultPath = process.env.SERPENT_MEDIA_TASK_PERF_RESULT_PATH;
    if (resultPath) writeFileSync(resultPath, `${JSON.stringify(result)}\n`, 'utf8');
    console.info(`MEDIA_TASK_PERF_JSON ${JSON.stringify(result)}`);
  }, 1_800_000);
});
