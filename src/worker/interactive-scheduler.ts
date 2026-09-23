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
  consumerId?: string;
  interactionKey?: string;
  interactionGeneration?: number;
  /** Lifecycle cleanup owns one library and may coexist with other-library reads. */
  lifecycleBoundary?: boolean;
  /**
   * The user is waiting on a library transition (open/create/close/delete).
   * Such a request outranks the entire queue instead of losing every admission
   * pass to the outgoing library's interactive backlog.
   */
  lifecyclePriority?: boolean;
  /** Re-check lifecycle ownership immediately before the handler starts. */
  isCurrent?: () => boolean;
  /** Command type, used only for stall diagnostics. */
  label?: string;
};

/** Why a non-empty queue could not be admitted, and who was holding the lanes. */
export type SchedulerStallInfo = {
  waitedMs: number;
  active: Array<{
    label: string;
    lane: PerformanceLane;
    libraryId?: string;
    runningMs: number;
  }>;
  queued: Array<{
    label: string;
    lane: PerformanceLane;
    libraryId?: string;
    queuedMs: number;
  }>;
};

export type InteractiveSchedulerOptions = {
  /**
   * Called when queued work has waited past the stall threshold without being
   * admitted. Purely diagnostic: it must not throw, and it never changes
   * admission decisions. The callback repeats with a growing interval while
   * the queue stays blocked.
   */
  onStall?: (info: SchedulerStallInfo) => void;
  stallReportMs?: number;
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

type QueueEntry<T> = {
  request: ScheduledRequest;
  run: () => Promise<T> | T;
  cancel?: () => void;
  onAdmitted?: () => void;
  deadlineTimer?: ReturnType<typeof setTimeout>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  sequence: number;
  enqueuedAt: number;
};

type ActiveEntry = {
  request: ScheduledRequest;
  cancel?: () => void;
  startedAt: number;
  /** Set while the owner has released its admission at a safe point. */
  yieldState?: { promise: Promise<void>; release: () => void };
};

type ReleasedEntry = {
  active: ActiveEntry;
  ready: boolean;
  /** Number of concurrent external operations sharing this owner. */
  pendingCount: number;
  promise: Promise<void>;
  resolve: () => void;
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

/**
 * Read-only state snapshots that may share the Worker with maintenance.
 * Unlike background task execution, these complete bounded SQLite reads and
 * must not wait for a potentially multi-second filesystem reconciliation.
 */
const MAINTENANCE_STATUS_READ_LABELS = new Set([
  'library.navigation-summary',
  'media.list-jobs',
  'media.job-summary',
  'ai.status',
  'plugin.jobs.list',
  'history.status',
  'sync.asset-card-status',
]);
const MAX_MAINTENANCE_STATUS_READS = 3;

/**
 * A library transition (open/create/close/delete-from-disk) is the one request
 * that must not wait its turn.
 *
 * It is a mutation, so it still needs a fully idle scheduler and runs
 * exclusively at the current owner's safe point — but a mutation's ordinary
 * priority (80) is below every interactive lane (100/95/90). A switch issued
 * while the renderer keeps feeding visible-window reports therefore loses the
 * admission pass to that backlog on every single pass and never starts: the
 * user sees "正在打开…" forever while the Worker is busy. Library transitions
 * outrank the whole queue instead, which is what makes a switch preemptive
 * rather than queued behind the outgoing library's media backlog.
 */
const LIFECYCLE_PRIORITY = 110;

// Node clamps setTimeout delays above the signed 32-bit millisecond range to
// roughly 1ms. Keep long-lived requests on a bounded timer and let the timer
// callback re-arm itself with the remaining duration instead of busy-looping.
const MAX_DEADLINE_TIMER_DELAY_MS = 2_147_483_647;

/** First stall report after this long; later reports back off up to the cap. */
const DEFAULT_STALL_REPORT_MS = 2_000;
const MAX_STALL_REPORT_MS = 30_000;

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
  /** Serpent-be29a9: active owners that released their admission at a safe point. */
  readonly #yielded = new Set<ActiveEntry>();
  /** Owners doing external async work without occupying a scheduler lane. */
  readonly #released = new Map<ActiveEntry, ReleasedEntry>();
  readonly #latestGenerationByKey = new Map<string, number>();
  readonly #options: InteractiveSchedulerOptions;
  #sequence = 0;
  #stallTimer: ReturnType<typeof setTimeout> | undefined;
  #stallSince: number | undefined;
  #stallReportDelayMs: number;

  constructor(options: InteractiveSchedulerOptions = {}) {
    this.#options = options;
    this.#stallReportDelayMs = options.stallReportMs ?? DEFAULT_STALL_REPORT_MS;
  }

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
      if (request.lane === 'mutation' && request.lifecyclePriority === true) {
        // A library transition cannot wait for another library's background
        // work to finish: a mutation needs a fully idle scheduler, so the
        // outgoing library's open-reconciliation kept the incoming library's
        // `library.open` queued for as long as that background pass ran
        // (measured: 13.5 s of `schedulerWaitMs` for a 154 ms handler). The
        // user is leaving that library — ask every cancellable background
        // owner to stop, whatever library it belongs to.
        this.cancelActiveBackgroundOwners();
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
        enqueuedAt: Date.now(),
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
   * Drop queued viewport hints (`asset.thumbnail.visible-window`) for one
   * library.
   *
   * A hint is an idempotent report of what is on screen, so it is safe to drop
   * — the renderer re-reports it as soon as the incoming library mounts. It is
   * also already allowed to fail: the latest-wins interaction key rejects
   * superseded queued hints. Preserving a deep hint backlog while a switch is
   * in flight makes the replacement's first page queue behind the library the
   * user just left.
   */
  cancelQueuedViewportHintsForLibrary(libraryId: string): number {
    let cancelled = 0;
    for (let index = this.#queue.length - 1; index >= 0; index -= 1) {
      const queued = this.#queue[index]!;
      if (queued.request.interactionKey !== 'visible-window') continue;
      if (queued.request.libraryId !== libraryId) continue;
      this.removeQueuedEntry(index)?.reject(
        new SchedulerCancelledError(queued.request.requestId, `library:${libraryId}`),
      );
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
    for (const active of [
      ...this.#active,
      ...this.#yielded,
      ...[...this.#released.keys()],
    ]) {
      if (active.request.libraryId !== libraryId) continue;
      if (!isBackgroundPerformanceLane(active.request.lane) || !active.cancel) continue;
      active.cancel();
      requested += 1;
    }
    return requested;
  }

  /**
   * Ask every active, cancellable background owner to reach its next safe
   * point, whatever library it belongs to. Used by a library transition, which
   * must not wait for the outgoing library's background pass to finish.
   */
  cancelActiveBackgroundOwners(): number {
    let requested = 0;
    for (const active of [
      ...this.#active,
      ...this.#yielded,
      ...[...this.#released.keys()],
    ]) {
      if (!isBackgroundPerformanceLane(active.request.lane) || !active.cancel) continue;
      active.cancel();
      requested += 1;
    }
    return requested;
  }

  /**
   * Serpent-be29a9: release a long background owner's admission at a safe point
   * so a queued interactive request or mutation can start, then take the
   * admission back before continuing.
   *
   * Measured before this existed: one open reconciliation held the single
   * background admission for up to 25.8 s while `browse.session.open` waited
   * 28.3 s and 1,509 status polls piled up behind it. The rule here is narrow on
   * purpose —
   *   - nothing interactive or mutating is waiting → return immediately, so a
   *     quiet library pays nothing;
   *   - interactive requests and mutations preempt the yield;
   *   - the yielded owner keeps the slot ahead of other *background* work, so
   *     the maintenance pass still makes bounded progress instead of losing the
   *     admission to a 1/s status poll forever.
   */
  async yieldAdmission(requestId: string): Promise<void> {
    if (!this.hasWaitingInteractiveOrMutation()) return;
    const entry = [...this.#active]
      .find((candidate) => candidate.request.requestId === requestId);
    if (!entry || entry.yieldState !== undefined) return;
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    entry.yieldState = { promise, release };
    // Keep the entry out of the active set: that is what frees the single
    // background admission (and lets a mutation see a fully idle scheduler).
    this.#active.delete(entry);
    this.#yielded.add(entry);
    this.drain();
    await promise;
  }

  /**
   * Run an external asynchronous operation without holding this scheduler's
  * admission. The active request is re-admitted before the returned promise
  * resolves, so callers can safely perform their short commit/cleanup phase
  * under the normal lane policy. This is intentionally different from
   * `yieldAdmission`: it releases even when no foreground request is queued.
   * Concurrent callers using the same request id share one released scope and
   * only reacquire after the last external operation finishes.
   */
  async runWithoutAdmission<T>(
    requestId: string,
    work: () => Promise<T> | T,
  ): Promise<T> {
    const active = [...this.#active]
      .find((candidate) => candidate.request.requestId === requestId);
    const released = [...this.#released.values()]
      .find((candidate) => candidate.active.request.requestId === requestId);
    if (released) {
      released.pendingCount += 1;
      try {
        return await work();
      } finally {
        released.pendingCount -= 1;
        if (released.pendingCount === 0) {
          released.ready = true;
          this.tryReacquireReleased();
        }
        await released.promise;
      }
    }
    if (!active) return work();

    let resolve!: () => void;
    const state: ReleasedEntry = {
      active,
      ready: false,
      pendingCount: 1,
      promise: new Promise<void>((done) => { resolve = done; }),
      resolve: () => resolve(),
    };
    this.#released.set(active, state);
    this.#active.delete(active);
    this.drain();
    try {
      return await work();
    } finally {
      state.pendingCount -= 1;
      if (state.pendingCount === 0) {
        state.ready = true;
        this.tryReacquireReleased();
      }
      await state.promise;
    }
  }

  private hasWaitingInteractiveOrMutation(): boolean {
    return this.#queue.some((entry) =>
      entry.request.lane === 'mutation'
      || isInteractivePerformanceLane(entry.request.lane));
  }

  /** Hand the admission back to the oldest yielded owner. */
  private resumeYieldingEntry(): boolean {
    for (const entry of this.#yielded) {
      this.#yielded.delete(entry);
      this.#active.add(entry);
      const state = entry.yieldState;
      entry.yieldState = undefined;
      state?.release();
      return true;
    }
    return false;
  }

  cancelAllQueued(): number {
    const cancelled = this.#queue.length;
    while (this.#queue.length > 0) {
      const queued = this.#queue.pop();
      this.clearDeadlineTimer(queued);
      if (queued) queued.reject(new SchedulerCancelledError(queued.request.requestId));
    }
    this.clearStallWatch();
    return cancelled;
  }

  /**
   * True when a `mutation` is queued or running for this library.
   *
   * A long-running background command holds the single Worker thread, so a
   * mutation that arrives mid-way cannot preempt it: the lane policy only
   * decides *admission*, and a synchronous command never reaches a safe point.
   * Cooperative background work (drag priming today) polls this between
   * sub-batches and abandons what is left — it is a cache primer, so a partial
   * result is safe and the next browse re-primes it. That is what makes a
   * library/folder switch feel preemptive instead of queued behind seconds of
   * background work.
   */
  mutationPendingFor(libraryId: string): boolean {
    for (const active of this.#active) {
      if (active.request.lane === 'mutation') return true;
    }
    for (const queued of this.#queue) {
      if (queued.request.lane !== 'mutation') continue;
      if (queued.request.libraryId === undefined || queued.request.libraryId === libraryId) {
        return true;
      }
    }
    return false;
  }

  get queuedCount(): number {
    return this.#queue.length;
  }

  get activeCount(): number {
    return this.#active.size;
  }

  private latestKey(request: ScheduledRequest): string | undefined {
    if (request.interactionKey === undefined || request.interactionGeneration === undefined) return undefined;
    return `${request.libraryId ?? ''}\u0000${request.consumerId ?? ''}\u0000${request.interactionKey}`;
  }

  private drain(): void {
    while (true) {
      this.discardExpiredQueuedRequests();
      const index = this.nextRunnableIndex();
      if (index < 0) {
        // Nothing queued can run: give a yielded owner its admission back so it
        // finishes instead of stalling behind an empty (or blocked) queue.
        if (this.resumeYieldingEntry()) continue;
        // Nothing can be admitted right now. If work is still waiting, that is
        // either a short burst or a genuine lane deadlock; the watchdog reports
        // the holder instead of leaving a silent hang.
        this.armStallWatch();
        return;
      }
      if (
        this.#yielded.size > 0
        && isBackgroundPerformanceLane(this.#queue[index]!.request.lane)
        && this.resumeYieldingEntry()
      ) {
        // The yielded owner keeps the slot ahead of other background work; only
        // interactive requests and mutations preempt it.
        continue;
      }
      this.clearStallWatch();
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

      const active: ActiveEntry = { request: entry.request, cancel: entry.cancel, startedAt: Date.now() };
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
        // A yielded owner that finished (or was cancelled) must release any
        // waiter and leave the yielded set, otherwise the admission is lost.
        this.#yielded.delete(active);
        const yieldState = active.yieldState;
        active.yieldState = undefined;
        yieldState?.release();
        this.tryReacquireReleased();
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
    if (this.#queue.length === 0) this.clearStallWatch();
    return entry;
  }

  private armStallWatch(): void {
    if (this.#stallTimer !== undefined) return;
    if (this.#queue.length === 0) return;
    const onStall = this.#options.onStall;
    if (!onStall) return;
    this.#stallSince ??= Date.now();
    const since = this.#stallSince;
    const timer = setTimeout(() => {
      this.#stallTimer = undefined;
      if (this.#queue.length === 0) {
        this.#stallSince = undefined;
        return;
      }
      try {
        onStall(this.stallInfo(Date.now() - since));
      } catch {
        // Diagnostics must never influence admission.
      }
      this.#stallReportDelayMs = Math.min(MAX_STALL_REPORT_MS, this.#stallReportDelayMs * 2);
      this.armStallWatch();
    }, this.#stallReportDelayMs);
    (timer as { unref?: () => void }).unref?.();
    this.#stallTimer = timer;
  }

  private clearStallWatch(): void {
    if (this.#stallTimer !== undefined) {
      clearTimeout(this.#stallTimer);
      this.#stallTimer = undefined;
    }
    this.#stallSince = undefined;
    this.#stallReportDelayMs = this.#options.stallReportMs ?? DEFAULT_STALL_REPORT_MS;
  }

  private stallInfo(waitedMs: number): SchedulerStallInfo {
    const now = Date.now();
    const activeEntries = [
      ...this.#active,
      ...[...this.#released.keys()],
    ];
    return {
      waitedMs,
      active: activeEntries.map((entry) => ({
        label: entry.request.label ?? entry.request.requestId,
        lane: entry.request.lane,
        ...(entry.request.libraryId === undefined ? {} : { libraryId: entry.request.libraryId }),
        runningMs: now - entry.startedAt,
      })),
      queued: this.#queue.map((entry) => ({
        label: entry.request.label ?? entry.request.requestId,
        lane: entry.request.lane,
        ...(entry.request.libraryId === undefined ? {} : { libraryId: entry.request.libraryId }),
        queuedMs: now - entry.enqueuedAt,
      })),
    };
  }

  private tryReacquireReleased(): boolean {
    if (this.#active.size > 0) return false;
    const priorityWaiting = this.#queue.some((entry) =>
      entry.request.lane === 'mutation' || isInteractivePerformanceLane(entry.request.lane),
    );
    if (priorityWaiting) {
      this.drain();
      return false;
    }
    for (const [entry, state] of this.#released) {
      if (!state.ready) continue;
      this.#released.delete(entry);
      this.#active.add(entry);
      state.resolve();
      return true;
    }
    return false;
  }

  private nextRunnableIndex(): number {
    if (this.#queue.length === 0) return -1;
    const activeMutations = [...this.#active]
      .filter((entry) => entry.request.lane === 'mutation');
    const hasActiveMutation = activeMutations.length > 0;
    const hasQueuedMutation = this.#queue.some((entry) => entry.request.lane === 'mutation');
    const activeInteractiveEntries = [...this.#active]
      .filter((entry) => isInteractivePerformanceLane(entry.request.lane));
    const activeInteractive = activeInteractiveEntries.length;
    /**
     * Serpent-52eed4（真实实例日志 2026-09-14）：`media.get-preview-artifact` 是
     * viewer-upgrade，单次可跑 5.6–15.7 秒（冷预览/RAW/OIIO 解码或插件）。它占着
     * 唯一交互槽时，`browse.session.open` / `folder.browse-entries` /
     * `asset.thumbnail.visible-window` 全部排队——用户看到的就是「切一个文件夹卡 20 秒」。
     * 导航属于 interactive-control：允许它在 viewer-upgrade 正在跑时另开一个槽，
     * 但导航之间仍串行、且同一时刻仍只允许一个 viewer-upgrade。
     */
    const activeInteractiveControl = activeInteractiveEntries
      .filter((entry) => entry.request.lane === 'interactive-control').length;
    const activeBackgroundEntries = [...this.#active]
      .filter((entry) => isBackgroundPerformanceLane(entry.request.lane));
    const activeBackground = activeBackgroundEntries.length;
    const activeMaintenanceStatusReads = activeBackgroundEntries.filter((entry) =>
      entry.request.lane === 'background-secondary'
      && MAINTENANCE_STATUS_READ_LABELS.has(entry.request.label ?? ''),
    );
    const activeMaintenanceCount = activeBackgroundEntries
      .filter((entry) => entry.request.lane === 'maintenance').length;
    const activeBackgroundPrimary = activeBackgroundEntries
      .filter((entry) => entry.request.lane === 'background-primary').length;
    // Status snapshots used to require “maintenance plus only status reads”.
    // GitHub #45: thumbnail waves are allowed to share the Worker with
    // maintenance (`onlyMaintenanceActive` below). That extra primary owner
    // disqualified the exception, so history.status / media.list-jobs waited
    // behind a multi-minute missing-file reconciliation.
    const hasMaintenanceWithOptionalPrimaryAndStatusReads = activeMaintenanceCount === 1
      && activeBackgroundPrimary <= 1
      && activeBackgroundEntries.length
        === 1 + activeBackgroundPrimary + activeMaintenanceStatusReads.length;
    // Serpent-52eed4（实测 2026-09-14）：开库对账是 30 秒级的 maintenance owner，
    // 而缩略图泵与可见卡 artifact 路径解析是 background-primary。「同时只允许一个
    // 后台任务」让用户切文件夹后等 34.6 秒才看到 15 张缩略图（schedulerWaitMs
    // 34,897 ms）。只放行一个服务可见内容的 background-primary 与 maintenance
    // 并行；background-secondary（状态轮询）与第二个 background-primary 仍被挡住。
    const onlyMaintenanceActive = activeBackground === 1
      && activeBackgroundEntries[0]!.request.lane === 'maintenance';

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
            ? (lane === 'interactive-control'
              // 只针对长耗时的 viewer-upgrade（冷预览/RAW 解码）另开槽；visible-media
              // 仍需保持原来的串行，否则「变更需要完全空闲」的保证会被破坏。
              ? activeInteractiveControl < 1
                && activeInteractiveEntries.every((entry) =>
                  entry.request.lane !== 'visible-media')
              : activeInteractive < 1)
            : !hasQueuedMutation
              && (
                activeBackground < 1
                || (lane === 'background-primary' && onlyMaintenanceActive)
                || (
                  lane === 'background-secondary'
                  && MAINTENANCE_STATUS_READ_LABELS.has(this.#queue[index]!.request.label ?? '')
                  && hasMaintenanceWithOptionalPrimaryAndStatusReads
                  && activeMaintenanceStatusReads.length < MAX_MAINTENANCE_STATUS_READS
                )
              );
      if (!canStart) continue;
      const priority = this.#queue[index]!.request.lifecyclePriority === true
        ? LIFECYCLE_PRIORITY
        : LANE_PRIORITY[lane];
      const selected = bestIndex >= 0 ? this.#queue[bestIndex] : undefined;
      if (priority > bestPriority || (priority === bestPriority && selected !== undefined && this.#queue[index]!.sequence < selected.sequence)) {
        bestIndex = index;
        bestPriority = priority;
      }
    }
    return bestIndex;
  }
}
