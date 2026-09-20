import { describe, expect, it, vi } from 'vitest';

import { InteractiveScheduler } from '../../src/worker/interactive-scheduler';

/**
 * Serpent-be29a9: a long background pass (the open reconciliation) must not hold
 * the single background admission for its whole duration. Measured on a real
 * library before this existed: `browse.session.open` waited 28.3 s behind one
 * reconciliation whose task ran up to 25.8 s, because the scheduler admits at
 * most one interactive lane and at most one background lane at a time.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('InteractiveScheduler admission yield', () => {
  it('lets a queued interactive request run inside the background pass', async () => {
    const events: string[] = [];
    const scheduler = new InteractiveScheduler();

    const maintenance = scheduler.schedule(
      { requestId: 'reconciliation:lib:1', lane: 'maintenance', label: 'reconciliation' },
      async () => {
        events.push('reconciliation:batch-1');
        await delay(5);
        await scheduler.yieldAdmission('reconciliation:lib:1');
        events.push('reconciliation:batch-2');
      },
    );
    await delay(0);
    const interactive = scheduler.schedule(
      { requestId: 'browse-open', lane: 'interactive-control', label: 'browse.session.open' },
      () => {
        events.push('browse:served');
      },
    );

    await Promise.all([maintenance, interactive]);

    // The navigation is served between the two batches of the pass, not after it.
    expect(events).toEqual([
      'reconciliation:batch-1',
      'browse:served',
      'reconciliation:batch-2',
    ]);
  });

  it('admits a mutation while the background pass is yielded', async () => {
    const events: string[] = [];
    const scheduler = new InteractiveScheduler();

    const maintenance = scheduler.schedule(
      { requestId: 'reconciliation:lib:1', lane: 'maintenance', label: 'reconciliation' },
      async () => {
        await delay(5);
        await scheduler.yieldAdmission('reconciliation:lib:1');
        events.push('reconciliation:resumed');
      },
    );
    await delay(0);
    // A mutation needs a completely idle scheduler; the yield is what makes the
    // user's delete/rename/switch able to start mid-pass.
    const mutation = scheduler.schedule(
      { requestId: 'folder-create', lane: 'mutation', libraryId: 'lib', label: 'folder.create' },
      () => {
        events.push('mutation:ran');
      },
    );

    await Promise.all([maintenance, mutation]);
    expect(events).toEqual(['mutation:ran', 'reconciliation:resumed']);
  });

  it('admits bounded status reads without blocking maintenance progress', async () => {
    const events: string[] = [];
    const scheduler = new InteractiveScheduler();
    let releasePoll!: () => void;

    const maintenance = scheduler.schedule(
      { requestId: 'reconciliation:lib:1', lane: 'maintenance', label: 'reconciliation' },
      async () => {
        await delay(5);
        await scheduler.yieldAdmission('reconciliation:lib:1');
        events.push('reconciliation:resumed');
        await delay(5);
        events.push('reconciliation:done');
      },
    );
    await delay(0);
    const poll = scheduler.schedule(
      { requestId: 'media-list-jobs', lane: 'background-secondary', label: 'media.list-jobs' },
      () => new Promise<void>((resolve) => {
        events.push('poll:started');
        releasePoll = () => {
          events.push('poll:finished');
          resolve();
        };
      }),
    );

    expect(events).toContain('poll:started');
    // The admitted snapshot may overlap the maintenance owner, but it cannot
    // hold that owner's permit or prevent its next bounded batch from running.
    await vi.waitFor(() => expect(events).toContain('reconciliation:done'));
    expect(events).not.toContain('poll:finished');
    releasePoll();
    await Promise.all([maintenance, poll]);
    expect(events).toContain('reconciliation:done');
    expect(events).toContain('poll:finished');
  });

  it('returns immediately when nothing interactive or mutating is waiting', async () => {
    const events: string[] = [];
    const scheduler = new InteractiveScheduler();

    await scheduler.schedule(
      { requestId: 'reconciliation:lib:1', lane: 'maintenance', label: 'reconciliation' },
      async () => {
        events.push('before');
        await scheduler.yieldAdmission('reconciliation:lib:1');
        events.push('after');
      },
    );

    expect(events).toEqual(['before', 'after']);
  });

  it('still reaches a yielded owner when a lifecycle boundary cancels background work', async () => {
    let cancellations = 0;
    const scheduler = new InteractiveScheduler();

    const maintenance = scheduler.schedule(
      { requestId: 'reconciliation:lib:1', lane: 'maintenance', libraryId: 'lib', label: 'reconciliation' },
      async () => {
        await delay(5);
        await scheduler.yieldAdmission('reconciliation:lib:1');
      },
      { cancel: () => { cancellations += 1; } },
    );
    // Queue interactive work so the yield actually releases the admission.
    const interactive = scheduler.schedule(
      { requestId: 'browse-open', lane: 'interactive-control', label: 'browse.session.open' },
      () => undefined,
    );
    await delay(0);

    expect(scheduler.cancelActiveBackgroundOwners()).toBe(1);
    expect(cancellations).toBe(1);

    await Promise.all([maintenance, interactive]);
    // The yielded owner was resumed even though it left the active set.
    expect(scheduler.cancelActiveBackgroundOwners()).toBe(0);
  });

  it('lets another background request run while an external wait is pending', async () => {
    const events: string[] = [];
    const scheduler = new InteractiveScheduler();
    let releaseExternal!: () => void;

    const ai = scheduler.schedule(
      { requestId: 'ai.process-queue', lane: 'background-secondary', label: 'ai.process-queue' },
      async () => {
        await scheduler.runWithoutAdmission('ai.process-queue', () => new Promise<void>((resolve) => {
          events.push('ai:external-start');
          releaseExternal = resolve;
        }));
        events.push('ai:resumed');
      },
    );
    await vi.waitFor(() => expect(events).toContain('ai:external-start'));

    const media = scheduler.schedule(
      { requestId: 'thumbnail-wave', lane: 'background-primary', label: 'media.thumbnail' },
      () => {
        events.push('media:started');
      },
    );
    await media;
    expect(events).toEqual(['ai:external-start', 'media:started']);

    releaseExternal();
    await ai;
    expect(events).toEqual(['ai:external-start', 'media:started', 'ai:resumed']);
  });

  it('releases and reacquires around each external stage, not only once per wave', async () => {
    const events: string[] = [];
    const scheduler = new InteractiveScheduler();
    let releasePrepare!: () => void;
    let releaseProvider!: () => void;

    const ai = scheduler.schedule(
      { requestId: 'ai.process-queue', lane: 'background-secondary', label: 'ai.process-queue' },
      async () => {
        events.push('claim');
        await scheduler.runWithoutAdmission('ai.process-queue', () => new Promise<void>((resolve) => {
          events.push('prepare-external');
          releasePrepare = resolve;
        }));
        events.push('prepare-commit');
        await scheduler.runWithoutAdmission('ai.process-queue', () => new Promise<void>((resolve) => {
          events.push('provider-external');
          releaseProvider = resolve;
        }));
        events.push('commit');
      },
    );
    await vi.waitFor(() => expect(events).toContain('prepare-external'));

    const foreground = scheduler.schedule(
      { requestId: 'browse-open', lane: 'interactive-control', label: 'browse.session.open' },
      () => { events.push('foreground'); },
    );
    await foreground;
    expect(events).toEqual(['claim', 'prepare-external', 'foreground']);

    releasePrepare();
    await vi.waitFor(() => expect(events).toContain('provider-external'));
    const secondForeground = scheduler.schedule(
      { requestId: 'folder-open', lane: 'interactive-control', label: 'folder.browse' },
      () => { events.push('second-foreground'); },
    );
    await secondForeground;
    expect(events).toContain('second-foreground');

    releaseProvider();
    await ai;
    expect(events.at(-1)).toBe('commit');
  });

  it('shares one released scope across concurrent lanes without letting one lane reacquire early', async () => {
    const events: string[] = [];
    const scheduler = new InteractiveScheduler();
    let releaseA!: () => void;
    let releaseB!: () => void;

    const ai = scheduler.schedule(
      { requestId: 'ai.process-queue', lane: 'background-secondary', label: 'ai.process-queue' },
      async () => {
        const laneA = scheduler.runWithoutAdmission(
          'ai.process-queue',
          () => new Promise<void>((resolve) => {
            events.push('lane-a-external');
            releaseA = resolve;
          }),
        ).then(() => events.push('lane-a-commit'));
        const laneB = scheduler.runWithoutAdmission(
          'ai.process-queue',
          () => new Promise<void>((resolve) => {
            events.push('lane-b-external');
            releaseB = resolve;
          }),
        ).then(() => events.push('lane-b-commit'));
        await Promise.all([laneA, laneB]);
      },
    );
    await vi.waitFor(() => expect(events).toEqual(['lane-a-external', 'lane-b-external']));

    const foreground = scheduler.schedule(
      { requestId: 'browse-open', lane: 'interactive-control', label: 'browse.session.open' },
      () => { events.push('foreground'); },
    );
    await foreground;
    expect(events).toEqual(['lane-a-external', 'lane-b-external', 'foreground']);

    releaseA();
    await delay(0);
    expect(events).not.toContain('lane-a-commit');
    releaseB();
    await ai;
    expect(events).toContain('lane-a-commit');
    expect(events).toContain('lane-b-commit');
  });
});
