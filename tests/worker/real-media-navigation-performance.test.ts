import {
  opendirSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statfsSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import sharp from 'sharp';
import { expect, it } from 'vitest';

import { LibraryService, type LibraryServiceDiagnostic } from '../../src/worker/library-service';
import { importNoConflict } from './import-no-conflict';

const enabled = process.env.SERPENT_REAL_MEDIA_NAV_BENCH === '1';
const sourceRoots = [
  process.env.SERPENT_REAL_MEDIA_NAV_SOURCE_A,
  process.env.SERPENT_REAL_MEDIA_NAV_SOURCE_B,
].filter((value): value is string => Boolean(value));
const tempParent = path.resolve(process.env.SERPENT_REAL_MEDIA_NAV_TMP ?? tmpdir());
const requestedSampleCount = Number(process.env.SERPENT_REAL_MEDIA_NAV_SAMPLE_COUNT ?? 24);
const sampleCount = Number.isFinite(requestedSampleCount)
  ? Math.max(16, Math.min(32, Math.trunc(requestedSampleCount)))
  : 24;

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.tif', '.tiff', '.bmp', '.tga', '.exr',
  '.dng', '.cr2', '.cr3', '.nef', '.arw', '.raf', '.orf', '.rw2', '.raw',
]);
const RAW_EXTENSIONS = new Set([
  '.dng', '.cr2', '.cr3', '.nef', '.arw', '.raf', '.orf', '.rw2', '.raw',
]);
const MAX_ENTRIES_PER_ROOT = 30_000;
const MAX_DEPTH = 8;
const MAX_FILE_BYTES = 128 * 1024 * 1024;
const MAX_SAMPLE_BYTES = 512 * 1024 * 1024;
const MIB = 1024 * 1024;
const MIN_FREE_BYTES = 512 * MIB;

/**
 * Operator-run benchmark. Set SERPENT_REAL_MEDIA_NAV_BENCH=1 plus the two
 * source directory variables; discovery is bounded and only selected files
 * are copied into a disposable library. SERPENT_REAL_MEDIA_NAV_TMP can pin the
 * temporary library to a local volume with enough free space.
 */

type Candidate = {
  extension: string;
  sourcePath: string;
  byteSize: number;
};

type TimingSummary = {
  count: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
};

function summarize(values: readonly number[]): TimingSummary {
  const ordered = [...values].sort((left, right) => left - right);
  const percentile = (fraction: number): number => ordered.length === 0
    ? 0
    : ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)]!;
  return {
    count: ordered.length,
    p50Ms: Number(percentile(0.5).toFixed(2)),
    p95Ms: Number(percentile(0.95).toFixed(2)),
    maxMs: Number(percentile(1).toFixed(2)),
  };
}

async function enumerateImages(root: string, sourceIndex: number): Promise<Candidate[]> {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Source directory ${sourceIndex + 1} is unavailable.`);
  }
  const pending: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }];
  const candidates: Candidate[] = [];
  const visited = new Set<string>();
  let visitedEntries = 0;

  while (pending.length > 0 && visitedEntries < MAX_ENTRIES_PER_ROOT) {
    const current = pending.shift()!;
    const canonical = path.resolve(current.directory);
    if (visited.has(canonical)) continue;
    visited.add(canonical);

    let directory;
    try {
      directory = opendirSync(current.directory);
    } catch {
      continue;
    }
    try {
      for await (const entry of directory) {
        visitedEntries += 1;
        if (visitedEntries > MAX_ENTRIES_PER_ROOT) break;
        if (entry.isSymbolicLink()) continue;
        const entryPath = path.join(current.directory, entry.name);
        if (entry.isDirectory()) {
          if (current.depth < MAX_DEPTH) {
            pending.push({ directory: entryPath, depth: current.depth + 1 });
          }
          continue;
        }
        if (!entry.isFile()) continue;
        const extension = path.extname(entry.name).toLowerCase();
        if (!IMAGE_EXTENSIONS.has(extension)) continue;
        let byteSize: number;
        try {
          byteSize = statSync(entryPath).size;
        } catch {
          continue;
        }
        if (byteSize <= 0 || byteSize > MAX_FILE_BYTES) continue;
        candidates.push({ extension, sourcePath: entryPath, byteSize });
      }
    } finally {
      try {
        await directory.close();
      } catch {
        // The async iterator closes a directory when it reaches or breaks from its end.
      }
    }
  }
  return candidates;
}

function selectSample(candidates: readonly Candidate[]): Candidate[] {
  const byExtension = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const group = byExtension.get(candidate.extension) ?? [];
    group.push(candidate);
    byExtension.set(candidate.extension, group);
  }
  for (const group of byExtension.values()) {
    group.sort((left, right) => left.byteSize - right.byteSize);
  }

  const selected: Candidate[] = [];
  const selectedPaths = new Set<string>();
  let selectedBytes = 0;
  const add = (candidate: Candidate | undefined): void => {
    if (!candidate || selected.length >= sampleCount) return;
    const identity = path.resolve(candidate.sourcePath).toLowerCase();
    if (selectedPaths.has(identity) || selectedBytes + candidate.byteSize > MAX_SAMPLE_BYTES) return;
    selectedPaths.add(identity);
    selected.push(candidate);
    selectedBytes += candidate.byteSize;
  };

  const rawCandidate = candidates
    .filter((candidate) => RAW_EXTENSIONS.has(candidate.extension))
    .sort((left, right) => right.byteSize - left.byteSize)[0];
  add(rawCandidate);

  const largeImages = candidates
    .filter((candidate) => !RAW_EXTENSIONS.has(candidate.extension) && candidate.byteSize >= 8 * MIB)
    .sort((left, right) => right.byteSize - left.byteSize);
  add(largeImages[0]);
  add(largeImages[1]);

  const extensions = [...byExtension.keys()].sort();
  const offsets = new Map(extensions.map((extension) => [extension, 0]));
  while (selected.length < sampleCount) {
    let addedInPass = false;
    for (const extension of extensions) {
      if (selected.length >= sampleCount) break;
      if (RAW_EXTENSIONS.has(extension)) continue;
      const group = byExtension.get(extension) ?? [];
      let offset = offsets.get(extension) ?? 0;
      while (offset < group.length && selectedPaths.has(path.resolve(group[offset]!.sourcePath).toLowerCase())) {
        offset += 1;
      }
      offsets.set(extension, offset + 1);
      if (offset >= group.length) continue;
      add(group[offset]);
      addedInPass = true;
    }
    if (!addedInPass) break;
  }
  return selected;
}

function safeErrorLabel(error: unknown): string {
  const fields: string[] = [];
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Z0-9_]{1,64}$/u.test(code)) fields.push(code);
    const reason = (error as { reason?: unknown }).reason;
    if (typeof reason === 'string' && /^[A-Z0-9_]{1,64}$/u.test(reason)) fields.push(reason);
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof Error && /^[A-Za-z][A-Za-z0-9_$]{0,63}$/u.test(cause.name)) {
      fields.push(cause.name);
      if ('code' in cause) {
        const causeCode = (cause as Error & { code?: unknown }).code;
        if (typeof causeCode === 'string' && /^[A-Z0-9_]{1,64}$/u.test(causeCode)) {
          fields.push(causeCode);
        }
      }
    }
  }
  if (fields.length > 0) return fields.join('_');
  return error instanceof Error ? error.name : 'UnknownError';
}

async function processQueue(
  service: LibraryService,
  libraryId: string,
  assetIds: readonly string[],
  kind: 'generate_thumbnail' | 'extract_metadata' | 'extract_palette',
): Promise<{ timings: number[]; jobs: number }> {
  const timings: number[] = [];
  let jobs = 0;
  for (;;) {
    const pending = service.listMediaJobs(libraryId).jobs.some((job) =>
      job.kind === kind && job.status === 'queued' && assetIds.includes(job.assetId));
    if (!pending) break;
    const startedAt = performance.now();
    const processed = await service.processThumbnailQueue(libraryId, {
      jobKinds: [kind],
      maxJobs: 1,
      assetIds,
    });
    timings.push(performance.now() - startedAt);
    if (processed === 0) break;
    jobs += processed;
  }
  return { timings, jobs };
}

function dimensionBucket(width: number | null | undefined, height: number | null | undefined): string {
  if (!width || !height || width <= 0 || height <= 0) return 'unknown';
  const edge = Math.max(width, height);
  if (edge < 1_000) return 'under-1k';
  if (edge < 2_000) return '1k-2k';
  if (edge < 4_000) return '2k-4k';
  return '4k-plus';
}

it.skipIf(!enabled)('records real-media navigation, Inspector, thumbnail, and palette timings', async () => {
  if (sourceRoots.length !== 2) throw new Error('Set both real-media source directory environment variables.');
  if (!existsSync(tempParent) || !statSync(tempParent).isDirectory()) {
    throw new Error('The configured temporary parent directory is unavailable.');
  }

  let temporaryRoot = '';
  let service: LibraryService | undefined;
  const diagnostics: LibraryServiceDiagnostic[] = [];
  let stage = 'sample discovery';
  let failure: { stage: string; label: string } | undefined;
  let cleanupFailure = false;
  try {
    const discovered = (await Promise.all(sourceRoots.map(enumerateImages))).flat();
    const candidates = [...new Map(discovered.map((candidate) => [
      path.resolve(candidate.sourcePath).toLowerCase(), candidate,
    ])).values()];
    const sample = selectSample(candidates);
    const availableRaw = candidates.some((candidate) => RAW_EXTENSIONS.has(candidate.extension));
    const availableFormats = [...new Set(candidates.map((candidate) => candidate.extension))].sort();
    if (sample.length !== sampleCount) {
      throw Object.assign(new Error('Bounded sample count mismatch.'), {
        code: `SAMPLE_COUNT_${sample.length}_OF_${sampleCount}`,
      });
    }
    if (!availableRaw) throw Object.assign(new Error('No RAW candidate found.'), { code: 'RAW_MISSING' });
    const sampleFormatCount = new Set(sample.map((candidate) => candidate.extension)).size;
    if (sampleFormatCount < 3) {
      throw Object.assign(new Error('Not enough distinct formats.'), {
        code: `FORMAT_COUNT_${sampleFormatCount}`,
      });
    }
    const totalSourceBytes = sample.reduce((sum, candidate) => sum + candidate.byteSize, 0);
    if (totalSourceBytes > MAX_SAMPLE_BYTES) {
      throw Object.assign(new Error('Bounded sample exceeds byte budget.'), { code: 'SAMPLE_BYTES_OVER_LIMIT' });
    }
    const disk = statfsSync(tempParent);
    const freeBytes = disk.bavail * disk.bsize;
    const requiredFreeBytes = totalSourceBytes + MIN_FREE_BYTES;
    if (freeBytes < requiredFreeBytes) throw new Error('Insufficient free space for the isolated sample library.');

    stage = 'isolated library import';
    temporaryRoot = mkdtempSync(path.join(tempParent, 'serpent-real-media-navigation-'));
    service = new LibraryService({
      observerFactory: () => ({ close() {} }),
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    stage = 'temporary library creation';
    const created = service.createLibrary({
      displayName: 'Real Media Navigation Benchmark',
      selectedParentPath: temporaryRoot,
    });
    const assetIds: string[] = [];
    for (let index = 0; index < sample.length; index += 1) {
      const candidate = sample[index]!;
      stage = `isolated library import item ${index + 1} (${candidate.extension}) of ${sample.length}`;
      const imported = importNoConflict(service, created.libraryId, candidate.sourcePath);
      const asset = imported.assets[0];
      if (asset) assetIds.push(asset.assetId);
    }
    expect(assetIds.length).toBe(sample.length);

    stage = 'library open';
    service.closeAll();
    const openService = new LibraryService({
      observerFactory: () => ({ close() {} }),
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    service = openService;
    const openStartedAt = performance.now();
    const opened = service.openLibrary(created.libraryPath);
    const libraryOpenMs = performance.now() - openStartedAt;

    stage = 'initial navigation';
    const navigationStartedAt = performance.now();
    const initialNavigation = await service.getLibraryNavigationSummaryAsync({ libraryId: opened.libraryId });
    const navigationColdMs = performance.now() - navigationStartedAt;
    const rootBrowseStartedAt = performance.now();
    const rootBrowse = service.searchAssets({ libraryId: opened.libraryId, limit: 50, offset: 0 });
    const rootFirstPageMs = performance.now() - rootBrowseStartedAt;
    expect(initialNavigation.allAssetCount).toBe(sample.length);
    expect(rootBrowse.items.length).toBe(sample.length);

    stage = 'managed-folder navigation';
    const createFolderStartedAt = performance.now();
    const folder = service.createManagedFolder({
      libraryId: opened.libraryId,
      name: 'Navigation Benchmark Folder',
    });
    const createFolderMs = performance.now() - createFolderStartedAt;
    const moved = service.moveAssets({
      libraryId: opened.libraryId,
      assetIds: assetIds.slice(0, Math.min(3, assetIds.length)),
      targetFolderId: folder.folderId,
    });
    expect(moved.movedCount).toBeGreaterThan(0);
    const folderNavigationStartedAt = performance.now();
    const folderNavigation = await service.getLibraryNavigationSummaryAsync({ libraryId: opened.libraryId });
    const folderNavigationMs = performance.now() - folderNavigationStartedAt;
    const folderBrowseStartedAt = performance.now();
    const folderBrowse = service.searchAssets({
      libraryId: opened.libraryId,
      scope: { kind: 'folder', folderId: folder.folderId, recursive: false },
      limit: 50,
      offset: 0,
    });
    const folderFirstPageMs = performance.now() - folderBrowseStartedAt;
    expect(folderNavigation.folders.some((entry) => entry.folderId === folder.folderId)).toBe(true);
    expect(folderBrowse.items.length).toBe(moved.movedCount);

    stage = 'bounded media queue';
    const initialEnqueueStartedAt = performance.now();
    service.enqueueThumbnailJobs(opened.libraryId, { assetIds, limit: assetIds.length });
    const initialEnqueueMs = performance.now() - initialEnqueueStartedAt;
    const thumbnailResult = await processQueue(service, opened.libraryId, assetIds, 'generate_thumbnail');
    const metadataResult = await processQueue(service, opened.libraryId, assetIds, 'extract_metadata');
    const paletteEnqueueStartedAt = performance.now();
    service.enqueueThumbnailJobs(opened.libraryId, { assetIds, limit: assetIds.length });
    const paletteEnqueueMs = performance.now() - paletteEnqueueStartedAt;
    const paletteResult = await processQueue(service, opened.libraryId, assetIds, 'extract_palette');

    stage = 'decode evidence and Inspector';
    const artifactsByFormat: Record<string, {
      sampled: number;
      thumbnailReady: number;
      thumbnailFailed: number;
      decoded: number;
      paletteReady: number;
      paletteFailed: number;
    }> = {};
    const dimensions: Record<string, number> = {};
    let decodedThumbnailCount = 0;
    let decodedRawCount = 0;
    let readyPaletteCount = 0;
    let highResolutionSampleCount = 0;
    for (let index = 0; index < sample.length; index += 1) {
      stage = `decode evidence item ${index + 1} metadata`;
      const candidate = sample[index]!;
      const assetId = assetIds[index]!;
      const byFormat = artifactsByFormat[candidate.extension] ?? {
        sampled: 0,
        thumbnailReady: 0,
        thumbnailFailed: 0,
        decoded: 0,
        paletteReady: 0,
        paletteFailed: 0,
      };
      byFormat.sampled += 1;
      const extracted = service.getExtractedMetadata({ libraryId: opened.libraryId, assetId });
      const width = extracted.metadata?.width;
      const height = extracted.metadata?.height;
      const bucket = dimensionBucket(width, height);
      dimensions[bucket] = (dimensions[bucket] ?? 0) + 1;
      if (width && height && Math.max(width, height) >= 2_048) highResolutionSampleCount += 1;

      stage = `decode evidence item ${index + 1} thumbnail`;
      const thumbnail = service.getCurrentArtifact(opened.libraryId, assetId, 'thumbnail');
      if (thumbnail?.status === 'ready') {
        byFormat.thumbnailReady += 1;
        const thumbnailPath = service.getArtifactAbsolutePath(opened.libraryId, thumbnail.artifactId, 'preview');
        const decoded = await sharp(thumbnailPath).rotate().raw().toBuffer({ resolveWithObject: true });
        expect(decoded.info.width).toBeGreaterThan(0);
        expect(decoded.info.height).toBeGreaterThan(0);
        expect(decoded.data.byteLength).toBeGreaterThan(0);
        byFormat.decoded += 1;
        decodedThumbnailCount += 1;
        if (RAW_EXTENSIONS.has(candidate.extension)) decodedRawCount += 1;
      } else if (thumbnail?.status === 'failed') {
        byFormat.thumbnailFailed += 1;
      }

      stage = `decode evidence item ${index + 1} palette`;
      const palette = service.getCurrentArtifact(opened.libraryId, assetId, 'extracted_palette');
      if (palette?.status === 'ready') {
        const palettePath = service.getArtifactAbsolutePath(opened.libraryId, palette.artifactId);
        const colors = JSON.parse(readFileSync(palettePath, 'utf8')) as unknown;
        if (!Array.isArray(colors) || colors.length === 0) {
          throw new Error('The generated palette artifact is empty or invalid.');
        }
        byFormat.paletteReady += 1;
        readyPaletteCount += 1;
      } else if (palette?.status === 'failed') {
        byFormat.paletteFailed += 1;
      }
      artifactsByFormat[candidate.extension] = byFormat;
    }
    if (decodedThumbnailCount === 0) {
      throw Object.assign(new Error('No generated thumbnail decoded successfully.'), { code: 'THUMBNAIL_DECODE_MISSING' });
    }
    if (decodedRawCount === 0) {
      throw Object.assign(new Error('No selected RAW thumbnail decoded successfully.'), { code: 'RAW_DECODE_MISSING' });
    }
    if (readyPaletteCount === 0) {
      throw Object.assign(new Error('No generated palette artifact was ready.'), { code: 'PALETTE_DECODE_MISSING' });
    }
    if (highResolutionSampleCount === 0) {
      throw Object.assign(new Error('No sample has source dimensions at or above 2K.'), { code: 'LARGE_IMAGE_DIMENSIONS_MISSING' });
    }

    stage = 'Inspector metadata reads';
    const inspectorAssetId = assetIds[0]!;
    const inspectorMetadataSamples: number[] = [];
    const inspectorTechnicalSamples: number[] = [];
    for (let sampleIndex = 0; sampleIndex < 7; sampleIndex += 1) {
      const metadataStartedAt = performance.now();
      service.getAssetMetadata({ libraryId: opened.libraryId, assetId: inspectorAssetId });
      inspectorMetadataSamples.push(performance.now() - metadataStartedAt);
      const technicalStartedAt = performance.now();
      service.getExtractedMetadata({ libraryId: opened.libraryId, assetId: inspectorAssetId });
      inspectorTechnicalSamples.push(performance.now() - technicalStartedAt);
    }
    const navigationStages = diagnostics
      .filter((diagnostic) => diagnostic.scope === 'navigation.summary')
      .map((diagnostic) => diagnostic.context?.stagesMs)
      .filter((stages): stages is Record<string, unknown> =>
        typeof stages === 'object' && stages !== null && !Array.isArray(stages));

    console.info('real-media navigation benchmark:', JSON.stringify({
      sampleCount: sample.length,
      importedAssetCount: assetIds.length,
      sampleBytes: totalSourceBytes,
      sourceEntryScanLimitPerRoot: MAX_ENTRIES_PER_ROOT,
      discoveryFormatCandidates: Object.fromEntries(
        availableFormats.map((extension) => [
          extension,
          candidates.filter((candidate) => candidate.extension === extension).length,
        ]),
      ),
      sampleFormatCounts: Object.fromEntries(
        sample.reduce((counts, candidate) => counts.set(candidate.extension, (counts.get(candidate.extension) ?? 0) + 1), new Map<string, number>()),
      ),
      dimensions,
      highResolutionSamples: highResolutionSampleCount,
      libraryOpenMs: Number(libraryOpenMs.toFixed(2)),
      navigationColdMs: Number(navigationColdMs.toFixed(2)),
      rootFirstPageMs: Number(rootFirstPageMs.toFixed(2)),
      createFolderMs: Number(createFolderMs.toFixed(2)),
      navigationAfterFolderMs: Number(folderNavigationMs.toFixed(2)),
      folderFirstPageMs: Number(folderFirstPageMs.toFixed(2)),
      navigationStages: navigationStages.at(-1) ?? null,
      initialEnqueueMs: Number(initialEnqueueMs.toFixed(2)),
      thumbnailJobs: thumbnailResult.jobs,
      thumbnailQueueMs: Number(thumbnailResult.timings.reduce((sum, value) => sum + value, 0).toFixed(2)),
      thumbnailJobsPerSecond: Number((thumbnailResult.jobs / Math.max(0.001, thumbnailResult.timings.reduce((sum, value) => sum + value, 0) / 1_000)).toFixed(2)),
      metadataJobs: metadataResult.jobs,
      paletteEnqueueMs: Number(paletteEnqueueMs.toFixed(2)),
      paletteJobs: paletteResult.jobs,
      paletteQueueMs: Number(paletteResult.timings.reduce((sum, value) => sum + value, 0).toFixed(2)),
      paletteJobsPerSecond: Number((paletteResult.jobs / Math.max(0.001, paletteResult.timings.reduce((sum, value) => sum + value, 0) / 1_000)).toFixed(2)),
      decodedThumbnailCount,
      decodedRawCount,
      readyPaletteCount,
      artifactsByFormat,
      inspectorMetadataMs: summarize(inspectorMetadataSamples),
      inspectorTechnicalMetadataMs: summarize(inspectorTechnicalSamples),
      diskFreeBeforeRunMb: Math.floor(freeBytes / MIB),
    }));
  } catch (error) {
    failure = { stage, label: safeErrorLabel(error) };
  } finally {
    try {
      service?.closeAll();
    } catch {
      cleanupFailure = true;
    }
    if (temporaryRoot) {
      const resolvedRoot = path.resolve(temporaryRoot);
      const allowedPrefix = `${tempParent}${path.sep}serpent-real-media-navigation-`;
      if (path.dirname(resolvedRoot) !== tempParent || !resolvedRoot.startsWith(allowedPrefix)) {
        cleanupFailure = true;
      } else {
        try {
          rmSync(resolvedRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 200 });
        } catch {
          cleanupFailure = true;
        }
      }
    }
  }
  if (failure) {
    throw new Error(
      `Real-media benchmark failed during ${failure.stage} (${failure.label}).`
        + (cleanupFailure ? ' Its isolated temporary directory also could not be cleaned.' : ''),
      { cause: failure.label },
    );
  }
  if (cleanupFailure) throw new Error('Real-media benchmark could not clean its isolated temporary directory.');
}, 600_000);
