import {
  pluginRuntimeChildMessageSchema,
  type PluginRuntimeChildMessage,
  type PluginRuntimeDeactivateReason,
  type PluginRuntimeParentMessage,
} from '../shared/plugin-runtime-utility-protocol';
import type { AutomationScriptCommandId } from '../shared/automation-script-api';
import type { PluginPermission } from '../plugins/plugin-manifest';
import type { PluginJobComplete, PluginJobRecord } from '../plugins/plugin-jobs';
import type { PluginProviderBatchResult, PluginProviderInvoke } from '../plugins/plugin-providers';
import type {
  PluginSearchChunk,
  PluginSearchComplete,
  PluginSearchRequest,
} from '../plugins/plugin-search';
import type { PluginCommandComplete, PluginCommandContext } from '../plugins/plugin-commands';
import type {
  PluginInputCaptureEndReason,
  PluginInputCaptureEvent,
  PluginInputCaptureOptions,
  PluginInputCaptureStartResult,
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

export interface PluginRuntimeSupervisorLogger {
  info(scope: string, message: string, context?: Record<string, unknown>): void;
  error(scope: string, error: unknown, context?: Record<string, unknown>): void;
}

export interface PluginRuntimeActivateInput {
  instanceId: string;
  libraryId: string;
  libraryDirectory: string;
  instanceScope?: 'global' | 'library';
  pluginId: string;
  version: string;
  packageHash: string;
  entryJavaScript: string;
  permissions: readonly PluginPermission[];
  installScope?: 'user' | 'library';
  activateDeadlineMs?: number;
}

export type PluginRuntimeHostCommandHandler = (
  commandId: AutomationScriptCommandId,
  input: unknown,
  context: {
    instanceId: string;
    libraryId: string;
    pluginId: string;
    permissions: readonly PluginPermission[];
    causeChain: readonly string[];
  },
) => Promise<unknown>;

export type PluginRuntimeStorageHandler = (input: {
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

export type PluginRuntimeJobEnqueueHandler = (input: {
  instanceId: string;
  requestId: string;
  handlerId: string;
  payload: Record<string, unknown>;
  recoveryStrategy?: 'idempotent' | 'checkpoint';
  context: {
    libraryId: string;
    pluginId: string;
    packageHash: string;
    permissions: readonly PluginPermission[];
  };
}) => Promise<{ jobId: string }>;

export type PluginRuntimeInputCaptureStartHandler = (input: {
  instanceId: string;
  pluginId: string;
  libraryId: string;
  permissions: readonly PluginPermission[];
  options: PluginInputCaptureOptions;
}) => PluginInputCaptureStartResult;

/**
 * Main-owned long-lived Standard Plugin Host. One UtilityProcess hosts many
 * plugin instances; Main never evaluates entry JavaScript itself.
 */
export class PluginRuntimeSupervisor {
  #child: RuntimeChild | undefined;
  #ready = false;
  #readyWaiters: Array<{ resolve(): void; reject(error: Error): void }> = [];
  #readyTimer: ReturnType<typeof setTimeout> | undefined;
  #lastHeartbeatAt = 0;
  #heartbeatWatch: ReturnType<typeof setInterval> | undefined;
  #instances = new Map<string, {
    instanceId: string;
    libraryId: string;
    libraryDirectory: string;
    instanceScope: 'global' | 'library';
    pluginId: string;
    packageHash: string;
    permissions: readonly PluginPermission[];
    installScope: 'user' | 'library';
    activated: boolean;
  }>();
  #pendingHookDecisions = new Map<string, {
    resolve(decision: import('../plugins/plugin-hooks').PluginHookDecision): void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  #pendingJobCompletions = new Map<string, {
    resolve(complete: PluginJobComplete): void;
    timer: ReturnType<typeof setTimeout>;
  }>();
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
      executeHostCommand: PluginRuntimeHostCommandHandler;
      executeStorage?: PluginRuntimeStorageHandler;
      handleJobEnqueue?: PluginRuntimeJobEnqueueHandler;
      handleInputCaptureStart?: PluginRuntimeInputCaptureStartHandler;
      handleInputCaptureRelease?: (instanceId: string, sessionId: string) => void;
      onInstanceDeactivated?: (instanceId: string) => void;
      /** Called after crash recording so upper layers can evict the instance. */
      onInstanceCrashed?: (input: Pick<PluginRuntimeCrash, 'instanceId' | 'failureCode'>) => void;
      onInputCaptureEnd?: (instanceId: string) => void;
      onInstanceActivated?: (input: {
        instanceId: string;
        libraryId: string;
        pluginId: string;
      }) => void;
      onCrash?: (input: PluginRuntimeCrash) => void;
      logger?: PluginRuntimeSupervisorLogger;
      heartbeatTimeoutMs?: number;
      heartbeatCheckIntervalMs?: number;
      now?: () => number;
    },
  ) {}

  async ensureHostRunning(): Promise<void> {
    if (this.#child !== undefined && this.#ready) return;
    if (this.#child !== undefined) {
      await this.#waitUntilReady();
      return;
    }
    const child = this.options.fork(this.options.modulePath);
    this.#child = child;
    this.#ready = false;
    child.stdout?.on('data', (chunk) => {
      this.options.logger?.info('plugin.runtime.stdout', String(chunk).trim());
    });
    child.stderr?.on('data', (chunk) => {
      this.options.logger?.error('plugin.runtime.stderr', new Error(String(chunk).trim()));
    });
    child.on('message', (raw) => this.#onMessage(raw));
    child.on('exit', (...details) => this.#onExit(details[0]));
    child.on('error', (error) => {
      this.options.logger?.error('plugin.runtime.fatal', error);
      this.#failReady(new Error('The standard plugin host could not start.'));
    });
    this.#readyTimer = setTimeout(() => {
      this.#failReady(new Error('The standard plugin host timed out during ready handshake.'));
      this.shutdown();
    }, READY_TIMEOUT_MS);
    await this.#waitUntilReady();
  }

  async activate(input: PluginRuntimeActivateInput): Promise<void> {
    await this.ensureHostRunning();
    this.#instances.set(input.instanceId, {
      instanceId: input.instanceId,
      libraryId: input.libraryId,
      libraryDirectory: input.libraryDirectory,
      instanceScope: input.instanceScope ?? 'library',
      pluginId: input.pluginId,
      packageHash: input.packageHash,
      permissions: input.permissions,
      installScope: input.installScope ?? 'library',
      activated: false,
    });
    this.#post({
      type: 'plugin-runtime.activate',
      instanceId: input.instanceId,
      libraryId: input.libraryId,
      instanceScope: input.instanceScope ?? 'library',
      pluginId: input.pluginId,
      version: input.version,
      packageHash: input.packageHash,
      entryJavaScript: input.entryJavaScript,
      permissions: [...input.permissions],
      installScope: input.installScope ?? 'library',
      activateDeadlineMs: input.activateDeadlineMs ?? 10_000,
    });
  }

  deactivate(instanceId: string, reason: PluginRuntimeDeactivateReason): void {
    if (!this.#instances.has(instanceId)) return;
    this.options.onInstanceDeactivated?.(instanceId);
    this.#post({
      type: 'plugin-runtime.deactivate',
      instanceId,
      reason,
    });
  }

  deliverInputCaptureEvent(
    instanceId: string,
    sessionId: string,
    event: PluginInputCaptureEvent,
  ): void {
    if (!this.#instances.has(instanceId)) return;
    this.#post({ type: 'plugin-runtime.input-capture.event', instanceId, sessionId, event });
  }

  endInputCapture(
    instanceId: string,
    sessionId: string,
    reason: PluginInputCaptureEndReason,
  ): void {
    if (!this.#instances.has(instanceId)) return;
    this.#post({ type: 'plugin-runtime.input-capture.end', instanceId, sessionId, reason });
  }

  deactivateLibrary(libraryId: string, reason: PluginRuntimeDeactivateReason): void {
    for (const [instanceId, instance] of this.#instances) {
      if (instance.instanceScope === 'library' && instance.libraryId === libraryId) {
        this.deactivate(instanceId, reason);
      }
    }
  }

  /**
   * Fan-out a committed domain event to every active instance for the library.
   * Delivery is at-least-once; guests dedupe with `eventId`.
   */
  deliverDomainEvent(
    libraryId: string,
    event: import('../plugins/plugin-domain-events').PluginDomainEvent,
  ): void {
    if (this.#child === undefined || !this.#ready) return;
    for (const [instanceId, instance] of this.#instances) {
      if (instance.instanceScope !== 'global'
        && (instance.libraryId !== libraryId || !instance.activated)) continue;
      if (!instance.activated) continue;
      this.#post({
        type: 'plugin-runtime.domain-event',
        instanceId,
        event,
      });
    }
  }

  /**
   * Ask one activated instance for an onWill decision. Times out to allow
   * (caller treats timeout as fail-open).
   */
  invokeHook(input: {
    instanceId: string;
    invoke: import('../plugins/plugin-hooks').PluginHookInvoke;
    timeoutMs: number;
  }): Promise<{
    decision: import('../plugins/plugin-hooks').PluginHookDecision;
    timedOut: boolean;
  }> {
    const instance = this.#instances.get(input.instanceId);
    if (
      this.#child === undefined
      || !this.#ready
      || instance === undefined
      || !instance.activated
    ) {
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
      this.#post({
        type: 'plugin-runtime.hook-invoke',
        instanceId: input.instanceId,
        invoke: input.invoke,
      });
    });
  }

  invokeJob(input: {
    instanceId: string;
    job: PluginJobRecord;
    timeoutMs: number;
  }): Promise<{
    complete: PluginJobComplete;
    timedOut: boolean;
  }> {
    const instance = this.#instances.get(input.instanceId);
    if (
      this.#child === undefined
      || !this.#ready
      || instance === undefined
      || !instance.activated
    ) {
      return Promise.resolve({
        complete: {
          jobId: input.job.jobId,
          status: 'failed',
          errorCode: 'PLUGIN_JOB_INSTANCE_UNAVAILABLE',
          errorDetail: 'The plugin instance is not active.',
        },
        timedOut: false,
      });
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#pendingJobCompletions.delete(input.job.jobId);
        resolve({
          complete: {
            jobId: input.job.jobId,
            status: 'failed',
            errorCode: 'PLUGIN_JOB_TIMEOUT',
            errorDetail: 'The plugin job handler timed out.',
          },
          timedOut: true,
        });
      }, input.timeoutMs);
      this.#pendingJobCompletions.set(input.job.jobId, {
        resolve: (complete) => resolve({ complete, timedOut: false }),
        timer,
      });
      this.#post({
        type: 'plugin-runtime.job-invoke',
        instanceId: input.instanceId,
        job: input.job,
      });
    });
  }

  invokeProvider(input: {
    instanceId: string;
    invoke: PluginProviderInvoke;
    timeoutMs: number;
  }): Promise<{ result: PluginProviderBatchResult; timedOut: boolean }> {
    const instance = this.#instances.get(input.instanceId);
    if (
      this.#child === undefined
      || !this.#ready
      || instance === undefined
      || !instance.activated
    ) {
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
      this.#post({
        type: 'plugin-runtime.provider-invoke',
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
    const instance = this.#instances.get(input.instanceId);
    const unavailable = (errorCode: string): Promise<{ complete: PluginSearchComplete; timedOut: boolean }> => Promise.resolve({
      complete: {
        invokeId: input.request.invokeId,
        status: 'failed',
        errorCode,
        errorDetail: 'The plugin search provider is not active.',
      },
      timedOut: false,
    });
    if (
      this.#child === undefined
      || !this.#ready
      || instance === undefined
      || !instance.activated
    ) return unavailable('PLUGIN_PROVIDER_INSTANCE_UNAVAILABLE');
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
        this.#post({
          type: 'plugin-runtime.search-cancel',
          instanceId: input.instanceId,
          cancel: { invokeId: input.request.invokeId, reason: 'deadline-exceeded' },
        });
        settle({
          invokeId: input.request.invokeId,
          status: 'cancelled',
          errorCode: 'PLUGIN_PROVIDER_TIMEOUT',
          errorDetail: 'The plugin search provider timed out.',
        }, true);
      }, input.timeoutMs);
      const abort = (): void => {
        this.#post({
          type: 'plugin-runtime.search-cancel',
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
      this.#post({
        type: 'plugin-runtime.search-request',
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
    const instance = this.#instances.get(input.instanceId);
    if (
      this.#child === undefined
      || !this.#ready
      || instance === undefined
      || !instance.activated
    ) {
      return Promise.resolve({
        complete: {
          invokeId: globalThis.crypto.randomUUID(),
          status: 'failed',
          errorCode: 'PLUGIN_COMMAND_INSTANCE_UNAVAILABLE',
          errorDetail: 'The plugin instance is not active.',
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
      this.#post({
        type: 'plugin-runtime.command-invoke',
        instanceId: input.instanceId,
        invoke: {
          invokeId,
          commandId: input.commandId,
          context: input.context,
        },
      });
    });
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
      .filter(([, instance]) => libraryId === undefined
        || instance.instanceScope === 'global'
        || instance.libraryId === libraryId)
      .map(([instanceId, instance]) => ({
        instanceId,
        libraryId: instance.libraryId,
        instanceScope: instance.instanceScope,
        pluginId: instance.pluginId,
        packageHash: instance.packageHash,
        activated: instance.activated,
      }));
  }

  listActiveInstanceIds(libraryId?: string): string[] {
    return [...this.#instances.entries()]
      .filter(([, instance]) => libraryId === undefined
        || instance.instanceScope === 'global'
        || instance.libraryId === libraryId)
      .map(([instanceId]) => instanceId);
  }

  shutdown(): void {
    this.#stopHeartbeatWatch();
    const child = this.#child;
    if (child === undefined) return;
    try {
      child.postMessage({ type: 'plugin-runtime.shutdown' });
    } catch {
      // Child may already be gone.
    }
    child.kill();
    this.#child = undefined;
    this.#ready = false;
    this.#instances.clear();
    if (this.#readyTimer !== undefined) clearTimeout(this.#readyTimer);
  }

  #now(): number {
    return this.options.now?.() ?? Date.now();
  }

  #startHeartbeatWatch(): void {
    this.#stopHeartbeatWatch();
    this.#lastHeartbeatAt = this.#now();
    const checkIntervalMs = this.options.heartbeatCheckIntervalMs ?? DEFAULT_HEARTBEAT_CHECK_INTERVAL_MS;
    this.#heartbeatWatch = setInterval(() => this.#checkHeartbeat(), checkIntervalMs);
  }

  #stopHeartbeatWatch(): void {
    if (this.#heartbeatWatch !== undefined) {
      clearInterval(this.#heartbeatWatch);
      this.#heartbeatWatch = undefined;
    }
  }

  #checkHeartbeat(): void {
    if (this.#child === undefined || !this.#ready) return;
    const timeoutMs = this.options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
    if (this.#now() - this.#lastHeartbeatAt <= timeoutMs) return;
    this.options.logger?.error(
      'plugin.runtime.heartbeat',
      new Error('The standard plugin host stopped sending heartbeats.'),
    );
    const instances = [...this.#instances.values()];
    this.#child.kill();
    this.#child = undefined;
    this.#ready = false;
    this.#instances.clear();
    this.#stopHeartbeatWatch();
    for (const instance of instances) {
      this.#notifyCrash({
        instanceId: instance.instanceId,
        libraryId: instance.libraryId,
        libraryDirectory: instance.libraryDirectory,
        pluginId: instance.pluginId,
        packageHash: instance.packageHash,
        failureCode: 'HEARTBEAT_TIMEOUT',
      });
    }
  }

  #waitUntilReady(): Promise<void> {
    if (this.#ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.#readyWaiters.push({ resolve, reject });
    });
  }

  #failReady(error: Error): void {
    if (this.#readyTimer !== undefined) clearTimeout(this.#readyTimer);
    const waiters = this.#readyWaiters.splice(0);
    for (const waiter of waiters) waiter.reject(error);
  }

  #markReady(): void {
    this.#ready = true;
    if (this.#readyTimer !== undefined) clearTimeout(this.#readyTimer);
    const waiters = this.#readyWaiters.splice(0);
    for (const waiter of waiters) waiter.resolve();
    this.#startHeartbeatWatch();
  }

  #post(message: PluginRuntimeParentMessage): void {
    this.#child?.postMessage(message);
  }

  #onExit(code: unknown): void {
    this.#stopHeartbeatWatch();
    const instances = [...this.#instances.values()];
    this.#child = undefined;
    this.#ready = false;
    this.#instances.clear();
    this.#failReady(new Error(`The standard plugin host exited unexpectedly (${String(code)}).`));
    for (const instance of instances) {
      this.#notifyCrash({
        instanceId: instance.instanceId,
        libraryId: instance.libraryId,
        libraryDirectory: instance.libraryDirectory,
        pluginId: instance.pluginId,
        packageHash: instance.packageHash,
        failureCode: 'RUNTIME_PROCESS_EXITED',
      });
    }
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

  #onMessage(raw: unknown): void {
    const payload = typeof raw === 'object' && raw !== null && 'data' in raw
      ? (raw as { data: unknown }).data
      : raw;
    const parsed = pluginRuntimeChildMessageSchema.safeParse(payload);
    if (!parsed.success) {
      this.options.logger?.error(
        'plugin.runtime.protocol',
        new Error('Invalid plugin-runtime child message.'),
      );
      return;
    }
    const message = parsed.data;
    if (message.type === 'plugin-runtime.ready') {
      this.#markReady();
      return;
    }
    if (message.type === 'plugin-runtime.heartbeat') {
      this.#lastHeartbeatAt = this.#now();
      return;
    }
    if (!this.#ready) return;

    if (message.type === 'plugin-runtime.host-command') {
      void this.#respondHostCommand(message);
      return;
    }
    if (message.type === 'plugin-runtime.storage-request') {
      void this.#respondStorage(message);
      return;
    }
    if (message.type === 'plugin-runtime.job-enqueue') {
      void this.#respondJobEnqueue(message);
      return;
    }
    if (message.type === 'plugin-runtime.input-capture.start') {
      void this.#respondInputCaptureStart(message);
      return;
    }
    if (message.type === 'plugin-runtime.input-capture.release') {
      this.options.handleInputCaptureRelease?.(message.instanceId, message.sessionId);
      return;
    }
    if (message.type === 'plugin-runtime.activated') {
      const instance = this.#instances.get(message.instanceId);
      if (instance !== undefined) {
        instance.activated = true;
        this.options.onInstanceActivated?.({
          instanceId: message.instanceId,
          libraryId: instance.libraryId,
          pluginId: instance.pluginId,
        });
      }
      return;
    }
    if (message.type === 'plugin-runtime.activation-failed') {
      const instance = this.#instances.get(message.instanceId);
      this.#instances.delete(message.instanceId);
      if (instance !== undefined) {
        this.#notifyCrash({
          instanceId: message.instanceId,
          libraryId: instance.libraryId,
          libraryDirectory: instance.libraryDirectory,
          pluginId: instance.pluginId,
          packageHash: instance.packageHash,
          failureCode: message.code,
        });
      }
      return;
    }
    if (message.type === 'plugin-runtime.deactivated') {
      this.#instances.delete(message.instanceId);
      return;
    }
    if (message.type === 'plugin-runtime.console') {
      this.options.logger?.info('plugin.runtime.console', message.message, {
        instanceId: message.instanceId,
        level: message.level,
      });
      return;
    }
    if (message.type === 'plugin-runtime.hook-decision') {
      const pending = this.#pendingHookDecisions.get(message.invokeId);
      if (pending === undefined) return;
      clearTimeout(pending.timer);
      this.#pendingHookDecisions.delete(message.invokeId);
      pending.resolve(message.decision);
      return;
    }
    if (message.type === 'plugin-runtime.job-complete') {
      const pending = this.#pendingJobCompletions.get(message.jobId);
      if (pending === undefined) return;
      clearTimeout(pending.timer);
      this.#pendingJobCompletions.delete(message.jobId);
      pending.resolve({
        jobId: message.jobId,
        status: message.status,
        ...(message.errorCode === undefined ? {} : { errorCode: message.errorCode }),
        ...(message.errorDetail === undefined ? {} : { errorDetail: message.errorDetail }),
        ...(message.progress === undefined ? {} : { progress: message.progress }),
      });
      return;
    }
    if (message.type === 'plugin-runtime.provider-complete') {
      const pending = this.#pendingProviderCompletions.get(message.invokeId);
      if (pending === undefined) return;
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
    if (message.type === 'plugin-runtime.search-chunk') {
      this.#pendingSearches.get(message.invokeId)?.onChunk({
        invokeId: message.invokeId,
        items: message.items,
      });
      return;
    }
    if (message.type === 'plugin-runtime.search-complete') {
      const pending = this.#pendingSearches.get(message.invokeId);
      if (pending === undefined) return;
      pending.resolve({
        invokeId: message.invokeId,
        status: message.status,
        ...(message.nextOffset === undefined ? {} : { nextOffset: message.nextOffset }),
        ...(message.errorCode === undefined ? {} : { errorCode: message.errorCode }),
        ...(message.errorDetail === undefined ? {} : { errorDetail: message.errorDetail }),
      });
      return;
    }
    if (message.type === 'plugin-runtime.command-complete') {
      const pending = this.#pendingCommandCompletions.get(message.invokeId);
      if (pending === undefined) return;
      clearTimeout(pending.timer);
      this.#pendingCommandCompletions.delete(message.invokeId);
      pending.resolve(message);
    }
  }

  async #respondHostCommand(
    message: Extract<PluginRuntimeChildMessage, { type: 'plugin-runtime.host-command' }>,
  ): Promise<void> {
    const instance = this.#instances.get(message.instanceId);
    if (instance === undefined) {
      this.#post({
        type: 'plugin-runtime.host-result',
        instanceId: message.instanceId,
        requestId: message.requestId,
        ok: false,
        error: { code: 'INSTANCE_GONE', message: 'The plugin instance is no longer active.' },
      });
      return;
    }
    try {
      const result = await this.options.executeHostCommand(message.commandId, message.input, {
        instanceId: message.instanceId,
        libraryId: instance.libraryId,
        pluginId: instance.pluginId,
        permissions: instance.permissions,
        causeChain: message.causeChain ?? [],
      });
      this.#post({
        type: 'plugin-runtime.host-result',
        instanceId: message.instanceId,
        requestId: message.requestId,
        ok: true,
        result,
      });
    } catch (error) {
      this.options.logger?.error('plugin.runtime.host-command-failed', error, {
        instanceId: message.instanceId,
        commandId: message.commandId,
      });
      this.#post({
        type: 'plugin-runtime.host-result',
        instanceId: message.instanceId,
        requestId: message.requestId,
        ok: false,
        error: { code: 'HOST_COMMAND_FAILED', message: 'The automation command could not complete.' },
      });
    }
  }

  async #respondStorage(
    message: Extract<PluginRuntimeChildMessage, { type: 'plugin-runtime.storage-request' }>,
  ): Promise<void> {
    const instance = this.#instances.get(message.instanceId);
    if (instance === undefined) {
      this.#post({
        type: 'plugin-runtime.storage-result',
        instanceId: message.instanceId,
        requestId: message.requestId,
        ok: false,
        error: { code: 'INSTANCE_GONE', message: 'The plugin instance is no longer active.' },
      });
      return;
    }
    if (this.options.executeStorage === undefined) {
      this.#post({
        type: 'plugin-runtime.storage-result',
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
            ? instance.installScope
            : 'library'
        ),
        ...(message.key === undefined ? {} : { key: message.key }),
        ...(message.value === undefined ? {} : { value: message.value }),
        context: {
          instanceId: message.instanceId,
          libraryId: instance.libraryId,
          libraryDirectory: instance.libraryDirectory,
          pluginId: instance.pluginId,
          permissions: instance.permissions,
        },
      });
      this.#post({
        type: 'plugin-runtime.storage-result',
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
      this.options.logger?.error('plugin.runtime.storage-failed', error, {
        instanceId: message.instanceId,
        operation: message.operation,
      });
      this.#post({
        type: 'plugin-runtime.storage-result',
        instanceId: message.instanceId,
        requestId: message.requestId,
        ok: false,
        error: { code, message: messageText.slice(0, 1_024) },
      });
    }
  }

  async #respondJobEnqueue(
    message: Extract<PluginRuntimeChildMessage, { type: 'plugin-runtime.job-enqueue' }>,
  ): Promise<void> {
    const instance = this.#instances.get(message.instanceId);
    if (instance === undefined) {
      this.#post({
        type: 'plugin-runtime.job-enqueue-result',
        instanceId: message.instanceId,
        requestId: message.requestId,
        ok: false,
        error: { code: 'INSTANCE_GONE', message: 'The plugin instance is no longer active.' },
      });
      return;
    }
    if (!instance.permissions.includes('job.manage')) {
      this.#post({
        type: 'plugin-runtime.job-enqueue-result',
        instanceId: message.instanceId,
        requestId: message.requestId,
        ok: false,
        error: { code: 'PERMISSION_DENIED', message: 'This plugin does not have job.manage permission.' },
      });
      return;
    }
    if (this.options.handleJobEnqueue === undefined) {
      this.#post({
        type: 'plugin-runtime.job-enqueue-result',
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
        context: {
          libraryId: instance.libraryId,
          pluginId: instance.pluginId,
          packageHash: instance.packageHash,
          permissions: instance.permissions,
        },
      });
      this.#post({
        type: 'plugin-runtime.job-enqueue-result',
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
      this.options.logger?.error('plugin.runtime.job-enqueue-failed', error, {
        instanceId: message.instanceId,
        handlerId: message.handlerId,
      });
      this.#post({
        type: 'plugin-runtime.job-enqueue-result',
        instanceId: message.instanceId,
        requestId: message.requestId,
        ok: false,
        error: { code, message: messageText.slice(0, 1_024) },
      });
    }
  }

  #respondInputCaptureStart(
    message: Extract<PluginRuntimeChildMessage, { type: 'plugin-runtime.input-capture.start' }>,
  ): void {
    const instance = this.#instances.get(message.instanceId);
    const handler = this.options.handleInputCaptureStart;
    if (instance === undefined || handler === undefined) {
      this.#post({
        type: 'plugin-runtime.input-capture.error',
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
        pluginId: instance.pluginId,
        libraryId: instance.libraryId,
        permissions: instance.permissions,
        options: message.options,
      });
      if (!result.ok) {
        this.#post({
          type: 'plugin-runtime.input-capture.error',
          instanceId: message.instanceId,
          requestId: message.requestId,
          code: result.code,
          message: result.message,
        });
        return;
      }
      this.#post({
        type: 'plugin-runtime.input-capture.started',
        instanceId: message.instanceId,
        requestId: message.requestId,
        sessionId: result.session.sessionId,
      });
    } catch (error) {
      this.#post({
        type: 'plugin-runtime.input-capture.error',
        instanceId: message.instanceId,
        requestId: message.requestId,
        code: 'CAPTURE_UNAVAILABLE',
        message: error instanceof Error ? error.message : 'Input capture failed.',
      });
    }
  }
}
