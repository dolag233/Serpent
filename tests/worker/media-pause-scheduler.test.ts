import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, expect, it, vi } from 'vitest';
import { LibraryService } from '../../src/worker/library-service';
import { importNoConflict } from './import-no-conflict';

const ownedFixtures: Array<{ root: string; parent: string; service?: LibraryService; workerClosed: boolean }> = [];
afterEach(() => {
  for (const owned of ownedFixtures.splice(0)) {
    owned.service?.closeAll();
    if (!owned.workerClosed) throw new Error('Worker shutdown was not confirmed; the fixture remains in use.');
    if (path.dirname(owned.root) !== owned.parent || !path.basename(owned.root).startsWith('serpent-pause-scheduler-')) {
      throw new Error('Fixture cleanup ownership check failed.');
    }
    rmSync(owned.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

it('keeps selected and full resume wakes across old automatic and explicit pump cleanup', async () => {
  const parent = path.resolve(tmpdir());
  const root = mkdtempSync(path.join(parent, 'serpent-pause-scheduler-'));
  const owned: (typeof ownedFixtures)[number] = { root, parent, workerClosed: true };
  ownedFixtures.push(owned);
  const fixture = new LibraryService();
  owned.service = fixture;
  const created = fixture.createLibrary({ displayName: 'PauseWakeFixture', selectedParentPath: root });
  const ids: string[] = [];
  for (let index = 0; index < 2; index += 1) {
    const source = path.join(root, `image-${index}.png`);
    const bytes = await sharp({ create: {
      width: 2049, height: 4, channels: 3, background: { r: 90 + index, g: 120, b: 150 },
    } }).png().toBuffer();
    writeFileSync(source, bytes);
    ids.push(importNoConflict(fixture, created.libraryId, source).assets[0]!.assetId);
  }
  fixture.enqueueThumbnailJobs(created.libraryId, { assetIds: ids, skipStaleRepair: true });
  const selectedJob = fixture.listMediaJobs(created.libraryId).jobs.find(job => job.assetId === ids[0])!;
  fixture.closeAll();

  let releaseOld!: () => void;
  const oldRelease = new Promise<void>(resolve => { releaseOld = resolve; });
  let signalStarted!: () => void;
  const oldStarted = new Promise<void>(resolve => { signalStarted = resolve; });
  let held = false;
  let holdExplicitNext = false;
  let releaseExplicit!: () => void;
  const explicitRelease = new Promise<void>(resolve => { releaseExplicit = resolve; });
  let signalExplicitStarted!: () => void;
  const explicitStarted = new Promise<void>(resolve => { signalExplicitStarted = resolve; });
  const processQueue = LibraryService.prototype.processThumbnailQueue;
  const spy = vi.spyOn(LibraryService.prototype, 'processThumbnailQueue')
    .mockImplementation(async function (this: LibraryService, libraryId, options = {}) {
      if (!held && options.jobKinds?.includes('generate_thumbnail')) {
        held = true;
        signalStarted();
        await oldRelease;
        return 0;
      }
      if (holdExplicitNext && options.origin === 'explicit') {
        holdExplicitNext = false;
        signalExplicitStarted();
        await explicitRelease;
        return 0;
      }
      return processQueue.call(this, libraryId, options);
    });
  const reconciliation = vi.spyOn(LibraryService.prototype, 'runOpenBackgroundReconciliation')
    .mockImplementation(async () => undefined);
  const posted: Array<Record<string, unknown>> = [];
  let receive: ((event: { data: unknown }) => void) | undefined;
  let shutdown = false;
  Object.defineProperty(process, 'parentPort', { configurable: true, value: {
    on: (_event: string, listener: (event: { data: unknown }) => void) => { receive = listener; },
    postMessage: (message: Record<string, unknown>) => {
      posted.push(message);
      if (message.type === 'plugin-media-provider.request') queueMicrotask(() => receive?.({ data: {
        type: 'plugin-media-provider.response', requestId: message.requestId,
        result: { status: 'native-fallback', assetId: message.assetId, kind: message.kind },
      } }));
    },
  } });
  let sequence = 0;
  const send = async (command: Record<string, unknown>) => {
    const requestId = `pause-wake-${++sequence}`;
    receive?.({ data: { requestId, command } });
    await vi.waitFor(() => expect(posted.some(message => message.requestId === requestId)).toBe(true),
      { timeout: 10_000 });
    const reply = posted.find(message => message.requestId === requestId)!;
    expect(reply.result).toMatchObject({ ok: true });
    return reply.result as Record<string, unknown>;
  };
  try {
    owned.workerClosed = false;
    await import('../../src/worker/index');
    await send({ type: 'library.open', selectedLibraryPath: created.libraryPath });
    await send({ type: 'media.enqueue-thumbnail-jobs', libraryId: created.libraryId });
    await oldStarted;
    await send({ type: 'media.pause-jobs', libraryId: created.libraryId });
    await send({ type: 'media.resume-jobs', libraryId: created.libraryId, jobIds: [selectedJob.jobId] });
    // The old owner is still alive at this exact boundary. Its aborted closure
    // must hand off the explicit wake instead of retrying its automatic options.
    releaseOld();
    await vi.waitFor(() => {
      const ready = posted.some(event => event.type === 'asset.thumbnail.ready' && event.assetId === ids[0])
        || posted.some(event => event.type === 'asset.thumbnail.batch-ready'
          && (event.ready as Array<{ assetId: string }>).some(item => item.assetId === ids[0]));
      expect(ready).toBe(true);
    }, { timeout: 10_000 });
    const summary = await send({ type: 'media.job-summary', libraryId: created.libraryId });
    expect(summary).toMatchObject({ queuePaused: true, queued: 0, running: 0 });
    holdExplicitNext = true;
    await send({ type: 'media.retry-artifact', libraryId: created.libraryId, assetId: ids[0], kind: 'thumbnail' });
    await explicitStarted;
    await send({ type: 'media.pause-jobs', libraryId: created.libraryId });
    await send({ type: 'media.resume-jobs', libraryId: created.libraryId });
    // A full resume must replace the aborting explicit closure with a fresh
    // automatic owner, rather than lose the reschedule in the explicit tail.
    releaseExplicit();
    await vi.waitFor(() => {
      expect(posted.some(event => event.type === 'asset.thumbnail.ready' && event.assetId === ids[1])
        || posted.some(event => event.type === 'asset.thumbnail.batch-ready'
          && (event.ready as Array<{ assetId: string }>).some(item => item.assetId === ids[1]))).toBe(true);
    }, { timeout: 10_000 });
    receive?.({ data: { type: 'worker.shutdown' } });
    await vi.waitFor(() => expect(posted.some(message => message.type === 'worker.shutdown.ack')).toBe(true));
    shutdown = true;
    fixture.openLibrary(created.libraryPath);
    const jobs = fixture.listMediaJobs(created.libraryId).jobs;
    expect(fixture.isMediaQueuePaused(created.libraryId)).toBe(false);
    expect(jobs.find(job => job.jobId === selectedJob.jobId)?.status).toBe('succeeded');
    expect(jobs.find(job => job.assetId === ids[1] && job.kind === 'generate_thumbnail')?.status).toBe('succeeded');
  } finally {
    releaseOld();
    releaseExplicit();
    if (receive && !shutdown) {
      receive({ data: { type: 'worker.shutdown' } });
      await vi.waitFor(() => expect(posted.some(message => message.type === 'worker.shutdown.ack')).toBe(true),
        { timeout: 10_000 });
      shutdown = true;
    }
    owned.workerClosed = shutdown;
    spy.mockRestore();
    reconciliation.mockRestore();
    delete (process as unknown as { parentPort?: unknown }).parentPort;
    fixture.closeAll();
  }
}, 30_000);
