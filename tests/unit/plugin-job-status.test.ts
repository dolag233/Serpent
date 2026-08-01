import { describe, expect, it } from 'vitest';

import type { PluginJobRecord } from '../../src/plugins/plugin-jobs';
import { summarizePluginJobs } from '../../src/shared/plugin-job-status';

function job(partial: Partial<PluginJobRecord> & Pick<PluginJobRecord, 'jobId' | 'status'>): PluginJobRecord {
  return {
    libraryId: 'library-1',
    kind: 'plugin.background',
    progress: 0,
    attemptCount: 0,
    errorCode: null,
    errorDetail: null,
    ownerPluginId: 'com.serpent.job-probe',
    ownerPackageHash: 'a'.repeat(64),
    pluginHandlerId: 'tick',
    payload: {},
    recoveryStrategy: 'idempotent',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...partial,
  };
}

describe('summarizePluginJobs', () => {
  it('counts statuses and preserves owning plugin fields', () => {
    const summary = summarizePluginJobs([
      job({ jobId: '11111111-1111-4111-8111-111111111111', status: 'queued' }),
      job({ jobId: '22222222-2222-4222-8222-222222222222', status: 'running', progress: 0.5 }),
      job({ jobId: '33333333-3333-4333-8333-333333333333', status: 'paused' }),
      job({
        jobId: '44444444-4444-4444-8444-444444444444',
        status: 'failed',
        errorCode: 'PLUGIN_JOB_TIMEOUT',
        errorDetail: 'timed out',
      }),
      job({ jobId: '55555555-5555-4555-8555-555555555555', status: 'succeeded' }),
      job({ jobId: '66666666-6666-4666-8666-666666666666', status: 'cancelled' }),
    ]);

    expect(summary).toMatchObject({
      queued: 1,
      running: 1,
      paused: 1,
      failed: 1,
      succeeded: 1,
      cancelled: 1,
    });
    expect(summary.jobs[0]?.ownerPluginId).toBe('com.serpent.job-probe');
    expect(summary.jobs[0]?.pluginHandlerId).toBe('tick');
  });
});
