import { type PluginJobComplete, type PluginJobRecord } from '../plugins/plugin-jobs';
import type { PluginRuntimeSupervisor } from './plugin-runtime-supervisor';
import type { PluginTrustedRuntimeSupervisor } from './plugin-trusted-runtime-supervisor';

export interface PluginJobSchedulerLogger {
  error(scope: string, error: unknown, context?: Record<string, unknown>): void;
}

export type PluginJobWorkerRequester = (command: {
  type: 'plugin.jobs.claim-next';
  libraryId: string;
  ownerPluginId: string;
  ownerPackageHash: string;
  ownerPluginInstanceId: string;
  ownerScope: 'library' | 'global';
  ownerLibraryId: string;
} | {
  type: 'plugin.jobs.complete';
  libraryId: string;
  jobId: string;
  ownerPluginId: string;
  ownerPackageHash: string;
  ownerPluginInstanceId: string;
  ownerScope: 'library' | 'global';
  ownerLibraryId: string;
  status: 'succeeded' | 'failed' | 'cancelled';
  errorCode?: string;
  errorDetail?: string;
  progress?: number;
  completed?: number;
  total?: number;
  phase?: string;
  message?: string;
  itemResults?: PluginJobComplete['itemResults'];
  failedAssetIds?: string[];
  retryInput?: Record<string, unknown>;
  checkpoint?: PluginJobComplete['checkpoint'];
}) => Promise<{
  ok: boolean;
  type?: string;
  job?: PluginJobRecord | null;
}>;

export type PluginJobSchedulerInstanceBinding = {
  instanceId: string;
  mode: 'restricted' | 'unrestricted';
  pluginId: string;
  packageHash: string;
  instanceScope: 'library' | 'global';
  activated: boolean;
};

/**
 * Main-owned scheduler that claims persisted plugin jobs from the Worker and
 * invokes handlers in the active Standard/Trusted Hosts.
 */
export class PluginJobScheduler {
  #inFlight = new Set<string>();

  constructor(private readonly options: {
    supervisor: PluginRuntimeSupervisor;
    trustedSupervisor?: PluginTrustedRuntimeSupervisor;
    requestWorker: PluginJobWorkerRequester;
    resolveInstances: (libraryId: string) => readonly PluginJobSchedulerInstanceBinding[];
    logger?: PluginJobSchedulerLogger;
  }) {}

  tick(libraryId: string): void {
    void this.#drainLibrary(libraryId);
  }

  async #drainLibrary(libraryId: string): Promise<void> {
    const instances = this.options.resolveInstances(libraryId)
      .filter((instance) => instance.activated);
    for (const instance of instances) {
      await this.#drainInstance(libraryId, instance);
    }
  }

  async #drainInstance(
    libraryId: string,
    instance: PluginJobSchedulerInstanceBinding,
  ): Promise<void> {
    for (;;) {
      const claimed = await this.options.requestWorker({
        type: 'plugin.jobs.claim-next',
        libraryId,
        ownerPluginId: instance.pluginId,
        ownerPackageHash: instance.packageHash,
        ownerPluginInstanceId: instance.instanceId,
        ownerScope: instance.instanceScope,
        ownerLibraryId: libraryId,
      });
      if (!claimed.ok || claimed.type !== 'plugin.jobs.claimed' || claimed.job === null || claimed.job === undefined) {
        return;
      }
      if (this.#inFlight.has(claimed.job.jobId)) return;
      this.#inFlight.add(claimed.job.jobId);
      try {
        await this.#runClaimedJob(libraryId, instance, claimed.job);
      } finally {
        this.#inFlight.delete(claimed.job.jobId);
      }
    }
  }

  async #runClaimedJob(
    libraryId: string,
    instance: PluginJobSchedulerInstanceBinding,
    job: PluginJobRecord,
  ): Promise<void> {
    const invoked = instance.mode === 'restricted'
      ? await this.options.supervisor.invokeJob({
        instanceId: instance.instanceId,
        job,
      })
      : await this.options.trustedSupervisor!.invokeJob({
        instanceId: instance.instanceId,
        job,
      });
    await this.#completeJob(libraryId, instance, invoked.complete);
  }

  async completeJobFromHost(
    libraryId: string,
    instance: PluginJobSchedulerInstanceBinding,
    complete: PluginJobComplete,
  ): Promise<void> {
    await this.#completeJob(libraryId, instance, complete);
  }

  async #completeJob(
    libraryId: string,
    instance: PluginJobSchedulerInstanceBinding,
    complete: PluginJobComplete,
  ): Promise<void> {
    const result = await this.options.requestWorker({
      type: 'plugin.jobs.complete',
      libraryId,
      jobId: complete.jobId,
      ownerPluginId: instance.pluginId,
      ownerPackageHash: instance.packageHash,
      ownerPluginInstanceId: instance.instanceId,
      ownerScope: instance.instanceScope,
      ownerLibraryId: libraryId,
      status: complete.status,
      ...(complete.errorCode === undefined ? {} : { errorCode: complete.errorCode }),
      ...(complete.errorDetail === undefined ? {} : { errorDetail: complete.errorDetail }),
      ...(complete.progress === undefined ? {} : { progress: complete.progress }),
      ...(complete.completed === undefined ? {} : { completed: complete.completed }),
      ...(complete.total === undefined ? {} : { total: complete.total }),
      ...(complete.phase === undefined ? {} : { phase: complete.phase }),
      ...(complete.message === undefined ? {} : { message: complete.message }),
      ...(complete.itemResults === undefined ? {} : { itemResults: complete.itemResults }),
      ...(complete.failedAssetIds === undefined ? {} : { failedAssetIds: complete.failedAssetIds }),
      ...(complete.retryInput === undefined ? {} : { retryInput: complete.retryInput }),
      ...(complete.checkpoint === undefined ? {} : { checkpoint: complete.checkpoint }),
    });
    if (!result.ok) {
      this.options.logger?.error(
        'plugin.job.complete-failed',
        new Error('Worker could not complete plugin job.'),
        { libraryId, jobId: complete.jobId },
      );
    }
  }
}
