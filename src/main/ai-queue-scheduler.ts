export interface AiQueueBatchResult {
  processed: number;
  requeued: number;
}

interface AiQueueSchedulerOptions {
  batchSize: number;
  baseRetryDelayMs: number;
  maxRetryDelayMs: number;
}

interface QueueState {
  running: boolean;
  requested: boolean;
  retryRound: number;
  timer?: ReturnType<typeof setTimeout>;
}

export class AiQueueScheduler {
  private readonly stateByLibrary = new Map<string, QueueState>();

  constructor(
    private readonly processBatch: (libraryId: string, maxJobs: number) => Promise<AiQueueBatchResult>,
    private readonly options: AiQueueSchedulerOptions,
  ) {}

  async trigger(libraryId: string): Promise<void> {
    const state = this.stateByLibrary.get(libraryId) ?? { running: false, requested: false, retryRound: 0 };
    this.stateByLibrary.set(libraryId, state);
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = undefined;
    }
    if (state.running) {
      state.requested = true;
      return;
    }

    state.running = true;
    try {
      for (;;) {
        state.requested = false;
        const result = await this.processBatch(libraryId, this.options.batchSize);
        if (result.requeued > 0) {
          const delay = Math.min(
            this.options.baseRetryDelayMs * (2 ** state.retryRound),
            this.options.maxRetryDelayMs,
          );
          state.retryRound = Math.min(state.retryRound + 1, 30);
          state.timer = setTimeout(() => {
            state.timer = undefined;
            void this.trigger(libraryId);
          }, delay);
          state.timer.unref?.();
          return;
        }
        state.retryRound = 0;
        if (result.processed < this.options.batchSize && !state.requested) return;
      }
    } finally {
      state.running = false;
    }
  }

  clearAll(): void {
    for (const state of this.stateByLibrary.values()) {
      if (state.timer) clearTimeout(state.timer);
    }
    this.stateByLibrary.clear();
  }
}
