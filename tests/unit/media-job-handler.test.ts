import { expect, test, vi } from 'vitest';

import { executeMediaJobWorkerCommand } from '../../src/worker/handlers/media-jobs';
import type { LibraryService } from '../../src/worker/library-service';
import type { WorkerRequest } from '../../src/shared/protocol/requests';

function mediaJobRequest(command: WorkerRequest['command']): WorkerRequest {
  return { requestId: 'req-1', command };
}

test('media.enqueue-thumbnail-jobs schedules a bounded queue', async () => {
  const scheduleThumbnailQueue = vi.fn(() => 12);
  await expect(executeMediaJobWorkerCommand(
    {} as LibraryService,
    mediaJobRequest({ type: 'media.enqueue-thumbnail-jobs', libraryId: 'lib-1' }),
    { scheduleThumbnailQueue },
  )).resolves.toEqual({
    ok: true,
    type: 'media.jobs.enqueued',
    libraryId: 'lib-1',
    enqueued: 12,
  });
  expect(scheduleThumbnailQueue).toHaveBeenCalledWith('lib-1', { limit: 50 });
});

test('media.resume-jobs resumes durable jobs then pumps without a catalogue enqueue', async () => {
  const libraryService = {
    resumeMediaJobs: vi.fn(() => ({ resumedCount: 3 })),
  } as unknown as LibraryService;
  const scheduleThumbnailQueue = vi.fn(() => 0);

  await expect(executeMediaJobWorkerCommand(
    libraryService,
    mediaJobRequest({
      type: 'media.resume-jobs',
      libraryId: 'lib-1',
      jobIds: ['job-1'],
    }),
    { scheduleThumbnailQueue },
  )).resolves.toEqual({
    ok: true,
    type: 'media.jobs.resumed',
    libraryId: 'lib-1',
    resumedCount: 3,
  });
  expect(scheduleThumbnailQueue).toHaveBeenCalledWith('lib-1', { skipInitialEnqueue: true });
});

test('media.job-summary returns queue counters', async () => {
  const libraryService = {
    listMediaJobs: vi.fn(() => ({
      queued: 1,
      running: 2,
      succeeded: 3,
      failed: 0,
      paused: 0,
      cancelled: 0,
    })),
  } as unknown as LibraryService;

  await expect(executeMediaJobWorkerCommand(
    libraryService,
    mediaJobRequest({ type: 'media.job-summary', libraryId: 'lib-1' }),
    { scheduleThumbnailQueue: vi.fn(() => 0) },
  )).resolves.toEqual({
    ok: true,
    type: 'media.job-summary.read',
    libraryId: 'lib-1',
    queued: 1,
    running: 2,
    succeeded: 3,
    failed: 0,
    paused: 0,
    cancelled: 0,
  });
});
