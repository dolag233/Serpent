export type AiProvider = 'openai' | 'gemini' | 'anthropic';

interface Waiter {
  resolve(): void;
  reject(error: Error): void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

/**
 * Process-wide provider semaphore. A single Library Worker owns every open
 * library, so one limiter instance enforces the vendor cap across libraries.
 */
export class ProviderConcurrencyLimiter {
  readonly #active = new Map<AiProvider, number>();
  readonly #waiting = new Map<AiProvider, Waiter[]>();

  constructor(private readonly limit = 2) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new TypeError('AI provider concurrency limit must be a positive integer.');
    }
  }

  async run<T>(provider: AiProvider, signal: AbortSignal | undefined, task: () => Promise<T>): Promise<T> {
    await this.acquire(provider, signal);
    try {
      return await task();
    } finally {
      this.release(provider);
    }
  }

  private async acquire(provider: AiProvider, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new DOMException('AI request cancelled.', 'AbortError');
    const active = this.#active.get(provider) ?? 0;
    if (active < this.limit) {
      this.#active.set(provider, active + 1);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal };
      if (signal) {
        waiter.onAbort = () => {
          const queue = this.#waiting.get(provider);
          const index = queue?.indexOf(waiter) ?? -1;
          if (queue && index >= 0) queue.splice(index, 1);
          reject(new DOMException('AI request cancelled.', 'AbortError'));
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      const queue = this.#waiting.get(provider) ?? [];
      queue.push(waiter);
      this.#waiting.set(provider, queue);
    });
  }

  private release(provider: AiProvider): void {
    const queue = this.#waiting.get(provider);
    while (queue && queue.length > 0) {
      const waiter = queue.shift()!;
      if (waiter.signal?.aborted) continue;
      if (waiter.signal && waiter.onAbort) {
        waiter.signal.removeEventListener('abort', waiter.onAbort);
      }
      waiter.resolve();
      return;
    }
    if (queue?.length === 0) this.#waiting.delete(provider);
    const active = this.#active.get(provider) ?? 1;
    if (active <= 1) this.#active.delete(provider);
    else this.#active.set(provider, active - 1);
  }
}
