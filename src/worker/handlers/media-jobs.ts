import type { WorkerRequest } from '../../shared/protocol/requests';
import type { WorkerResult } from '../../shared/protocol/responses';
import type { LibraryService } from '../library-service';

export type MediaJobHooks = {
  scheduleThumbnailQueue: (
    libraryId: string,
    options?: { limit?: number; skipInitialEnqueue?: boolean },
  ) => number;
};

export async function executeMediaJobWorkerCommand(
  libraryService: LibraryService,
  request: WorkerRequest,
  hooks: MediaJobHooks,
): Promise<WorkerResult | undefined> {
  switch (request.command.type) {
    case 'media.enqueue-thumbnail-jobs': {
      const enqueued = hooks.scheduleThumbnailQueue(request.command.libraryId, { limit: 50 });
      return { ok: true, type: 'media.jobs.enqueued', libraryId: request.command.libraryId, enqueued };
    }
    case 'media.set-audio-preview-preference': {
      const rebuilt = libraryService.setAudioPreviewPrefersCover(
        request.command.libraryId,
        request.command.preferCover,
      );
      if (rebuilt > 0) {
        hooks.scheduleThumbnailQueue(request.command.libraryId, { skipInitialEnqueue: true });
      }
      return {
        ok: true,
        type: 'media.audio-preview-preference.applied',
        libraryId: request.command.libraryId,
        preferCover: request.command.preferCover,
        rebuilt,
      };
    }
    case 'media.process-thumbnail-queue': {
      const processed = await libraryService.processThumbnailQueue(request.command.libraryId);
      return { ok: true, type: 'media.jobs.processed', libraryId: request.command.libraryId, processed };
    }
    case 'media.job-summary': {
      const status = libraryService.listMediaJobs(request.command.libraryId, {
        summaryOnly: true,
      });
      return {
        ok: true,
        type: 'media.job-summary.read',
        libraryId: request.command.libraryId,
        queued: status.queued,
        running: status.running,
        succeeded: status.succeeded,
        failed: status.failed,
        paused: status.paused,
        cancelled: status.cancelled,
      };
    }
    case 'media.list-jobs': {
      const status = libraryService.listMediaJobs(request.command.libraryId, {
        summaryOnly: request.command.summaryOnly,
        cursor: request.command.cursor,
        limit: request.command.limit,
      });
      return {
        ok: true,
        type: 'media.jobs.listed',
        libraryId: request.command.libraryId,
        ...status,
      };
    }
    case 'media.pause-jobs': {
      const result = libraryService.pauseMediaJobs(
        request.command.libraryId,
        request.command.jobIds,
      );
      return {
        ok: true,
        type: 'media.jobs.paused',
        libraryId: request.command.libraryId,
        ...result,
      };
    }
    case 'media.resume-jobs': {
      const result = libraryService.resumeMediaJobs(
        request.command.libraryId,
        request.command.jobIds,
      );
      // Resuming persisted jobs must not synchronously rescan and insert the
      // entire catalogue before the command can return. The queue pump below
      // still admits missing thumbnails in its existing bounded 500-row
      // continuation after active jobs make progress.
      hooks.scheduleThumbnailQueue(request.command.libraryId, { skipInitialEnqueue: true });
      return {
        ok: true,
        type: 'media.jobs.resumed',
        libraryId: request.command.libraryId,
        ...result,
      };
    }
    case 'media.cancel-jobs': {
      const result = libraryService.cancelMediaJobs(
        request.command.libraryId,
        request.command.jobIds,
      );
      return {
        ok: true,
        type: 'media.jobs.cancelled',
        libraryId: request.command.libraryId,
        ...result,
      };
    }
    case 'media.retry-jobs': {
      const result = libraryService.retryMediaJobs(
        request.command.libraryId,
        request.command.jobIds,
      );
      hooks.scheduleThumbnailQueue(request.command.libraryId, { skipInitialEnqueue: true });
      return {
        ok: true,
        type: 'media.jobs.retried',
        libraryId: request.command.libraryId,
        ...result,
      };
    }
    default:
      return undefined;
  }
}
