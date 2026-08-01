import {
  pluginRuntimeChildMessageSchema,
  type PluginRuntimeChildMessage,
  type PluginRuntimeDeactivateReason,
  type PluginRuntimeParentMessage,
} from '../shared/plugin-runtime-utility-protocol';
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

export interface PluginRuntimeSupervisorLogger {
  info(scope: string, message: string, context?: Record<string, unknown>): void;
  error(scope: string, error: unknown, context?: Record<string, unknown>): void;
}

export interface PluginRuntimeActivateInput {
  instanceId: string;
  libraryId: string;
  libraryDirectory: string;
  pluginId: string;
  version: string;
  packageHash: string;
  entryJavaScript: string;
  permissions: readonly PluginPermission[];
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
    libraryId: string;
    libraryDirectory: string;
    pluginId: string;
    packageHash: string;
    permissions: readonly PluginPermission[];
    activated: boolean;
  }>();

  constructor(
    private readonly options: {
      fork(modulePath: string): RuntimeChild;
      modulePath: string;
      executeHostCommand: PluginRuntimeHostCommandHandler;
      executeStorage?: PluginRuntimeStorageHandler;
      onCrash?: (input: {
        libraryId: string;
        libraryDirectory: string;
        pluginId: string;
        packageHash: string;
        failureCode: string;
      }) => void;
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
      libraryId: input.libraryId,
      libraryDirectory: input.libraryDirectory,
      pluginId: input.pluginId,
      packageHash: input.packageHash,
      permissions: input.permissions,
      activated: false,
    });
    this.#post({
      type: 'plugin-runtime.activate',
      instanceId: input.instanceId,
      libraryId: input.libraryId,
      pluginId: input.pluginId,
      version: input.version,
      packageHash: input.packageHash,
      entryJavaScript: input.entryJavaScript,
      permissions: [...input.permissions],
      activateDeadlineMs: input.activateDeadlineMs ?? 10_000,
    });
  }

  deactivate(instanceId: string, reason: PluginRuntimeDeactivateReason): void {
    if (!this.#instances.has(instanceId)) return;
    this.#post({
      type: 'plugin-runtime.deactivate',
      instanceId,
      reason,
    });
  }

  deactivateLibrary(libraryId: string, reason: PluginRuntimeDeactivateReason): void {
    for (const [instanceId, instance] of this.#instances) {
      if (instance.libraryId === libraryId) this.deactivate(instanceId, reason);
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
      if (instance.libraryId !== libraryId || !instance.activated) continue;
      this.#post({
        type: 'plugin-runtime.domain-event',
        instanceId,
        event,
      });
    }
  }

  listActiveInstanceIds(libraryId?: string): string[] {
    return [...this.#instances.entries()]
      .filter(([, instance]) => libraryId === undefined || instance.libraryId === libraryId)
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
      this.options.onCrash?.({
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
      this.options.onCrash?.({
        libraryId: instance.libraryId,
        libraryDirectory: instance.libraryDirectory,
        pluginId: instance.pluginId,
        packageHash: instance.packageHash,
        failureCode: 'RUNTIME_PROCESS_EXITED',
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
    if (message.type === 'plugin-runtime.activated') {
      const instance = this.#instances.get(message.instanceId);
      if (instance !== undefined) instance.activated = true;
      return;
    }
    if (message.type === 'plugin-runtime.activation-failed') {
      const instance = this.#instances.get(message.instanceId);
      this.#instances.delete(message.instanceId);
      if (instance !== undefined) {
        this.options.onCrash?.({
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
        scope: message.scope,
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
}
