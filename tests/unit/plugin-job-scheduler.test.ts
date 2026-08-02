import { describe, expect, it, vi } from 'vitest';

import type { PluginJobComplete, PluginJobRecord } from '../../src/plugins/plugin-jobs';
import { PluginJobScheduler } from '../../src/main/plugin-job-scheduler';

function job(overrides: Partial<PluginJobRecord> = {}): PluginJobRecord {
  return {
    jobId: '00000000-0000-4000-8000-000000000001',
    libraryId: 'library-01',
    kind: 'plugin.background',
    status: 'queued',
    progress: 0,
    attemptCount: 0,
    errorCode: null,
    errorDetail: null,
    ownerPluginId: 'com.example.worker',
    ownerPackageHash: 'a'.repeat(64),
    ownerPluginInstanceId: 'instance-01',
    ownerScope: 'library',
    ownerLibraryId: 'library-01',
    pluginHandlerId: 'upscale',
    payload: { assetIds: ['asset-01', 'asset-02'] },
    recoveryStrategy: 'checkpoint',
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('PluginJobScheduler', () => {
  it('claims by plugin instance and forwards rich completion data', async () => {
    const requestWorker = vi.fn()
      .mockResolvedValueOnce({ ok: true, type: 'plugin.jobs.claimed', job: job() })
      .mockResolvedValueOnce({ ok: true, type: 'plugin.jobs.completed', job: job({ status: 'succeeded' }) })
      .mockResolvedValueOnce({ ok: true, type: 'plugin.jobs.claimed', job: null });
    const invokeJob = vi.fn().mockResolvedValue({
      complete: {
        jobId: '00000000-0000-4000-8000-000000000001',
        status: 'succeeded',
        completed: 2,
        total: 2,
        phase: 'writeback',
        message: 'Finished',
        itemResults: [{ itemId: 'asset-01', status: 'succeeded' }],
        failedAssetIds: [],
        checkpoint: {
          version: 'v1',
          data: { cursor: '2' },
          savedAt: '2026-08-02T00:00:00.000Z',
        },
      },
    });
    const scheduler = new PluginJobScheduler({
      supervisor: { invokeJob } as never,
      requestWorker,
      resolveInstances: () => [{
        instanceId: 'instance-01',
        instanceScope: 'library',
        mode: 'restricted',
        pluginId: 'com.example.worker',
        packageHash: 'a'.repeat(64),
        activated: true,
      }],
    });

    scheduler.tick('library-01');
    await vi.waitFor(() => expect(invokeJob).toHaveBeenCalledOnce());

    expect(requestWorker).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'plugin.jobs.claim-next',
      ownerPluginInstanceId: 'instance-01',
      ownerScope: 'library',
      ownerLibraryId: 'library-01',
    }));
    expect(requestWorker).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'plugin.jobs.complete',
      completed: 2,
      total: 2,
      phase: 'writeback',
      message: 'Finished',
      itemResults: [{ itemId: 'asset-01', status: 'succeeded' }],
      checkpoint: expect.objectContaining({ version: 'v1' }),
    }));
  });

  it('serializes repeated ticks for the same plugin instance', async () => {
    const first = job({ jobId: '00000000-0000-4000-8000-000000000001' });
    const second = job({ jobId: '00000000-0000-4000-8000-000000000002' });
    const pending = new Map<string, (value: { complete: PluginJobComplete }) => void>();
    let claimCount = 0;
    const requestWorker = vi.fn(async (command) => {
      if (command.type === 'plugin.jobs.claim-next') {
        claimCount += 1;
        return {
          ok: true,
          type: 'plugin.jobs.claimed',
          job: claimCount === 1 ? first : claimCount === 2 ? second : null,
        };
      }
      return { ok: true, type: 'plugin.jobs.completed', job: null };
    });
    const invokeJob = vi.fn(({ job: invoked }: { job: PluginJobRecord }) => new Promise<{ complete: PluginJobComplete }>((resolve) => {
      pending.set(invoked.jobId, resolve);
    }));
    const scheduler = new PluginJobScheduler({
      supervisor: { invokeJob } as never,
      requestWorker,
      resolveInstances: () => [{
        instanceId: 'instance-01',
        instanceScope: 'library',
        mode: 'restricted',
        pluginId: 'com.example.worker',
        packageHash: 'a'.repeat(64),
        activated: true,
      }],
    });

    scheduler.tick('library-01');
    await vi.waitFor(() => expect(invokeJob).toHaveBeenCalledOnce());
    scheduler.tick('library-01');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(invokeJob).toHaveBeenCalledOnce();

    pending.get(first.jobId)?.({
      complete: { jobId: first.jobId, status: 'succeeded' },
    });
    await vi.waitFor(() => expect(invokeJob).toHaveBeenCalledTimes(2));
    pending.get(second.jobId)?.({
      complete: { jobId: second.jobId, status: 'succeeded' },
    });
  });

  it('keeps the same global instance independent across libraries', async () => {
    const libraryOneJob = job({
      jobId: '00000000-0000-4000-8000-000000000011',
      libraryId: 'library-01',
      ownerScope: 'global',
      ownerLibraryId: 'library-01',
    });
    const libraryTwoJob = job({
      jobId: '00000000-0000-4000-8000-000000000012',
      libraryId: 'library-02',
      ownerScope: 'global',
      ownerLibraryId: 'library-02',
    });
    const pending = new Map<string, (value: { complete: PluginJobComplete }) => void>();
    const claimCountByLibrary = new Map<string, number>();
    const requestWorker = vi.fn(async (command) => {
      if (command.type === 'plugin.jobs.claim-next') {
        const claimCount = (claimCountByLibrary.get(command.libraryId) ?? 0) + 1;
        claimCountByLibrary.set(command.libraryId, claimCount);
        return {
          ok: true,
          type: 'plugin.jobs.claimed',
          job: claimCount === 1
            ? command.libraryId === 'library-01' ? libraryOneJob : libraryTwoJob
            : null,
        };
      }
      return { ok: true, type: 'plugin.jobs.completed', job: null };
    });
    const invokeJob = vi.fn(({ job: invoked }: { job: PluginJobRecord }) => new Promise<{ complete: PluginJobComplete }>((resolve) => {
      pending.set(invoked.jobId, resolve);
    }));
    const scheduler = new PluginJobScheduler({
      supervisor: { invokeJob } as never,
      requestWorker,
      resolveInstances: () => [{
        instanceId: 'global-instance-01',
        instanceScope: 'global',
        mode: 'restricted',
        pluginId: 'com.example.worker',
        packageHash: 'a'.repeat(64),
        activated: true,
      }],
    });

    scheduler.tick('library-01');
    scheduler.tick('library-02');
    await vi.waitFor(() => expect(invokeJob).toHaveBeenCalledTimes(2));

    pending.get(libraryOneJob.jobId)?.({
      complete: { jobId: libraryOneJob.jobId, status: 'succeeded' },
    });
    pending.get(libraryTwoJob.jobId)?.({
      complete: { jobId: libraryTwoJob.jobId, status: 'succeeded' },
    });
  });
});
