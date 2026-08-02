import { describe, expect, it, vi } from 'vitest';

import type { PluginJobRecord } from '../../src/plugins/plugin-jobs';
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
});
