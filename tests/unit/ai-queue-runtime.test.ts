import { describe, expect, it, vi } from 'vitest';

import { AiQueueScheduler } from '../../src/main/ai-queue-scheduler';
import { AiJobAbortRegistry } from '../../src/worker/ai/job-abort-registry';

describe('AiJobAbortRegistry', () => {
  it('aborts only matching active jobs and removes completed registrations', () => {
    const registry = new AiJobAbortRegistry();
    const first = registry.register('library-1', 'job-1');
    const second = registry.register('library-1', 'job-2');
    const otherLibrary = registry.register('library-2', 'job-3');

    registry.abort('library-1', ['job-1']);
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(otherLibrary.signal.aborted).toBe(false);

    registry.unregister('job-2');
    registry.abort('library-1');
    expect(second.signal.aborted).toBe(false);
  });

  it('interrupts an in-flight analyzer through its AbortSignal', async () => {
    const registry = new AiJobAbortRegistry();
    const controller = registry.register('library-1', 'job-1');
    const analyzer = new Promise<void>((_resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
    });

    registry.abort('library-1', ['job-1']);

    await expect(analyzer).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('AiQueueScheduler', () => {
  it('drains successive full batches without waiting for another trigger', async () => {
    const processBatch = vi.fn()
      .mockResolvedValueOnce({ processed: 20, requeued: 0 })
      .mockResolvedValueOnce({ processed: 5, requeued: 0 });
    const scheduler = new AiQueueScheduler(processBatch, {
      batchSize: 20,
      baseRetryDelayMs: 100,
      maxRetryDelayMs: 800,
    });

    await scheduler.trigger('library-1');

    expect(processBatch).toHaveBeenCalledTimes(2);
    expect(processBatch).toHaveBeenNthCalledWith(1, 'library-1', 20);
    scheduler.clearAll();
  });

  it('does not lose a trigger that arrives while a batch is running', async () => {
    let releaseFirst!: (value: { processed: number; requeued: number }) => void;
    const firstBatch = new Promise<{ processed: number; requeued: number }>((resolve) => {
      releaseFirst = resolve;
    });
    const processBatch = vi.fn()
      .mockReturnValueOnce(firstBatch)
      .mockResolvedValueOnce({ processed: 0, requeued: 0 });
    const scheduler = new AiQueueScheduler(processBatch, {
      batchSize: 20,
      baseRetryDelayMs: 100,
      maxRetryDelayMs: 800,
    });

    const running = scheduler.trigger('library-1');
    await scheduler.trigger('library-1');
    releaseFirst({ processed: 0, requeued: 0 });
    await running;

    expect(processBatch).toHaveBeenCalledTimes(2);
    scheduler.clearAll();
  });

  it('retries requeued jobs with capped exponential backoff', async () => {
    vi.useFakeTimers();
    const processBatch = vi.fn()
      .mockResolvedValueOnce({ processed: 1, requeued: 1 })
      .mockResolvedValueOnce({ processed: 1, requeued: 1 })
      .mockResolvedValueOnce({ processed: 1, requeued: 0 });
    const scheduler = new AiQueueScheduler(processBatch, {
      batchSize: 20,
      baseRetryDelayMs: 100,
      maxRetryDelayMs: 150,
    });

    await scheduler.trigger('library-1');
    expect(processBatch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(processBatch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(processBatch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(149);
    expect(processBatch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(processBatch).toHaveBeenCalledTimes(3);

    scheduler.clearAll();
    vi.useRealTimers();
  });

  it('applies deterministic retry jitter when configured, preventing synchronized retry waves', async () => {
    vi.useFakeTimers();
    const processBatch = vi.fn()
      .mockResolvedValueOnce({ processed: 1, requeued: 1 })
      .mockResolvedValueOnce({ processed: 1, requeued: 0 });
    const scheduler = new AiQueueScheduler(processBatch, {
      batchSize: 20,
      baseRetryDelayMs: 100,
      maxRetryDelayMs: 800,
      retryJitterRatio: 0.2,
      random: () => 1,
    });

    await scheduler.trigger('library-1');
    await vi.advanceTimersByTimeAsync(119);
    expect(processBatch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(processBatch).toHaveBeenCalledTimes(2);

    scheduler.clearAll();
    vi.useRealTimers();
  });

  it('clears pending retry timers on shutdown', async () => {
    vi.useFakeTimers();
    const processBatch = vi.fn().mockResolvedValue({ processed: 1, requeued: 1 });
    const scheduler = new AiQueueScheduler(processBatch, {
      batchSize: 20,
      baseRetryDelayMs: 100,
      maxRetryDelayMs: 800,
    });

    await scheduler.trigger('library-1');
    scheduler.clearAll();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(processBatch).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
