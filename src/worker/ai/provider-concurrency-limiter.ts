export type AiProvider = 'dashscope' | 'openai' | 'gemini' | 'anthropic';

export interface AiConcurrencySnapshot {
  /** Real outbound vendor requests holding a global semaphore slot. */
  inFlight: number;
  limit: number;
  waitingForSlot: number;
}

interface Waiter {
  resolve(): void;
  reject(error: Error): void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

/**
 * Process-wide AI semaphore. A single Library Worker owns every open library,
 * so one limiter enforces the configured cap across all providers and
 * libraries. The provider argument is retained at the call site for future
 * provider metrics, but must never split this global user-facing cap.
 */
export class ProviderConcurrencyLimiter {
  #active = 0;
  #limit: number;
  readonly #waiting: Waiter[] = [];
  readonly #listeners = new Set<(snapshot: AiConcurrencySnapshot) => void>();

  constructor(limit = 2) {
    this.#limit = assertLimit(limit);
  }

  /**
   * Applies future work immediately. Existing requests are allowed to finish,
   * so lowering the cap never aborts an analysis or corrupts its job state.
   */
  setLimit(limit: number): void {
    this.#limit = assertLimit(limit);
    this.#drain();
    this.#publish();
  }

  snapshot(): AiConcurrencySnapshot {
    return {
      inFlight: this.#active,
      limit: this.#limit,
      waitingForSlot: this.#waiting.length,
    };
  }

  /** Observability hook; listeners receive no provider, asset, or key data. */
  onChange(listener: (snapshot: AiConcurrencySnapshot) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async run<T>(_provider: AiProvider, signal: AbortSignal | undefined, task: () => Promise<T>): Promise<T> {
    await this.acquire(signal);
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private async acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new DOMException('AI request cancelled.', 'AbortError');
    if (this.#active < this.#limit) {
      this.#active += 1;
      this.#publish();
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal };
      if (signal) {
        waiter.onAbort = () => {
          const index = this.#waiting.indexOf(waiter);
          if (index >= 0) this.#waiting.splice(index, 1);
          this.#publish();
          reject(new DOMException('AI request cancelled.', 'AbortError'));
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.#waiting.push(waiter);
      this.#publish();
    });
  }

  private release(): void {
    this.#active = Math.max(0, this.#active - 1);
    this.#drain();
    this.#publish();
  }

  #drain(): void {
    while (this.#active < this.#limit && this.#waiting.length > 0) {
      const waiter = this.#waiting.shift()!;
      if (waiter.signal?.aborted) continue;
      if (waiter.signal && waiter.onAbort) {
        waiter.signal.removeEventListener('abort', waiter.onAbort);
      }
      this.#active += 1;
      waiter.resolve();
    }
  }

  #publish(): void {
    const snapshot = this.snapshot();
    for (const listener of this.#listeners) listener(snapshot);
  }
}

function assertLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new TypeError('AI concurrency limit must be a positive integer.');
  }
  return limit;
}
