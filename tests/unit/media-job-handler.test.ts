import { expect, test, vi } from 'vitest';

import { executeMediaJobWorkerCommand } from '../../src/worker/handlers/media-jobs';
import type { LibraryService } from '../../src/worker/library-service';
import type { WorkerRequest } from '../../src/shared/protocol/requests';

function mediaJobRequest(command: WorkerRequest['command']): WorkerRequest {
  return { requestId: 'req-1', command };
}

function hooks(scheduleThumbnailQueue = vi.fn(() => 0)) {
  return {
    scheduleThumbnailQueue,
    scheduleSecondaryMediaQueue: vi.fn(),
    cancelAutomaticMediaForLibrary: vi.fn(),
  };
}

test('media.enqueue-thumbnail-jobs schedules a bounded queue', async () => {
  const scheduleThumbnailQueue = vi.fn(() => 12);
  await expect(executeMediaJobWorkerCommand(
    {} as LibraryService,
    mediaJobRequest({ type: 'media.enqueue-thumbnail-jobs', libraryId: 'lib-1' }),
    hooks(scheduleThumbnailQueue),
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
    hooks(scheduleThumbnailQueue),
  )).resolves.toEqual({
    ok: true,
    type: 'media.jobs.resumed',
    libraryId: 'lib-1',
    resumedCount: 3,
  });
  expect(scheduleThumbnailQueue).toHaveBeenCalledWith('lib-1', { skipInitialEnqueue: true, origin: 'explicit' });
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
      queuePaused: true,
    })),
  } as unknown as LibraryService;

  await expect(executeMediaJobWorkerCommand(
    libraryService,
    mediaJobRequest({ type: 'media.job-summary', libraryId: 'lib-1' }),
    hooks(),
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
    queuePaused: true,
  });
});

test('global pause cancels automatic owners while a selected pause preserves other work', async () => {
  const service = { pauseMediaJobs: vi.fn(() => ({ pausedCount: 1 })) } as unknown as LibraryService;
  const control = hooks();
  await executeMediaJobWorkerCommand(service, mediaJobRequest({
    type: 'media.pause-jobs', libraryId: 'lib-1', jobIds: ['job-1'],
  }), control);
  expect(control.cancelAutomaticMediaForLibrary).not.toHaveBeenCalled();
  await executeMediaJobWorkerCommand(service, mediaJobRequest({ type: 'media.pause-jobs', libraryId: 'lib-1' }), control);
  expect(control.cancelAutomaticMediaForLibrary).toHaveBeenCalledWith('lib-1');
});

test('global resume wakes both ordinary lanes even when no persisted rows change', async () => {
  const service = { resumeMediaJobs: vi.fn(() => ({ resumedCount: 0 })) } as unknown as LibraryService;
  const control = hooks();
  await executeMediaJobWorkerCommand(service, mediaJobRequest({ type: 'media.resume-jobs', libraryId: 'lib-1' }), control);
  expect(control.scheduleThumbnailQueue).toHaveBeenCalledWith('lib-1', { skipInitialEnqueue: true });
  expect(control.scheduleSecondaryMediaQueue).toHaveBeenCalledWith('lib-1');
});

test('selected retry wakes explicit lanes without changing the automatic mode', async () => {
  const service = { retryMediaJobs: vi.fn(() => ({ retriedCount: 1 })) } as unknown as LibraryService;
  const control = hooks();
  await executeMediaJobWorkerCommand(service, mediaJobRequest({
    type: 'media.retry-jobs', libraryId: 'lib-1', jobIds: ['job-1'],
  }), control);
  expect(control.scheduleThumbnailQueue).toHaveBeenCalledWith('lib-1', { skipInitialEnqueue: true, origin: 'explicit' });
  expect(control.scheduleSecondaryMediaQueue).toHaveBeenCalledWith('lib-1', { urgent: true });
  expect(control.cancelAutomaticMediaForLibrary).not.toHaveBeenCalled();
});
