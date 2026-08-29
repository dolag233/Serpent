import {
  isBackgroundPerformanceLane,
  isInteractivePerformanceLane,
  type PerformanceLane,
} from '../shared/performance-contract';

export type ScheduledRequest = {
  requestId: string;
  lane: PerformanceLane;
  /**
   * Absolute wall-clock admission deadline. Expired queued work never enters
   * the handler; once onAdmitted begins, the request is a started operation.
   */
  deadlineAtEpochMs?: number;
  libraryId?: string;
  libraryGeneration?: number;
  interactionKey?: string;
  interactionGeneration?: number;
  /** Lifecycle cleanup owns one library and may coexist with other-library reads. */
  lifecycleBoundary?: boolean;
  /** Re-check lifecycle ownership immediately before the handler starts. */
  isCurrent?: () => boolean;
};

export class SchedulerCancelledError extends Error {
  readonly code = 'CANCELLED' as const;

  constructor(
    readonly requestId: string,
    readonly key?: string,
    readonly reasonCode: 'CANCELLED' | 'DEADLINE_EXCEEDED' = 'CANCELLED',
  ) {
    super(
      reasonCode === 'DEADLINE_EXCEEDED'
        ? `Worker request ${requestId} expired before execution.`
        : `Worker request ${requestId} was superseded before execution.`,
    );
    this.name = 'SchedulerCancelledError';
  }
}

interface QueueEntry<T> {
  request: ScheduledRequest;
  run: () => Promise<T> | T;
  cancel?: () => void;
  onAdmitted?: () => void;
  deadlineTimer?: ReturnType<typeof setTimeout>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  sequence: number;
}

type ActiveEntry = {
  request: ScheduledRequest;
  cancel?: () => void;
};

export type ScheduleOptions = {
  /** Abort a safe-to-stop background owner when a mutation needs the lane. */
  cancel?: () => void;
  /** Cancel queued work invalidated by a lifecycle boundary after admission. */
  cancelQueuedForLibrary?: string;
  /** Apply lightweight admission effects after the request passes the final queue check. */
  onAdmitted?: () => void;
};

const LANE_PRIORITY: Record<PerformanceLane, number> = {
  'interactive-control': 100,
  'viewer-upgrade': 95,
  'visible-media': 90,
  mutation: 80,
  'background-primary': 40,
  'background-secondary': 30,
  maintenance: 20,
};

// Node clamps setTimeout delays above the signed 32-bit millisecond range to
// roughly 1ms. Keep long-lived requests on a bounded timer and let the timer
// callback re-arm itself with the remaining duration instead of busy-looping.
const MAX_DEADLINE_TIMER_DELAY_MS = 2_147_483_647;

/**
 * Small admission controller for the single SQLite-owning Worker.
 *
 * It deliberately does not kill an active operation.  It only decides which
 * not-yet-started operation may enter the service, so file writes remain
 * recoverable and cancellation is observable as a typed result.
 */
export class InteractiveScheduler {
  readonly #queue: QueueEntry<unknown>[] = [];
  readonly #active = new Set<ActiveEntry>();
  readonly #latestGenerationByKey = new Map<string, number>();
  #sequence = 0;

  schedule<T>(
    request: ScheduledRequest,
    run: () => Promise<T> | T,
    options: ScheduleOptions = {},
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.isExpired(request)) {
        reject(new SchedulerCancelledError(request.requestId, undefined, 'DEADLINE_EXCEEDED'));
        return;
      }
      if (request.lane === 'mutation' && request.libraryId !== undefined) {
        // A mutation needs exclusive SQLite ownership. If the current owner is
        // cancellable background maintenance for the same library, ask it to
        // stop now instead of letting an active-idle loop hold the mutation
        // until its deadline. The active owner remains in the set until its
        // promise reaches a safe point; this never force-closes a write.
        this.cancelActiveBackgroundForLibrary(request.libraryId);
      }
      if (options.cancelQueuedForLibrary !== undefined) {
        this.cancelQueuedForLibrary(options.cancelQueuedForLibrary);
      }
      const key = this.latestKey(request);
      if (key !== undefined && request.interactionGeneration !== undefined) {
        const previousGeneration = this.#latestGenerationByKey.get(key);
        if (previousGeneration !== undefined && request.interactionGeneration < previousGeneration) {
          reject(new SchedulerCancelledError(request.requestId, key));
          return;
        }
        this.#latestGenerationByKey.set(key, request.interactionGeneration);
        for (let index = this.#queue.length - 1; index >= 0; index -= 1) {
          const queued = this.#queue[index]!;
          if (this.latestKey(queued.request) !== key) continue;
          if ((queued.request.interactionGeneration ?? 0) >= request.interactionGeneration) continue;
          this.removeQueuedEntry(index)?.reject(new SchedulerCancelledError(queued.request.requestId, key));
        }
      }

      const entry: QueueEntry<unknown> = {
        request,
        run,
        cancel: options.cancel,
        onAdmitted: options.onAdmitted,
        resolve: (value) => resolve(value as T),
        reject,
        sequence: this.#sequence++,
      };
      this.#queue.push(entry);
      this.armDeadlineTimer(entry);
      this.drain();
    });
  }

  cancelQueuedForLibrary(libraryId: string): number {
    let cancelled = 0;
    for (let index = this.#queue.length - 1; index >= 0; index -= 1) {
      const queued = this.#queue[index]!;
      if (queued.request.libraryId !== libraryId) continue;
      this.removeQueuedEntry(index)?.reject(new SchedulerCancelledError(queued.request.requestId, `library:${libraryId}`));
      cancelled += 1;
    }
    return cancelled;
  }

  /**
   * Ask active, cancellable background owners for the same library to reach
   * their next safe point. The scheduler keeps them active until their
   * promise settles; it never forcefully removes an in-flight operation.
   */
  cancelActiveBackgroundForLibrary(libraryId: string): number {
    let requested = 0;
    for (const active of this.#active) {
      if (active.request.libraryId !== libraryId) continue;
      if (!isBackgroundPerformanceLane(active.request.lane) || !active.cancel) continue;
      active.cancel();
      requested += 1;
    }
    return requested;
  }

  cancelAllQueued(): number {
    const cancelled = this.#queue.length;
    while (this.#queue.length > 0) {
      const queued = this.#queue.pop();
      this.clearDeadlineTimer(queued);
      if (queued) queued.reject(new SchedulerCancelledError(queued.request.requestId));
    }
    return cancelled;
  }

  get queuedCount(): number {
    return this.#queue.length;
  }

  get activeCount(): number {
    return this.#active.size;
  }

  private latestKey(request: ScheduledRequest): string | undefined {
    if (request.interactionKey === undefined || request.interactionGeneration === undefined) return undefined;
    return `${request.libraryId ?? ''}\u0000${request.interactionKey}`;
  }

  private drain(): void {
    while (true) {
      this.discardExpiredQueuedRequests();
      const index = this.nextRunnableIndex();
      if (index < 0) return;
      const [entry] = this.#queue.splice(index, 1);
      if (!entry) return;
      this.clearDeadlineTimer(entry);
      if (this.isExpired(entry.request)) {
        entry.reject(new SchedulerCancelledError(entry.request.requestId, undefined, 'DEADLINE_EXCEEDED'));
        continue;
      }
      const key = this.latestKey(entry.request);
      if (entry.request.isCurrent !== undefined && !entry.request.isCurrent()) {
        entry.reject(new SchedulerCancelledError(entry.request.requestId));
        continue;
      }
      if (
        key !== undefined
        && entry.request.interactionGeneration !== undefined
        && entry.request.interactionGeneration < (this.#latestGenerationByKey.get(key) ?? 0)
      ) {
        entry.reject(new SchedulerCancelledError(entry.request.requestId, key));
        continue;
      }

      const active: ActiveEntry = { request: entry.request, cancel: entry.cancel };
      let result: Promise<unknown>;
      try {
        // This check is intentionally immediately before onAdmitted: the
        // callback is the admission boundary for Worker-side pause/mark/cancel
        // effects. Once it begins, the request is considered started and is
        // allowed to finish at its safe point even if the wall clock advances.
        if (this.isExpired(entry.request)) {
          entry.reject(new SchedulerCancelledError(entry.request.requestId, undefined, 'DEADLINE_EXCEEDED'));
          continue;
        }
        entry.onAdmitted?.();
        this.#active.add(active);
        result = Promise.resolve(entry.run());
      } catch (error) {
        result = Promise.reject(error);
      }
      result.then(entry.resolve, entry.reject).finally(() => {
        this.#active.delete(active);
        this.drain();
      });
    }
  }

  private isExpired(request: ScheduledRequest): boolean {
    return request.deadlineAtEpochMs !== undefined && Date.now() >= request.deadlineAtEpochMs;
  }

  private discardExpiredQueuedRequests(): void {
    for (let index = this.#queue.length - 1; index >= 0; index -= 1) {
      const entry = this.#queue[index]!;
      if (!this.isExpired(entry.request)) continue;
      this.removeQueuedEntry(index)?.reject(new SchedulerCancelledError(entry.request.requestId, undefined, 'DEADLINE_EXCEEDED'));
    }
  }

  private armDeadlineTimer(entry: QueueEntry<unknown>): void {
    const deadlineAtEpochMs = entry.request.deadlineAtEpochMs;
    if (deadlineAtEpochMs === undefined) return;
    const delayMs = Math.min(
      MAX_DEADLINE_TIMER_DELAY_MS,
      Math.max(0, deadlineAtEpochMs - Date.now()),
    );
    const timer = setTimeout(() => {
      if (!this.#queue.includes(entry)) return;
      if (!this.isExpired(entry.request)) {
        this.armDeadlineTimer(entry);
        return;
      }
      const index = this.#queue.indexOf(entry);
      if (index < 0) return;
      this.removeQueuedEntry(index)?.reject(
        new SchedulerCancelledError(entry.request.requestId, undefined, 'DEADLINE_EXCEEDED'),
      );
      // Removing a queued mutation can unblock a background lane, so run the
      // normal admission pass after the typed cancellation is delivered.
      this.drain();
    }, delayMs);
    entry.deadlineTimer = timer;
    (timer as { unref?: () => void }).unref?.();
  }

  private clearDeadlineTimer(entry: QueueEntry<unknown> | undefined): void {
    if (!entry?.deadlineTimer) return;
    clearTimeout(entry.deadlineTimer);
    entry.deadlineTimer = undefined;
  }

  private removeQueuedEntry(index: number): QueueEntry<unknown> | undefined {
    const [entry] = this.#queue.splice(index, 1);
    this.clearDeadlineTimer(entry);
    return entry;
  }

  private nextRunnableIndex(): number {
    if (this.#queue.length === 0) return -1;
    const activeMutations = [...this.#active]
      .filter((entry) => entry.request.lane === 'mutation');
    const hasActiveMutation = activeMutations.length > 0;
    const hasQueuedMutation = this.#queue.some((entry) => entry.request.lane === 'mutation');
    const activeInteractive = [...this.#active]
      .filter((entry) => isInteractivePerformanceLane(entry.request.lane)).length;
    const activeBackground = [...this.#active]
      .filter((entry) => isBackgroundPerformanceLane(entry.request.lane)).length;

    let bestIndex = -1;
    let bestPriority = -1;
    for (let index = 0; index < this.#queue.length; index += 1) {
      const lane = this.#queue[index]!.request.lane;
      const requestLibraryId = this.#queue[index]!.request.libraryId;
      const mayReadDuringOtherLibraryClose =
        lane !== 'mutation' &&
        requestLibraryId !== undefined &&
        activeMutations.length > 0 &&
        activeMutations.every((entry) =>
          entry.request.lifecycleBoundary === true &&
          entry.request.libraryId !== undefined &&
          entry.request.libraryId !== requestLibraryId,
        );
      const canStart = lane === 'mutation'
        ? !hasActiveMutation && this.#active.size === 0
        : hasActiveMutation
          ? mayReadDuringOtherLibraryClose
          : isInteractivePerformanceLane(lane)
            ? activeInteractive < 1
            : activeBackground < 1 && !hasQueuedMutation;
      if (!canStart) continue;
      const priority = LANE_PRIORITY[lane];
      const selected = bestIndex >= 0 ? this.#queue[bestIndex] : undefined;
      if (priority > bestPriority || (priority === bestPriority && selected !== undefined && this.#queue[index]!.sequence < selected.sequence)) {
        bestIndex = index;
        bestPriority = priority;
      }
    }
    return bestIndex;
  }
}
