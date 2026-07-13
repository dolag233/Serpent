import type { AiProgressEvent } from '../../shared/protocol/responses';

/** Keeps the latest queue snapshot while limiting each library to one event/s. */
export class AiProgressThrottler {
  readonly #lastSentAt = new Map<string, number>();
  readonly #pending = new Map<string, AiProgressEvent>();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly emit: (event: AiProgressEvent) => void,
    private readonly intervalMs = 1_000,
  ) {}

  publish(event: AiProgressEvent): void {
    const now = Date.now();
    const lastSentAt = this.#lastSentAt.get(event.libraryId);
    if (lastSentAt === undefined || (now - lastSentAt >= this.intervalMs && !this.#timers.has(event.libraryId))) {
      this.emitNow(event, now);
      return;
    }

    this.#pending.set(event.libraryId, event);
    if (this.#timers.has(event.libraryId)) return;
    const remaining = Math.max(0, this.intervalMs - (now - lastSentAt));
    const timer = setTimeout(() => {
      this.#timers.delete(event.libraryId);
      const pending = this.#pending.get(event.libraryId);
      if (!pending) return;
      this.#pending.delete(event.libraryId);
      this.emitNow(pending, Date.now());
    }, remaining);
    timer.unref?.();
    this.#timers.set(event.libraryId, timer);
  }

  clearAll(): void {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    this.#pending.clear();
    this.#lastSentAt.clear();
  }

  private emitNow(event: AiProgressEvent, now: number): void {
    this.#lastSentAt.set(event.libraryId, now);
    this.emit(event);
  }
}
