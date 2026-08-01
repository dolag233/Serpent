import {
  pluginTrustedChildMessageSchema,
  type PluginTrustedChildMessage,
  type PluginTrustedParentMessage,
} from '../shared/plugin-trusted-runtime-protocol';
import type { PluginRuntimeDeactivateReason } from '../shared/plugin-runtime-utility-protocol';
import type { AutomationScriptCommandId } from '../shared/automation-script-api';
import type { PluginPermission } from '../plugins/plugin-manifest';

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

export interface PluginTrustedRuntimeSupervisorLogger {
  info(scope: string, message: string, context?: Record<string, unknown>): void;
  error(scope: string, error: unknown, context?: Record<string, unknown>): void;
}

export interface PluginTrustedActivateInput {
  instanceId: string;
  libraryId: string;
  libraryDirectory: string;
  pluginId: string;
  version: string;
  packageHash: string;
  packageDirectory: string;
  entryRelativePath: string;
  permissions: readonly PluginPermission[];
  activateDeadlineMs?: number;
}

export type PluginTrustedHostCommandHandler = (
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

export type PluginTrustedStorageHandler = (input: {
  operation: 'get' | 'set' | 'delete' | 'list';
  scope: 'library' | 'user';
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
  libraryId: string;
  libraryDirectory: string;
  pluginId: string;
  packageHash: string;
  permissions: readonly PluginPermission[];
  readyWaiters: Array<{ resolve(): void; reject(error: Error): void }>;
  readyTimer: ReturnType<typeof setTimeout> | undefined;
  lastHeartbeatAt: number;
  heartbeatWatch: ReturnType<typeof setInterval> | undefined;
};

/**
 * One UtilityProcess per trusted plugin instance. Crash isolation is per child;
 * permissions do not constrain Node inside the child.
 */
export class PluginTrustedRuntimeSupervisor {
  #instances = new Map<string, TrackedInstance>();
  #pendingHookDecisions = new Map<string, {
    resolve(decision: import('../plugins/plugin-hooks').PluginHookDecision): void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(
    private readonly options: {
      fork(modulePath: string): RuntimeChild;
      modulePath: string;
      executeHostCommand: PluginTrustedHostCommandHandler;
      executeStorage?: PluginTrustedStorageHandler;
      onCrash?: (input: {
        libraryId: string;
        libraryDirectory: string;
        pluginId: string;
        packageHash: string;
        failureCode: string;
      }) => void;
      logger?: PluginTrustedRuntimeSupervisorLogger;
      heartbeatTimeoutMs?: number;
      heartbeatCheckIntervalMs?: number;
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
      libraryId: input.libraryId,
      libraryDirectory: input.libraryDirectory,
      pluginId: input.pluginId,
      packageHash: input.packageHash,
      permissions: input.permissions,
      readyWaiters: [],
      readyTimer: undefined,
      lastHeartbeatAt: 0,
      heartbeatWatch: undefined,
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
    this.#post(tracked, {
      type: 'plugin-trusted.activate',
      instanceId: input.instanceId,
      libraryId: input.libraryId,
      pluginId: input.pluginId,
      version: input.version,
      packageHash: input.packageHash,
      packageDirectory: input.packageDirectory,
      entryRelativePath: input.entryRelativePath,
      permissions: [...input.permissions],
      activateDeadlineMs: input.activateDeadlineMs ?? 15_000,
    });
  }

  deactivate(instanceId: string, reason: PluginRuntimeDeactivateReason): void {
    const tracked = this.#instances.get(instanceId);
    if (tracked === undefined) return;
    try {
      tracked.child.postMessage({
        type: 'plugin-trusted.deactivate',
        instanceId,
        reason,
      } satisfies PluginTrustedParentMessage);
    } catch {
      // Child may already be gone.
    }
    tracked.child.kill();
    this.#clearTracked(instanceId);
  }

  deactivateLibrary(libraryId: string, reason: PluginRuntimeDeactivateReason): void {
    for (const [instanceId, tracked] of this.#instances) {
      if (tracked.libraryId === libraryId) this.deactivate(instanceId, reason);
    }
  }

  deliverDomainEvent(
    libraryId: string,
    event: import('../plugins/plugin-domain-events').PluginDomainEvent,
  ): void {
    for (const [instanceId, tracked] of this.#instances) {
      if (tracked.libraryId !== libraryId || !tracked.ready) continue;
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
    invoke: import('../plugins/plugin-hooks').PluginHookInvoke;
    timeoutMs: number;
  }): Promise<{
    decision: import('../plugins/plugin-hooks').PluginHookDecision;
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

  shutdown(): void {
    for (const instanceId of [...this.#instances.keys()]) {
      this.deactivate(instanceId, 'supervisor-shutdown');
    }
  }

  listActiveInstanceIds(libraryId?: string): string[] {
    return [...this.#instances.entries()]
      .filter(([, tracked]) => libraryId === undefined || tracked.libraryId === libraryId)
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
    this.options.onCrash?.({
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

  #failReady(tracked: TrackedInstance, error: Error): void {
    if (tracked.readyTimer !== undefined) clearTimeout(tracked.readyTimer);
    const waiters = tracked.readyWaiters.splice(0);
    for (const waiter of waiters) waiter.reject(error);
  }

  #markReady(tracked: TrackedInstance): void {
    tracked.ready = true;
    if (tracked.readyTimer !== undefined) clearTimeout(tracked.readyTimer);
    const waiters = tracked.readyWaiters.splice(0);
    for (const waiter of waiters) waiter.resolve();
    this.#startHeartbeatWatch(tracked);
  }

  #post(tracked: TrackedInstance, message: PluginTrustedParentMessage): void {
    tracked.child.postMessage(message);
  }

  #clearTracked(instanceId: string): void {
    const tracked = this.#instances.get(instanceId);
    if (tracked === undefined) return;
    this.#stopHeartbeatWatch(tracked);
    if (tracked.readyTimer !== undefined) clearTimeout(tracked.readyTimer);
    this.#instances.delete(instanceId);
  }

  #onExit(instanceId: string): void {
    const tracked = this.#instances.get(instanceId);
    if (tracked === undefined) return;
    this.#failReady(tracked, new Error('Trusted plugin host exited unexpectedly.'));
    this.options.onCrash?.({
      libraryId: tracked.libraryId,
      libraryDirectory: tracked.libraryDirectory,
      pluginId: tracked.pluginId,
      packageHash: tracked.packageHash,
      failureCode: 'RUNTIME_PROCESS_EXITED',
    });
    this.#clearTracked(instanceId);
  }

  #onMessage(instanceId: string, raw: unknown): void {
    const tracked = this.#instances.get(instanceId);
    if (tracked === undefined) return;
    const payload = typeof raw === 'object' && raw !== null && 'data' in raw
      ? (raw as { data: unknown }).data
      : raw;
    const parsed = pluginTrustedChildMessageSchema.safeParse(payload);
    if (!parsed.success) {
      this.options.logger?.error(
        'plugin.trusted.protocol',
        new Error('Invalid plugin-trusted child message.'),
        { instanceId },
      );
      return;
    }
    const message = parsed.data;
    if (message.type === 'plugin-trusted.ready') {
      this.#markReady(tracked);
      return;
    }
    if (message.type === 'plugin-trusted.heartbeat') {
      tracked.lastHeartbeatAt = this.#now();
      return;
    }
    if (!tracked.ready) return;
    if (message.type === 'plugin-trusted.host-command') {
      void this.#respondHostCommand(tracked, message);
      return;
    }
    if (message.type === 'plugin-trusted.storage-request') {
      void this.#respondStorage(tracked, message);
      return;
    }
    if (message.type === 'plugin-trusted.activation-failed') {
      this.options.onCrash?.({
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
      if (pending === undefined) return;
      clearTimeout(pending.timer);
      this.#pendingHookDecisions.delete(message.invokeId);
      pending.resolve(message.decision);
    }
  }

  async #respondHostCommand(
    tracked: TrackedInstance,
    message: Extract<PluginTrustedChildMessage, { type: 'plugin-trusted.host-command' }>,
  ): Promise<void> {
    try {
      const result = await this.options.executeHostCommand(message.commandId, message.input, {
        instanceId: message.instanceId,
        libraryId: tracked.libraryId,
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
        scope: message.scope,
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
}
