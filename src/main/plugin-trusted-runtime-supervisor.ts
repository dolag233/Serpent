import {
  parsePluginTrustedChildMessage,
  type PluginTrustedChildMessage,
  type PluginTrustedParentMessage,
} from '../shared/plugin-trusted-runtime-protocol';
import type { PluginRuntimeDeactivateReason } from '../shared/plugin-runtime-utility-protocol';
import type { AutomationScriptCommandId } from '../shared/automation-script-api';
import type { PluginPermission } from '../plugins/plugin-manifest';
import type { PluginDomainEvent } from '../plugins/plugin-domain-events';
import type { PluginHookDecision, PluginHookInvoke } from '../plugins/plugin-hooks';
import type { PluginJobComplete, PluginJobRecord } from '../plugins/plugin-jobs';
import type { PluginProviderBatchResult, PluginProviderInvoke } from '../plugins/plugin-providers';
import type {
  PluginSearchChunk,
  PluginSearchComplete,
  PluginSearchRequest,
} from '../plugins/plugin-search';
import type { PluginCommandComplete, PluginCommandContext } from '../plugins/plugin-commands';
import type {
  PluginRuntimeJobEnqueueHandler,
  PluginRuntimeJobProgressHandler,
  PluginRuntimeJobControlHandler,
  PluginRuntimeInputCaptureStartHandler,
} from './plugin-runtime-supervisor';
import type {
  PluginInputCaptureEndReason,
  PluginInputCaptureEvent,
} from '../shared/plugin-input-capture';

const READY_TIMEOUT_MS = 5_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 15_000;
const DEFAULT_HEARTBEAT_CHECK_INTERVAL_MS = 5_000;

type RuntimeChildListener = (...args: unknown[]) => void;

type RuntimeChild = {
  readonly pid?: number;
  readonly stdout?: { on(event: 'data', listener: (chunk: unknown) => void): unknown } | null;
  readonly stderr?: { on(event: 'data', listener: (chunk: unknown) => void): unknown } | null;
  postMessage(message: unknown): void;
  kill(): boolean;
  on(event: string, listener: RuntimeChildListener): unknown;
  off(event: string, listener: RuntimeChildListener): unknown;
  once(event: string, listener: RuntimeChildListener): unknown;
};

type PluginRuntimeCrash = {
  instanceId: string;
  libraryId: string;
  libraryDirectory: string;
  pluginId: string;
  packageHash: string;
  failureCode: string;
};

export interface PluginTrustedRuntimeSupervisorLogger {
  info(scope: string, message: string, context?: Record<string, unknown>): void;
  error(scope: string, error: unknown, context?: Record<string, unknown>): void;
}

export interface PluginTrustedActivateInput {
  instanceId: string;
  libraryId: string;
  libraryDirectory: string;
  instanceScope?: 'global' | 'library';
  pluginId: string;
  version: string;
  packageHash: string;
  packageDirectory: string;
  entryRelativePath: string;
  permissions: readonly PluginPermission[];
  installScope?: 'user' | 'library';
  activateDeadlineMs?: number;
}

export type PluginTrustedHostCommandHandler = (
  commandId: AutomationScriptCommandId,
  input: unknown,
  context: {
    instanceId: string;
    libraryId: string;
    targetLibraryId?: string;
    pluginId: string;
    permissions: readonly PluginPermission[];
    causeChain: readonly string[];
  },
) => Promise<unknown>;

export type PluginTrustedStorageHandler = (input: {
  operation: 'get' | 'set' | 'delete' | 'list' | 'get-directory';
  scope?: 'library' | 'user';
  key?: string;
  value?: unknown;
  context: {
    instanceId: string;
    libraryId: string;
    libraryDirectory: string;
    pluginId: string;
    permissions: readonly PluginPermission[];
  };
}) => Promise<unknown>;

type TrackedInstance = {
  instanceId: string;
  child: RuntimeChild;
  ready: boolean;
  activated: boolean;
  libraryId: string;
  libraryDirectory: string;
  instanceScope: 'global' | 'library';
  pluginId: string;
  packageHash: string;
  permissions: readonly PluginPermission[];
  installScope: 'user' | 'library';
  readyWaiters: Array<{ resolve(): void; reject(error: Error): void }>;
  activateWaiters: Array<{ resolve(): void; reject(error: Error): void }>;
  readyTimer: ReturnType<typeof setTimeout> | undefined;
  activateTimer: ReturnType<typeof setTimeout> | undefined;
  lastHeartbeatAt: number;
  heartbeatWatch: ReturnType<typeof setInterval> | undefined;
  deactivationTimer: ReturnType<typeof setTimeout> | undefined;
};

/**
 * One UtilityProcess per trusted plugin instance. Crash isolation is per child;
 * permissions do not constrain Node inside the child.
 */
export class PluginTrustedRuntimeSupervisor {
  #instances = new Map<string, TrackedInstance>();
  #pendingHookDecisions = new Map<string, {
    resolve(decision: PluginHookDecision): void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  #pendingJobCompletions = new Map<string, {
    resolve(complete: PluginJobComplete): void;
  }>();
  #jobOwners = new Map<string, string>();
  #pendingProviderCompletions = new Map<string, {
    resolve(result: PluginProviderBatchResult): void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  #pendingSearches = new Map<string, {
    onChunk: (chunk: PluginSearchChunk) => void;
    resolve(complete: PluginSearchComplete): void;
    timer: ReturnType<typeof setTimeout>;
    signalCleanup?: () => void;
  }>();
  #pendingCommandCompletions = new Map<string, {
    resolve(complete: PluginCommandComplete): void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(
    private readonly options: {
      fork(modulePath: string): RuntimeChild;
      modulePath: string;
      executeHostCommand: PluginTrustedHostCommandHandler;
      executeStorage?: PluginTrustedStorageHandler;
      handleJobEnqueue?: PluginRuntimeJobEnqueueHandler;
      handleJobProgress?: PluginRuntimeJobProgressHandler;
      handleJobControl?: PluginRuntimeJobControlHandler;
      handleInputCaptureStart?: PluginRuntimeInputCaptureStartHandler;
      handleInputCaptureRelease?: (instanceId: string, sessionId: string) => void;
      onInstanceDeactivated?: (instanceId: string) => void;
      /** Called after crash recording so upper layers can evict the instance. */
      onInstanceCrashed?: (input: Pick<PluginRuntimeCrash, 'instanceId' | 'failureCode'>) => void;
      onInstanceActivated?: (input: {
        instanceId: string;
        libraryId: string;
        pluginId: string;
      }) => void;
      onCrash?: (input: PluginRuntimeCrash) => void;
      logger?: PluginTrustedRuntimeSupervisorLogger;
      heartbeatTimeoutMs?: number;
      heartbeatCheckIntervalMs?: number;
      /** Grace period for an activated plugin to finish dispose(reason). */
      deactivateGraceMs?: number;
      now?: () => number;
    },
  ) {}

  async activate(input: PluginTrustedActivateInput): Promise<void> {
    if (this.#instances.has(input.instanceId)) {
      throw new Error('Trusted plugin instance already exists.');
    }
    const child = this.options.fork(this.options.modulePath);
    const tracked: TrackedInstance = {
      instanceId: input.instanceId,
      child,
      ready: false,
      activated: false,
      libraryId: input.libraryId,
      libraryDirectory: input.libraryDirectory,
      instanceScope: input.instanceScope ?? 'library',
      pluginId: input.pluginId,
      packageHash: input.packageHash,
      permissions: input.permissions,
      installScope: input.installScope ?? 'library',
      readyWaiters: [],
      activateWaiters: [],
      readyTimer: undefined,
      activateTimer: undefined,
      lastHeartbeatAt: 0,
      heartbeatWatch: undefined,
      deactivationTimer: undefined,
    };
    this.#instances.set(input.instanceId, tracked);
    child.stdout?.on('data', (chunk) => {
      this.options.logger?.info('plugin.trusted.stdout', String(chunk).trim(), {
        pluginId: input.pluginId,
      });
    });
    child.stderr?.on('data', (chunk) => {
      this.options.logger?.error('plugin.trusted.stderr', new Error(String(chunk).trim()), {
        pluginId: input.pluginId,
      });
    });
    child.on('message', (raw) => this.#onMessage(input.instanceId, raw));
    child.on('exit', () => this.#onExit(input.instanceId));
    child.on('error', (error) => {
      this.options.logger?.error('plugin.trusted.fatal', error, { pluginId: input.pluginId });
      this.#failReady(tracked, new Error('The trusted plugin host could not start.'));
    });
    tracked.readyTimer = setTimeout(() => {
      this.#failReady(tracked, new Error('Trusted plugin host ready handshake timed out.'));
      this.deactivate(input.instanceId, 'supervisor-shutdown');
    }, READY_TIMEOUT_MS);

    await this.#waitReady(tracked);
    const activateDeadlineMs = input.activateDeadlineMs ?? 15_000;
    tracked.activateTimer = setTimeout(() => {
      this.#failActivate(tracked, new Error('Trusted plugin activate() timed out.'));
      this.deactivate(input.instanceId, 'supervisor-shutdown');
    }, activateDeadlineMs);
    this.#post(tracked, {
      type: 'plugin-trusted.activate',
      instanceId: input.instanceId,
      libraryId: input.libraryId,
      instanceScope: input.instanceScope ?? 'library',
      pluginId: input.pluginId,
      version: input.version,
      packageHash: input.packageHash,
      packageDirectory: input.packageDirectory,
      entryRelativePath: input.entryRelativePath,
      permissions: [...input.permissions],
      installScope: input.installScope ?? 'library',
      activateDeadlineMs,
    });
    await this.#waitActivated(tracked);
  }

  deactivate(instanceId: string, reason: PluginRuntimeDeactivateReason): void {
    const tracked = this.#instances.get(instanceId);
    if (tracked === undefined) return;
    this.options.onInstanceDeactivated?.(instanceId);
    for (const [jobId, owner] of this.#jobOwners) {
      if (owner === instanceId) this.#jobOwners.delete(jobId);
    }
    // An instance that never completed setup cannot run dispose(). Activated
    // instances get a bounded grace period so their cleanup is observable.
    if (!tracked.activated) {
      tracked.child.kill();
      this.#clearTracked(instanceId);
      return;
    }
    if (tracked.deactivationTimer !== undefined) return;
    try {
      tracked.child.postMessage({
        type: 'plugin-trusted.deactivate',
        instanceId,
        reason,
      } satisfies PluginTrustedParentMessage);
    } catch {
      // Child may already be gone.
    }
    const graceMs = this.options.deactivateGraceMs ?? 5_000;
    tracked.deactivationTimer = setTimeout(() => {
      const current = this.#instances.get(instanceId);
      if (current !== tracked) return;
      this.options.logger?.error(
        'plugin.trusted.dispose-timeout',
        new Error('Trusted plugin dispose() exceeded its grace period.'),
        { instanceId, graceMs },
      );
      current.child.kill();
      this.#clearTracked(instanceId);
    }, graceMs);
  }

  deactivateLibrary(libraryId: string, reason: PluginRuntimeDeactivateReason): void {
    for (const [instanceId, tracked] of this.#instances) {
      if (tracked.instanceScope === 'library' && tracked.libraryId === libraryId) {
        this.deactivate(instanceId, reason);
      }
    }
  }

  deliverInputCaptureEvent(instanceId: string, sessionId: string, event: PluginInputCaptureEvent): void {
    const tracked = this.#instances.get(instanceId);
    if (tracked === undefined) return;
    this.#post(tracked, { type: 'plugin-trusted.input-capture.event', instanceId, sessionId, event });
  }

  endInputCapture(instanceId: string, sessionId: string, reason: PluginInputCaptureEndReason): void {
    const tracked = this.#instances.get(instanceId);
    if (tracked === undefined) return;
    this.#post(tracked, { type: 'plugin-trusted.input-capture.end', instanceId, sessionId, reason });
  }

  deliverDomainEvent(
    libraryId: string,
    event: PluginDomainEvent,
  ): void {
    for (const [instanceId, tracked] of this.#instances) {
      if (tracked.instanceScope !== 'global'
        && (tracked.libraryId !== libraryId || !tracked.ready)) continue;
      if (!tracked.ready) continue;
      try {
        tracked.child.postMessage({
          type: 'plugin-trusted.domain-event',
          instanceId,
          event,
        });
      } catch (error) {
        this.options.logger?.error('plugin.trusted.domain-event', error, { instanceId });
      }
    }
  }

  invokeHook(input: {
    instanceId: string;
    invoke: PluginHookInvoke;
    timeoutMs: number;
  }): Promise<{
    decision: PluginHookDecision;
    timedOut: boolean;
  }> {
    const tracked = this.#instances.get(input.instanceId);
    if (tracked === undefined || !tracked.ready) {
      return Promise.resolve({ decision: { action: 'allow' }, timedOut: false });
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#pendingHookDecisions.delete(input.invoke.invokeId);
        resolve({ decision: { action: 'allow' }, timedOut: true });
      }, input.timeoutMs);
      this.#pendingHookDecisions.set(input.invoke.invokeId, {
        resolve: (decision) => resolve({ decision, timedOut: false }),
        timer,
      });
      try {
        tracked.child.postMessage({
          type: 'plugin-trusted.hook-invoke',
          instanceId: input.instanceId,
          invoke: input.invoke,
        });
      } catch {
        clearTimeout(timer);
        this.#pendingHookDecisions.delete(input.invoke.invokeId);
        resolve({ decision: { action: 'allow' }, timedOut: false });
      }
    });
  }

  invokeJob(input: {
    instanceId: string;
    job: PluginJobRecord;
  }): Promise<{
    complete: PluginJobComplete;
  }> {
    const tracked = this.#instances.get(input.instanceId);
    if (tracked === undefined || !tracked.ready) {
      return Promise.resolve({
        complete: {
          jobId: input.job.jobId,
          status: 'failed',
          errorCode: 'PLUGIN_JOB_INSTANCE_UNAVAILABLE',
          errorDetail: 'The trusted plugin instance is not active.',
        },
      });
    }
    return new Promise((resolve) => {
      this.#pendingJobCompletions.set(input.job.jobId, {
        resolve: (complete) => resolve({ complete }),
      });
      this.#jobOwners.set(input.job.jobId, input.instanceId);
      try {
        tracked.child.postMessage({
          type: 'plugin-trusted.job-invoke',
          instanceId: input.instanceId,
          job: input.job,
        });
      } catch {
        this.#pendingJobCompletions.delete(input.job.jobId);
        this.#jobOwners.delete(input.job.jobId);
        resolve({
          complete: {
            jobId: input.job.jobId,
            status: 'failed',
            errorCode: 'PLUGIN_JOB_INSTANCE_UNAVAILABLE',
            errorDetail: 'The trusted plugin instance is not active.',
          },
        });
      }
    });
  }

  signalJob(instanceId: string, jobId: string, action: 'pause' | 'cancel', reason?: string): void {
    const tracked = this.#instances.get(instanceId);
    if (tracked === undefined) return;
    tracked.child.postMessage({
      type: 'plugin-trusted.job-signal',
      instanceId,
      jobId,
      action,
      ...(reason === undefined ? {} : { reason }),
    });
  }

  invokeProvider(input: {
    instanceId: string;
    invoke: PluginProviderInvoke;
    timeoutMs: number;
  }): Promise<{ result: PluginProviderBatchResult; timedOut: boolean }> {
    const tracked = this.#instances.get(input.instanceId);
    if (tracked === undefined || !tracked.ready) {
      return Promise.resolve({
        result: {
          invokeId: input.invoke.invokeId,
          status: 'failed',
          values: [],
          errorCode: 'PLUGIN_PROVIDER_INSTANCE_UNAVAILABLE',
          errorDetail: 'The plugin instance is not active.',
        },
        timedOut: false,
      });
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#pendingProviderCompletions.delete(input.invoke.invokeId);
        resolve({
          result: {
            invokeId: input.invoke.invokeId,
            status: 'cancelled',
            values: [],
            errorCode: 'PLUGIN_PROVIDER_TIMEOUT',
            errorDetail: 'The plugin provider timed out.',
          },
          timedOut: true,
        });
      }, input.timeoutMs);
      this.#pendingProviderCompletions.set(input.invoke.invokeId, {
        resolve: (result) => resolve({ result, timedOut: false }),
        timer,
      });
      this.#post(tracked, {
        type: 'plugin-trusted.provider-invoke',
        instanceId: input.instanceId,
        invoke: input.invoke,
      });
    });
  }

  invokeSearch(input: {
    instanceId: string;
    request: PluginSearchRequest;
    timeoutMs: number;
    signal?: AbortSignal;
    onChunk?: (chunk: PluginSearchChunk) => void;
  }): Promise<{ complete: PluginSearchComplete; timedOut: boolean }> {
    const tracked = this.#instances.get(input.instanceId);
    if (tracked === undefined || !tracked.ready) {
      return Promise.resolve({
        complete: {
          invokeId: input.request.invokeId,
          status: 'failed',
          errorCode: 'PLUGIN_PROVIDER_INSTANCE_UNAVAILABLE',
          errorDetail: 'The trusted plugin search provider is not active.',
        },
        timedOut: false,
      });
    }
    if (input.signal?.aborted) {
      return Promise.resolve({
        complete: {
          invokeId: input.request.invokeId,
          status: 'cancelled',
          errorCode: 'PLUGIN_PROVIDER_CANCELLED',
        },
        timedOut: false,
      });
    }
    return new Promise((resolve) => {
      let settled = false;
      const settle = (complete: PluginSearchComplete, timedOut: boolean): void => {
        if (settled) return;
        settled = true;
        const pending = this.#pendingSearches.get(input.request.invokeId);
        if (pending !== undefined) {
          clearTimeout(pending.timer);
          pending.signalCleanup?.();
          this.#pendingSearches.delete(input.request.invokeId);
        }
        resolve({ complete, timedOut });
      };
      const timer = setTimeout(() => {
        this.#post(tracked, {
          type: 'plugin-trusted.search-cancel',
          instanceId: input.instanceId,
          cancel: { invokeId: input.request.invokeId, reason: 'deadline-exceeded' },
        });
        settle({
          invokeId: input.request.invokeId,
          status: 'cancelled',
          errorCode: 'PLUGIN_PROVIDER_TIMEOUT',
          errorDetail: 'The trusted plugin search provider timed out.',
        }, true);
      }, input.timeoutMs);
      const abort = (): void => {
        this.#post(tracked, {
          type: 'plugin-trusted.search-cancel',
          instanceId: input.instanceId,
          cancel: { invokeId: input.request.invokeId, reason: 'cancelled' },
        });
        settle({
          invokeId: input.request.invokeId,
          status: 'cancelled',
          errorCode: 'PLUGIN_PROVIDER_CANCELLED',
        }, false);
      };
      input.signal?.addEventListener('abort', abort, { once: true });
      this.#pendingSearches.set(input.request.invokeId, {
        onChunk: input.onChunk ?? (() => undefined),
        resolve: (complete) => settle(complete, false),
        timer,
        signalCleanup: input.signal === undefined ? undefined : () => input.signal?.removeEventListener('abort', abort),
      });
      this.#post(tracked, {
        type: 'plugin-trusted.search-request',
        instanceId: input.instanceId,
        request: input.request,
      });
    });
  }

  invokeCommand(input: {
    instanceId: string;
    commandId: string;
    context: PluginCommandContext;
    timeoutMs: number;
  }): Promise<{
    complete: PluginCommandComplete;
    timedOut: boolean;
  }> {
    const tracked = this.#instances.get(input.instanceId);
    if (tracked === undefined || !tracked.ready) {
      return Promise.resolve({
        complete: {
          invokeId: globalThis.crypto.randomUUID(),
          status: 'failed',
          errorCode: 'PLUGIN_COMMAND_INSTANCE_UNAVAILABLE',
          errorDetail: 'The trusted plugin instance is not active.',
        },
        timedOut: false,
      });
    }
    const invokeId = globalThis.crypto.randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#pendingCommandCompletions.delete(invokeId);
        resolve({
          complete: {
            invokeId,
            status: 'failed',
            errorCode: 'PLUGIN_COMMAND_TIMEOUT',
            errorDetail: 'The plugin command handler timed out.',
          },
          timedOut: true,
        });
      }, input.timeoutMs);
      this.#pendingCommandCompletions.set(invokeId, {
        resolve: (complete) => resolve({ complete, timedOut: false }),
        timer,
      });
      try {
        tracked.child.postMessage({
          type: 'plugin-trusted.command-invoke',
          instanceId: input.instanceId,
          invoke: {
            invokeId,
            commandId: input.commandId,
            context: input.context,
          },
        });
      } catch {
        clearTimeout(timer);
        this.#pendingCommandCompletions.delete(invokeId);
        resolve({
          complete: {
            invokeId,
            status: 'failed',
            errorCode: 'PLUGIN_COMMAND_INSTANCE_UNAVAILABLE',
            errorDetail: 'The trusted plugin instance is not active.',
          },
          timedOut: false,
        });
      }
    });
  }

  shutdown(): void {
    for (const instanceId of [...this.#instances.keys()]) {
      this.deactivate(instanceId, 'supervisor-shutdown');
    }
  }

  listActiveInstances(libraryId?: string): Array<{
    instanceId: string;
    libraryId: string;
    instanceScope: 'global' | 'library';
    pluginId: string;
    packageHash: string;
    activated: boolean;
  }> {
    return [...this.#instances.entries()]
      .filter(([, tracked]) => libraryId === undefined
        || tracked.instanceScope === 'global'
        || tracked.libraryId === libraryId)
      .map(([instanceId, tracked]) => ({
        instanceId,
        libraryId: tracked.libraryId,
        instanceScope: tracked.instanceScope,
        pluginId: tracked.pluginId,
        packageHash: tracked.packageHash,
        activated: tracked.ready,
      }));
  }

  listActiveInstanceIds(libraryId?: string): string[] {
    return [...this.#instances.entries()]
      .filter(([, tracked]) => libraryId === undefined
        || tracked.instanceScope === 'global'
        || tracked.libraryId === libraryId)
      .map(([instanceId]) => instanceId);
  }

  #now(): number {
    return this.options.now?.() ?? Date.now();
  }

  #startHeartbeatWatch(tracked: TrackedInstance): void {
    this.#stopHeartbeatWatch(tracked);
    tracked.lastHeartbeatAt = this.#now();
    const checkIntervalMs = this.options.heartbeatCheckIntervalMs ?? DEFAULT_HEARTBEAT_CHECK_INTERVAL_MS;
    tracked.heartbeatWatch = setInterval(() => this.#checkHeartbeat(tracked), checkIntervalMs);
  }

  #stopHeartbeatWatch(tracked: TrackedInstance): void {
    if (tracked.heartbeatWatch !== undefined) {
      clearInterval(tracked.heartbeatWatch);
      tracked.heartbeatWatch = undefined;
    }
  }

  #checkHeartbeat(tracked: TrackedInstance): void {
    if (!this.#instances.has(tracked.instanceId) || !tracked.ready) return;
    const timeoutMs = this.options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
    if (this.#now() - tracked.lastHeartbeatAt <= timeoutMs) return;
    this.options.logger?.error(
      'plugin.trusted.heartbeat',
      new Error('The trusted plugin host stopped sending heartbeats.'),
      { pluginId: tracked.pluginId },
    );
    this.#notifyCrash({
      instanceId: tracked.instanceId,
      libraryId: tracked.libraryId,
      libraryDirectory: tracked.libraryDirectory,
      pluginId: tracked.pluginId,
      packageHash: tracked.packageHash,
      failureCode: 'HEARTBEAT_TIMEOUT',
    });
    tracked.child.kill();
    this.#clearTracked(tracked.instanceId);
  }

  #waitReady(tracked: TrackedInstance): Promise<void> {
    if (tracked.ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      tracked.readyWaiters.push({ resolve, reject });
    });
  }

  #waitActivated(tracked: TrackedInstance): Promise<void> {
    if (tracked.activated) return Promise.resolve();
    return new Promise((resolve, reject) => {
      tracked.activateWaiters.push({ resolve, reject });
    });
  }

  #failReady(tracked: TrackedInstance, error: Error): void {
    if (tracked.readyTimer !== undefined) clearTimeout(tracked.readyTimer);
    const waiters = tracked.readyWaiters.splice(0);
    for (const waiter of waiters) waiter.reject(error);
    this.#failActivate(tracked, error);
  }

  #failActivate(tracked: TrackedInstance, error: Error): void {
    if (tracked.activateTimer !== undefined) clearTimeout(tracked.activateTimer);
    const waiters = tracked.activateWaiters.splice(0);
    for (const waiter of waiters) waiter.reject(error);
  }

  #markReady(tracked: TrackedInstance): void {
    tracked.ready = true;
    if (tracked.readyTimer !== undefined) clearTimeout(tracked.readyTimer);
    const waiters = tracked.readyWaiters.splice(0);
    for (const waiter of waiters) waiter.resolve();
    this.#startHeartbeatWatch(tracked);
  }

  #markActivated(tracked: TrackedInstance): void {
    tracked.activated = true;
    if (tracked.activateTimer !== undefined) clearTimeout(tracked.activateTimer);
    const waiters = tracked.activateWaiters.splice(0);
    for (const waiter of waiters) waiter.resolve();
  }

  #post(tracked: TrackedInstance, message: PluginTrustedParentMessage): void {
    tracked.child.postMessage(message);
  }

  #clearTracked(instanceId: string): void {
    const tracked = this.#instances.get(instanceId);
    if (tracked === undefined) return;
    this.#stopHeartbeatWatch(tracked);
    if (tracked.readyTimer !== undefined) clearTimeout(tracked.readyTimer);
    if (tracked.activateTimer !== undefined) clearTimeout(tracked.activateTimer);
    if (tracked.deactivationTimer !== undefined) clearTimeout(tracked.deactivationTimer);
    tracked.deactivationTimer = undefined;
    this.#failActivate(tracked, new Error('Trusted plugin host ended before activate completed.'));
    this.#instances.delete(instanceId);
    for (const [jobId, owner] of this.#jobOwners) {
      if (owner === instanceId) this.#jobOwners.delete(jobId);
    }
  }

  #onExit(instanceId: string): void {
    const tracked = this.#instances.get(instanceId);
    if (tracked === undefined) return;
    this.#failReady(tracked, new Error('Trusted plugin host exited unexpectedly.'));
    this.#notifyCrash({
      instanceId: tracked.instanceId,
      libraryId: tracked.libraryId,
      libraryDirectory: tracked.libraryDirectory,
      pluginId: tracked.pluginId,
      packageHash: tracked.packageHash,
      failureCode: 'RUNTIME_PROCESS_EXITED',
    });
    this.#clearTracked(instanceId);
  }

  #notifyCrash(input: PluginRuntimeCrash): void {
    try {
      this.options.onCrash?.(input);
    } finally {
      this.options.onInstanceCrashed?.({
        instanceId: input.instanceId,
        failureCode: input.failureCode,
      });
    }
  }

  #onMessage(instanceId: string, raw: unknown): void {
    const tracked = this.#instances.get(instanceId);
    if (tracked === undefined) return;
    const payload = typeof raw === 'object' && raw !== null && 'data' in raw
      ? (raw as { data: unknown }).data
      : raw;
    const protocol = parsePluginTrustedChildMessage(payload);
    if (protocol.kind === 'ignored-event') {
      this.options.logger?.info('plugin.trusted.ignored-event', 'Ignored unknown non-critical event.', {
        eventType: protocol.eventType,
        instanceId: protocol.instanceId ?? instanceId,
      });
      return;
    }
    if (protocol.kind === 'fault') {
      this.#handleProtocolFault(protocol.instanceId ?? instanceId, protocol.reason);
      return;
    }
    const message = protocol.message;
    if (message.type === 'plugin-trusted.ready') {
      if (tracked.ready) {
        this.#handleProtocolFault(tracked.instanceId, 'Duplicate trusted Host ready handshake.');
        return;
      }
      this.#markReady(tracked);
      return;
    }
    if (message.type === 'plugin-trusted.heartbeat') {
      tracked.lastHeartbeatAt = this.#now();
      return;
    }
    if (!tracked.ready) {
      this.#handleProtocolFault(tracked.instanceId, `Trusted Host sent ${message.type} before ready handshake.`);
      return;
    }
    if (message.type === 'plugin-trusted.event') return;
    if (message.instanceId !== tracked.instanceId) {
      this.#handleProtocolFault(tracked.instanceId, `Message ${message.type} references a different instance.`);
      return;
    }
    if (message.type === 'plugin-trusted.host-command') {
      void this.#respondHostCommand(tracked, message);
      return;
    }
    if (message.type === 'plugin-trusted.storage-request') {
      void this.#respondStorage(tracked, message);
      return;
    }
    if (message.type === 'plugin-trusted.job-enqueue') {
      void this.#respondJobEnqueue(tracked, message);
      return;
    }
    if (message.type === 'plugin-trusted.job-progress') {
      void this.#respondJobProgress(tracked, message);
      return;
    }
    if (message.type === 'plugin-trusted.job-control') {
      void this.#respondJobControl(tracked, message);
      return;
    }
    if (message.type === 'plugin-trusted.input-capture.start') {
      this.#respondInputCaptureStart(tracked, message);
      return;
    }
    if (message.type === 'plugin-trusted.input-capture.release') {
      this.options.handleInputCaptureRelease?.(message.instanceId, message.sessionId);
      return;
    }
    if (message.type === 'plugin-trusted.activated') {
      this.#markActivated(tracked);
      this.options.onInstanceActivated?.({
        instanceId: message.instanceId,
        libraryId: tracked.libraryId,
        pluginId: tracked.pluginId,
      });
      return;
    }
    if (message.type === 'plugin-trusted.activation-failed') {
      this.#failActivate(tracked, new Error(message.message || message.code));
      this.#notifyCrash({
        instanceId: tracked.instanceId,
        libraryId: tracked.libraryId,
        libraryDirectory: tracked.libraryDirectory,
        pluginId: tracked.pluginId,
        packageHash: tracked.packageHash,
        failureCode: message.code,
      });
      tracked.child.kill();
      this.#clearTracked(instanceId);
      return;
    }
    if (message.type === 'plugin-trusted.deactivated') {
      tracked.child.kill();
      this.#clearTracked(instanceId);
      return;
    }
    if (message.type === 'plugin-trusted.console') {
      this.options.logger?.info('plugin.trusted.console', message.message, {
        instanceId,
        level: message.level,
      });
      return;
    }
    if (message.type === 'plugin-trusted.hook-decision') {
      const pending = this.#pendingHookDecisions.get(message.invokeId);
      if (pending === undefined) {
        this.#handleProtocolFault(tracked.instanceId, `Unknown hook correlation ${message.invokeId}.`);
        return;
      }
      clearTimeout(pending.timer);
      this.#pendingHookDecisions.delete(message.invokeId);
      pending.resolve(message.decision);
      return;
    }
    if (message.type === 'plugin-trusted.job-complete') {
      if (this.#jobOwners.get(message.jobId) !== message.instanceId) {
        this.#handleProtocolFault(tracked.instanceId, `Job completion ownership mismatch for ${message.jobId}.`);
        return;
      }
      const pending = this.#pendingJobCompletions.get(message.jobId);
      if (pending === undefined) {
        this.#handleProtocolFault(tracked.instanceId, `Unknown job correlation ${message.jobId}.`);
        return;
      }
      this.#pendingJobCompletions.delete(message.jobId);
      this.#jobOwners.delete(message.jobId);
      pending.resolve({
        jobId: message.jobId,
        status: message.status,
        ...(message.errorCode === undefined ? {} : { errorCode: message.errorCode }),
        ...(message.errorDetail === undefined ? {} : { errorDetail: message.errorDetail }),
        ...(message.progress === undefined ? {} : { progress: message.progress }),
        ...(message.completed === undefined ? {} : { completed: message.completed }),
        ...(message.total === undefined ? {} : { total: message.total }),
        ...(message.phase === undefined ? {} : { phase: message.phase }),
        ...(message.message === undefined ? {} : { message: message.message }),
        ...(message.itemResults === undefined ? {} : { itemResults: message.itemResults }),
        ...(message.failedAssetIds === undefined ? {} : { failedAssetIds: message.failedAssetIds }),
        ...(message.retryInput === undefined ? {} : { retryInput: message.retryInput }),
        ...(message.checkpoint === undefined ? {} : { checkpoint: message.checkpoint }),
      });
      return;
    }
    if (message.type === 'plugin-trusted.provider-complete') {
      const pending = this.#pendingProviderCompletions.get(message.invokeId);
      if (pending === undefined) {
        this.#handleProtocolFault(tracked.instanceId, `Unknown provider correlation ${message.invokeId}.`);
        return;
      }
      clearTimeout(pending.timer);
      this.#pendingProviderCompletions.delete(message.invokeId);
      pending.resolve({
        invokeId: message.invokeId,
        status: message.status,
        values: message.values,
        ...(message.errorCode === undefined ? {} : { errorCode: message.errorCode }),
        ...(message.errorDetail === undefined ? {} : { errorDetail: message.errorDetail }),
      });
      return;
    }
    if (message.type === 'plugin-trusted.search-chunk') {
      const pending = this.#pendingSearches.get(message.invokeId);
      if (pending === undefined) {
        this.#handleProtocolFault(tracked.instanceId, `Unknown search correlation ${message.invokeId}.`);
        return;
      }
      pending.onChunk({
        invokeId: message.invokeId,
        items: message.items,
      });
      return;
    }
    if (message.type === 'plugin-trusted.search-complete') {
      const pending = this.#pendingSearches.get(message.invokeId);
      if (pending === undefined) {
        this.#handleProtocolFault(tracked.instanceId, `Unknown search correlation ${message.invokeId}.`);
        return;
      }
      pending.resolve({
        invokeId: message.invokeId,
        status: message.status,
        ...(message.nextOffset === undefined ? {} : { nextOffset: message.nextOffset }),
        ...(message.errorCode === undefined ? {} : { errorCode: message.errorCode }),
        ...(message.errorDetail === undefined ? {} : { errorDetail: message.errorDetail }),
      });
      return;
    }
    if (message.type === 'plugin-trusted.command-complete') {
      const pending = this.#pendingCommandCompletions.get(message.invokeId);
      if (pending === undefined) {
        this.#handleProtocolFault(tracked.instanceId, `Unknown command correlation ${message.invokeId}.`);
        return;
      }
      clearTimeout(pending.timer);
      this.#pendingCommandCompletions.delete(message.invokeId);
      pending.resolve(message);
    }
  }

  #handleProtocolFault(instanceId: string | undefined, reason: string): void {
    const tracked = instanceId === undefined ? undefined : this.#instances.get(instanceId);
    this.options.logger?.error(
      'plugin.trusted.protocol-fault',
      new Error(reason),
      instanceId === undefined ? undefined : { instanceId },
    );
    if (tracked === undefined) return;
    this.#notifyCrash({
      instanceId: tracked.instanceId,
      libraryId: tracked.libraryId,
      libraryDirectory: tracked.libraryDirectory,
      pluginId: tracked.pluginId,
      packageHash: tracked.packageHash,
      failureCode: 'RUNTIME_PROTOCOL_ERROR',
    });
    try {
      tracked.child.postMessage({
        type: 'plugin-trusted.deactivate',
        instanceId: tracked.instanceId,
        reason: 'protocol-fault',
      });
    } catch {
      // The child may already be gone.
    }
    tracked.child.kill();
    this.#clearTracked(tracked.instanceId);
  }

  async #respondHostCommand(
    tracked: TrackedInstance,
    message: Extract<PluginTrustedChildMessage, { type: 'plugin-trusted.host-command' }>,
  ): Promise<void> {
    try {
      const result = await this.options.executeHostCommand(message.commandId, message.input, {
        instanceId: message.instanceId,
        libraryId: tracked.libraryId,
        ...(message.targetLibraryId === undefined ? {} : { targetLibraryId: message.targetLibraryId }),
        pluginId: tracked.pluginId,
        permissions: tracked.permissions,
        causeChain: message.causeChain ?? [],
      });
      this.#post(tracked, {
        type: 'plugin-trusted.host-result',
        instanceId: message.instanceId,
        requestId: message.requestId,
        ok: true,
        result,
      });
    } catch (error) {
      this.options.logger?.error('plugin.trusted.host-command-failed', error, {
        instanceId: message.instanceId,
        commandId: message.commandId,
      });
      this.#post(tracked, {
        type: 'plugin-trusted.host-result',
        instanceId: message.instanceId,
        requestId: message.requestId,
        ok: false,
        error: { code: 'HOST_COMMAND_FAILED', message: 'The automation command could not complete.' },
      });
    }
  }

  async #respondStorage(
    tracked: TrackedInstance,
    message: Extract<PluginTrustedChildMessage, { type: 'plugin-trusted.storage-request' }>,
  ): Promise<void> {
    if (this.options.executeStorage === undefined) {
      this.#post(tracked, {
        type: 'plugin-trusted.storage-result',
        instanceId: message.instanceId,
        requestId: message.requestId,
        ok: false,
        error: { code: 'STORAGE_UNAVAILABLE', message: 'Plugin storage is unavailable in this session.' },
      });
      return;
    }
    try {
      const result = await this.options.executeStorage({
        operation: message.operation,
        scope: message.scope ?? (
          message.operation === 'get-directory'
            ? tracked.installScope
            : 'library'
        ),
        ...(message.key === undefined ? {} : { key: message.key }),
        ...(message.value === undefined ? {} : { value: message.value }),
        context: {
          instanceId: message.instanceId,
          libraryId: tracked.libraryId,
          libraryDirectory: tracked.libraryDirectory,
          pluginId: tracked.pluginId,
          permissions: tracked.permissions,
        },
      });
      this.#post(tracked, {
        type: 'plugin-trusted.storage-result',
        instanceId: message.instanceId,
        requestId: message.requestId,
        ok: true,
        result,
      });
    } catch (error) {
      const code = error instanceof Error && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'STORAGE_FAILED';
      const messageText = error instanceof Error ? error.message : 'Plugin storage request failed.';
      this.options.logger?.error('plugin.trusted.storage-failed', error, {
        instanceId: message.instanceId,
        operation: message.operation,
      });
      this.#post(tracked, {
        type: 'plugin-trusted.storage-result',
        instanceId: message.instanceId,
        requestId: message.requestId,
        ok: false,
        error: { code, message: messageText.slice(0, 1_024) },
      });
    }
  }

  async #respondJobEnqueue(
    tracked: TrackedInstance,
    message: Extract<PluginTrustedChildMessage, { type: 'plugin-trusted.job-enqueue' }>,
  ): Promise<void> {
    if (!tracked.permissions.includes('job.manage')) {
      this.#post(tracked, {
        type: 'plugin-trusted.job-enqueue-result',
        instanceId: message.instanceId,
        requestId: message.requestId,
        ok: false,
        error: { code: 'PERMISSION_DENIED', message: 'This plugin does not have job.manage permission.' },
      });
      return;
    }
    if (this.options.handleJobEnqueue === undefined) {
      this.#post(tracked, {
        type: 'plugin-trusted.job-enqueue-result',
        instanceId: message.instanceId,
        requestId: message.requestId,
        ok: false,
        error: { code: 'JOBS_UNAVAILABLE', message: 'Plugin jobs are unavailable in this session.' },
      });
      return;
    }
    try {
      const result = await this.options.handleJobEnqueue({
        instanceId: message.instanceId,
        requestId: message.requestId,
        handlerId: message.handlerId,
        payload: message.payload,
        ...(message.recoveryStrategy === undefined ? {} : { recoveryStrategy: message.recoveryStrategy }),
        ...(message.targetLibraryId === undefined ? {} : { targetLibraryId: message.targetLibraryId }),
        context: {
          libraryId: tracked.libraryId,
          pluginId: tracked.pluginId,
          packageHash: tracked.packageHash,
          permissions: tracked.permissions,
        },
      });
      this.#jobOwners.set(result.jobId, message.instanceId);
      this.#post(tracked, {
        type: 'plugin-trusted.job-enqueue-result',
        instanceId: message.instanceId,
        requestId: message.requestId,
        ok: true,
        result: { jobId: result.jobId },
      });
    } catch (error) {
      const code = error instanceof Error && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'JOB_ENQUEUE_FAILED';
      const messageText = error instanceof Error ? error.message : 'Plugin job enqueue failed.';
      this.options.logger?.error('plugin.trusted.job-enqueue-failed', error, {
        instanceId: message.instanceId,
        handlerId: message.handlerId,
      });
      this.#post(tracked, {
        type: 'plugin-trusted.job-enqueue-result',
        instanceId: message.instanceId,
        requestId: message.requestId,
        ok: false,
        error: { code, message: messageText.slice(0, 1_024) },
      });
    }
  }

  async #respondJobProgress(
    tracked: TrackedInstance,
    message: Extract<PluginTrustedChildMessage, { type: 'plugin-trusted.job-progress' }>,
  ): Promise<void> {
    if (!tracked.permissions.includes('job.manage')) {
      this.options.logger?.info('plugin.trusted.job-progress-denied', 'Ignored progress without job.manage permission.', {
        instanceId: tracked.instanceId,
        jobId: message.jobId,
      });
      return;
    }
    const owner = this.#jobOwners.get(message.jobId);
    if (owner !== message.instanceId) {
      this.options.logger?.info('plugin.trusted.job-progress-ignored', 'Ignored progress for an unknown or foreign job.', {
        instanceId: tracked.instanceId,
        jobId: message.jobId,
      });
      return;
    }
    if (this.options.handleJobProgress === undefined) return;
    try {
      await this.options.handleJobProgress({
        instanceId: message.instanceId,
        jobId: message.jobId,
        progress: message.progress,
        ...(message.targetLibraryId === undefined ? {} : { targetLibraryId: message.targetLibraryId }),
        context: {
          libraryId: tracked.libraryId,
          pluginId: tracked.pluginId,
          packageHash: tracked.packageHash,
          permissions: tracked.permissions,
        },
      });
    } catch (error) {
      this.options.logger?.error('plugin.trusted.job-progress-failed', error, {
        instanceId: tracked.instanceId,
        jobId: message.jobId,
      });
    }
  }

  async #respondJobControl(
    tracked: TrackedInstance,
    message: Extract<PluginTrustedChildMessage, { type: 'plugin-trusted.job-control' }>,
  ): Promise<void> {
    if (!tracked.permissions.includes('job.manage')) {
      this.#post(tracked, {
        type: 'plugin-trusted.job-control-result', instanceId: message.instanceId,
        requestId: message.requestId, ok: false,
        error: { code: 'PERMISSION_DENIED', message: 'This plugin does not have job.manage permission.' },
      });
      return;
    }
    if (this.options.handleJobControl === undefined) {
      this.#post(tracked, {
        type: 'plugin-trusted.job-control-result', instanceId: message.instanceId,
        requestId: message.requestId, ok: false,
        error: { code: 'JOBS_UNAVAILABLE', message: 'Plugin jobs are unavailable in this session.' },
      });
      return;
    }
    try {
      const result = await this.options.handleJobControl({
        instanceId: message.instanceId,
        requestId: message.requestId,
        jobId: message.jobId,
        action: message.action,
        ...(message.targetLibraryId === undefined ? {} : { targetLibraryId: message.targetLibraryId }),
        ...(message.reason === undefined ? {} : { reason: message.reason }),
        ...(message.retryInput === undefined ? {} : { retryInput: message.retryInput }),
        ...(message.checkpoint === undefined ? {} : { checkpoint: message.checkpoint }),
        context: {
          libraryId: tracked.libraryId,
          pluginId: tracked.pluginId,
          packageHash: tracked.packageHash,
          permissions: tracked.permissions,
        },
      });
      if (message.action === 'cancel' || message.action === 'pause') {
        this.signalJob(message.instanceId, message.jobId, message.action, message.reason);
      }
      this.#post(tracked, {
        type: 'plugin-trusted.job-control-result', instanceId: message.instanceId,
        requestId: message.requestId, ok: true, job: result.job,
      });
    } catch (error) {
      const code = error instanceof Error && 'code' in error && typeof error.code === 'string'
        ? error.code : 'JOB_CONTROL_FAILED';
      this.#post(tracked, {
        type: 'plugin-trusted.job-control-result', instanceId: message.instanceId,
        requestId: message.requestId, ok: false,
        error: { code, message: error instanceof Error ? error.message.slice(0, 1_024) : 'Plugin job control failed.' },
      });
    }
  }

  #respondInputCaptureStart(
    tracked: TrackedInstance,
    message: Extract<PluginTrustedChildMessage, { type: 'plugin-trusted.input-capture.start' }>,
  ): void {
    const handler = this.options.handleInputCaptureStart;
    if (handler === undefined) {
      this.#post(tracked, {
        type: 'plugin-trusted.input-capture.error',
        instanceId: message.instanceId,
        requestId: message.requestId,
        code: 'CAPTURE_UNAVAILABLE',
        message: 'Input capture is unavailable in this session.',
      });
      return;
    }
    try {
      const result = handler({
        instanceId: message.instanceId,
        pluginId: tracked.pluginId,
        libraryId: tracked.libraryId,
        permissions: tracked.permissions,
        options: message.options,
      });
      if (!result.ok) {
        this.#post(tracked, {
          type: 'plugin-trusted.input-capture.error',
          instanceId: message.instanceId,
          requestId: message.requestId,
          code: result.code,
          message: result.message,
        });
        return;
      }
      this.#post(tracked, {
        type: 'plugin-trusted.input-capture.started',
        instanceId: message.instanceId,
        requestId: message.requestId,
        sessionId: result.session.sessionId,
      });
    } catch (error) {
      this.#post(tracked, {
        type: 'plugin-trusted.input-capture.error',
        instanceId: message.instanceId,
        requestId: message.requestId,
        code: 'CAPTURE_UNAVAILABLE',
        message: error instanceof Error ? error.message : 'Input capture failed.',
      });
    }
  }
}
