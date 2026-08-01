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

  it('enqueues, claims, completes, and pauses plugin jobs bound to an owner package', () => {
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
      pluginHandlerId: 'tick',
      payload: { n: 1 },
      recoveryStrategy: 'idempotent',
    });
    expect(enqueued.status).toBe('queued');
    expect(enqueued.kind).toBe('plugin.background');

    const claimed = service.claimNextPluginJob({
      libraryId: library.libraryId,
      ownerPluginId: 'com.serpent.job-probe',
      ownerPackageHash: packageHash,
    });
    expect(claimed?.jobId).toBe(enqueued.jobId);
    expect(claimed?.status).toBe('running');

    const completed = service.completePluginJob({
      libraryId: library.libraryId,
      jobId: enqueued.jobId,
      status: 'succeeded',
    });
    expect(completed?.status).toBe('succeeded');
    expect(completed?.progress).toBe(1);

    const second = service.enqueuePluginJob({
      libraryId: library.libraryId,
      ownerPluginId: 'com.serpent.job-probe',
      ownerPackageHash: packageHash,
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
});
