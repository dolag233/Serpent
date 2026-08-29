export class LibraryTransitionInProgressError extends Error {
  readonly code = "LIBRARY_TRANSITION_IN_PROGRESS" as const;

  constructor() {
    super("A library transition is already in progress.");
    this.name = "LibraryTransitionInProgressError";
  }
}

export type LibraryTransitionLock = {
  <T>(operation: () => Promise<T>): Promise<T>;
  /** Run a catalog/file write in the same FIFO gate as transitions. */
  runWrite<T>(operation: () => Promise<T>): Promise<T>;
  /** True after a transition has been requested and until it finishes. */
  hasTransitionPending(): boolean;
  /** True while the current transition callback is executing. */
  isTransitionRunning(): boolean;
};

/**
 * Serialize renderer-side library replacement and close/delete transitions
 * together with catalog/file writes. The Worker already serializes its
 * mutation lane, but the Renderer must keep UI teardown, library identity, and
 * the requests that mutate that identity in one FIFO order. Writes submitted
 * after a transition request are rejected rather than being replayed against
 * a different active library.
 */
export function createLibraryTransitionLock(): LibraryTransitionLock {
  let tail: Promise<void> = Promise.resolve();
  let pendingTransitions = 0;
  let runningTransitions = 0;

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const previous = tail;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = previous.catch(() => undefined).then(operation);
    // Keep later work behind the operation even when it rejects. The release
    // handler is attached with both branches so a rejected operation cannot
    // leave the queue permanently blocked.
    tail = run.then(() => gate, () => gate);
    run.then(
      () => release?.(),
      () => release?.(),
    );
    return run;
  };

  const runTransition = async <T>(operation: () => Promise<T>): Promise<T> => {
    pendingTransitions += 1;
    return enqueue(async () => {
      runningTransitions += 1;
      try {
        return await operation();
      } finally {
        runningTransitions = Math.max(0, runningTransitions - 1);
        pendingTransitions = Math.max(0, pendingTransitions - 1);
      }
    });
  };

  const runWrite = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (pendingTransitions > 0) {
      throw new LibraryTransitionInProgressError();
    }
    return enqueue(operation);
  };

  const lock = runTransition as LibraryTransitionLock;
  lock.runWrite = runWrite;
  lock.hasTransitionPending = () => pendingTransitions > 0;
  lock.isTransitionRunning = () => runningTransitions > 0;
  return lock;
}
