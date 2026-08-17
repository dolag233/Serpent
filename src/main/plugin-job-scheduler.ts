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

type PendingJobCompletion = {
  libraryId: string;
  instance: PluginJobSchedulerInstanceBinding;
  complete: PluginJobComplete;
  attempts: number;
};

const DEFERRED_RUNTIME_COMPLETION_CODES = new Set([
  'PLUGIN_JOB_INSTANCE_DEACTIVATED',
  'PLUGIN_JOB_INSTANCE_UNAVAILABLE',
  'PLUGIN_JOB_RUNTIME_ENDED',
  'PLUGIN_JOB_RUNTIME_SHUTDOWN',
  'PLUGIN_JOB_RUNTIME_HEARTBEAT_TIMEOUT',
  'PLUGIN_JOB_RUNTIME_PROCESS_EXITED',
  'PLUGIN_JOB_RUNTIME_PROTOCOL_ERROR',
]);

/**
 * Main-owned scheduler that claims persisted plugin jobs from the Worker and
 * invokes handlers in the active Standard/Trusted Hosts.
 */
export class PluginJobScheduler {
  #inFlight = new Set<string>();
  #drainingInstances = new Set<string>();
  #pendingCompletions = new Map<string, PendingJobCompletion>();
  #completionRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly options: {
    supervisor: PluginRuntimeSupervisor;
    trustedSupervisor?: PluginTrustedRuntimeSupervisor;
    requestWorker: PluginJobWorkerRequester;
    resolveInstances: (libraryId: string) => readonly PluginJobSchedulerInstanceBinding[];
    logger?: PluginJobSchedulerLogger;
  }) {}

  tick(libraryId: string): void {
    void this.#drainLibrary(libraryId).catch((error) => {
      this.options.logger?.error('plugin.job.drain-failed', error, { libraryId });
    });
  }

  async #drainLibrary(libraryId: string): Promise<void> {
    const instances = this.options.resolveInstances(libraryId)
      .filter((instance) => instance.activated);
    for (const instance of instances) {
      try {
        await this.#drainInstance(libraryId, instance);
      } catch (error) {
        this.options.logger?.error('plugin.job.instance-drain-failed', error, {
          libraryId,
          instanceId: instance.instanceId,
          pluginId: instance.pluginId,
        });
      }
    }
  }

  async #drainInstance(
    libraryId: string,
    instance: PluginJobSchedulerInstanceBinding,
  ): Promise<void> {
    const drainKey = `${libraryId}\u0000${instance.instanceId}`;
    if (this.#drainingInstances.has(drainKey)) return;
    this.#drainingInstances.add(drainKey);
    try {
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
    } finally {
      this.#drainingInstances.delete(drainKey);
    }
  }

  async #runClaimedJob(
    libraryId: string,
    instance: PluginJobSchedulerInstanceBinding,
    job: PluginJobRecord,
  ): Promise<void> {
    let invoked: { complete: PluginJobComplete };
    try {
      invoked = instance.mode === 'restricted'
        ? await this.options.supervisor.invokeJob({ instanceId: instance.instanceId, job })
        : await this.options.trustedSupervisor!.invokeJob({ instanceId: instance.instanceId, job });
    } catch {
      await this.#completeOrQueue(libraryId, instance, {
        jobId: job.jobId,
        status: 'failed',
        errorCode: 'PLUGIN_JOB_SCHEDULER_ERROR',
        errorDetail: 'The plugin job runtime failed before it returned a completion.',
      });
      return;
    }
    // Runtime termination is persisted by the activation coordinator as a
    // paused owner-scoped job. Completing this synthetic result here would
    // race that pause and can turn a recoverable job into a terminal failure.
    if (invoked.complete.errorCode !== undefined
      && DEFERRED_RUNTIME_COMPLETION_CODES.has(invoked.complete.errorCode)) return;
    await this.#completeOrQueue(libraryId, instance, invoked.complete);
  }

  async completeJobFromHost(
    libraryId: string,
    instance: PluginJobSchedulerInstanceBinding,
    complete: PluginJobComplete,
  ): Promise<void> {
    await this.#completeOrQueue(libraryId, instance, complete);
  }

  async #completeOrQueue(
    libraryId: string,
    instance: PluginJobSchedulerInstanceBinding,
    complete: PluginJobComplete,
  ): Promise<void> {
    try {
      await this.#completeJob(libraryId, instance, complete);
      this.#pendingCompletions.delete(complete.jobId);
    } catch (error) {
      this.options.logger?.error('plugin.job.complete-retry', error, {
        libraryId,
        jobId: complete.jobId,
      });
      this.#scheduleCompletionRetry({ libraryId, instance, complete, attempts: 0 });
    }
  }

  #scheduleCompletionRetry(pending: PendingJobCompletion): void {
    this.#pendingCompletions.set(pending.complete.jobId, pending);
    if (this.#completionRetryTimers.has(pending.complete.jobId)) return;
    const delay = Math.min(10_000, 500 * (2 ** Math.min(pending.attempts, 4)));
    const timer = setTimeout(() => {
      this.#completionRetryTimers.delete(pending.complete.jobId);
      const current = this.#pendingCompletions.get(pending.complete.jobId);
      if (current === undefined) return;
      void this.#completeJob(current.libraryId, current.instance, current.complete)
        .then(() => {
          this.#pendingCompletions.delete(current.complete.jobId);
        })
        .catch((error: unknown) => {
          this.options.logger?.error('plugin.job.complete-retry-failed', error, {
            libraryId: current.libraryId,
            jobId: current.complete.jobId,
            attempts: current.attempts + 1,
          });
          this.#scheduleCompletionRetry({ ...current, attempts: current.attempts + 1 });
        });
    }, delay);
    timer.unref?.();
    this.#completionRetryTimers.set(pending.complete.jobId, timer);
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
      throw new Error(`Worker could not complete plugin job ${complete.jobId}.`);
    }
  }
}
