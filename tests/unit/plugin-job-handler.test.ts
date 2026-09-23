import { expect, test, vi } from 'vitest';

import { executePluginJobWorkerCommand } from '../../src/worker/handlers/plugin-jobs';
import type { LibraryService } from '../../src/worker/library-service';
import type { WorkerRequest } from '../../src/shared/protocol/requests';

function pluginJobRequest(command: WorkerRequest['command']): WorkerRequest {
  return { requestId: 'req-1', command };
}

test('plugin.jobs.list returns jobs for the library', () => {
  const jobs = [{ jobId: 'job-1' }];
  const libraryService = {
    listPluginJobs: vi.fn(() => jobs),
  } as unknown as LibraryService;

  expect(executePluginJobWorkerCommand(
    libraryService,
    pluginJobRequest({ type: 'plugin.jobs.list', libraryId: 'lib-1' }),
  )).toEqual({
    ok: true,
    type: 'plugin.jobs.listed',
    libraryId: 'lib-1',
    jobs,
  });
});

test('plugin.jobs.cancel uses the control action', () => {
  const job = { jobId: 'job-1', status: 'cancelled' };
  const libraryService = {
    controlPluginJob: vi.fn(() => job),
  } as unknown as LibraryService;
  const command = {
    type: 'plugin.jobs.cancel' as const,
    libraryId: 'lib-1',
    jobId: '11111111-1111-4111-8111-111111111111',
    ownerPluginId: 'plugin.demo',
    ownerPackageHash: 'a'.repeat(64),
    ownerPluginInstanceId: 'instance-1',
    ownerScope: 'library' as const,
    ownerLibraryId: 'lib-1',
  };

  expect(executePluginJobWorkerCommand(
    libraryService,
    pluginJobRequest(command),
  )).toEqual({
    ok: true,
    type: 'plugin.jobs.cancelled',
    libraryId: 'lib-1',
    job,
  });
  expect(libraryService.controlPluginJob).toHaveBeenCalledWith({
    ...command,
    action: 'cancel',
  });
});
