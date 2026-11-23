import { lstatSync, mkdtempSync, readdirSync, statfsSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { expect, it, vi } from 'vitest';
import { LibraryService } from '../../src/worker/library-service';
import { importNoConflict } from './import-no-conflict';

type QueueOptions = NonNullable<Parameters<LibraryService['processThumbnailQueue']>[1]>;
type PostedMessage = Record<string, unknown>;

function anonymousFailureCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error
    && typeof error.code === 'string' && /^[A-Z0-9_]{1,40}$/u.test(error.code)) {
    return error.code;
  }
  return error instanceof Error ? error.name : 'unknown';
}

function cleanupFailureLabel(stage: string, error: unknown, root: string): string {
  const code = anonymousFailureCode(error);
  if (typeof error !== 'object' || error === null) return `${stage}:${code}`;
  const details = error as { syscall?: unknown; path?: unknown };
  const operation = typeof details.syscall === 'string' && /^[a-z]{1,20}$/u.test(details.syscall)
    ? details.syscall
    : 'unknown-op';
  if (typeof details.path !== 'string') return `${stage}:${operation}:${code}`;
  const normalizeWindowsPath = (input: string) => {
    const resolved = path.resolve(input);
    if (resolved.startsWith('\\\\?\\UNC\\')) return `\\\\${resolved.slice(8)}`;
    return resolved.startsWith('\\\\?\\') ? resolved.slice(4) : resolved;
  };
  const resolvedPath = normalizeWindowsPath(details.path);
  const relativePath = path.relative(normalizeWindowsPath(root), resolvedPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return `${stage}:${operation}:outside-owned-root:${code}`;
  }
  let isDirectory = false;
  try {
    isDirectory = lstatSync(resolvedPath).isDirectory();
  } catch {
    // A deleted target still gets categorized by its safe relative suffix.
  }
  if (isDirectory) {
    const firstSegment = relativePath.split(path.sep)[0]?.toLowerCase();
    const area = relativePath === ''
      ? 'fixture-root'
      : firstSegment === '.serpent' ? 'library-internal' : 'managed-folder';
    return `${stage}:${operation}:directory-${area}:${code}`;
  }
  const extension = path.extname(resolvedPath).toLowerCase();
  const category = /-(wal|shm|journal)$/iu.test(path.basename(resolvedPath))
    ? 'database-sidecar'
    : extension === '.db' ? 'database'
      : extension === '.jpg' || extension === '.jpeg' ? 'thumbnail'
        : extension === '.png' ? 'source-image'
          : extension === '.json' ? 'metadata'
            : 'other-file';
  return `${stage}:${operation}:${category}:${code}`;
}

function assertNoReparsePoints(root: string): void {
  const stat = lstatSync(root);
  if (stat.isSymbolicLink()) throw new Error('Owned fixture contains a reparse point.');
  if (!stat.isDirectory()) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    const child = lstatSync(entryPath);
    if (child.isSymbolicLink()) throw new Error('Owned fixture contains a reparse point.');
    if (child.isDirectory()) assertNoReparsePoints(entryPath);
  }
}

it('runs real secondary palette work at a full primary-wave boundary', async () => {
  const parent = path.resolve(tmpdir());
  const available = statfsSync(parent);
  const requiredBytes = 8 * 1024 * 1024;
  if (available.bavail * available.bsize < requiredBytes) {
    throw new Error('Temporary fixture storage preflight failed.');
  }
  const root = mkdtempSync(path.join(parent, 'serpent-media-fairness-'));
  const fixture = new LibraryService();
  let created: ReturnType<LibraryService['createLibrary']>;
  const assetIds: string[] = [];
  const fixtureNames = ['amber', 'birch', 'cedar', 'dune', 'elm', 'fern', 'grove', 'hazel', 'indigo', 'juniper'];
  try {
    created = fixture.createLibrary({ displayName: 'MediaFairnessFixture', selectedParentPath: root });
    for (const [index, name] of fixtureNames.entries()) {
      const source = path.join(root, `${name}.png`);
      const bytes = await sharp({ create: {
        width: 2049,
        height: 320,
        channels: 3,
        background: { r: 40 + index * 25, g: 100 + index * 13, b: 170 - index * 17 },
      } }).png().toBuffer();
      writeFileSync(source, bytes);
      importNoConflict(fixture, created.libraryId, source);
      const imported = fixture.listAssets({ libraryId: created.libraryId, recursive: true })
        .find(asset => asset.relativeFilePath === `${name}.png`);
      expect(imported).toBeDefined();
      assetIds.push(imported!.assetId);
    }
    fixture.enqueueThumbnailJobs(created.libraryId, { assetIds, skipStaleRepair: true });
    const queuedPrimaryCount = fixture.listMediaJobs(created.libraryId, { limit: 100 }).jobs
      .filter(job => job.kind === 'generate_thumbnail' && job.status === 'queued').length;
    expect(queuedPrimaryCount).toBe(assetIds.length);
    await fixture.closeAllAsync(5_000);
  } catch (error) {
    const cleanupFailures: string[] = [];
    try {
      await fixture.closeAllAsync(5_000);
    } catch (cleanupError) {
      cleanupFailures.push(cleanupFailureLabel('service-close', cleanupError, root));
    }
    if (path.dirname(root) !== parent || !path.basename(root).startsWith('serpent-media-fairness-')) {
      cleanupFailures.push('ownership:boundary-mismatch');
    } else {
      try {
        assertNoReparsePoints(root);
      } catch (cleanupError) {
        cleanupFailures.push(cleanupFailureLabel('reparse-scan', cleanupError, root));
      }
      if (cleanupFailures.length === 0) {
        try {
          await rm(root, { recursive: true, force: false, maxRetries: 3, retryDelay: 100 });
        } catch (cleanupError) {
          cleanupFailures.push(cleanupFailureLabel('root-remove', cleanupError, root));
        }
      }
    }
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [error, new Error(`Owned fixture setup cleanup failed (${cleanupFailures.join(', ')}).`)],
        'Fixture setup failed and cleanup did not complete.',
        { cause: error },
      );
    }
    throw error;
  }

  const posted: PostedMessage[] = [];
  let receive: ((event: { data: unknown }) => void) | undefined;
  let workerImported = false;
  let shutdownAcknowledged = false;
  let secondWaveHeld = false;
  let resolveSecondWaveStarted!: () => void;
  const secondWaveStarted = new Promise<void>(resolve => { resolveSecondWaveStarted = resolve; });
  let resolveSecondWaveRelease!: () => void;
  const secondWaveRelease = new Promise<void>(resolve => { resolveSecondWaveRelease = resolve; });
  let resolveSecondWaveFinished!: (processed: number) => void;
  const secondWaveFinished = new Promise<number>(resolve => { resolveSecondWaveFinished = resolve; });
  let visibleWaveHeld = false;
  let visibleWaveActive = false;
  let visibleWaveAssetIds: string[] = [];
  let visibleSecondaryCalls = 0;
  let resolveVisibleWaveRelease!: () => void;
  const visibleWaveRelease = new Promise<void>(resolve => { resolveVisibleWaveRelease = resolve; });
  let resolveVisibleWaveFinished!: (processed: number) => void;
  const visibleWaveFinished = new Promise<number>(resolve => { resolveVisibleWaveFinished = resolve; });
  let explicitSecondaryHeld = false;
  let resolveExplicitSecondaryRelease!: () => void;
  const explicitSecondaryRelease = new Promise<void>(resolve => { resolveExplicitSecondaryRelease = resolve; });
  let resolveExplicitSecondaryFinished!: (processed: number) => void;
  const explicitSecondaryFinished = new Promise<number>(resolve => { resolveExplicitSecondaryFinished = resolve; });
  let primaryCalls = 0;
  let firstWaveBudget = 0;
  let firstWaveProcessed = 0;
  const secondaryCalls: Array<{
    maxJobs: number | undefined;
    paletteCapable: boolean;
    origin: QueueOptions['origin'];
  }> = [];
  const originalProcessQueue = LibraryService.prototype.processThumbnailQueue;
  const processQueueSpy = vi.spyOn(LibraryService.prototype, 'processThumbnailQueue')
    .mockImplementation(async function (this: LibraryService, libraryId, options: QueueOptions = {}) {
      const kinds = options.jobKinds ?? [];
      const isPrimary = kinds.includes('generate_thumbnail') || kinds.includes('generate_video_poster');
      if (
        isPrimary
        && options.interactive === true
        && (options.assetIds?.length ?? 0) > 0
        && !visibleWaveHeld
      ) {
        visibleWaveHeld = true;
        visibleWaveActive = true;
        visibleWaveAssetIds = [...options.assetIds!];
        await visibleWaveRelease;
        try {
          const processed = await originalProcessQueue.call(this, libraryId, options);
          resolveVisibleWaveFinished(processed);
          return processed;
        } finally {
          visibleWaveActive = false;
        }
      }
      if (isPrimary && options.origin !== 'explicit' && options.assetIds === undefined) {
        primaryCalls += 1;
        if (primaryCalls === 1) {
          firstWaveBudget = options.maxJobs ?? 0;
          firstWaveProcessed = await originalProcessQueue.call(this, libraryId, options);
          return firstWaveProcessed;
        }
        if (primaryCalls === 2 && !secondWaveHeld) {
          secondWaveHeld = true;
          resolveSecondWaveStarted();
          await secondWaveRelease;
          const processed = await originalProcessQueue.call(this, libraryId, options);
          resolveSecondWaveFinished(processed);
          return processed;
        }
      }

      const paletteCapable = kinds.includes('extract_palette');
      if (!isPrimary) {
        secondaryCalls.push({ maxJobs: options.maxJobs, paletteCapable, origin: options.origin });
        if (visibleWaveActive && options.origin !== 'explicit') visibleSecondaryCalls += 1;
        if (paletteCapable && options.origin === 'explicit' && !explicitSecondaryHeld) {
          explicitSecondaryHeld = true;
          await explicitSecondaryRelease;
          const processed = await originalProcessQueue.call(this, libraryId, options);
          resolveExplicitSecondaryFinished(processed);
          return processed;
        }
        // Keep the actual palette extraction on the far side of the held
        // second primary call so the event proves both lanes overlapped.
        if (paletteCapable) await secondWaveStarted;
      }
      return originalProcessQueue.call(this, libraryId, options);
    });
  const reconciliationSpy = vi.spyOn(LibraryService.prototype, 'runOpenBackgroundReconciliation')
    .mockImplementation(async () => undefined);

  Object.defineProperty(process, 'parentPort', { configurable: true, value: {
    on: (_event: string, listener: (event: { data: unknown }) => void) => { receive = listener; },
    postMessage: (message: PostedMessage) => {
      posted.push(message);
      if (message.type === 'plugin-media-provider.request') queueMicrotask(() => receive?.({ data: {
        type: 'plugin-media-provider.response',
        requestId: message.requestId,
        result: { status: 'native-fallback', assetId: message.assetId, kind: message.kind },
      } }));
    },
  } });

  let requestSequence = 0;
  const send = async (command: Record<string, unknown>) => {
    const requestId = `media-fairness-${++requestSequence}`;
    receive?.({ data: { requestId, command } });
    await vi.waitFor(() => expect(posted.some(message => message.requestId === requestId)).toBe(true), {
      timeout: 10_000,
      interval: 20,
    });
    const reply = posted.find(message => message.requestId === requestId)!;
    expect(reply.result).toMatchObject({ ok: true });
    return reply.result as Record<string, unknown>;
  };

  let testError: unknown;
  const cleanupFailures: string[] = [];
  try {
    await import('../../src/worker/index');
    workerImported = true;
    await send({ type: 'library.open', selectedLibraryPath: created.libraryPath });
    await send({ type: 'media.enqueue-thumbnail-jobs', libraryId: created.libraryId });
    await vi.waitFor(() => expect(secondWaveHeld).toBe(true), { timeout: 10_000, interval: 20 });

    expect(firstWaveBudget).toBeGreaterThan(0);
    expect(assetIds.length).toBeGreaterThan(firstWaveBudget);
    expect(firstWaveProcessed).toBe(firstWaveBudget);

    await vi.waitFor(() => {
      const paletteReady = posted.some(message =>
        message.type === 'asset.derived.ready' && message.kind === 'extract_palette');
      expect(paletteReady).toBe(true);
    }, { timeout: 6_000, interval: 25 });

    const paletteCallsDuringCompetition = secondaryCalls.filter(call => call.paletteCapable);
    expect(paletteCallsDuringCompetition.length).toBeGreaterThan(0);
    expect(paletteCallsDuringCompetition.every(call => (call.maxJobs ?? 0) <= 1)).toBe(true);
    const visibleAssetIds = assetIds.slice(firstWaveBudget);
    expect(visibleAssetIds.length).toBeGreaterThan(0);
    await send({
      type: 'asset.thumbnail.visible-window',
      libraryId: created.libraryId,
      assetIds: visibleAssetIds,
      viewportGeneration: 1,
    });
    resolveSecondWaveRelease();
    await secondWaveFinished;
    await vi.waitFor(() => expect(visibleWaveHeld).toBe(true), { timeout: 10_000, interval: 20 });
    expect(visibleWaveAssetIds.some(assetId => visibleAssetIds.includes(assetId))).toBe(true);
    const visibleJobs = await send({ type: 'media.list-jobs', libraryId: created.libraryId, limit: 100 });
    const visibleJobRows = visibleJobs.jobs as Array<{
      jobId: string;
      kind: string;
      status: string;
    }>;
    expect(visibleJobRows.some(job => job.kind === 'extract_palette' && job.status === 'queued')).toBe(true);
    await new Promise<void>(resolve => setTimeout(resolve, 2_200));
    expect(visibleSecondaryCalls).toBe(0);
    const jobsWhileVisibleIsHeld = await send({
      type: 'media.list-jobs',
      libraryId: created.libraryId,
      limit: 100,
    });
    const queuedPalette = (jobsWhileVisibleIsHeld.jobs as Array<{
      jobId: string;
      kind: string;
      status: string;
    }>).find(job =>
      job.kind === 'extract_palette' && job.status === 'queued');
    expect(queuedPalette).toBeDefined();

    await send({ type: 'media.pause-jobs', libraryId: created.libraryId });
    resolveVisibleWaveRelease();
    await visibleWaveFinished;
    const pausedSummary = await send({ type: 'media.job-summary', libraryId: created.libraryId });
    expect(pausedSummary.queuePaused).toBe(true);
    const ordinaryCallsWhilePaused = secondaryCalls.filter(call => call.origin !== 'explicit').length;
    await new Promise<void>(resolve => setTimeout(resolve, 250));
    expect(secondaryCalls.filter(call => call.origin !== 'explicit').length).toBe(ordinaryCallsWhilePaused);

    await send({
      type: 'media.resume-jobs',
      libraryId: created.libraryId,
      jobIds: [queuedPalette!.jobId],
    });
    await vi.waitFor(() => expect(explicitSecondaryHeld).toBe(true), { timeout: 10_000, interval: 20 });
    const explicitSummary = await send({ type: 'media.job-summary', libraryId: created.libraryId });
    expect(explicitSummary.queuePaused).toBe(true);
    const ordinaryCallsAtUrgentStart = secondaryCalls.filter(call => call.origin !== 'explicit').length;

    await send({ type: 'media.resume-jobs', libraryId: created.libraryId });
    const listJobs = async () => {
      const result = await send({ type: 'media.list-jobs', libraryId: created.libraryId, limit: 100 });
      return result.jobs as Array<{ kind: string; status: string }>;
    };
    await vi.waitFor(async () => {
      const jobs = await listJobs();
      const unfinishedPrimary = jobs.filter(job =>
        (job.kind === 'generate_thumbnail' || job.kind === 'generate_video_poster')
        && (job.status === 'queued' || job.status === 'running'));
      expect(unfinishedPrimary).toHaveLength(0);
    }, { timeout: 15_000, interval: 50 });
    expect(secondaryCalls.filter(call => call.origin !== 'explicit').length)
      .toBe(ordinaryCallsAtUrgentStart);

    resolveExplicitSecondaryRelease();
    expect(await explicitSecondaryFinished).toBeGreaterThan(0);
    await vi.waitFor(async () => {
      const jobs = await listJobs();
      const palettes = jobs.filter(job => job.kind === 'extract_palette');
      expect(palettes.length).toBe(assetIds.length);
      expect(palettes.every(job => job.status === 'succeeded')).toBe(true);
    }, { timeout: 15_000, interval: 50 });

    receive?.({ data: { type: 'worker.shutdown' } });
    await vi.waitFor(() => {
      shutdownAcknowledged = posted.some(message => message.type === 'worker.shutdown.ack');
      expect(shutdownAcknowledged).toBe(true);
    }, { timeout: 10_000, interval: 20 });
    fixture.openLibrary(created.libraryPath);
    const readyPalette = posted.find(message =>
      message.type === 'asset.derived.ready' && message.kind === 'extract_palette');
    expect(readyPalette?.assetId).toBeTypeOf('string');
    expect(fixture.getCurrentArtifact(created.libraryId, String(readyPalette!.assetId), 'extracted_palette'))
      .toMatchObject({ status: 'ready' });
    const jobs = fixture.listMediaJobs(created.libraryId, { limit: 100 }).jobs;
    expect(jobs.filter(job => job.kind === 'generate_thumbnail' && job.status === 'succeeded').length)
      .toBeGreaterThanOrEqual(firstWaveBudget);
  } catch (error) {
    testError = error;
  } finally {
    resolveSecondWaveRelease();
    resolveVisibleWaveRelease();
    resolveExplicitSecondaryRelease();
    try {
      if (workerImported) {
        if (!receive) {
          cleanupFailures.push('worker-shutdown:listener-missing');
        } else if (!shutdownAcknowledged) {
          receive({ data: { type: 'worker.shutdown' } });
          await vi.waitFor(() => {
            shutdownAcknowledged = posted.some(message => message.type === 'worker.shutdown.ack');
            expect(shutdownAcknowledged).toBe(true);
          }, { timeout: 10_000, interval: 20 });
        }
      } else {
        shutdownAcknowledged = true;
      }
    } catch (cleanupError) {
      cleanupFailures.push(cleanupFailureLabel('worker-shutdown', cleanupError, root));
    }
    try {
      processQueueSpy.mockRestore();
    } catch (cleanupError) {
      cleanupFailures.push(cleanupFailureLabel('process-spy-restore', cleanupError, root));
    }
    try {
      reconciliationSpy.mockRestore();
    } catch (cleanupError) {
      cleanupFailures.push(cleanupFailureLabel('reconciliation-spy-restore', cleanupError, root));
    }
    try {
      delete (process as unknown as { parentPort?: unknown }).parentPort;
    } catch (cleanupError) {
      cleanupFailures.push(cleanupFailureLabel('parent-port-restore', cleanupError, root));
    }
    let serviceClosed = false;
    try {
      await fixture.closeAllAsync(5_000);
      serviceClosed = true;
    } catch (cleanupError) {
      cleanupFailures.push(cleanupFailureLabel('service-close', cleanupError, root));
    }
    if (!shutdownAcknowledged) cleanupFailures.push('worker-shutdown:unconfirmed');
    if (path.dirname(root) !== parent || !path.basename(root).startsWith('serpent-media-fairness-')) {
      cleanupFailures.push('ownership:boundary-mismatch');
    } else if (!serviceClosed) {
      cleanupFailures.push('root-remove:skipped-service-open');
    } else if (!shutdownAcknowledged) {
      cleanupFailures.push('root-remove:skipped-worker-open');
    } else {
      try {
        assertNoReparsePoints(root);
      } catch (cleanupError) {
        cleanupFailures.push(cleanupFailureLabel('reparse-scan', cleanupError, root));
      }
      if (cleanupFailures.length === 0) {
        try {
          await rm(root, { recursive: true, force: false, maxRetries: 3, retryDelay: 100 });
        } catch (cleanupError) {
          cleanupFailures.push(cleanupFailureLabel('root-remove', cleanupError, root));
        }
      }
    }
  }

  if (cleanupFailures.length > 0) {
    const cleanupError = new Error(`Owned fixture cleanup failed (${cleanupFailures.join(', ')}).`);
    throw new AggregateError(
      testError ? [testError, cleanupError] : [cleanupError],
      'Worker fixture cleanup did not complete safely.',
      testError ? { cause: testError } : undefined,
    );
  }
  if (testError) throw testError;
}, 30_000);
