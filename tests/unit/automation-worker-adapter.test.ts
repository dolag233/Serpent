import { describe, expect, it, vi } from 'vitest';

import {
  AutomationLibraryWorkerAdapter,
  type AutomationWorkerRequester,
} from '../../src/main/automation-worker-adapter';
import type { WorkerCommand } from '../../src/shared/protocol/requests';
import type { WorkerResult } from '../../src/shared/protocol/responses';

const enqueueCommand = {
  type: 'ai.enqueue-analysis',
  libraryId: 'library-1',
  assetIds: ['asset-1'],
} satisfies WorkerCommand;

const enqueueResult = {
  ok: true,
  type: 'ai.jobs.enqueued',
  libraryId: 'library-1',
  enqueued: 1,
  jobIds: ['job-1'],
  alreadyPendingJobIds: [],
  skippedAssetIds: [],
} satisfies WorkerResult;

function requester(result: WorkerResult): AutomationWorkerRequester & {
  readonly request: ReturnType<typeof vi.fn>;
} {
  return {
    request: vi.fn(async () => result),
  };
}

describe('AutomationLibraryWorkerAdapter AI scheduling seam', () => {
  it('triggers the Main scheduler after a successful AI enqueue without delaying the Worker result', async () => {
    const worker = requester(enqueueResult);
    const trigger = vi.fn();
    const adapter = new AutomationLibraryWorkerAdapter(worker, {
      onAiEnqueued: trigger,
    });

    await expect(adapter.request(enqueueCommand)).resolves.toBe(enqueueResult);
    expect(trigger).toHaveBeenCalledOnce();
    expect(trigger).toHaveBeenCalledWith('library-1');
  });

  it('re-triggers for already-pending jobs, but not for failed enqueue or read-only status responses', async () => {
    const trigger = vi.fn();
    const worker = requester({
      ok: true,
      type: 'ai.jobs.enqueued',
      libraryId: 'library-1',
      enqueued: 0,
      jobIds: [],
      alreadyPendingJobIds: ['job-existing'],
      skippedAssetIds: [],
    });
    const adapter = new AutomationLibraryWorkerAdapter(worker, {
      onAiEnqueued: trigger,
    });

    await adapter.request(enqueueCommand);
    expect(trigger).toHaveBeenCalledOnce();

    const failedWorker = requester({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'queue unavailable',
      },
    });
    const failedAdapter = new AutomationLibraryWorkerAdapter(failedWorker, {
      onAiEnqueued: trigger,
    });
    await failedAdapter.request(enqueueCommand);

    const statusWorker = requester({
      ok: true,
      type: 'ai.jobs.status',
      libraryId: 'library-1',
      queued: 0,
      running: 0,
      paused: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      jobs: [],
    });
    const statusAdapter = new AutomationLibraryWorkerAdapter(statusWorker, {
      onAiEnqueued: trigger,
    });
    await statusAdapter.request({
      type: 'ai.status',
      libraryId: 'library-1',
      jobIds: ['job-1'],
    }, { readonly: true });

    expect(trigger).toHaveBeenCalledOnce();
  });

  it('does not trigger after cancellation and does not turn scheduler failure into enqueue failure', async () => {
    const trigger = vi.fn(() => {
      throw new Error('scheduler unavailable');
    });
    const adapter = new AutomationLibraryWorkerAdapter(requester(enqueueResult), {
      onAiEnqueued: trigger,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(adapter.request(enqueueCommand, { signal: controller.signal }))
      .rejects.toThrow('cancelled before Worker dispatch');
    expect(trigger).not.toHaveBeenCalled();

    await expect(adapter.request(enqueueCommand)).resolves.toBe(enqueueResult);
    expect(trigger).toHaveBeenCalledOnce();
  });
});
