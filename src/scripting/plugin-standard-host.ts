import { runPluginGuestActivate } from './plugin-guest-realm';
import {
  pluginRuntimeParentMessageSchema,
  type PluginRuntimeActivationFailureCode,
  type PluginRuntimeChildMessage,
  type PluginRuntimeDeactivateReason,
  type PluginRuntimeParentMessage,
} from '../shared/plugin-runtime-utility-protocol';
import type { AutomationScriptCommandId } from '../shared/automation-script-api';

type PendingHostRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

type ActiveInstance = {
  instanceId: string;
  pluginId: string;
  packageHash: string;
  abortController: AbortController;
  pendingHostRequests: Map<string, PendingHostRequest>;
  deactivate: {
    reason: PluginRuntimeDeactivateReason;
    resolve(): void;
  } | undefined;
  deactivatePromise: Promise<void>;
  resolveDeactivatePark(): void;
  activated: boolean;
};

export type PluginStandardHostHandler = {
  handle(message: unknown): void;
  dispose(): void;
};

function mapFailureCode(code: string): PluginRuntimeActivationFailureCode {
  switch (code) {
    case 'WALL_TIMEOUT':
    case 'CANCELLED':
    case 'MEMORY_LIMIT':
    case 'OUTPUT_LIMIT':
    case 'HOST_CALL_LIMIT':
    case 'PROMISE_LIMIT':
    case 'CPU_TIMEOUT':
    case 'ENTRY_INVALID':
    case 'ACTIVATE_REJECTED':
      return code;
    default:
      return 'RUNTIME_ERROR';
  }
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;

export function createPluginStandardHostHandler(options: {
  postMessage(message: PluginRuntimeChildMessage): void;
  heartbeatIntervalMs?: number;
}): PluginStandardHostHandler {
  const instances = new Map<string, ActiveInstance>();
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const heartbeatTimer = setInterval(() => {
    options.postMessage({ type: 'plugin-runtime.heartbeat' });
  }, heartbeatIntervalMs);
  // UtilityProcess keep-alive + Main liveness signal.
  options.postMessage({ type: 'plugin-runtime.heartbeat' });

  const finishInstance = (instanceId: string): void => {
    const current = instances.get(instanceId);
    if (current === undefined) return;
    instances.delete(instanceId);
    for (const pending of current.pendingHostRequests.values()) {
      pending.reject(new Error('The plugin instance ended.'));
    }
    current.pendingHostRequests.clear();
    current.resolveDeactivatePark();
  };

  const activate = async (
    request: Extract<PluginRuntimeParentMessage, { type: 'plugin-runtime.activate' }>,
  ): Promise<void> => {
    if (instances.has(request.instanceId)) {
      options.postMessage({
        type: 'plugin-runtime.activation-failed',
        instanceId: request.instanceId,
        code: 'ACTIVATE_REJECTED',
        message: 'A plugin instance with this id is already active.',
      });
      return;
    }

    let resolveDeactivatePark = (): void => undefined;
    const deactivatePromise = new Promise<void>((resolve) => {
      resolveDeactivatePark = resolve;
    });
    const abortController = new AbortController();
    const pendingHostRequests = new Map<string, PendingHostRequest>();
    const active: ActiveInstance = {
      instanceId: request.instanceId,
      pluginId: request.pluginId,
      packageHash: request.packageHash,
      abortController,
      pendingHostRequests,
      deactivate: undefined,
      deactivatePromise,
      resolveDeactivatePark,
      activated: false,
    };
    instances.set(request.instanceId, active);

    const callHost = (commandId: AutomationScriptCommandId, input: unknown): Promise<unknown> => (
      new Promise((resolve, reject) => {
        const current = instances.get(request.instanceId);
        if (current === undefined || current.abortController.signal.aborted) {
          reject(new Error('The plugin instance was deactivated.'));
          return;
        }
        const requestId = globalThis.crypto.randomUUID();
        current.pendingHostRequests.set(requestId, { resolve, reject });
        options.postMessage({
          type: 'plugin-runtime.host-command',
          instanceId: request.instanceId,
          requestId,
          commandId,
          input,
        });
      })
    );

    const result = await runPluginGuestActivate({
      entryJavaScript: request.entryJavaScript,
      executeAutomationCommand: callHost,
      waitUntilDeactivate: () => active.deactivatePromise,
      signal: abortController.signal,
      wallTimeoutMs: Math.max(request.activateDeadlineMs, 60_000),
      onActivated: () => {
        if (active.activated) return;
        active.activated = true;
        options.postMessage({
          type: 'plugin-runtime.activated',
          instanceId: request.instanceId,
          pluginId: request.pluginId,
          packageHash: request.packageHash,
        });
      },
    });

    const current = instances.get(request.instanceId);
    if (current === undefined) return;

    if (!result.ok) {
      if (!current.activated) {
        options.postMessage({
          type: 'plugin-runtime.activation-failed',
          instanceId: request.instanceId,
          code: mapFailureCode(result.code),
          message: result.message,
        });
      }
      finishInstance(request.instanceId);
      return;
    }

    const reason = current.deactivate?.reason ?? 'supervisor-shutdown';
    options.postMessage({
      type: 'plugin-runtime.deactivated',
      instanceId: request.instanceId,
      reason,
    });
    finishInstance(request.instanceId);
  };

  const deactivate = (
    request: Extract<PluginRuntimeParentMessage, { type: 'plugin-runtime.deactivate' }>,
  ): void => {
    const current = instances.get(request.instanceId);
    if (current === undefined) return;
    current.deactivate = { reason: request.reason, resolve: current.resolveDeactivatePark };
    current.abortController.abort();
    for (const pending of current.pendingHostRequests.values()) {
      pending.reject(new Error('The plugin instance was deactivated.'));
    }
    current.pendingHostRequests.clear();
    current.resolveDeactivatePark();
  };

  return {
    handle(input: unknown): void {
      const parsed = pluginRuntimeParentMessageSchema.safeParse(input);
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.type === 'plugin-runtime.activate') {
        void activate(message);
        return;
      }
      if (message.type === 'plugin-runtime.shutdown') {
        for (const instanceId of [...instances.keys()]) {
          deactivate({
            type: 'plugin-runtime.deactivate',
            instanceId,
            reason: 'supervisor-shutdown',
          });
        }
        return;
      }
      if (message.type === 'plugin-runtime.deactivate') {
        deactivate(message);
        return;
      }
      const current = instances.get(message.instanceId);
      if (current === undefined) return;
      const pending = current.pendingHostRequests.get(message.requestId);
      if (pending === undefined) return;
      current.pendingHostRequests.delete(message.requestId);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error?.message ?? 'The host request failed.'));
    },
    dispose(): void {
      clearInterval(heartbeatTimer);
      for (const instanceId of [...instances.keys()]) {
        deactivate({
          type: 'plugin-runtime.deactivate',
          instanceId,
          reason: 'supervisor-shutdown',
        });
      }
    },
  };
}
