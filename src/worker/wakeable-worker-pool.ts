export interface WakeableWorkerPoolOptions {
  maxWorkers: number;
  /** Run one worker loop until it sees no work left. */
  runWorker: () => Promise<void>;
  /** Called once after the first worker failure, before remaining workers settle. */
  onError?: (error: unknown) => void;
}

/**
 * Owns a bounded set of asynchronous worker loops that can be woken while
 * existing loops are running or settling. A wake raises the pool's limit and
 * starts any newly available slots; it never interrupts an in-flight loop.
 */
export class WakeableWorkerPool {
  private readonly maxWorkers: number;
  private readonly runWorker: () => Promise<void>;
  private readonly onError: ((error: unknown) => void) | undefined;
  private readonly completion: Promise<void>;
  private resolveCompletion!: () => void;
  private rejectCompletion!: (error: unknown) => void;
  private started = false;
  private closed = false;
  private failed = false;
  private failure: unknown;
  private activeLimit = 0;
  private liveWorkers = 0;
  private wakeRevision = 0;

  constructor(options: WakeableWorkerPoolOptions) {
    if (!Number.isSafeInteger(options.maxWorkers) || options.maxWorkers < 1) {
      throw new RangeError('maxWorkers must be a positive safe integer.');
    }
    this.maxWorkers = options.maxWorkers;
    this.runWorker = options.runWorker;
    this.onError = options.onError;
    this.completion = new Promise<void>((resolve, reject) => {
      this.resolveCompletion = resolve;
      this.rejectCompletion = reject;
    });
  }

  /** Start the pool once. The initial loop count is capped by maxWorkers. */
  start(initialWorkers: number): Promise<void> {
    if (this.started) return this.completion;
    const initialLimit = this.normalizeWorkerCount(initialWorkers);
    this.started = true;
    this.activeLimit = initialLimit;
    this.wakeRevision += 1;
    this.startAvailableWorkers();
    return this.completion;
  }

  /**
   * Raise the active worker limit and fill free slots. Repeated wakes also
   * advance the revision so a loop returning at the same time will recheck.
   */
  wake(requestedWorkers: number): boolean {
    if (!this.started || this.closed || this.failed) return false;
    this.activeLimit = Math.max(this.activeLimit, this.normalizeWorkerCount(requestedWorkers));
    this.wakeRevision += 1;
    this.startAvailableWorkers();
    return true;
  }

  private normalizeWorkerCount(requestedWorkers: number): number {
    if (!Number.isSafeInteger(requestedWorkers) || requestedWorkers < 1) {
      throw new RangeError('worker count must be a positive safe integer.');
    }
    return Math.min(this.maxWorkers, requestedWorkers);
  }

  private startAvailableWorkers(): void {
    while (!this.failed && this.liveWorkers < this.activeLimit) {
      this.liveWorkers += 1;
      void this.runWorkerSlot();
    }
  }

  private async runWorkerSlot(): Promise<void> {
    const runUntilQuiet = async (): Promise<number> => {
      while (!this.failed) {
        const runRevision = this.wakeRevision;
        try {
          await this.runWorker();
        } catch (error) {
          this.fail(error);
          return this.wakeRevision;
        }
        if (this.failed) return this.wakeRevision;

        if (this.wakeRevision === runRevision) return runRevision;

        // Let other wake callbacks in this turn update the scope before the
        // final empty-work check. The revision makes this retry bounded to
        // actual wakes rather than a polling loop.
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      return this.wakeRevision;
    };

    while (!this.failed) {
      const observedRevision = await runUntilQuiet();
      if (this.failed || observedRevision === this.wakeRevision) break;

      // Keep the slot live across this settlement boundary. A wake can land
      // after runUntilQuiet resolves but before this continuation runs; give
      // that wake one yielded retry instead of losing it in final cleanup.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    this.workerSettled();
  }

  private fail(error: unknown): void {
    if (this.failed) return;
    this.failed = true;
    this.failure = error;
    try {
      this.onError?.(error);
    } catch {
      // Preserve the worker failure; callers use onError for queue cleanup.
    }
  }

  private workerSettled(): void {
    this.liveWorkers -= 1;
    if (this.liveWorkers !== 0) return;

    this.closed = true;
    if (this.failed) this.rejectCompletion(this.failure);
    else this.resolveCompletion();
  }
}
