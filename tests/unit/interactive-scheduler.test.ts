import { describe, expect, it } from 'vitest';

import {
  performanceInteractionKeyForCommand,
  performanceLaneForCommand,
  shouldPreemptAutomaticMedia,
} from '../../src/shared/performance-contract';
import { LibraryRequestBroker } from '../../src/main/library-request-broker';
import { parseWorkerRequest } from '../../src/shared/protocol/requests';
import {
  InteractiveScheduler,
  SchedulerCancelledError,
} from '../../src/worker/interactive-scheduler';

describe('performance command classification', () => {
  it('validates Main-owned lane metadata at the Worker protocol boundary', () => {
    const parsed = parseWorkerRequest({
      requestId: 'request-1',
      command: {
        type: 'asset.list',
        libraryId: 'library-1',
        recursive: true,
      },
      performance: {
        lane: 'interactive-control',
        libraryId: 'library-1',
        libraryGeneration: 2,
        sentAtEpochMs: 123,
        interactionKey: 'browse',
        interactionGeneration: 4,
      },
    });

    expect(parsed.performance).toMatchObject({
      lane: 'interactive-control',
      libraryGeneration: 2,
      interactionGeneration: 4,
    });
  });

  it('keeps visible media and viewer upgrades out of background lanes', () => {
    expect(performanceLaneForCommand({ type: 'asset.thumbnail.visible-window' })).toBe('visible-media');
    expect(performanceLaneForCommand({ type: 'asset.preview' })).toBe('viewer-upgrade');
    expect(performanceLaneForCommand({ type: 'media.get-preview-artifact' })).toBe('viewer-upgrade');
    expect(performanceLaneForCommand({ type: 'media.get-artifact-path' })).toBe('interactive-control');
    expect(performanceLaneForCommand({ type: 'media.get-thumbnail-artifact' })).toBe('interactive-control');
    expect(performanceLaneForCommand({ type: 'media.get-source-path' })).toBe('interactive-control');
    expect(performanceLaneForCommand({ type: 'media.process-thumbnail-queue' })).toBe('background-primary');
    expect(performanceLaneForCommand({ type: 'ai.enqueue-analysis' })).toBe('background-secondary');
    expect(performanceLaneForCommand({ type: 'library.navigation-summary' })).toBe('background-secondary');
  });

  it('assigns lifecycle generations and bounded deadlines in Main', () => {
    const broker = new LibraryRequestBroker();
    const open = broker.envelopeFor({ type: 'library.open', selectedLibraryPath: '/tmp/library' });
    expect(open.libraryGeneration).toBeUndefined();

    broker.observeResult({
      ok: true,
      type: 'library.opened',
      library: { libraryId: 'library-1' },
    } as never);
    const browse = broker.envelopeFor({
      type: 'asset.list',
      libraryId: 'library-1',
      recursive: false,
    });
    expect(browse.libraryGeneration).toBe(1);

    broker.observeResult({ ok: true, type: 'library.closed', libraryId: 'library-1' } as never);
    const afterClose = broker.envelopeFor({
      type: 'asset.list',
      libraryId: 'library-1',
      recursive: false,
    }, { sentAtEpochMs: 100, timeoutMs: 250 });
    expect(afterClose).toMatchObject({
      libraryGeneration: 2,
      deadlineAtEpochMs: 350,
    });
  });

  it('gives mutations exclusive ownership of the Worker service', () => {
    expect(performanceLaneForCommand({ type: 'asset.move' })).toBe('mutation');
    expect(performanceLaneForCommand({ type: 'asset.search' })).toBe('interactive-control');
    expect(performanceInteractionKeyForCommand({
      type: 'asset.preview',
      libraryId: 'library-1',
      assetId: 'asset-1',
      mode: 'viewer',
    })).toBe('viewer:asset-1');
  });

  it('does not let browse reads and path lookups starve visible thumbnail work', () => {
    expect(shouldPreemptAutomaticMedia(
      { type: 'browse.session.geometry', libraryId: 'library-1' },
      'interactive-control',
    )).toBe(false);
    expect(shouldPreemptAutomaticMedia(
      { type: 'media.get-source-path', libraryId: 'library-1', assetId: 'asset-1' },
      'interactive-control',
    )).toBe(false);
    expect(shouldPreemptAutomaticMedia(
      { type: 'media.get-thumbnail-artifact', libraryId: 'library-1', assetId: 'asset-1' },
      'interactive-control',
    )).toBe(false);
    expect(shouldPreemptAutomaticMedia(
      { type: 'media.get-asset-path', libraryId: 'library-1', assetId: 'asset-1' },
      'interactive-control',
    )).toBe(false);
    expect(shouldPreemptAutomaticMedia(
      { type: 'media.get-preview-artifact', libraryId: 'library-1', assetId: 'asset-1' },
      'viewer-upgrade',
    )).toBe(true);
    expect(shouldPreemptAutomaticMedia(
      { type: 'asset.preview', libraryId: 'library-1', assetId: 'asset-1' },
      'viewer-upgrade',
    )).toBe(true);
    expect(shouldPreemptAutomaticMedia(
      { type: 'asset.thumbnail.visible-window', libraryId: 'library-1' },
      'visible-media',
    )).toBe(false);
    expect(shouldPreemptAutomaticMedia(
      { type: 'ai.status', libraryId: 'library-1' },
      'interactive-control',
    )).toBe(false);
    expect(shouldPreemptAutomaticMedia(
      { type: 'media.get-asset-drag-infos', libraryId: 'library-1' },
      'interactive-control',
    )).toBe(false);
  });
});

describe('InteractiveScheduler', () => {
  it('drops superseded queued work before it reaches the handler', async () => {
    const scheduler = new InteractiveScheduler();
    let releaseBlockingRead!: () => void;
    const blockingRead = scheduler.schedule(
      {
        requestId: 'blocking-read',
        lane: 'interactive-control',
        libraryId: 'library-1',
      },
      () => new Promise<string>((resolve) => { releaseBlockingRead = () => resolve('blocking-read'); }),
    );

    const first = scheduler.schedule(
      {
        requestId: 'first',
        lane: 'interactive-control',
        libraryId: 'library-1',
        interactionKey: 'browse',
        interactionGeneration: 1,
      },
      () => Promise.resolve('first'),
    );
    const second = scheduler.schedule(
      {
        requestId: 'second',
        lane: 'interactive-control',
        libraryId: 'library-1',
        interactionKey: 'browse',
        interactionGeneration: 2,
      },
      () => Promise.resolve('second'),
    );

    await expect(first).rejects.toBeInstanceOf(SchedulerCancelledError);
    releaseBlockingRead();
    await expect(blockingRead).resolves.toBe('blocking-read');
    await expect(second).resolves.toBe('second');
  });

  it('starts an interactive request while one background request is awaiting I/O', async () => {
    const scheduler = new InteractiveScheduler();
    let releaseBackground!: () => void;
    const order: string[] = [];
    const background = scheduler.schedule(
      { requestId: 'background', lane: 'background-primary', libraryId: 'library-1' },
      () => new Promise<string>((resolve) => {
        order.push('background-start');
        releaseBackground = () => {
          order.push('background-end');
          resolve('background');
        };
      }),
    );
    const interactive = scheduler.schedule(
      { requestId: 'interactive', lane: 'interactive-control', libraryId: 'library-1' },
      () => {
        order.push('interactive');
        return Promise.resolve('interactive');
      },
    );

    await expect(interactive).resolves.toBe('interactive');
    expect(order).toEqual(['background-start', 'interactive']);
    releaseBackground();
    await expect(background).resolves.toBe('background');
  });

  it('does not start a mutation until all reads have finished', async () => {
    const scheduler = new InteractiveScheduler();
    let releaseRead!: () => void;
    const order: string[] = [];
    const read = scheduler.schedule(
      { requestId: 'read', lane: 'interactive-control', libraryId: 'library-1' },
      () => new Promise<string>((resolve) => {
        order.push('read-start');
        releaseRead = () => {
          order.push('read-end');
          resolve('read');
        };
      }),
    );
    const mutation = scheduler.schedule(
      { requestId: 'mutation', lane: 'mutation', libraryId: 'library-1' },
      () => {
        order.push('mutation');
        return Promise.resolve('mutation');
      },
    );

    await Promise.resolve();
    expect(order).toEqual(['read-start']);
    releaseRead();
    await expect(read).resolves.toBe('read');
    await expect(mutation).resolves.toBe('mutation');
    expect(order).toEqual(['read-start', 'read-end', 'mutation']);
  });

  it('rechecks the library generation immediately before entering the handler', async () => {
    const scheduler = new InteractiveScheduler();
    let releaseBlocking!: () => void;
    const blocking = scheduler.schedule(
      { requestId: 'blocking', lane: 'interactive-control', libraryId: 'library-1' },
      () => new Promise<void>((resolve) => { releaseBlocking = resolve; }),
    );
    let current = true;
    const run = scheduler.schedule(
      {
        requestId: 'stale',
        lane: 'interactive-control',
        libraryId: 'library-1',
        libraryGeneration: 1,
        isCurrent: () => current,
      },
      () => {
        throw new Error('stale request entered the handler');
      },
    );
    current = false;
    releaseBlocking();
    await expect(blocking).resolves.toBeUndefined();
    await expect(run).rejects.toBeInstanceOf(SchedulerCancelledError);
  });

  it('cooperatively cancels an active background owner before a lifecycle mutation', async () => {
    const scheduler = new InteractiveScheduler();
    let releaseBackground!: () => void;
    let cancelBackground!: () => void;
    const background = scheduler.schedule(
      { requestId: 'reconcile', lane: 'maintenance', libraryId: 'library-1' },
      () => new Promise<string>((resolve) => {
        releaseBackground = () => resolve('done');
        cancelBackground = () => releaseBackground();
      }),
      { cancel: () => cancelBackground() },
    );
    const requested = scheduler.cancelActiveBackgroundForLibrary('library-1');
    expect(requested).toBe(1);
    await expect(background).resolves.toBe('done');
  });

  it('rejects an already expired request before entering the handler', async () => {
    const scheduler = new InteractiveScheduler();
    let entered = false;
    let admitted = false;
    const request = scheduler.schedule(
      {
        requestId: 'expired-before-admission',
        lane: 'interactive-control',
        deadlineAtEpochMs: Date.now() - 1,
      },
      () => {
        entered = true;
        return 'unexpected';
      },
      { onAdmitted: () => { admitted = true; } },
    );

    await expect(request).rejects.toMatchObject({
      reasonCode: 'DEADLINE_EXCEEDED',
    });
    expect(entered).toBe(false);
    expect(admitted).toBe(false);
  });

  it('drops a queued request that expires while another handler is active', async () => {
    const scheduler = new InteractiveScheduler();
    let releaseBlocking!: () => void;
    const blocking = scheduler.schedule(
      { requestId: 'deadline-blocker', lane: 'interactive-control' },
      () => new Promise<void>((resolve) => { releaseBlocking = resolve; }),
    );
    let entered = false;
    let admitted = false;
    const queued = scheduler.schedule(
      {
        requestId: 'deadline-queued',
        lane: 'interactive-control',
        deadlineAtEpochMs: Date.now() + 10,
      },
      () => {
        entered = true;
        return 'unexpected';
      },
      { onAdmitted: () => { admitted = true; } },
    );
    const queuedRejection = expect(queued).rejects.toMatchObject({
      reasonCode: 'DEADLINE_EXCEEDED',
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    await queuedRejection;
    expect(scheduler.queuedCount).toBe(0);
    releaseBlocking();
    await expect(blocking).resolves.toBeUndefined();
    expect(entered).toBe(false);
    expect(admitted).toBe(false);
  });

  it('cancels same-library background maintenance when a mutation arrives', async () => {
    const scheduler = new InteractiveScheduler();
    let releaseBackground!: () => void;
    let cancellationRequested = false;
    const background = scheduler.schedule(
      { requestId: 'reconcile', lane: 'maintenance', libraryId: 'library-1' },
      () => new Promise<string>((resolve) => {
        releaseBackground = () => resolve('done');
      }),
      {
        cancel: () => {
          cancellationRequested = true;
          releaseBackground();
        },
      },
    );
    const mutation = scheduler.schedule(
      { requestId: 'import', lane: 'mutation', libraryId: 'library-1' },
      () => 'imported',
    );

    expect(cancellationRequested).toBe(true);
    await expect(background).resolves.toBe('done');
    await expect(mutation).resolves.toBe('imported');
  });
});
