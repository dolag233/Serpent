export type VisibleDimensionProbeCoordinatorOptions<T extends { assetId: string }> = {
  probeBatch: (
    ids: string[],
    signal: AbortSignal,
    onReady: (item: T) => void,
    isWanted: (id: string) => boolean,
  ) => Promise<unknown>;
  publish: (item: T) => void;
  onError: (error: unknown) => void;
  onIdle?: () => void;
  yieldAfterBatch?: () => Promise<void>;
  batchSize?: number;
};

/**
 * Coalesces visible-dimension work to the latest union while keeping one drain
 * per library. Work already in a batch may finish, but its callbacks are
 * published only while their asset remains wanted.
 */
export class VisibleDimensionProbeCoordinator<T extends { assetId: string }> {
  readonly #options: VisibleDimensionProbeCoordinatorOptions<T>;
  readonly #controller = new AbortController();
  #wanted = new Set<string>();
  #pending: string[] = [];
  #activeDrain: Promise<void> | null = null;
  #activeDrainToken: object | null = null;
  #stopped = false;
  #idleNotified = false;

  constructor(options: VisibleDimensionProbeCoordinatorOptions<T>) {
    const batchSize = options.batchSize ?? 16;
    if (!Number.isInteger(batchSize) || batchSize <= 0) {
      throw new RangeError('batchSize must be a positive integer.');
    }
    this.#options = { ...options, batchSize };
  }

  update(ids: readonly string[]): void {
    if (this.#stopped) return;
    const uniqueIds = [...new Set(ids)];
    this.#wanted = new Set(uniqueIds);
    this.#pending = uniqueIds;

    if (this.#activeDrain) return;
    if (this.#pending.length === 0) {
      this.#notifyIdle();
      return;
    }
    this.#startDrain();
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#pending = [];
    this.#wanted.clear();
    this.#controller.abort();
    if (!this.#activeDrain) this.#notifyIdle();
  }

  async whenIdle(): Promise<void> {
    while (this.#activeDrain) {
      const activeDrain = this.#activeDrain;
      await activeDrain;
      // onIdle may synchronously enqueue a new update and start another drain.
      if (this.#activeDrain === activeDrain) break;
    }
  }

  #startDrain(): void {
    if (this.#activeDrain || this.#stopped || this.#pending.length === 0) return;
    this.#idleNotified = false;

    // Start on a microtask so ownership is installed before probeBatch can
    // synchronously reject or invoke callbacks that re-enter this instance.
    const token = {};
    this.#activeDrainToken = token;
    const ownedDrain = Promise.resolve()
      .then(() => this.#drain())
      .catch((error: unknown) => {
        this.#reportError(error);
      })
      .then(() => this.#finishDrain(token));
    this.#activeDrain = ownedDrain;
  }

  async #drain(): Promise<void> {
    while (!this.#stopped && this.#pending.length > 0) {
      const batch = this.#pending.splice(0, this.#options.batchSize);
      try {
        await this.#options.probeBatch(
          batch,
          this.#controller.signal,
          (item) => {
            if (this.#stopped || !this.#wanted.has(item.assetId)) return;
            try {
              this.#options.publish(item);
            } catch (error) {
              this.#reportError(error);
            }
          },
          (assetId) => !this.#stopped && this.#wanted.has(assetId),
        );
      } catch (error) {
        if (!this.#stopped && !isAbortError(error)) this.#reportError(error);
      }

      if (this.#stopped || this.#pending.length === 0) continue;
      try {
        await this.#options.yieldAfterBatch?.();
      } catch (error) {
        if (!this.#stopped && !isAbortError(error)) this.#reportError(error);
      }
    }
  }

  #finishDrain(token: object): void {
    if (this.#activeDrainToken !== token) return;
    this.#activeDrainToken = null;
    this.#activeDrain = null;

    if (!this.#stopped && this.#pending.length > 0) {
      this.#startDrain();
      return;
    }
    this.#notifyIdle();
  }

  #notifyIdle(): void {
    if (this.#idleNotified) return;
    this.#idleNotified = true;
    try {
      this.#options.onIdle?.();
    } catch (error) {
      this.#reportError(error);
    }
  }

  #reportError(error: unknown): void {
    try {
      this.#options.onError(error);
    } catch {
      // A diagnostic callback must not strand pending work or drain ownership.
    }
  }
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'AbortError';
}
