import { runPluginGuestActivate } from './plugin-guest-realm';
import {
  createPluginDomainEventQueue,
} from '../plugins/plugin-domain-events';
import {
  createPluginHookInvokeQueue,
  normalizePluginHookDecision,
  type PluginHookDecision,
} from '../plugins/plugin-hooks';
import {
  createPluginJobInvokeQueue,
  type PluginJobComplete,
} from '../plugins/plugin-jobs';
import {
  createPluginProviderInvokeQueue,
  type PluginProviderBatchResult,
} from '../plugins/plugin-providers';
import {
  createPluginSearchEventQueue,
  type PluginSearchChunk,
  type PluginSearchComplete,
  type PluginSearchEvent,
} from '../plugins/plugin-search';
import {
  createPluginCommandInvokeQueue,
  type PluginCommandComplete,
} from '../plugins/plugin-commands';
import {
  pluginRuntimeParentMessageSchema,
  type PluginRuntimeActivationFailureCode,
  type PluginRuntimeChildMessage,
  type PluginRuntimeDeactivateReason,
  type PluginRuntimeParentMessage,
} from '../shared/plugin-runtime-utility-protocol';
import type { AutomationScriptCommandId } from '../shared/automation-script-api';
import type {
  PluginInputCaptureEvent,
  PluginInputCaptureOptions,
} from '../shared/plugin-input-capture';

type PendingHostRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

type InputCaptureQueue = {
  values: PluginInputCaptureEvent[];
  waiters: Array<(value: PluginInputCaptureEvent | null) => void>;
  closed: boolean;
  push(value: PluginInputCaptureEvent): void;
  end(): void;
  next(): Promise<PluginInputCaptureEvent | null>;
};

function createInputCaptureQueue(): InputCaptureQueue {
  const queue: InputCaptureQueue = {
    values: [],
    waiters: [],
    closed: false,
    push(value) {
      const waiter = queue.waiters.shift();
      if (waiter !== undefined) waiter(value);
      else if (!queue.closed) queue.values.push(value);
    },
    end() {
      if (queue.closed) return;
      queue.closed = true;
      for (const waiter of queue.waiters.splice(0)) waiter(null);
    },
    next() {
      const value = queue.values.shift();
      if (value !== undefined) return Promise.resolve(value);
      if (queue.closed) return Promise.resolve(null);
      return new Promise((resolve) => queue.waiters.push(resolve));
    },
  };
  return queue;
}

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
  eventQueue: ReturnType<typeof createPluginDomainEventQueue>;
  hookQueue: ReturnType<typeof createPluginHookInvokeQueue>;
  jobQueue: ReturnType<typeof createPluginJobInvokeQueue>;
  providerQueue: ReturnType<typeof createPluginProviderInvokeQueue>;
  searchQueue: ReturnType<typeof createPluginSearchEventQueue>;
  commandQueue: ReturnType<typeof createPluginCommandInvokeQueue>;
  inputCaptureQueues: Map<string, InputCaptureQueue>;
  activeCauseChain: string[];
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
/** Plugin sessions are long-lived; deactivate is the lifetime bound, not wall clock. */
const PLUGIN_SESSION_WALL_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1_000;

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
    current.eventQueue.close();
    current.hookQueue.close();
    current.jobQueue.close();
    current.providerQueue.close();
    current.searchQueue.close();
    for (const queue of current.inputCaptureQueues.values()) queue.end();
    current.commandQueue.close();
    for (const queue of current.inputCaptureQueues.values()) queue.end();
    current.inputCaptureQueues.clear();
    current.commandQueue.close();
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
      eventQueue: createPluginDomainEventQueue(),
      hookQueue: createPluginHookInvokeQueue(),
      jobQueue: createPluginJobInvokeQueue(),
      providerQueue: createPluginProviderInvokeQueue(),
      searchQueue: createPluginSearchEventQueue(),
      commandQueue: createPluginCommandInvokeQueue(),
      inputCaptureQueues: new Map(),
      activeCauseChain: [],
    };
    instances.set(request.instanceId, active);

    const callHost = (
      commandId: AutomationScriptCommandId,
      input: unknown,
      commandOptions?: { causeChain?: readonly string[] },
    ): Promise<unknown> => (
      new Promise((resolve, reject) => {
        const current = instances.get(request.instanceId);
        if (current === undefined || current.abortController.signal.aborted) {
          reject(new Error('The plugin instance was deactivated.'));
          return;
        }
        const requestId = globalThis.crypto.randomUUID();
        current.pendingHostRequests.set(requestId, { resolve, reject });
        const causeChain = commandOptions?.causeChain ?? current.activeCauseChain;
        options.postMessage({
          type: 'plugin-runtime.host-command',
          instanceId: request.instanceId,
          requestId,
          commandId,
          input,
          ...(causeChain.length > 0 ? { causeChain: [...causeChain] } : {}),
        });
      })
    );

    const callStorage = (input: {
      operation: 'get' | 'set' | 'delete' | 'list' | 'get-directory';
      scope?: 'library' | 'user';
      key?: string;
      value?: unknown;
    }): Promise<unknown> => (
      new Promise((resolve, reject) => {
        const current = instances.get(request.instanceId);
        if (current === undefined || current.abortController.signal.aborted) {
          reject(new Error('The plugin instance was deactivated.'));
          return;
        }
        const requestId = globalThis.crypto.randomUUID();
        current.pendingHostRequests.set(requestId, { resolve, reject });
        options.postMessage({
          type: 'plugin-runtime.storage-request',
          instanceId: request.instanceId,
          requestId,
          operation: input.operation,
          scope: input.scope ?? 'library',
          ...(input.key === undefined ? {} : { key: input.key }),
          ...(input.value === undefined ? {} : { value: input.value }),
        });
      })
    );

    const respondHookDecision = (invokeId: string, decision: PluginHookDecision): Promise<void> => {
      options.postMessage({
        type: 'plugin-runtime.hook-decision',
        instanceId: request.instanceId,
        invokeId,
        decision: normalizePluginHookDecision(decision),
      });
      return Promise.resolve();
    };

    const respondJobComplete = (jobId: string, complete: PluginJobComplete): Promise<void> => {
      options.postMessage({
        type: 'plugin-runtime.job-complete',
        instanceId: request.instanceId,
        jobId,
        status: complete.status,
        ...(complete.errorCode === undefined ? {} : { errorCode: complete.errorCode }),
        ...(complete.errorDetail === undefined ? {} : { errorDetail: complete.errorDetail }),
        ...(complete.progress === undefined ? {} : { progress: complete.progress }),
      });
      return Promise.resolve();
    };

    const respondProviderComplete = (
      invokeId: string,
      result: PluginProviderBatchResult,
    ): Promise<void> => {
      options.postMessage({
        type: 'plugin-runtime.provider-complete',
        instanceId: request.instanceId,
        invokeId,
        status: result.status,
        values: result.values,
        ...(result.errorCode === undefined ? {} : { errorCode: result.errorCode }),
        ...(result.errorDetail === undefined ? {} : { errorDetail: result.errorDetail }),
      });
      return Promise.resolve();
    };

    const respondSearchChunk = (chunk: PluginSearchChunk): Promise<void> => {
      options.postMessage({
        type: 'plugin-runtime.search-chunk',
        instanceId: request.instanceId,
        invokeId: chunk.invokeId,
        items: chunk.items,
      });
      return Promise.resolve();
    };

    const respondSearchComplete = (complete: PluginSearchComplete): Promise<void> => {
      options.postMessage({
        type: 'plugin-runtime.search-complete',
        instanceId: request.instanceId,
        invokeId: complete.invokeId,
        status: complete.status,
        ...(complete.nextOffset === undefined ? {} : { nextOffset: complete.nextOffset }),
        ...(complete.errorCode === undefined ? {} : { errorCode: complete.errorCode }),
        ...(complete.errorDetail === undefined ? {} : { errorDetail: complete.errorDetail }),
      });
      return Promise.resolve();
    };

    const respondCommandComplete = (
      invokeId: string,
      complete: PluginCommandComplete,
    ): Promise<void> => {
      options.postMessage({
        type: 'plugin-runtime.command-complete',
        instanceId: request.instanceId,
        invokeId,
        status: complete.status,
        ...(complete.errorCode === undefined ? {} : { errorCode: complete.errorCode }),
        ...(complete.errorDetail === undefined ? {} : { errorDetail: complete.errorDetail }),
      });
      return Promise.resolve();
    };

    const enqueuePluginJob = (input: {
      handlerId: string;
      payload: Record<string, unknown>;
      recoveryStrategy?: 'idempotent' | 'checkpoint';
    }): Promise<unknown> => (
      new Promise((resolve, reject) => {
        const current = instances.get(request.instanceId);
        if (current === undefined || current.abortController.signal.aborted) {
          reject(new Error('The plugin instance was deactivated.'));
          return;
        }
        const requestId = globalThis.crypto.randomUUID();
        current.pendingHostRequests.set(requestId, { resolve, reject });
        options.postMessage({
          type: 'plugin-runtime.job-enqueue',
          instanceId: request.instanceId,
          requestId,
          handlerId: input.handlerId,
          payload: input.payload,
          ...(input.recoveryStrategy === undefined ? {} : { recoveryStrategy: input.recoveryStrategy }),
        });
      })
    );

    const requestInputCapture = (input: PluginInputCaptureOptions): Promise<{ sessionId: string }> => (
      new Promise((resolve, reject) => {
        const current = instances.get(request.instanceId);
        if (current === undefined || current.abortController.signal.aborted) {
          reject(new Error('The plugin instance was deactivated.'));
          return;
        }
        const requestId = globalThis.crypto.randomUUID();
        current.pendingHostRequests.set(requestId, { resolve, reject });
        options.postMessage({
          type: 'plugin-runtime.input-capture.start',
          instanceId: request.instanceId,
          requestId,
          options: input,
        });
      })
    );

    const releaseInputCapture = (sessionId: string): void => {
      if (!instances.has(request.instanceId)) return;
      options.postMessage({
        type: 'plugin-runtime.input-capture.release',
        instanceId: request.instanceId,
        sessionId,
      });
    };

    const result = await runPluginGuestActivate({
      entryJavaScript: request.entryJavaScript,
      executeAutomationCommand: callHost,
      executeStorageOperation: callStorage,
      waitUntilDeactivate: () => active.deactivatePromise,
      waitForDomainEvent: () => active.eventQueue.next(),
      waitForHookInvoke: () => active.hookQueue.next(),
      respondHookDecision,
      waitForJobInvoke: () => active.jobQueue.next(),
      respondJobComplete,
      waitForProviderInvoke: () => active.providerQueue.next(),
      respondProviderComplete,
      waitForSearchEvent: (): Promise<PluginSearchEvent | null> => active.searchQueue.next(),
      respondSearchChunk,
      respondSearchComplete,
      enqueuePluginJob,
      waitForCommandInvoke: () => active.commandQueue.next(),
      respondCommandComplete,
      requestInputCapture,
      releaseInputCapture,
      waitForInputCaptureEvent: (sessionId) => {
        const queue = active.inputCaptureQueues.get(sessionId) ?? createInputCaptureQueue();
        active.inputCaptureQueues.set(sessionId, queue);
        return queue.next();
      },
      setActiveCauseChain: (causeChain) => {
        active.activeCauseChain = [...causeChain];
      },
      signal: abortController.signal,
      wallTimeoutMs: PLUGIN_SESSION_WALL_TIMEOUT_MS,
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
    current.eventQueue.close();
    current.hookQueue.close();
    current.jobQueue.close();
    current.providerQueue.close();
    current.searchQueue.close();
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
      if (message.type === 'plugin-runtime.domain-event') {
        const current = instances.get(message.instanceId);
        if (current === undefined) return;
        current.eventQueue.push(message.event);
        return;
      }
      if (message.type === 'plugin-runtime.hook-invoke') {
        const current = instances.get(message.instanceId);
        if (current === undefined) return;
        current.hookQueue.push(message.invoke);
        return;
      }
      if (message.type === 'plugin-runtime.job-invoke') {
        const current = instances.get(message.instanceId);
        if (current === undefined) return;
        current.jobQueue.push(message.job);
        return;
      }
      if (message.type === 'plugin-runtime.provider-invoke') {
        const current = instances.get(message.instanceId);
        if (current === undefined) return;
        current.providerQueue.push(message.invoke);
        return;
      }
      if (message.type === 'plugin-runtime.search-request') {
        const current = instances.get(message.instanceId);
        if (current === undefined) return;
        current.searchQueue.push({ type: 'request', request: message.request });
        return;
      }
      if (message.type === 'plugin-runtime.search-cancel') {
        const current = instances.get(message.instanceId);
        if (current === undefined) return;
        current.searchQueue.push({ type: 'cancel', cancel: message.cancel });
        return;
      }
      if (message.type === 'plugin-runtime.command-invoke') {
        const current = instances.get(message.instanceId);
        if (current === undefined) return;
        current.commandQueue.push(message.invoke);
        return;
      }
      if (message.type === 'plugin-runtime.input-capture.started') {
        const current = instances.get(message.instanceId);
        if (current === undefined) return;
        const pending = current.pendingHostRequests.get(message.requestId);
        if (pending === undefined) return;
        current.pendingHostRequests.delete(message.requestId);
        current.inputCaptureQueues.set(message.sessionId, createInputCaptureQueue());
        pending.resolve({ sessionId: message.sessionId });
        return;
      }
      if (message.type === 'plugin-runtime.input-capture.event') {
        const current = instances.get(message.instanceId);
        if (current === undefined) return;
        const queue = current.inputCaptureQueues.get(message.sessionId) ?? createInputCaptureQueue();
        current.inputCaptureQueues.set(message.sessionId, queue);
        queue.push(message.event);
        return;
      }
      if (message.type === 'plugin-runtime.input-capture.end') {
        const current = instances.get(message.instanceId);
        if (current === undefined) return;
        current.inputCaptureQueues.get(message.sessionId)?.end();
        return;
      }
      if (message.type === 'plugin-runtime.input-capture.error') {
        const current = instances.get(message.instanceId);
        if (current === undefined) return;
        const pending = current.pendingHostRequests.get(message.requestId);
        if (pending === undefined) return;
        current.pendingHostRequests.delete(message.requestId);
        pending.reject(new Error(`${message.code}: ${message.message}`));
        return;
      }
      if (message.type === 'plugin-runtime.host-result'
        || message.type === 'plugin-runtime.storage-result'
        || message.type === 'plugin-runtime.job-enqueue-result') {
        const current = instances.get(message.instanceId);
        if (current === undefined) return;
        const pending = current.pendingHostRequests.get(message.requestId);
        if (pending === undefined) return;
        current.pendingHostRequests.delete(message.requestId);
        if (message.ok) pending.resolve(message.result);
        else pending.reject(new Error(message.error?.message ?? 'The host request failed.'));
      }
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
