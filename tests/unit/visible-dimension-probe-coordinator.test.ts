import { expect, test, vi } from 'vitest';

import { VisibleDimensionProbeCoordinator } from '../../src/worker/visible-dimension-probe-coordinator';

type ProbeItem = { assetId: string; width: number };

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('replaces pending ids, checks current wanted ids, and suppresses stale callbacks', async () => {
  const started = deferred<void>();
  const release = deferred<void>();
  const batches: string[][] = [];
  const claimed: string[][] = [];
  const published: ProbeItem[] = [];
  const errors: unknown[] = [];
  let active = 0;
  let maximumActive = 0;
  let firstIsWanted: ((assetId: string) => boolean) | undefined;

  const coordinator = new VisibleDimensionProbeCoordinator<ProbeItem>({
    batchSize: 2,
    probeBatch: async (ids, _signal, onReady, isWanted) => {
      batches.push(ids);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      try {
        if (batches.length === 1) {
          firstIsWanted = isWanted;
          started.resolve();
          await release.promise;
          claimed.push(ids.filter(isWanted));
          // Simulate a read that completed after its item became stale.
          onReady({ assetId: 'old-in-flight', width: 10 });
          onReady({ assetId: 'shared', width: 20 });
          return;
        }
        claimed.push(ids.filter(isWanted));
      } finally {
        active -= 1;
      }
    },
    publish: (item) => published.push(item),
    onError: (error) => errors.push(error),
  });

  coordinator.update(['old-in-flight', 'shared', 'obsolete-1', 'obsolete-2']);
  await started.promise;
  coordinator.update(['new', 'shared', 'new']);

  expect(firstIsWanted?.('old-in-flight')).toBe(false);
  expect(firstIsWanted?.('shared')).toBe(true);
  expect(firstIsWanted?.('new')).toBe(true);
  release.resolve();
  await coordinator.whenIdle();

  expect(batches).toEqual([
    ['old-in-flight', 'shared'],
    ['new', 'shared'],
  ]);
  expect(claimed).toEqual([['shared'], ['new', 'shared']]);
  expect(published).toEqual([{ assetId: 'shared', width: 20 }]);
  expect(maximumActive).toBe(1);
  expect(errors).toEqual([]);
});

test('stop aborts the drain, joins the active batch, suppresses callbacks, and ignores updates', async () => {
  const started = deferred<void>();
  const release = deferred<void>();
  const published: ProbeItem[] = [];
  const errors: unknown[] = [];
  const onIdle = vi.fn();
  let observedSignal: AbortSignal | undefined;
  let callCount = 0;

  const coordinator = new VisibleDimensionProbeCoordinator<ProbeItem>({
    probeBatch: async (_ids, signal, onReady) => {
      callCount += 1;
      observedSignal = signal;
      started.resolve();
      await release.promise;
      onReady({ assetId: 'asset-a', width: 10 });
    },
    publish: (item) => published.push(item),
    onError: (error) => errors.push(error),
    onIdle,
  });

  coordinator.update(['asset-a']);
  await started.promise;
  let joined = false;
  const joinPromise = coordinator.whenIdle().then(() => { joined = true; });
  coordinator.stop();
  coordinator.update(['asset-b']);
  await Promise.resolve();

  expect(observedSignal?.aborted).toBe(true);
  expect(joined).toBe(false);
  expect(callCount).toBe(1);
  release.resolve();
  await joinPromise;

  expect(joined).toBe(true);
  expect(callCount).toBe(1);
  expect(published).toEqual([]);
  expect(errors).toEqual([]);
  expect(onIdle).toHaveBeenCalledTimes(1);
});

test('empty update clears pending work and lets the active drain settle', async () => {
  const started = deferred<void>();
  const release = deferred<void>();
  const batches: string[][] = [];
  const onIdle = vi.fn();

  const coordinator = new VisibleDimensionProbeCoordinator<ProbeItem>({
    batchSize: 1,
    probeBatch: async (ids) => {
      batches.push(ids);
      started.resolve();
      await release.promise;
    },
    publish: () => undefined,
    onError: () => undefined,
    onIdle,
  });

  coordinator.update(['active', 'pending']);
  await started.promise;
  coordinator.update([]);
  release.resolve();
  await coordinator.whenIdle();

  expect(batches).toEqual([['active']]);
  expect(onIdle).toHaveBeenCalledTimes(1);
});

test('reports a failed batch once and continues with the latest pending ids without retrying the failed batch', async () => {
  const started = deferred<void>();
  const release = deferred<void>();
  const batches: string[][] = [];
  const errors: unknown[] = [];

  const coordinator = new VisibleDimensionProbeCoordinator<ProbeItem>({
    batchSize: 1,
    probeBatch: async (ids) => {
      batches.push(ids);
      if (batches.length === 1) {
        started.resolve();
        await release.promise;
        throw new Error('first batch failed');
      }
    },
    publish: () => undefined,
    onError: (error) => errors.push(error),
  });

  coordinator.update(['failed']);
  await started.promise;
  coordinator.update(['latest']);
  release.resolve();
  await coordinator.whenIdle();

  expect(batches).toEqual([['failed'], ['latest']]);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toMatchObject({ message: 'first batch failed' });
});

test('does not report abort errors from a probe batch', async () => {
  const errors: unknown[] = [];
  const coordinator = new VisibleDimensionProbeCoordinator<ProbeItem>({
    probeBatch: async () => {
      throw new DOMException('cancelled', 'AbortError');
    },
    publish: () => undefined,
    onError: (error) => errors.push(error),
  });

  coordinator.update(['asset-a']);
  await coordinator.whenIdle();

  expect(errors).toEqual([]);
});

test('an update after idle starts a fresh drain', async () => {
  const batches: string[][] = [];
  const onIdle = vi.fn();
  const coordinator = new VisibleDimensionProbeCoordinator<ProbeItem>({
    probeBatch: async (ids) => { batches.push(ids); },
    publish: () => undefined,
    onError: () => undefined,
    onIdle,
  });

  coordinator.update(['first']);
  await coordinator.whenIdle();
  coordinator.update(['second']);
  await coordinator.whenIdle();

  expect(batches).toEqual([['first'], ['second']]);
  expect(onIdle).toHaveBeenCalledTimes(2);
});

test('synchronous probe rejection preserves drain ownership when onIdle re-enters with new work', async () => {
  const batches: string[][] = [];
  const errors: unknown[] = [];
  const coordinatorRef: { current?: VisibleDimensionProbeCoordinator<ProbeItem> } = {};
  let idleCount = 0;

  const coordinator = new VisibleDimensionProbeCoordinator<ProbeItem>({
    probeBatch: (ids) => {
      batches.push(ids);
      if (batches.length === 1) throw new Error('synchronous failure');
      return Promise.resolve();
    },
    publish: () => undefined,
    onError: (error) => errors.push(error),
    onIdle: () => {
      idleCount += 1;
      if (idleCount === 1) coordinatorRef.current?.update(['second']);
    },
  });
  coordinatorRef.current = coordinator;

  coordinator.update(['first']);
  await coordinator.whenIdle();

  expect(batches).toEqual([['first'], ['second']]);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toMatchObject({ message: 'synchronous failure' });
  expect(idleCount).toBe(2);
});

test('uses a configured positive batch size and rejects invalid values', async () => {
  const batches: string[][] = [];
  const coordinator = new VisibleDimensionProbeCoordinator<ProbeItem>({
    batchSize: 2,
    probeBatch: async (ids) => { batches.push(ids); },
    publish: () => undefined,
    onError: () => undefined,
  });

  coordinator.update(['a', 'b', 'c', 'd', 'e']);
  await coordinator.whenIdle();

  expect(batches).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  expect(() => new VisibleDimensionProbeCoordinator<ProbeItem>({
    batchSize: 0,
    probeBatch: async () => undefined,
    publish: () => undefined,
    onError: () => undefined,
  })).toThrow(RangeError);
});
