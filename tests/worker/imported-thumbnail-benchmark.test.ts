import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import {
  IMPORTED_THUMBNAIL_GENERATOR_PREFIX,
  IMPORTED_THUMBNAIL_MAX_BYTES,
  IMPORTED_THUMBNAIL_NORMALIZATION_JOB,
  IMPORTED_THUMBNAIL_PRESERVED_GENERATOR,
} from '../../src/worker/imported-thumbnail-policy';

const enabled = process.env.SERPENT_IMPORTED_THUMBNAIL_BENCH === '1';
const stressEnabled = enabled && process.env.SERPENT_IMPORTED_THUMBNAIL_BENCH_STRESS === '1';

function readBenchmarkInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!enabled) return fallback;
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}; received ${JSON.stringify(raw)}`);
  }
  return Math.min(maximum, value);
}

const itemCount = readBenchmarkInteger(
  'SERPENT_IMPORTED_THUMBNAIL_BENCH_ASSETS',
  24,
  8,
  64,
);
const roundCount = readBenchmarkInteger(
  'SERPENT_IMPORTED_THUMBNAIL_BENCH_ROUNDS',
  3,
  1,
  5,
);
const require = createRequire(import.meta.url);

type BenchmarkSharp = (
  input: string | Buffer,
  options?: { raw: { width: number; height: number; channels: number } },
) => {
  jpeg(options: { quality: number }): { toBuffer(): Promise<Buffer> };
};

const sharp = require('sharp') as BenchmarkSharp;
let temporaryRoot = '';
let service: LibraryService | undefined;

type PerformanceSample = {
  maxEventLoopLagMs: number;
  peakRssBytes: number;
};

function percentile(samples: readonly number[], percentileValue: number): number {
  if (samples.length === 0) return 0;
  const ordered = samples.toSorted((left, right) => left - right);
  const index = Math.min(
    ordered.length - 1,
    Math.max(0, Math.ceil(ordered.length * percentileValue) - 1),
  );
  return ordered[index]!;
}

function startPerformanceSampler(): {
  stop(): PerformanceSample;
} {
  const intervalMs = 5;
  let previousTick = performance.now();
  let peakRssBytes = process.memoryUsage().rss;
  let maxEventLoopLagMs = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxEventLoopLagMs = Math.max(maxEventLoopLagMs, Math.max(0, now - previousTick - intervalMs));
    previousTick = now;
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }, intervalMs);
  return {
    stop() {
      clearInterval(timer);
      peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
      return { maxEventLoopLagMs, peakRssBytes };
    },
  };
}

function benchmarkAssetIndex(relativeFilePath: string): number {
  const match = /(?:^|\/)asset-(\d+)\.jpg$/u.exec(relativeFilePath);
  if (!match) throw new Error(`Unexpected benchmark asset path: ${relativeFilePath}`);
  return Number(match[1]);
}

async function makeHighEntropyJpeg(index: number): Promise<Buffer> {
  const width = 1_600 + (index % 3) * 200;
  const height = 900 + (index % 2) * 180;
  const pixels = randomBytes(width * height * 3);
  return sharp(pixels, {
    raw: { width, height, channels: 3 },
  }).jpeg({ quality: 92 }).toBuffer();
}

async function makeBoundedJpeg(index: number): Promise<Buffer> {
  const width = 320 + (index % 2) * 64;
  const height = 180 + (index % 3) * 24;
  const pixels = Buffer.alloc(width * height * 3, 127 + (index % 3));
  return sharp(pixels, {
    raw: { width, height, channels: 3 },
  }).jpeg({ quality: 82 }).toBuffer();
}

async function makeMaximumPixelJpeg(): Promise<Buffer> {
  const width = 8_000;
  const height = 4_000;
  const pixels = Buffer.alloc(width * height * 3, 127);
  return sharp(pixels, {
    raw: { width, height, channels: 3 },
  }).jpeg({ quality: 82 }).toBuffer();
}

async function writeFixture(root: string): Promise<string> {
  const libraryPath = path.join(root, 'Imported Thumbnail Benchmark.library');
  mkdirSync(path.join(libraryPath, 'images'), { recursive: true });
  writeFileSync(path.join(libraryPath, 'metadata.json'), JSON.stringify({ folders: [] }));
  for (let index = 0; index < itemCount; index += 1) {
    const itemPath = path.join(
      libraryPath,
      'images',
      `item-${String(index).padStart(3, '0')}.info`,
    );
    mkdirSync(itemPath, { recursive: true });
    const stress = stressEnabled && index === itemCount - 1;
    const bounded = !stress && index % 4 === 0;
    const bytes = stress
      ? await makeMaximumPixelJpeg()
      : bounded
        ? await makeBoundedJpeg(index)
        : await makeHighEntropyJpeg(index);
    const sourceBytes = bounded
      ? await makeHighEntropyJpeg(index + itemCount)
      : bytes;
    // External metadata describes the source rather than the adjacent
    // preview. This catches re-encoding caused by source dimensions alone.
    const sourceWidth = stress
      ? 8_000
      : bounded
        ? 4_096
        : 1_600 + (index % 3) * 200;
    const sourceHeight = stress
      ? 4_000
      : bounded
        ? 2_304
        : 900 + (index % 2) * 180;
    writeFileSync(path.join(itemPath, 'metadata.json'), JSON.stringify({
      id: `item-${index}`,
      name: `asset-${index}`,
      ext: 'jpg',
      width: sourceWidth,
      height: sourceHeight,
    }));
    writeFileSync(path.join(itemPath, `asset-${index}.jpg`), sourceBytes);
    writeFileSync(path.join(itemPath, `asset-${index}_thumbnail.jpg`), bytes);
  }
  return libraryPath;
}

describe.skipIf(!enabled)('imported thumbnail normalization benchmark (manual)', () => {
  let sourceRootPath = '';

  beforeAll(async () => {
    temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-import-thumb-bench-'));
    service = new LibraryService({ observerFactory: () => ({ close() {} }) });
    sourceRootPath = await writeFixture(temporaryRoot);
  }, 120_000);

  afterAll(() => {
    service?.closeAll();
    if (temporaryRoot) rmSync(temporaryRoot, { force: true, recursive: true });
  });

  it('records copy-first and bounded normalization cost for imported previews', async () => {
    if (!service) throw new Error('Benchmark service was not initialized.');
    const rounds: Array<Record<string, number>> = [];
    const importSamples: number[] = [];
    const normalizationSamples: number[] = [];
    const normalizationJobSamples: number[] = [];
    const importPeakRssDeltas: number[] = [];
    const normalizationPeakRssDeltas: number[] = [];
    const importEventLoopLags: number[] = [];
    const normalizationEventLoopLags: number[] = [];
    const visibleWaveSamples: number[] = [];
    const cumulativeRssDeltas: number[] = [];
    const benchmarkRssBefore = process.memoryUsage().rss;

    for (let round = 0; round < roundCount; round += 1) {
      const library = service.createLibrary({
        displayName: `Imported Thumbnail Benchmark ${round + 1}`,
        selectedParentPath: temporaryRoot,
      });
      const importRssBefore = process.memoryUsage().rss;
      const importSampler = startPerformanceSampler();
      const importStartedAt = performance.now();
      const imported = await service.importEagleLibrary({
        libraryId: library.libraryId,
        sourceRootPath,
      });
      const importElapsedMs = performance.now() - importStartedAt;
      const importMemory = importSampler.stop();
      expect(imported.importedCount).toBe(itemCount);
      importSamples.push(importElapsedMs);
      importPeakRssDeltas.push((importMemory.peakRssBytes - importRssBefore) / (1024 * 1024));
      importEventLoopLags.push(importMemory.maxEventLoopLagMs);

      const assets = service.listAssets({ libraryId: library.libraryId, recursive: true });
      expect(assets).toHaveLength(itemCount);
      const previewPathFor = (assetId: string): string => {
        const artifact = service!.getCurrentArtifact(library.libraryId, assetId, 'thumbnail');
        return service!.getArtifactAbsolutePath(library.libraryId, artifact!.artifactId, 'preview');
      };
      const artifactPathFor = (assetId: string): string => {
        const artifact = service!.getCurrentArtifact(library.libraryId, assetId, 'thumbnail');
        expect(artifact?.generatorVersion).toBe('eagle-thumbnail@1');
        return previewPathFor(assetId);
      };
      const rawPaths = assets.map((asset) => artifactPathFor(asset.assetId));
      const rawBytes = rawPaths.reduce((total, filePath) => total + statSync(filePath).size, 0);
      const boundedAssetIds = new Set(
        assets
          .filter((asset) => benchmarkAssetIndex(asset.relativeFilePath) % 4 === 0)
          .map((asset) => asset.assetId),
      );
      const normalizationAssetIds = new Set(assets
        .filter((asset) => !boundedAssetIds.has(asset.assetId))
        .map((asset) => asset.assetId));
      expect(boundedAssetIds.size).toBe(
        Math.ceil((itemCount - (stressEnabled ? 1 : 0)) / 4),
      );
      expect(rawBytes).toBeGreaterThan(0);
      const boundedCopyBytes = assets
        .filter((asset) => boundedAssetIds.has(asset.assetId))
        .reduce((total, asset) => total + statSync(previewPathFor(asset.assetId)).size, 0);
      const rawCandidateBytes = assets
        .filter((asset) => normalizationAssetIds.has(asset.assetId))
        .reduce((total, asset) => total + statSync(previewPathFor(asset.assetId)).size, 0);
      const queued = service.enqueueThumbnailJobs(library.libraryId);
      const markerJobs = service.listMediaJobs(library.libraryId).jobs.filter(
        (job) => job.errorCode === IMPORTED_THUMBNAIL_NORMALIZATION_JOB && job.status === 'queued',
      );
      // Every copy is verified, including small previews. Re-scheduling only
      // checks the durable marker and must not duplicate the background work.
      expect(queued).toBe(0);
      expect(markerJobs).toHaveLength(itemCount);
      const normalizationJobIds = new Set(markerJobs.map((job) => job.jobId));
      expect(new Set(markerJobs.map((job) => job.assetId))).toEqual(
        new Set(assets.map((asset) => asset.assetId)),
      );

      const visibleStartedAt = performance.now();
      const visibleWaveProcessed = await service.processThumbnailQueue(library.libraryId, {
        maxJobs: itemCount,
        jobKinds: ['generate_thumbnail'],
        interactive: true,
        assetIds: assets.map((asset) => asset.assetId),
      });
      visibleWaveSamples.push(performance.now() - visibleStartedAt);
      expect(visibleWaveProcessed).toBe(0);

      const normalizationRssBefore = process.memoryUsage().rss;
      const normalizationSampler = startPerformanceSampler();
      const normalizationStartedAt = performance.now();
      const normalizationJobSamplesForRound: number[] = [];
      for (const job of markerJobs) {
        const jobStartedAt = performance.now();
        const processedJob = await service.processThumbnailQueue(library.libraryId, {
          maxJobs: 1,
          jobKinds: ['generate_thumbnail'],
          assetIds: [job.assetId],
        });
        expect(processedJob).toBe(1);
        const jobElapsedMs = performance.now() - jobStartedAt;
        normalizationJobSamplesForRound.push(jobElapsedMs);
        normalizationJobSamples.push(jobElapsedMs);
      }
      const processed = normalizationJobSamplesForRound.length;
      const elapsedMs = performance.now() - normalizationStartedAt;
      const normalizationMemory = normalizationSampler.stop();
      normalizationSamples.push(elapsedMs);
      normalizationPeakRssDeltas.push(
        (normalizationMemory.peakRssBytes - normalizationRssBefore) / (1024 * 1024),
      );
      normalizationEventLoopLags.push(normalizationMemory.maxEventLoopLagMs);

      const normalizedCandidateBytes = assets
        .filter((asset) => normalizationAssetIds.has(asset.assetId))
        .reduce((total, asset) => total + statSync(previewPathFor(asset.assetId)).size, 0);
      const jobs = service.listMediaJobs(library.libraryId).jobs.filter((job) => assets.some(
        (asset) => asset.assetId === job.assetId,
      ));
      const normalizationJobs = jobs.filter((job) => normalizationJobIds.has(job.jobId));
      assets.forEach((asset) => {
        const artifact = service!.getCurrentArtifact(library.libraryId, asset.assetId, 'thumbnail');
        if (boundedAssetIds.has(asset.assetId)) {
          expect(artifact?.generatorVersion).toBe(IMPORTED_THUMBNAIL_PRESERVED_GENERATOR);
        } else {
          expect(artifact?.generatorVersion).toContain(IMPORTED_THUMBNAIL_GENERATOR_PREFIX);
          expect(statSync(previewPathFor(asset.assetId)).size)
            .toBeLessThanOrEqual(IMPORTED_THUMBNAIL_MAX_BYTES);
        }
      });
      expect(processed).toBe(itemCount);
      expect(normalizationJobs.filter((job) => job.status === 'succeeded')).toHaveLength(itemCount);
      expect(rawCandidateBytes).toBeGreaterThan(0);
      expect(normalizedCandidateBytes).toBeGreaterThan(0);
      expect(normalizedCandidateBytes).toBeLessThan(rawCandidateBytes);
      service.closeLibrary(library.libraryId);
      const cumulativeRssDeltaMb = (process.memoryUsage().rss - benchmarkRssBefore) / (1024 * 1024);
      cumulativeRssDeltas.push(cumulativeRssDeltaMb);
      rounds.push({
        boundedCopyBytes,
        boundedCopies: boundedAssetIds.size,
        elapsedMs: Number(elapsedMs.toFixed(1)),
        importElapsedMs: Number(importElapsedMs.toFixed(1)),
        importEventLoopLagMs: Number(importMemory.maxEventLoopLagMs.toFixed(1)),
        normalizationEventLoopLagMs: Number(normalizationMemory.maxEventLoopLagMs.toFixed(1)),
        normalizedCandidateBytes,
        rawCandidateBytes,
        rawBytes,
        cumulativeRssDeltaMb: Number(cumulativeRssDeltaMb.toFixed(1)),
        normalizationJobP95Ms: Number(percentile(normalizationJobSamplesForRound, 0.95).toFixed(1)),
        normalizationJobMaxMs: Number(Math.max(...normalizationJobSamplesForRound, 0).toFixed(1)),
        rssDeltaMb: Number((normalizationPeakRssDeltas.at(-1) ?? 0).toFixed(1)),
        visibleWaveMs: Number((visibleWaveSamples.at(-1) ?? 0).toFixed(1)),
      });
    }

    expect(rounds).toHaveLength(roundCount);
    expect(importSamples).toHaveLength(roundCount);
    expect(normalizationSamples).toHaveLength(roundCount);
    expect(visibleWaveSamples).toHaveLength(roundCount);
    const p95ImportMs = percentile(importSamples, 0.95);
    const p95NormalizationMs = percentile(normalizationSamples, 0.95);
    const p95NormalizationJobMs = percentile(normalizationJobSamples, 0.95);
    const maxPeakRssDeltaMb = Math.max(...importPeakRssDeltas, ...normalizationPeakRssDeltas, 0);
    const maxEventLoopLagMs = Math.max(
      ...importEventLoopLags,
      ...normalizationEventLoopLags,
      0,
    );
    const maxImportEventLoopLagMs = Math.max(...importEventLoopLags, 0);
    const maxNormalizationEventLoopLagMs = Math.max(...normalizationEventLoopLags, 0);
    const maxCumulativeRssDeltaMb = Math.max(...cumulativeRssDeltas, 0);
    const rawCandidateBytes = rounds.reduce((total, round) => total + (round.rawCandidateBytes ?? 0), 0);
    const normalizedCandidateBytes = rounds.reduce(
      (total, round) => total + (round.normalizedCandidateBytes ?? 0),
      0,
    );
    const result = {
      suite: 'imported-thumbnail-normalization',
      assets: itemCount,
      boundedCopies: rounds[0]?.boundedCopies ?? 0,
      rounds,
      importP50Ms: Number(percentile(importSamples, 0.5).toFixed(1)),
      importP95Ms: Number(p95ImportMs.toFixed(1)),
      importMaxMs: Number(Math.max(...importSamples, 0).toFixed(1)),
      normalizationP50Ms: Number(percentile(normalizationSamples, 0.5).toFixed(1)),
      normalizationP95Ms: Number(p95NormalizationMs.toFixed(1)),
      normalizationMaxMs: Number(Math.max(...normalizationSamples, 0).toFixed(1)),
      normalizationPerAssetP95Ms: Number((p95NormalizationMs / itemCount).toFixed(1)),
      normalizationJobP50Ms: Number(percentile(normalizationJobSamples, 0.5).toFixed(1)),
      normalizationJobP95Ms: Number(p95NormalizationJobMs.toFixed(1)),
      normalizationJobMaxMs: Number(Math.max(...normalizationJobSamples, 0).toFixed(1)),
      maxPeakRssDeltaMb: Number(maxPeakRssDeltaMb.toFixed(1)),
      maxCumulativeRssDeltaMb: Number(maxCumulativeRssDeltaMb.toFixed(1)),
      maxEventLoopLagMs: Number(maxEventLoopLagMs.toFixed(1)),
      maxImportEventLoopLagMs: Number(maxImportEventLoopLagMs.toFixed(1)),
      maxNormalizationEventLoopLagMs: Number(maxNormalizationEventLoopLagMs.toFixed(1)),
      visibleWaveP95Ms: Number(percentile(visibleWaveSamples, 0.95).toFixed(1)),
      rawCandidateBytes,
      normalizedCandidateBytes,
      byteReduction: Number((1 - normalizedCandidateBytes / rawCandidateBytes).toFixed(4)),
      stress: stressEnabled,
    };
    console.info(`IMPORTED_THUMBNAIL_PERF_JSON ${JSON.stringify(result)}`);
    const resultPath = process.env.SERPENT_IMPORTED_THUMBNAIL_BENCH_RESULT_PATH;
    if (resultPath) writeFileSync(resultPath, `${JSON.stringify(result)}\n`, 'utf8');
    if (process.env.SERPENT_IMPORTED_THUMBNAIL_BENCH_GATE === '1') {
      expect(p95ImportMs).toBeLessThan(1_000);
      expect(p95NormalizationMs / itemCount).toBeLessThan(50);
      expect(p95NormalizationJobMs).toBeLessThan(stressEnabled ? 500 : 250);
      expect(maxPeakRssDeltaMb).toBeLessThan(stressEnabled ? 384 : 256);
      expect(maxCumulativeRssDeltaMb).toBeLessThan(stressEnabled ? 384 : 256);
      // Import is a Worker-side file copy/hash transaction, so its latency
      // budget is the same one-second interactivity budget as library open.
      // Normalization is the background decoder lane and must not block the
      // Worker event loop for a quarter second.
      expect(maxImportEventLoopLagMs).toBeLessThan(1_000);
      expect(maxNormalizationEventLoopLagMs).toBeLessThan(250);
    }
  }, 120_000);
});
