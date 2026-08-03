import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';

describe('plugin job repository via LibraryService', () => {
  const roots: string[] = [];

  afterEach(() => {
    while (roots.length > 0) {
      const root = roots.pop();
      if (root !== undefined) rmSync(root, { recursive: true, force: true });
    }
  });

  it('enqueues, claims, reports progress, completes, and pauses instance-owned jobs', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-plugin-jobs-'));
    roots.push(root);
    const service = new LibraryService();
    const library = service.createLibrary({
      displayName: 'Plugin Jobs',
      selectedParentPath: root,
    });

    const packageHash = 'a'.repeat(64);
    const enqueued = service.enqueuePluginJob({
      libraryId: library.libraryId,
      ownerPluginId: 'com.serpent.job-probe',
      ownerPackageHash: packageHash,
      ownerPluginInstanceId: 'instance-01',
      ownerScope: 'library',
      ownerLibraryId: library.libraryId,
      pluginHandlerId: 'tick',
      payload: { n: 1 },
      recoveryStrategy: 'idempotent',
    });
    const otherInstanceJob = service.enqueuePluginJob({
      libraryId: library.libraryId,
      ownerPluginId: 'com.serpent.job-probe',
      ownerPackageHash: packageHash,
      ownerPluginInstanceId: 'instance-02',
      ownerScope: 'library',
      ownerLibraryId: library.libraryId,
      pluginHandlerId: 'tick',
      payload: { n: 99 },
      recoveryStrategy: 'idempotent',
    });
    expect(enqueued.status).toBe('queued');
    expect(enqueued.kind).toBe('plugin.background');

    const claimed = service.claimNextPluginJob({
      libraryId: library.libraryId,
      ownerPluginId: 'com.serpent.job-probe',
      ownerPackageHash: packageHash,
      ownerPluginInstanceId: 'instance-01',
      ownerScope: 'library',
      ownerLibraryId: library.libraryId,
    });
    expect(claimed?.jobId).toBe(enqueued.jobId);
    expect(claimed?.status).toBe('running');
    expect(claimed?.ownerPluginInstanceId).toBe('instance-01');

    const progressed = service.reportPluginJobProgress({
      libraryId: library.libraryId,
      jobId: enqueued.jobId,
      ownerPluginId: 'com.serpent.job-probe',
      ownerPackageHash: packageHash,
      ownerPluginInstanceId: 'instance-01',
      ownerScope: 'library',
      ownerLibraryId: library.libraryId,
      completed: 1,
      total: 2,
      phase: 'processing',
      message: 'Halfway',
    });
    expect(progressed?.progress).toBe(0.5);
    expect(progressed?.completed).toBe(1);
    expect(progressed?.phase).toBe('processing');
    expect(service.reportPluginJobProgress({
      libraryId: library.libraryId,
      jobId: enqueued.jobId,
      ownerPluginId: 'com.serpent.job-probe',
      ownerPackageHash: packageHash,
      ownerPluginInstanceId: 'instance-02',
      ownerScope: 'library',
      ownerLibraryId: library.libraryId,
      completed: 2,
      total: 2,
      phase: 'hijacked',
      message: 'Should be rejected',
    })).toBeNull();
    expect(service.listPluginJobs(library.libraryId).find((job) => job.jobId === enqueued.jobId)?.phase)
      .toBe('processing');
    expect(service.claimNextPluginJob({
      libraryId: library.libraryId,
      ownerPluginId: 'com.serpent.job-probe',
      ownerPackageHash: packageHash,
      ownerPluginInstanceId: 'instance-01',
      ownerScope: 'library',
      ownerLibraryId: library.libraryId,
    })).toBeNull();
    expect(service.claimNextPluginJob({
      libraryId: library.libraryId,
      ownerPluginId: 'com.serpent.job-probe',
      ownerPackageHash: packageHash,
      ownerPluginInstanceId: 'instance-02',
      ownerScope: 'library',
      ownerLibraryId: library.libraryId,
    })?.jobId).toBe(otherInstanceJob.jobId);
    expect(service.completePluginJob({
      libraryId: library.libraryId,
      jobId: otherInstanceJob.jobId,
      ownerPluginId: 'com.serpent.job-probe',
      ownerPackageHash: packageHash,
      ownerPluginInstanceId: 'instance-02',
      ownerScope: 'library',
      ownerLibraryId: library.libraryId,
      status: 'succeeded',
    })?.status).toBe('succeeded');

    const completed = service.completePluginJob({
      libraryId: library.libraryId,
      jobId: enqueued.jobId,
      ownerPluginId: 'com.serpent.job-probe',
      ownerPackageHash: packageHash,
      ownerPluginInstanceId: 'instance-01',
      ownerScope: 'library',
      ownerLibraryId: library.libraryId,
      status: 'succeeded',
    });
    expect(completed?.status).toBe('succeeded');
    expect(completed?.progress).toBe(1);

    expect(() => service.enqueuePluginJob({
      libraryId: library.libraryId,
      ownerPluginId: 'com.serpent.job-probe',
      ownerPackageHash: packageHash,
      ownerPluginInstanceId: 'global-instance',
      ownerScope: 'global',
      ownerLibraryId: '__serpent_global_runtime__',
      pluginHandlerId: 'tick',
      recoveryStrategy: 'idempotent',
    })).toThrow('concrete open library');

    const second = service.enqueuePluginJob({
      libraryId: library.libraryId,
      ownerPluginId: 'com.serpent.job-probe',
      ownerPackageHash: packageHash,
      ownerPluginInstanceId: 'instance-01',
      ownerScope: 'library',
      ownerLibraryId: library.libraryId,
      pluginHandlerId: 'tick',
      payload: { n: 2 },
      recoveryStrategy: 'idempotent',
    });
    const pausedCount = service.pausePluginJobsForOwners({
      libraryId: library.libraryId,
      owners: [{ pluginId: 'com.serpent.job-probe', packageHash }],
    });
    expect(pausedCount).toBe(1);
    const listed = service.listPluginJobs(library.libraryId);
    expect(listed.find((job) => job.jobId === second.jobId)?.status).toBe('paused');
    expect(listed.find((job) => job.jobId === second.jobId)?.errorCode).toBe('PLUGIN_UNAVAILABLE');

    service.closeLibrary(library.libraryId);
  });

  it('enforces owner isolation across cancel, checkpoint pause/resume, retry, and completion', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-plugin-job-controls-'));
    roots.push(root);
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Plugin Job Controls', selectedParentPath: root });
    const packageHash = 'b'.repeat(64);
    const owner = {
      ownerPluginId: 'com.serpent.job-controls',
      ownerPackageHash: packageHash,
      ownerPluginInstanceId: 'instance-controls',
      ownerScope: 'library' as const,
      ownerLibraryId: library.libraryId,
    };
    const job = service.enqueuePluginJob({
      libraryId: library.libraryId,
      ...owner,
      pluginHandlerId: 'resumable',
      recoveryStrategy: 'checkpoint',
    });

    expect(service.controlPluginJob({
      libraryId: library.libraryId,
      jobId: job.jobId,
      action: 'cancel',
      ...owner,
      ownerPluginInstanceId: 'other-instance',
      reason: 'must be rejected',
    })).toBeNull();
    expect(() => service.controlPluginJob({
      libraryId: library.libraryId,
      jobId: job.jobId,
      action: 'pause',
      ...owner,
      capabilities: { handlerId: 'resumable', resumable: false },
      checkpoint: { version: 'v1', data: {}, savedAt: '2026-08-02T00:00:00.000Z' },
    })).toThrowError(/resumable checkpoint support/);
    expect(service.controlPluginJob({
      libraryId: library.libraryId,
      jobId: job.jobId,
      action: 'pause',
      ...owner,
      capabilities: { handlerId: 'resumable', resumable: true, checkpointVersion: 'v1' },
      checkpoint: { version: 'v1', cursor: 'asset-2', data: { assetId: 'asset-2' }, savedAt: '2026-08-02T00:00:00.000Z' },
    })?.status).toBe('paused');
    expect(service.controlPluginJob({
      libraryId: library.libraryId,
      jobId: job.jobId,
      action: 'resume',
      ...owner,
      capabilities: { handlerId: 'resumable', resumable: true, checkpointVersion: 'v1' },
    })?.status).toBe('queued');
    expect(service.claimNextPluginJob({ libraryId: library.libraryId, ...owner })?.jobId).toBe(job.jobId);
    expect(service.completePluginJob({
      libraryId: library.libraryId,
      jobId: job.jobId,
      ...owner,
      ownerPluginInstanceId: 'other-instance',
      status: 'succeeded',
    })).toBeNull();
    expect(service.completePluginJob({ libraryId: library.libraryId, jobId: job.jobId, ...owner, status: 'failed' })?.status)
      .toBe('failed');
    expect(service.controlPluginJob({
      libraryId: library.libraryId,
      jobId: job.jobId,
      action: 'retry',
      ...owner,
      retryInput: { retry: 2 },
    })?.status).toBe('queued');
    expect(service.listPluginJobs(library.libraryId).find((item) => item.jobId === job.jobId)?.retryInput)
      .toEqual({ retry: 2 });
    service.closeLibrary(library.libraryId);
  });

  it('marks unfinished jobs interrupted after an application restart', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-plugin-job-recovery-'));
    roots.push(root);
    const crashed = new LibraryService();
    const library = crashed.createLibrary({ displayName: 'Plugin Job Recovery', selectedParentPath: root });
    const packageHash = 'c'.repeat(64);
    const owner = {
      ownerPluginId: 'com.serpent.job-recovery',
      ownerPackageHash: packageHash,
      ownerPluginInstanceId: 'instance-recovery',
      ownerScope: 'library' as const,
      ownerLibraryId: library.libraryId,
    };
    const job = crashed.enqueuePluginJob({
      libraryId: library.libraryId,
      ...owner,
      pluginHandlerId: 'recover',
      payload: { assetId: 'asset-1' },
      recoveryStrategy: 'idempotent',
    });
    const checkpointOwner = {
      ...owner,
      ownerPluginInstanceId: 'checkpoint-instance',
    };
    const checkpoint = {
      version: 'v1',
      cursor: 'asset-2',
      data: { assetId: 'asset-2' },
      savedAt: '2026-08-02T00:00:00.000Z',
    };
    const checkpointJob = crashed.enqueuePluginJob({
      libraryId: library.libraryId,
      ...checkpointOwner,
      pluginHandlerId: 'recover-checkpoint',
      recoveryStrategy: 'checkpoint',
    });
    crashed.claimNextPluginJob({ libraryId: library.libraryId, ...owner });
    crashed.reportPluginJobProgress({
      libraryId: library.libraryId,
      jobId: job.jobId,
      ...owner,
      completed: 0,
      total: 1,
      phase: 'reading',
      message: '读取资产 asset-1',
    });
    crashed.claimNextPluginJob({ libraryId: library.libraryId, ...checkpointOwner });
    crashed.reportPluginJobProgress({
      libraryId: library.libraryId,
      jobId: checkpointJob.jobId,
      ...checkpointOwner,
      completed: 1,
      total: 3,
      phase: 'processing',
      message: '处理 asset-2',
    });
    expect(crashed.controlPluginJob({
      libraryId: library.libraryId,
      jobId: checkpointJob.jobId,
      action: 'pause',
      ...checkpointOwner,
      capabilities: { handlerId: 'recover-checkpoint', resumable: true, checkpointVersion: 'v1' },
      checkpoint,
    })?.status).toBe('paused');
    expect(crashed.controlPluginJob({
      libraryId: library.libraryId,
      jobId: checkpointJob.jobId,
      action: 'resume',
      ...checkpointOwner,
      capabilities: { handlerId: 'recover-checkpoint', resumable: true, checkpointVersion: 'v1' },
    })?.status).toBe('queued');
    crashed.claimNextPluginJob({ libraryId: library.libraryId, ...checkpointOwner });

    const recovered = new LibraryService();
    recovered.openLibrary(library.libraryPath);
    const restored = recovered.listPluginJobs(library.libraryId).find((item) => item.jobId === job.jobId);
    expect(restored).toMatchObject({
      status: 'interrupted',
      progress: 0,
      completed: 0,
      total: 1,
      phase: 'reading',
      message: '读取资产 asset-1',
      errorCode: 'PLUGIN_JOB_INTERRUPTED',
      errorDetail: expect.stringContaining('previous application session'),
    });
    expect(recovered.listPluginJobs(library.libraryId).find((item) => item.jobId === checkpointJob.jobId))
      .toMatchObject({
        status: 'interrupted',
        progress: 0.3333333333333333,
        phase: 'running',
        message: '处理 asset-2',
        checkpoint,
        errorCode: 'PLUGIN_JOB_INTERRUPTED',
      });

    expect(recovered.claimNextPluginJob({
      libraryId: library.libraryId,
      ...owner,
      ownerPluginInstanceId: 'instance-after-restart',
    })).toBeNull();
    const retried = recovered.controlPluginJob({
      libraryId: library.libraryId,
      jobId: job.jobId,
      action: 'retry',
      ...owner,
    });
    expect(retried).toMatchObject({ status: 'queued' });
    expect(retried?.ownerPluginInstanceId).toBeUndefined();
    expect(recovered.claimNextPluginJob({
      libraryId: library.libraryId,
      ...owner,
      ownerPluginInstanceId: 'instance-after-restart',
    })).toMatchObject({
      jobId: job.jobId,
      status: 'running',
      ownerPluginInstanceId: 'instance-after-restart',
    });

    recovered.closeLibrary(library.libraryId);
    crashed.closeLibrary(library.libraryId);
  });

  it('marks jobs paused by an inactive plugin instance interrupted on restart', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-plugin-job-inactive-recovery-'));
    roots.push(root);
    const crashed = new LibraryService();
    const library = crashed.createLibrary({ displayName: 'Plugin Job Inactive Recovery', selectedParentPath: root });
    const packageHash = 'd'.repeat(64);
    const owner = {
      ownerPluginId: 'com.serpent.job-recovery',
      ownerPackageHash: packageHash,
      ownerPluginInstanceId: 'instance-recovery',
      ownerScope: 'library' as const,
      ownerLibraryId: library.libraryId,
    };
    const idempotentJob = crashed.enqueuePluginJob({
      libraryId: library.libraryId,
      ...owner,
      pluginHandlerId: 'recover',
      payload: { assetId: 'asset-1' },
      recoveryStrategy: 'idempotent',
    });
    const checkpointJob = crashed.enqueuePluginJob({
      libraryId: library.libraryId,
      ...owner,
      ownerPluginInstanceId: 'checkpoint-instance',
      pluginHandlerId: 'recover-checkpoint',
      payload: { assetId: 'asset-2' },
      recoveryStrategy: 'checkpoint',
    });
    crashed.claimNextPluginJob({ libraryId: library.libraryId, ...owner });
    crashed.claimNextPluginJob({
      libraryId: library.libraryId,
      ...owner,
      ownerPluginInstanceId: 'checkpoint-instance',
    });
    expect(crashed.pausePluginJobsForOwners({
      libraryId: library.libraryId,
      owners: [{ pluginId: owner.ownerPluginId, packageHash }],
      errorCode: 'PLUGIN_INSTANCE_INACTIVE',
      errorDetail: 'The plugin instance is no longer active.',
    })).toBe(2);

    const recovered = new LibraryService();
    recovered.openLibrary(library.libraryPath);
    expect(recovered.listPluginJobs(library.libraryId).find((job) => job.jobId === idempotentJob.jobId))
      .toMatchObject({
        status: 'interrupted',
        progress: 0,
        errorCode: 'PLUGIN_JOB_INTERRUPTED',
        phase: 'running',
        message: '',
      });
    expect(recovered.listPluginJobs(library.libraryId).find((job) => job.jobId === checkpointJob.jobId))
      .toMatchObject({
        status: 'interrupted',
        errorCode: 'PLUGIN_JOB_INTERRUPTED',
      });
    expect(recovered.claimNextPluginJob({
      libraryId: library.libraryId,
      ...owner,
      ownerPluginInstanceId: 'instance-recovery-after-restart',
    })).toBeNull();
    const retried = recovered.controlPluginJob({
      libraryId: library.libraryId,
      jobId: idempotentJob.jobId,
      action: 'retry',
      ...owner,
    });
    expect(retried).toMatchObject({ status: 'queued' });
    expect(retried?.ownerPluginInstanceId).toBeUndefined();
    expect(recovered.claimNextPluginJob({
      libraryId: library.libraryId,
      ...owner,
      ownerPluginInstanceId: 'instance-recovery-after-restart',
    })).toMatchObject({
      jobId: idempotentJob.jobId,
      status: 'running',
      ownerPluginInstanceId: 'instance-recovery-after-restart',
    });

    recovered.closeLibrary(library.libraryId);
    crashed.closeLibrary(library.libraryId);
  });
});
