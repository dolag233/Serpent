import type { WorkerRequest } from '../../shared/protocol/requests';
import type { WorkerResult } from '../../shared/protocol/responses';
import type { LibraryService } from '../library-service';

export function executePluginJobWorkerCommand(
  libraryService: LibraryService,
  request: WorkerRequest,
): WorkerResult | undefined {
  switch (request.command.type) {
    case 'plugin.jobs.enqueue': {
      const job = libraryService.enqueuePluginJob({
        libraryId: request.command.libraryId,
        ownerPluginId: request.command.ownerPluginId,
        ownerPackageHash: request.command.ownerPackageHash,
        ownerPluginInstanceId: request.command.ownerPluginInstanceId,
        ownerScope: request.command.ownerScope,
        ownerLibraryId: request.command.ownerLibraryId,
        pluginHandlerId: request.command.pluginHandlerId,
        payload: request.command.payload,
        recoveryStrategy: request.command.recoveryStrategy,
        priority: request.command.priority,
      });
      return {
        ok: true,
        type: 'plugin.jobs.enqueued',
        libraryId: request.command.libraryId,
        job,
      };
    }
    case 'plugin.jobs.list': {
      const jobs = libraryService.listPluginJobs(request.command.libraryId);
      return {
        ok: true,
        type: 'plugin.jobs.listed',
        libraryId: request.command.libraryId,
        jobs,
      };
    }
    case 'plugin.jobs.claim-next': {
      const job = libraryService.claimNextPluginJob({
        libraryId: request.command.libraryId,
        ownerPluginId: request.command.ownerPluginId,
        ownerPackageHash: request.command.ownerPackageHash,
        ownerPluginInstanceId: request.command.ownerPluginInstanceId,
        ownerScope: request.command.ownerScope,
        ownerLibraryId: request.command.ownerLibraryId,
      });
      return {
        ok: true,
        type: 'plugin.jobs.claimed',
        libraryId: request.command.libraryId,
        job,
      };
    }
    case 'plugin.jobs.complete': {
      const job = libraryService.completePluginJob(request.command);
      return {
        ok: true,
        type: 'plugin.jobs.completed',
        libraryId: request.command.libraryId,
        job,
      };
    }
    case 'plugin.jobs.cancel': {
      const job = libraryService.controlPluginJob({ ...request.command, action: 'cancel' });
      return {
        ok: true,
        type: 'plugin.jobs.cancelled',
        libraryId: request.command.libraryId,
        job,
      };
    }
    case 'plugin.jobs.pause': {
      const job = libraryService.controlPluginJob({ ...request.command, action: 'pause' });
      return {
        ok: true,
        type: 'plugin.jobs.job-paused',
        libraryId: request.command.libraryId,
        job,
      };
    }
    case 'plugin.jobs.resume': {
      const job = libraryService.controlPluginJob({ ...request.command, action: 'resume' });
      return {
        ok: true,
        type: 'plugin.jobs.resumed',
        libraryId: request.command.libraryId,
        job,
      };
    }
    case 'plugin.jobs.retry': {
      const job = libraryService.controlPluginJob({ ...request.command, action: 'retry' });
      return {
        ok: true,
        type: 'plugin.jobs.retried',
        libraryId: request.command.libraryId,
        job,
      };
    }
    case 'plugin.jobs.report-progress': {
      const job = libraryService.reportPluginJobProgress(request.command);
      return {
        ok: true,
        type: 'plugin.jobs.completed',
        libraryId: request.command.libraryId,
        job,
      };
    }
    case 'plugin.jobs.pause-owners': {
      const pausedCount = libraryService.pausePluginJobsForOwners({
        libraryId: request.command.libraryId,
        owners: request.command.owners,
        errorCode: request.command.errorCode,
        errorDetail: request.command.errorDetail,
      });
      return {
        ok: true,
        type: 'plugin.jobs.paused',
        libraryId: request.command.libraryId,
        pausedCount,
      };
    }
    case 'plugin.derived-fields.materialize': {
      const result = libraryService.materializePluginDerivedFields(request.command);
      return {
        ok: true,
        type: 'plugin.derived-fields.materialized',
        libraryId: request.command.libraryId,
        ...result,
      };
    }
    case 'plugin.derived-fields.query': {
      const result = libraryService.queryPluginDerivedFields(request.command);
      return {
        ok: true,
        type: 'plugin.derived-fields.queried',
        libraryId: request.command.libraryId,
        ...result,
        offset: request.command.offset ?? 0,
      };
    }
    default:
      return undefined;
  }
}
