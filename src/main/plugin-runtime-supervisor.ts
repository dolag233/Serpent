import {
  pluginRuntimeChildMessageSchema,
  type PluginRuntimeChildMessage,
  type PluginRuntimeDeactivateReason,
  type PluginRuntimeParentMessage,
} from '../shared/plugin-runtime-utility-protocol';
import type { AutomationScriptCommandId } from '../shared/automation-script-api';
import type { PluginPermission } from '../plugins/plugin-manifest';

const READY_TIMEOUT_MS = 5_000;

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
  context: { instanceId: string; libraryId: string; pluginId: string; permissions: readonly PluginPermission[] },
) => Promise<unknown>;

/**
 * Main-owned long-lived Standard Plugin Host. One UtilityProcess hosts many
 * plugin instances; Main never evaluates entry JavaScript itself.
 */
export class PluginRuntimeSupervisor {
  #child: RuntimeChild | undefined;
  #ready = false;
  #readyWaiters: Array<{ resolve(): void; reject(error: Error): void }> = [];
  #readyTimer: ReturnType<typeof setTimeout> | undefined;
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
      onCrash?: (input: {
        libraryId: string;
        libraryDirectory: string;
        pluginId: string;
        packageHash: string;
        failureCode: string;
      }) => void;
      logger?: PluginRuntimeSupervisorLogger;
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

  listActiveInstanceIds(libraryId?: string): string[] {
    return [...this.#instances.entries()]
      .filter(([, instance]) => libraryId === undefined || instance.libraryId === libraryId)
      .map(([instanceId]) => instanceId);
  }

  shutdown(): void {
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
  }

  #post(message: PluginRuntimeParentMessage): void {
    this.#child?.postMessage(message);
  }

  #onExit(code: unknown): void {
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
    if (!this.#ready) return;

    if (message.type === 'plugin-runtime.host-command') {
      void this.#respondHostCommand(message);
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
}
