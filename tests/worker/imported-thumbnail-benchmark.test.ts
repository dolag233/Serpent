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
  IMPORTED_THUMBNAIL_NORMALIZATION_JOB,
} from '../../src/worker/imported-thumbnail-policy';

const enabled = process.env.SERPENT_IMPORTED_THUMBNAIL_BENCH === '1';
const itemCount = Math.max(
  8,
  Math.min(64, Math.trunc(Number(process.env.SERPENT_IMPORTED_THUMBNAIL_BENCH_ASSETS ?? 24))),
);
const require = createRequire(import.meta.url);

type BenchmarkSharp = (
  input: Buffer,
  options: { raw: { width: number; height: number; channels: number } },
) => {
  jpeg(options: { quality: number }): { toBuffer(): Promise<Buffer> };
};

const sharp = require('sharp') as BenchmarkSharp;
let temporaryRoot = '';
let service: LibraryService | undefined;

async function makeHighEntropyJpeg(index: number): Promise<Buffer> {
  const width = 1_600 + (index % 3) * 200;
  const height = 900 + (index % 2) * 180;
  const pixels = randomBytes(width * height * 3);
  return sharp(pixels, {
    raw: { width, height, channels: 3 },
  }).jpeg({ quality: 92 }).toBuffer();
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
    const bytes = await makeHighEntropyJpeg(index);
    writeFileSync(path.join(itemPath, 'metadata.json'), JSON.stringify({
      id: `item-${index}`,
      name: `asset-${index}`,
      ext: 'jpg',
      width: 1_600 + (index % 3) * 200,
      height: 900 + (index % 2) * 180,
    }));
    writeFileSync(path.join(itemPath, `asset-${index}.jpg`), bytes);
    writeFileSync(path.join(itemPath, `asset-${index}_thumbnail.jpg`), bytes);
  }
  return libraryPath;
}

describe.skipIf(!enabled)('imported thumbnail normalization benchmark (manual)', () => {
  beforeAll(async () => {
    temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-import-thumb-bench-'));
    service = new LibraryService({ observerFactory: () => ({ close() {} }) });
    const library = service.createLibrary({
      displayName: 'Imported Thumbnail Benchmark',
      selectedParentPath: temporaryRoot,
    });
    const sourceRootPath = await writeFixture(temporaryRoot);
    const imported = await service.importEagleLibrary({
      libraryId: library.libraryId,
      sourceRootPath,
    });
    expect(imported.importedCount).toBe(itemCount);
  }, 120_000);

  afterAll(() => {
    service?.closeAll();
    if (temporaryRoot) rmSync(temporaryRoot, { force: true, recursive: true });
  });

  it('records copy-first and bounded normalization cost for imported previews', async () => {
    if (!service) throw new Error('Benchmark service was not initialized.');
    const libraryId = service.listLibraries()[0]!.libraryId;
    const assets = service.listAssets({ libraryId, recursive: true });
    const rawPaths = assets.map((asset) => {
      const artifact = service!.getCurrentArtifact(libraryId, asset.assetId, 'thumbnail');
      expect(artifact?.generatorVersion).toBe('eagle-thumbnail@1');
      return service!.getArtifactAbsolutePath(libraryId, artifact!.artifactId, 'preview');
    });
    const rawBytes = rawPaths.reduce((total, filePath) => total + statSync(filePath).size, 0);
    const queued = service.enqueueThumbnailJobs(libraryId);
    const markerJobs = service.listMediaJobs(libraryId).jobs.filter(
      (job) => job.errorCode === IMPORTED_THUMBNAIL_NORMALIZATION_JOB && job.status === 'queued',
    );
    // The import already enqueued one marker per oversized copy; a repeated
    // background scheduling pass must be idempotent.
    expect(queued).toBe(0);
    expect(markerJobs).toHaveLength(itemCount);

    const startedAt = performance.now();
    const rssBefore = process.memoryUsage().rss;
    const processed = await service.processThumbnailQueue(libraryId, {
      maxJobs: itemCount,
      jobKinds: ['generate_thumbnail'],
    });
    const elapsedMs = performance.now() - startedAt;
    const rssAfter = process.memoryUsage().rss;
    const normalizedPaths = assets.map((asset) => {
      const artifact = service!.getCurrentArtifact(libraryId, asset.assetId, 'thumbnail');
      expect(artifact?.generatorVersion).toContain(IMPORTED_THUMBNAIL_GENERATOR_PREFIX);
      return service!.getArtifactAbsolutePath(libraryId, artifact!.artifactId, 'preview');
    });
    const normalizedBytes = normalizedPaths.reduce(
      (total, filePath) => total + statSync(filePath).size,
      0,
    );
    const jobs = service.listMediaJobs(libraryId).jobs.filter((job) => assets.some(
      (asset) => asset.assetId === job.assetId,
    ));
    const result = {
      suite: 'imported-thumbnail-normalization',
      assets: itemCount,
      processed,
      elapsedMs: Number(elapsedMs.toFixed(1)),
      perAssetMs: Number((elapsedMs / itemCount).toFixed(1)),
      rawBytes,
      normalizedBytes,
      byteReduction: Number((1 - normalizedBytes / rawBytes).toFixed(4)),
      rssDeltaMb: Number(((rssAfter - rssBefore) / (1024 * 1024)).toFixed(1)),
      succeeded: jobs.filter((job) => job.status === 'succeeded').length,
    };
    console.info(JSON.stringify(result));
    const resultPath = process.env.SERPENT_IMPORTED_THUMBNAIL_BENCH_RESULT_PATH;
    if (resultPath) writeFileSync(resultPath, `${JSON.stringify(result)}\n`);
    expect(processed).toBe(itemCount);
    expect(jobs.filter((job) => job.status === 'succeeded')).toHaveLength(itemCount);
  }, 120_000);
});
