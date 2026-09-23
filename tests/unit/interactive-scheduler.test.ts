import { describe, expect, it, vi } from 'vitest';

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
  type SchedulerStallInfo,
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
    expect(performanceLaneForCommand({ type: 'media.get-artifact-path' })).toBe('background-primary');
    expect(performanceLaneForCommand({ type: 'media.get-thumbnail-artifact' })).toBe('background-primary');
    expect(performanceLaneForCommand({ type: 'media.get-source-path' })).toBe('background-primary');
    expect(performanceLaneForCommand({ type: 'browse.session.open' })).toBe('interactive-control');
    expect(performanceLaneForCommand({ type: 'browse.session.page' })).toBe('interactive-control');
    expect(performanceLaneForCommand({ type: 'media.process-thumbnail-queue' })).toBe('background-primary');
    expect(performanceLaneForCommand({ type: 'ai.enqueue-analysis' })).toBe('background-secondary');
    expect(performanceLaneForCommand({ type: 'library.navigation-summary' })).toBe('background-secondary');
    expect(performanceLaneForCommand({ type: 'media.list-jobs' })).toBe('background-secondary');
    expect(performanceLaneForCommand({ type: 'media.job-summary' })).toBe('background-secondary');
    expect(performanceLaneForCommand({ type: 'ai.status' })).toBe('background-secondary');
    expect(performanceLaneForCommand({ type: 'plugin.jobs.list' })).toBe('background-secondary');
    expect(performanceLaneForCommand({ type: 'ai.test-connection' })).toBe('background-secondary');
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
      { type: 'browse.session.page', libraryId: 'library-1' },
      'interactive-control',
    )).toBe(false);
    expect(shouldPreemptAutomaticMedia(
      { type: 'media.get-source-path', libraryId: 'library-1', assetId: 'asset-1' },
      'background-primary',
    )).toBe(false);
    expect(shouldPreemptAutomaticMedia(
      { type: 'media.get-thumbnail-artifact', libraryId: 'library-1', assetId: 'asset-1' },
      'background-primary',
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
      'background-secondary',
    )).toBe(false);
    expect(shouldPreemptAutomaticMedia(
      { type: 'media.get-asset-drag-infos', libraryId: 'library-1' },
      'interactive-control',
    )).toBe(false);
  });

  /**
   * Native-drag priming is background hydration, but it used to fall through to
   * the `interactive-control` default lane. `InteractiveScheduler` allows at most
   * one interactive lane at a time and makes `mutation` wait for a fully idle
   * Worker, while background lanes yield to a queued mutation — so priming held
   * the single interactive slot for seconds. Measured on a real network library:
   * one 500-id chunk ran 3383 ms while `library.open` and every interactive
   * command queued behind it for ~3357 ms (the "switching libraries hangs"
   * symptom). It must stay a lane that yields.
   */
  it('keeps native-drag priming out of the exclusive interactive lane', () => {
    expect(performanceLaneForCommand({ type: 'media.get-asset-drag-infos' }))
      .toBe('background-primary');
    // It is read-only hydration: it must still not suspend automatic media.
    expect(shouldPreemptAutomaticMedia(
      { type: 'media.get-asset-drag-infos', libraryId: 'library-1' },
      'background-primary',
    )).toBe(false);
    // Lifecycle/navigation commands stay mutation so they get exclusive SQLite
    // ownership and preempt background work.
    expect(performanceLaneForCommand({
      type: 'library.open',
      selectedLibraryPath: 'C:\\library',
    })).toBe('mutation');
  });

  it('gives browse session open a latest-wins interaction key', () => {
    expect(performanceInteractionKeyForCommand({
      type: 'browse.session.open',
      libraryId: 'library-1',
    })).toBe('browse-session');
    expect(performanceInteractionKeyForCommand({
      type: 'ignore.gitignore.preview',
      libraryId: 'library-1',
      content: '*.tmp\n',
    })).toBe('ignore-preview');
    expect(performanceInteractionKeyForCommand({
      type: 'browse.session.page',
      libraryId: 'library-1',
    })).toBeUndefined();
  });
});

describe('InteractiveScheduler', () => {
  function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((nextResolve) => {
      resolve = nextResolve;
    });
    return { promise, resolve };
  }

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

  it('lets another library read proceed while lifecycle cleanup drains the old library', async () => {
    const scheduler = new InteractiveScheduler();
    const closeGate = deferred();
    const events: string[] = [];
    const close = scheduler.schedule(
      {
        requestId: 'close-a',
        lane: 'mutation',
        libraryId: 'library-a',
        lifecycleBoundary: true,
      },
      async () => {
        events.push('close-start');
        await closeGate.promise;
        events.push('close-end');
      },
    );
    await Promise.resolve();

    const read = scheduler.schedule(
      {
        requestId: 'read-b',
        lane: 'background-secondary',
        libraryId: 'library-b',
      },
      () => {
        events.push('read-b');
      },
    );

    await expect(read).resolves.toBeUndefined();
    expect(events).toEqual(['close-start', 'read-b']);
    closeGate.resolve();
    await expect(close).resolves.toBeUndefined();
    expect(events).toEqual(['close-start', 'read-b', 'close-end']);
  });

  it('does not let reads of the closing library bypass its lifecycle boundary', async () => {
    const scheduler = new InteractiveScheduler();
    const closeGate = deferred();
    let readStarted = false;
    const close = scheduler.schedule(
      {
        requestId: 'close-a',
        lane: 'mutation',
        libraryId: 'library-a',
        lifecycleBoundary: true,
      },
      () => closeGate.promise,
    );
    await Promise.resolve();
    const read = scheduler.schedule(
      {
        requestId: 'read-a',
        lane: 'background-secondary',
        libraryId: 'library-a',
      },
      () => {
        readStarted = true;
      },
    );

    await Promise.resolve();
    expect(readStarted).toBe(false);
    closeGate.resolve();
    await expect(close).resolves.toBeUndefined();
    await expect(read).resolves.toBeUndefined();
    expect(readStarted).toBe(true);
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

  it('admits a bounded set of read-only status snapshots alongside maintenance', async () => {
    const scheduler = new InteractiveScheduler();
    const events: string[] = [];
    let releaseMaintenance!: () => void;
    const maintenance = scheduler.schedule(
      { requestId: 'reconcile', lane: 'maintenance', libraryId: 'library-1', label: 'reconciliation' },
      () => new Promise<void>((resolve) => { releaseMaintenance = resolve; }),
    );
    await Promise.resolve();

    const releaseStatus: Array<() => void> = [];
    const statusReads = ['media.list-jobs', 'ai.status', 'plugin.jobs.list'].map((label, index) =>
      scheduler.schedule(
        { requestId: `status-${index}`, lane: 'background-secondary', libraryId: 'library-1', label },
        () => new Promise<void>((resolve) => {
          events.push(`${label}-start`);
          releaseStatus.push(() => {
            events.push(`${label}-end`);
            resolve();
          });
        }),
      ),
    );
    let releaseFourthStatus!: () => void;
    let fourthStatusStarted = false;
    const fourthStatus = scheduler.schedule(
      { requestId: 'status-history', lane: 'background-secondary', libraryId: 'library-1', label: 'history.status' },
      () => new Promise<void>((resolve) => {
        fourthStatusStarted = true;
        events.push('history.status-start');
        releaseFourthStatus = () => {
          events.push('history.status-end');
          resolve();
        };
      }),
    );
    let maintenanceWorkStarted = false;
    const maintenanceWork = scheduler.schedule(
      {
        requestId: 'analysis',
        lane: 'background-secondary',
        libraryId: 'library-1',
        label: 'ai.process-queue',
      },
      () => {
        maintenanceWorkStarted = true;
      },
    );
    let browseStarted = false;
    const browse = scheduler.schedule(
      { requestId: 'browse', lane: 'interactive-control', libraryId: 'library-1', label: 'browse.session.open' },
      () => {
        browseStarted = true;
      },
    );

    expect(events.filter((event) => event.endsWith('-start'))).toHaveLength(3);
    expect(fourthStatusStarted).toBe(false);
    expect(maintenanceWorkStarted).toBe(false);
    expect(browseStarted).toBe(true);
    await browse;

    releaseStatus[0]!();
    await statusReads[0];
    await vi.waitFor(() => expect(fourthStatusStarted).toBe(true));
    releaseFourthStatus();
    for (const release of releaseStatus.slice(1)) release();
    await Promise.all([...statusReads.slice(1), fourthStatus]);
    expect(maintenanceWorkStarted).toBe(false);

    releaseMaintenance();
    await maintenance;
    await maintenanceWork;
    expect(maintenanceWorkStarted).toBe(true);
  });

  it('admits status snapshots while maintenance shares the Worker with one thumbnail wave', async () => {
    const scheduler = new InteractiveScheduler();
    let releaseMaintenance!: () => void;
    const maintenance = scheduler.schedule(
      { requestId: 'reconcile', lane: 'maintenance', libraryId: 'library-1', label: 'reconciliation' },
      () => new Promise<void>((resolve) => { releaseMaintenance = resolve; }),
    );
    await Promise.resolve();
    let releaseThumbnails!: () => void;
    const thumbnails = scheduler.schedule(
      {
        requestId: 'thumbnails',
        lane: 'background-primary',
        libraryId: 'library-1',
        label: 'media.process-thumbnail-queue',
      },
      () => new Promise<void>((resolve) => { releaseThumbnails = resolve; }),
    );
    await Promise.resolve();

    let historyStarted = false;
    const history = scheduler.schedule(
      { requestId: 'status-history', lane: 'background-secondary', libraryId: 'library-1', label: 'history.status' },
      () => {
        historyStarted = true;
      },
    );

    expect(historyStarted).toBe(true);
    await history;
    releaseThumbnails();
    releaseMaintenance();
    await Promise.all([thumbnails, maintenance]);
  });

  it('keeps interaction latest-wins keys isolated per consumerId', async () => {
    const scheduler = new InteractiveScheduler();
    let releaseBlocking!: () => void;
    const blocking = scheduler.schedule(
      {
        requestId: 'blocking-read',
        lane: 'interactive-control',
        libraryId: 'library-1',
      },
      () => new Promise<void>((resolve) => { releaseBlocking = resolve; }),
    );
    const firstA = scheduler.schedule(
      {
        requestId: 'a-1',
        lane: 'interactive-control',
        libraryId: 'library-1',
        consumerId: 'window:a',
        interactionKey: 'browse',
        interactionGeneration: 1,
      },
      () => 'a-1',
    );
    const secondA = scheduler.schedule(
      {
        requestId: 'a-2',
        lane: 'interactive-control',
        libraryId: 'library-1',
        consumerId: 'window:a',
        interactionKey: 'browse',
        interactionGeneration: 2,
      },
      () => 'a-2',
    );
    const firstB = scheduler.schedule(
      {
        requestId: 'b-1',
        lane: 'interactive-control',
        libraryId: 'library-1',
        consumerId: 'window:b',
        interactionKey: 'browse',
        interactionGeneration: 1,
      },
      () => 'b-1',
    );

    await expect(firstA).rejects.toBeInstanceOf(SchedulerCancelledError);
    releaseBlocking();
    await expect(blocking).resolves.toBeUndefined();
    await expect(secondA).resolves.toBe('a-2');
    await expect(firstB).resolves.toBe('b-1');
  });

  it('does not admit browse while a started mutation is in a synchronous wait', async () => {
    const scheduler = new InteractiveScheduler();
    const events: string[] = [];
    let releaseMutation!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });

    const mutation = scheduler.schedule(
      { requestId: 'write', lane: 'mutation', libraryId: 'library-1' },
      async () => {
        events.push('mutation-start');
        const startedAt = Date.now();
        while (Date.now() - startedAt < 20) {
          // Synchronous stall: not setTimeout and not an async sleep.
        }
        events.push('mutation-blocked');
        await hold;
        events.push('mutation-end');
      },
    );

    await Promise.resolve();
    expect(events).toEqual(['mutation-start', 'mutation-blocked']);

    let browseStarted = false;
    const browse = scheduler.schedule(
      { requestId: 'browse', lane: 'interactive-control', libraryId: 'library-1' },
      () => {
        browseStarted = true;
        events.push('browse');
      },
    );
    expect(browseStarted).toBe(false);

    releaseMutation();
    await Promise.all([mutation, browse]);
    expect(events).toEqual([
      'mutation-start',
      'mutation-blocked',
      'mutation-end',
      'browse',
    ]);
  });

  it('does not starve a library transition behind the interactive backlog', async () => {
    const scheduler = new InteractiveScheduler();
    const events: string[] = [];
    let releaseVisible!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseVisible = resolve;
    });

    // One visible-media report is running while the renderer has already queued
    // a deep interactive backlog — the shape of a switch issued mid-scroll.
    const running = scheduler.schedule(
      { requestId: 'visible', lane: 'visible-media', libraryId: 'library-a' },
      async () => {
        events.push('visible-start');
        await hold;
        events.push('visible-end');
      },
    );
    await Promise.resolve();
    for (let index = 0; index < 20; index += 1) {
      void scheduler.schedule(
        { requestId: `backlog-${index}`, lane: 'interactive-control', libraryId: 'library-a' },
        () => {
          events.push(`backlog-${index}`);
        },
      );
    }
    // The transition is a mutation: it needs exclusive ownership, but it must
    // not lose every admission pass to the interactive queue in front of it.
    const transition = scheduler.schedule(
      {
        requestId: 'open',
        lane: 'mutation',
        libraryId: 'library-b',
        lifecyclePriority: true,
      },
      () => {
        events.push('library-open');
      },
    );

    releaseVisible();
    await Promise.all([running, transition]);
    // The transition runs at the first safe point, ahead of every queued
    // interactive entry; the backlog only resumes after it settles.
    expect(events.slice(0, 3)).toEqual(['visible-start', 'visible-end', 'library-open']);
  });

  it('keeps an ordinary mutation behind interactive work', async () => {
    const scheduler = new InteractiveScheduler();
    const events: string[] = [];

    const interactive = scheduler.schedule(
      { requestId: 'interactive', lane: 'interactive-control', libraryId: 'library-1' },
      () => {
        events.push('interactive');
      },
    );
    const mutation = scheduler.schedule(
      { requestId: 'write', lane: 'mutation', libraryId: 'library-1' },
      () => {
        events.push('write');
      },
    );

    await Promise.all([interactive, mutation]);
    expect(events).toEqual(['interactive', 'write']);
  });

  it('reports the lane holder when queued work cannot be admitted', async () => {
    const stalls: SchedulerStallInfo[] = [];
    const scheduler = new InteractiveScheduler({
      onStall: (info) => stalls.push(info),
      stallReportMs: 20,
    });
    let releaseHolder!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseHolder = resolve;
    });

    // A single interactive owner blocks every other lane: another interactive
    // request needs `activeInteractive < 1`, and a mutation needs a completely
    // idle scheduler. That is the shape of a switch waiting on a stuck open.
    const holder = scheduler.schedule(
      { requestId: 'holder', lane: 'interactive-control', label: 'browse.session.open', libraryId: 'library-1' },
      () => hold,
    );
    await Promise.resolve();
    const waiting = scheduler.schedule(
      { requestId: 'waiting', lane: 'interactive-control', label: 'library.close', libraryId: 'library-1' },
      () => 'closed',
    );
    let mutationStarted = false;
    const mutation = scheduler.schedule(
      { requestId: 'mutation', lane: 'mutation', label: 'library.open', libraryId: 'library-2' },
      () => {
        mutationStarted = true;
      },
    );

    await vi.waitFor(() => expect(stalls.length).toBeGreaterThan(0));
    expect(stalls[0]!.active).toEqual([
      {
        label: 'browse.session.open',
        lane: 'interactive-control',
        libraryId: 'library-1',
        runningMs: expect.any(Number),
      },
    ]);
    expect(stalls[0]!.queued.map((entry) => entry.label)).toEqual(['library.close', 'library.open']);
    expect(stalls[0]!.queued.every((entry) => entry.queuedMs >= 0)).toBe(true);
    expect(stalls[0]!.waitedMs).toBeGreaterThanOrEqual(20);
    expect(mutationStarted).toBe(false);

    releaseHolder();
    await Promise.all([holder, waiting, mutation]);
    const reportsAfterDrain = stalls.length;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(stalls.length).toBe(reportsAfterDrain);
  });

  it('does not report a stall for a queue that drains normally', async () => {
    const stalls: SchedulerStallInfo[] = [];
    const scheduler = new InteractiveScheduler({
      onStall: (info) => stalls.push(info),
      stallReportMs: 20,
    });

    await Promise.all([
      scheduler.schedule(
        { requestId: 'one', lane: 'interactive-control', label: 'browse.session.open', libraryId: 'library-1' },
        () => 'ok',
      ),
      scheduler.schedule(
        { requestId: 'two', lane: 'background-primary', label: 'media.backfill', libraryId: 'library-1' },
        () => 'ok',
      ),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(stalls).toEqual([]);
  });
});
