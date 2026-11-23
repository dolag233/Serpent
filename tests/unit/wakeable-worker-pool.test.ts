import { describe, expect, it } from 'vitest';

import { WakeableWorkerPool } from '../../src/worker/wakeable-worker-pool';

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('WakeableWorkerPool', () => {
  it('starts new work in an empty slot while an earlier worker remains in flight', async () => {
    const slowEntered = deferred();
    const fastEntered = deferred();
    const releaseSlow = deferred();
    let calls = 0;
    let slowFinished = false;

    const pool = new WakeableWorkerPool({
      maxWorkers: 4,
      runWorker: async () => {
        calls += 1;
        if (calls === 1) {
          slowEntered.resolve();
          await releaseSlow.promise;
          slowFinished = true;
        } else if (calls === 2) {
          fastEntered.resolve();
        }
      },
    });

    const completion = pool.start(1);
    await slowEntered.promise;
    expect(pool.wake(2)).toBe(true);
    await fastEntered.promise;
    expect(slowFinished).toBe(false);

    releaseSlow.resolve();
    await completion;
    expect(slowFinished).toBe(true);
    // The first loop observes the wake and performs one yielded empty check.
    expect(calls).toBe(3);
  });

  it('caps live loops despite repeated larger wake requests', async () => {
    const twoEntered = deferred();
    const fourEntered = deferred();
    const release = deferred();
    let calls = 0;
    let active = 0;
    let maxActive = 0;

    const pool = new WakeableWorkerPool({
      maxWorkers: 4,
      runWorker: async () => {
        calls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (calls === 2) twoEntered.resolve();
        if (calls === 4) fourEntered.resolve();
        try {
          if (calls <= 4) await release.promise;
        } finally {
          active -= 1;
        }
      },
    });

    const completion = pool.start(2);
    await twoEntered.promise;
    expect(pool.wake(4)).toBe(true);
    await fourEntered.promise;
    for (let index = 0; index < 24; index += 1) {
      expect(pool.wake(10)).toBe(true);
    }
    expect(active).toBe(4);

    release.resolve();
    await completion;
    expect(maxActive).toBe(4);
    expect(calls).toBe(8);
  });

  it('rejects wakes after all worker loops have settled', async () => {
    let calls = 0;
    const pool = new WakeableWorkerPool({
      maxWorkers: 3,
      runWorker: async () => {
        calls += 1;
      },
    });

    await pool.start(1);
    expect(pool.wake(3)).toBe(false);
    expect(calls).toBe(1);
  });

  it('rechecks work when a wake arrives from the worker promise finalizer', async () => {
    const release = deferred();
    const retryEntered = deferred();
    let calls = 0;
    const pool = new WakeableWorkerPool({
      maxWorkers: 2,
      runWorker: () => {
        calls += 1;
        if (calls === 1) {
          return release.promise.finally(() => {
            expect(pool.wake(1)).toBe(true);
          });
        }
        retryEntered.resolve();
        return Promise.resolve();
      },
    });

    const completion = pool.start(1);
    release.resolve();
    await retryEntered.promise;
    await completion;
    expect(calls).toBe(2);
  });

  it('stops admission on failure and rejects only after other live workers settle', async () => {
    const allEntered = deferred();
    const failFirst = deferred();
    const releaseOthers = deferred();
    const errorObserved = deferred();
    const failure = new Error('fixture worker failure');
    let starts = 0;
    let finished = 0;
    let budget = 9;
    let settled = false;
    let onErrorCalls = 0;
    let observedError: unknown;

    const pool = new WakeableWorkerPool({
      maxWorkers: 3,
      runWorker: async () => {
        const worker = ++starts;
        if (starts === 3) allEntered.resolve();
        try {
          if (worker === 1) {
            await failFirst.promise;
            throw failure;
          }
          await releaseOthers.promise;
        } finally {
          finished += 1;
        }
      },
      onError: (error) => {
        onErrorCalls += 1;
        observedError = error;
        budget = 0;
        errorObserved.resolve();
      },
    });

    const completion = pool.start(3);
    void completion.then(
      () => { settled = true; },
      () => { settled = true; },
    );
    await allEntered.promise;
    failFirst.resolve();
    await errorObserved.promise;

    expect(budget).toBe(0);
    expect(pool.wake(3)).toBe(false);
    expect(settled).toBe(false);

    releaseOthers.resolve();
    await expect(completion).rejects.toBe(failure);
    expect(finished).toBe(3);
    expect(onErrorCalls).toBe(1);
    expect(observedError).toBe(failure);
  });
});
