import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  createPluginDomainEventQueue,
  type PluginDomainEvent,
} from '../plugins/plugin-domain-events';
import {
  normalizePluginHookDecision,
  type PluginHookContext,
  type PluginHookDecision,
} from '../plugins/plugin-hooks';
import type { PluginJobComplete, PluginJobRecord } from '../plugins/plugin-jobs';
import type { PluginCommandComplete, PluginCommandContext } from '../plugins/plugin-commands';
import type {
  PluginProviderBatchResult,
  PluginProviderInvoke,
} from '../plugins/plugin-providers';
import {
  pluginSearchResultSchema,
  type PluginSearchComplete,
  type PluginSearchHandlerRequest,
  type PluginSearchResult,
} from '../plugins/plugin-search';
import {
  pluginTrustedParentMessageSchema,
  type PluginTrustedChildMessage,
  type PluginTrustedParentMessage,
} from '../shared/plugin-trusted-runtime-protocol';
import type { PluginRuntimeDeactivateReason } from '../shared/plugin-runtime-utility-protocol';
import {
  createSerpentGuestApi,
} from './serpent-guest-api';
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

type TrustedExports = {
  setup?: (context: unknown) => unknown;
  dispose?: (reason?: string) => unknown;
};

type PluginTrustedHostActiveProvider = {
  compute: (
    batch: PluginProviderInvoke['batch'],
    context: { deadlineAt: number; maxResults: number },
  ) => unknown | Promise<unknown>;
};

type PluginTrustedHostActiveSearch = (
  request: PluginSearchHandlerRequest,
  signal: AbortSignal,
) => unknown | Promise<unknown>;

type ActiveInstance = {
  instanceId: string;
  pluginId: string;
  packageHash: string;
  pendingHostRequests: Map<string, PendingHostRequest>;
  deactivateReason: PluginRuntimeDeactivateReason | undefined;
  resolvePark(): void;
  parkPromise: Promise<void>;
  activated: boolean;
  exports: TrustedExports | undefined;
  eventQueue: ReturnType<typeof createPluginDomainEventQueue>;
  hookHandlers: Map<string, (context: PluginHookContext) => PluginHookDecision | Promise<PluginHookDecision>>;
  jobHandlers: Map<string, (payload: Record<string, unknown>, job: PluginJobRecord) => unknown | Promise<unknown>>;
  providerHandlers: Map<string, {
    kind: string;
    compute: (batch: PluginProviderInvoke['batch'], context: {
      deadlineAt: number;
      maxResults: number;
    }) => unknown | Promise<unknown>;
  }>;
  searchHandlers: Map<string, PluginTrustedHostActiveSearch>;
  searchControllers: Map<string, AbortController>;
  commandHandlers: Map<string, (context: PluginCommandContext) => unknown | Promise<unknown>>;
  inputCaptureQueues: Map<string, InputCaptureQueue>;
  activeCauseChain: string[];
};

export type PluginTrustedHostHandler = {
  handle(message: unknown): void;
  dispose(): void;
};

function resolveEntryAbsolute(packageDirectory: string, entryRelativePath: string): string | undefined {
  const root = path.resolve(packageDirectory);
  const absolute = path.resolve(root, entryRelativePath);
  const relative = path.relative(root, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
  return absolute;
}

function nodeRequire(): NodeRequire {
  // UtilityProcess Forge output is CJS; unit tests may run as ESM.
  const href = import.meta.url;
  return createRequire(href.startsWith('file:') ? fileURLToPath(href) : href);
}

async function loadTrustedEntry(absoluteEntry: string): Promise<TrustedExports> {
  try {
    const imported = await import(pathToFileURL(absoluteEntry).href) as TrustedExports;
    if (typeof imported.setup === 'function') return imported;
  } catch {
    // Fall through to CJS require for CommonJS packages.
  }
  const loaded = nodeRequire()(absoluteEntry) as TrustedExports | { default?: TrustedExports };
  if (typeof (loaded as TrustedExports).setup === 'function') {
    return loaded as TrustedExports;
  }
  const nested = (loaded as { default?: TrustedExports }).default;
  if (nested !== undefined && typeof nested.setup === 'function') return nested;
  throw new Error('Trusted plugin entry must export setup().');
}

function createSerpentBridge(
  instance: ActiveInstance,
  postMessage: (message: PluginTrustedChildMessage) => void,
): Record<string, unknown> {
  const callHost = (commandId: AutomationScriptCommandId, input: unknown): Promise<unknown> => (
    new Promise((resolve, reject) => {
      const requestId = globalThis.crypto.randomUUID();
      instance.pendingHostRequests.set(requestId, { resolve, reject });
      const causeChain = instance.activeCauseChain;
      postMessage({
        type: 'plugin-trusted.host-command',
        instanceId: instance.instanceId,
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
      const requestId = globalThis.crypto.randomUUID();
      instance.pendingHostRequests.set(requestId, { resolve, reject });
      postMessage({
        type: 'plugin-trusted.storage-request',
        instanceId: instance.instanceId,
        requestId,
        operation: input.operation,
        ...(input.scope === undefined ? {} : { scope: input.scope }),
        ...(input.key === undefined ? {} : { key: input.key }),
        ...(input.value === undefined ? {} : { value: input.value }),
      });
    })
  );

  const events = {
    next: (): Promise<PluginDomainEvent | null> => instance.eventQueue.next(),
    on: (kind: unknown, handler: unknown): void => {
      if (typeof handler !== 'function') {
        throw new Error('serpent.events.on requires a handler function.');
      }
      const kindName = String(kind);
      void (async () => {
        for (;;) {
          const event = await instance.eventQueue.next();
          if (event === null) return;
          if (kindName !== '*' && event.kind !== kindName) continue;
          const previous = instance.activeCauseChain;
          instance.activeCauseChain = [...event.causeChain, event.eventId];
          try {
            await (handler as (value: PluginDomainEvent) => unknown)(event);
          } finally {
            instance.activeCauseChain = previous;
          }
        }
      })();
    },
  };

  const hooks = {
    onWill: (event: unknown, handler: unknown): void => {
      if (typeof handler !== 'function') {
        throw new Error('serpent.hooks.onWill requires a handler function.');
      }
      instance.hookHandlers.set(
        String(event),
        handler as (context: PluginHookContext) => PluginHookDecision | Promise<PluginHookDecision>,
      );
    },
  };

  const jobs = {
    registerHandler: (id: unknown, handler: unknown): void => {
      if (typeof handler !== 'function') {
        throw new Error('serpent.jobs.registerHandler requires a handler function.');
      }
      instance.jobHandlers.set(
        String(id),
        handler as (payload: Record<string, unknown>, job: PluginJobRecord) => unknown | Promise<unknown>,
      );
    },
    enqueue: (input: {
      handlerId: string;
      payload?: Record<string, unknown>;
      recoveryStrategy?: 'idempotent' | 'checkpoint';
    }): Promise<unknown> => (
      new Promise((resolve, reject) => {
        const requestId = globalThis.crypto.randomUUID();
        instance.pendingHostRequests.set(requestId, { resolve, reject });
        postMessage({
          type: 'plugin-trusted.job-enqueue',
          instanceId: instance.instanceId,
          requestId,
          handlerId: input.handlerId,
          payload: input.payload ?? {},
          ...(input.recoveryStrategy === undefined ? {} : { recoveryStrategy: input.recoveryStrategy }),
        });
      })
    ),
  };
  const providers = {
    register: (kind: unknown, provider: unknown): void => {
      if (typeof provider !== 'object' || provider === null
        || typeof (provider as { id?: unknown }).id !== 'string'
        || typeof (provider as { compute?: unknown }).compute !== 'function') {
        throw new Error('serpent.providers.register requires { id, compute }.');
      }
      const candidate = provider as {
        id: string;
        compute: PluginTrustedHostActiveProvider['compute'];
      };
      instance.providerHandlers.set(candidate.id, {
        kind: String(kind),
        compute: candidate.compute,
      });
    },
    registerSearch: (provider: unknown): void => {
      if (typeof provider !== 'object' || provider === null
        || typeof (provider as { id?: unknown }).id !== 'string'
        || typeof (provider as { search?: unknown }).search !== 'function') {
        throw new Error('serpent.providers.registerSearch requires { id, search }.');
      }
      const candidate = provider as { id: string; search: PluginTrustedHostActiveSearch };
      instance.searchHandlers.set(candidate.id, candidate.search);
    },
  };
  const commands = {
    register: (id: unknown, handler: unknown): void => {
      if (typeof handler !== 'function') {
        throw new Error('serpent.commands.register requires a handler function.');
      }
      instance.commandHandlers.set(
        String(id),
        handler as (context: PluginCommandContext) => unknown | Promise<unknown>,
      );
    },
  };
  const input = {
    capture: (options: PluginInputCaptureOptions): Promise<{
      sessionId: string;
      events: InputCaptureQueue;
      release: () => void;
    }> => new Promise((resolve, reject) => {
      const requestId = globalThis.crypto.randomUUID();
      instance.pendingHostRequests.set(requestId, {
        resolve: (value) => {
          const sessionId = (value as { sessionId: string }).sessionId;
          const queue = createInputCaptureQueue();
          instance.inputCaptureQueues.set(sessionId, queue);
          resolve({
            sessionId,
            events: queue,
            release: () => {
              postMessage({
                type: 'plugin-trusted.input-capture.release',
                instanceId: instance.instanceId,
                sessionId,
              });
            },
          });
        },
        reject,
      });
      postMessage({
        type: 'plugin-trusted.input-capture.start',
        instanceId: instance.instanceId,
        requestId,
        options,
      });
    }),
  };

  return {
    ...createSerpentGuestApi({ executeCommand: callHost }),
    storage: {
      get: (key: unknown, options?: { scope?: 'library' | 'user' }) => callStorage({
        operation: 'get',
        key: String(key),
        scope: options?.scope ?? 'library',
      }),
      set: (key: unknown, value: unknown, options?: { scope?: 'library' | 'user' }) => callStorage({
        operation: 'set',
        key: String(key),
        value,
        scope: options?.scope ?? 'library',
      }),
      delete: (key: unknown, options?: { scope?: 'library' | 'user' }) => callStorage({
        operation: 'delete',
        key: String(key),
        scope: options?.scope ?? 'library',
      }),
      listKeys: (options?: { scope?: 'library' | 'user' }) => callStorage({
        operation: 'list',
        scope: options?.scope ?? 'library',
      }),
    },
    data: {
      getDirectory: (options?: { scope?: 'library' | 'user' }) => callStorage({
        operation: 'get-directory',
        ...(options?.scope === undefined ? {} : { scope: options.scope }),
      }),
    },
    events,
    hooks,
    jobs,
    commands,
    providers,
    input,
    console: {
      log: (...args: unknown[]) => {
        postMessage({
          type: 'plugin-trusted.console',
          instanceId: instance.instanceId,
          level: 'log',
          message: args.map((value) => String(value)).join(' ').slice(0, 4_096),
        });
      },
    },
  };
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;

/**
 * Trusted plugins run with full Node in this UtilityProcess. Permissions are
 * advisory for Gateway RPC only — they do not sandbox Node itself.
 */
export function createPluginTrustedHostHandler(options: {
  postMessage(message: PluginTrustedChildMessage): void;
  heartbeatIntervalMs?: number;
}): PluginTrustedHostHandler {
  const instances = new Map<string, ActiveInstance>();
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const heartbeatTimer = setInterval(() => {
    options.postMessage({ type: 'plugin-trusted.heartbeat' });
  }, heartbeatIntervalMs);
  options.postMessage({ type: 'plugin-trusted.heartbeat' });

  const finish = (instanceId: string): void => {
    const current = instances.get(instanceId);
    if (current === undefined) return;
    instances.delete(instanceId);
    current.eventQueue.close();
    for (const controller of current.searchControllers.values()) controller.abort();
    current.searchControllers.clear();
    for (const queue of current.inputCaptureQueues.values()) queue.end();
    current.inputCaptureQueues.clear();
    for (const pending of current.pendingHostRequests.values()) {
      pending.reject(new Error('The trusted plugin instance ended.'));
    }
    current.pendingHostRequests.clear();
    current.resolvePark();
  };

  const activate = async (
    request: Extract<PluginTrustedParentMessage, { type: 'plugin-trusted.activate' }>,
  ): Promise<void> => {
    if (instances.has(request.instanceId)) {
      options.postMessage({
        type: 'plugin-trusted.activation-failed',
        instanceId: request.instanceId,
        code: 'ACTIVATE_REJECTED',
        message: 'A trusted plugin instance with this id is already active.',
      });
      return;
    }

    let resolvePark = (): void => undefined;
    const parkPromise = new Promise<void>((resolve) => {
      resolvePark = resolve;
    });
    const active: ActiveInstance = {
      instanceId: request.instanceId,
      pluginId: request.pluginId,
      packageHash: request.packageHash,
      pendingHostRequests: new Map(),
      deactivateReason: undefined,
      resolvePark,
      parkPromise,
      activated: false,
      exports: undefined,
      eventQueue: createPluginDomainEventQueue(),
      hookHandlers: new Map(),
      jobHandlers: new Map(),
      providerHandlers: new Map(),
      searchHandlers: new Map(),
      searchControllers: new Map(),
      commandHandlers: new Map(),
      inputCaptureQueues: new Map(),
      activeCauseChain: [],
    };
    instances.set(request.instanceId, active);

    try {
      const absoluteEntry = resolveEntryAbsolute(request.packageDirectory, request.entryRelativePath);
      if (absoluteEntry === undefined) {
        options.postMessage({
          type: 'plugin-trusted.activation-failed',
          instanceId: request.instanceId,
          code: 'ENTRY_INVALID',
          message: 'Trusted plugin entry path escaped its package directory.',
        });
        finish(request.instanceId);
        return;
      }

      const exported = await loadTrustedEntry(absoluteEntry);
      active.exports = exported;
      const serpent = createSerpentBridge(active, options.postMessage);
      await exported.setup?.(Object.assign({}, serpent, {
        pluginId: request.pluginId,
        pluginInstanceId: request.instanceId,
        installationScope: request.installScope,
        instanceScope: request.instanceScope,
        serpent,
      }));
      active.activated = true;
      options.postMessage({
        type: 'plugin-trusted.activated',
        instanceId: request.instanceId,
        pluginId: request.pluginId,
        packageHash: request.packageHash,
      });
      await active.parkPromise;
      try {
        await exported.dispose?.(active.deactivateReason ?? undefined);
      } catch {
        // Best-effort dispose after Main requested shutdown.
      }
      options.postMessage({
        type: 'plugin-trusted.deactivated',
        instanceId: request.instanceId,
        reason: active.deactivateReason ?? 'supervisor-shutdown',
      });
    } catch (error) {
      if (!active.activated) {
        options.postMessage({
          type: 'plugin-trusted.activation-failed',
          instanceId: request.instanceId,
          code: 'ACTIVATE_REJECTED',
          message: error instanceof Error ? error.message : 'Trusted plugin activation failed.',
        });
      }
    } finally {
      finish(request.instanceId);
    }
  };

  const deactivate = (
    request: Extract<PluginTrustedParentMessage, { type: 'plugin-trusted.deactivate' }>,
  ): void => {
    const current = instances.get(request.instanceId);
    if (current === undefined) return;
    current.deactivateReason = request.reason;
    current.eventQueue.close();
    for (const controller of current.searchControllers.values()) controller.abort();
    current.searchControllers.clear();
    for (const queue of current.inputCaptureQueues.values()) queue.end();
    for (const pending of current.pendingHostRequests.values()) {
      pending.reject(new Error('The trusted plugin instance was deactivated.'));
    }
    current.pendingHostRequests.clear();
    current.resolvePark();
  };

  return {
    handle(input: unknown): void {
      const parsed = pluginTrustedParentMessageSchema.safeParse(input);
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.type === 'plugin-trusted.activate') {
        void activate(message);
        return;
      }
      if (message.type === 'plugin-trusted.shutdown') {
        for (const instanceId of [...instances.keys()]) {
          deactivate({
            type: 'plugin-trusted.deactivate',
            instanceId,
            reason: 'supervisor-shutdown',
          });
        }
        return;
      }
      if (message.type === 'plugin-trusted.deactivate') {
        deactivate(message);
        return;
      }
      if (message.type === 'plugin-trusted.domain-event') {
        const current = instances.get(message.instanceId);
        if (current === undefined) return;
        current.eventQueue.push(message.event);
        return;
      }
      if (message.type === 'plugin-trusted.hook-invoke') {
        const current = instances.get(message.instanceId);
        if (current === undefined) return;
        void (async () => {
          const handler = current.hookHandlers.get(message.invoke.event);
          let decision: PluginHookDecision = { action: 'allow' };
          if (handler !== undefined) {
            try {
              decision = normalizePluginHookDecision(await handler(message.invoke.context));
            } catch {
              decision = { action: 'allow' };
            }
          }
          options.postMessage({
            type: 'plugin-trusted.hook-decision',
            instanceId: message.instanceId,
            invokeId: message.invoke.invokeId,
            decision,
          });
        })();
        return;
      }
      if (message.type === 'plugin-trusted.job-invoke') {
        const current = instances.get(message.instanceId);
        if (current === undefined) return;
        void (async () => {
          const handler = current.jobHandlers.get(message.job.pluginHandlerId);
          let complete: PluginJobComplete = { jobId: message.job.jobId, status: 'succeeded' };
          if (handler === undefined) {
            complete = {
              jobId: message.job.jobId,
              status: 'failed',
              errorCode: 'PLUGIN_JOB_HANDLER_MISSING',
              errorDetail: 'No handler registered for this job.',
            };
          } else {
            try {
              await handler(message.job.payload, message.job);
            } catch (error) {
              complete = {
                jobId: message.job.jobId,
                status: 'failed',
                errorCode: 'PLUGIN_JOB_HANDLER_FAILED',
                errorDetail: error instanceof Error
                  ? error.message.slice(0, 4_096)
                  : 'Job handler failed.',
              };
            }
          }
          options.postMessage({
            type: 'plugin-trusted.job-complete',
            instanceId: message.instanceId,
            jobId: complete.jobId,
            status: complete.status,
            ...(complete.errorCode === undefined ? {} : { errorCode: complete.errorCode }),
            ...(complete.errorDetail === undefined ? {} : { errorDetail: complete.errorDetail }),
            ...(complete.progress === undefined ? {} : { progress: complete.progress }),
          });
        })();
        return;
      }
      if (message.type === 'plugin-trusted.provider-invoke') {
        const current = instances.get(message.instanceId);
        if (current === undefined) return;
        void (async () => {
          const registered = current.providerHandlers.get(message.invoke.providerId);
          let result: PluginProviderBatchResult = {
            invokeId: message.invoke.invokeId,
            status: 'succeeded',
            values: [],
          };
          if (registered === undefined || registered.kind !== message.invoke.kind) {
            result = {
              ...result,
              status: 'failed',
              errorCode: 'PROVIDER_HANDLER_MISSING',
              errorDetail: 'No provider handler is registered.',
            };
          } else if (Date.now() >= message.invoke.deadlineAt) {
            result = {
              ...result,
              status: 'cancelled',
              errorCode: 'PROVIDER_DEADLINE_EXCEEDED',
              errorDetail: 'The provider deadline elapsed before invocation.',
            };
          } else {
            try {
              const values = await registered.compute(message.invoke.batch, {
                deadlineAt: message.invoke.deadlineAt,
                maxResults: message.invoke.maxResults,
              });
              result.values = Array.isArray(values) ? values.slice(0, message.invoke.maxResults) as PluginProviderBatchResult['values'] : [];
            } catch (error) {
              result = {
                ...result,
                status: 'failed',
                errorCode: 'PROVIDER_HANDLER_FAILED',
                errorDetail: error instanceof Error ? error.message.slice(0, 4_096) : 'Provider handler failed.',
              };
            }
          }
          options.postMessage({
            type: 'plugin-trusted.provider-complete',
            instanceId: message.instanceId,
            ...result,
          });
        })();
        return;
      }
      if (message.type === 'plugin-trusted.search-cancel') {
        const current = instances.get(message.instanceId);
        if (current === undefined) return;
        current.searchControllers.get(message.cancel.invokeId)?.abort();
        return;
      }
      if (message.type === 'plugin-trusted.search-request') {
        const current = instances.get(message.instanceId);
        if (current === undefined) return;
        void (async () => {
          const controller = new AbortController();
          current.searchControllers.set(message.request.invokeId, controller);
          let status: PluginSearchComplete['status'] = 'succeeded';
          let errorCode: string | undefined;
          let errorDetail: string | undefined;
          let sent = 0;
          const emit = async (value: unknown): Promise<void> => {
            if (controller.signal.aborted || Date.now() >= message.request.deadlineAt) {
              status = 'cancelled';
              errorCode = controller.signal.aborted ? 'PROVIDER_CANCELLED' : 'PROVIDER_DEADLINE_EXCEEDED';
              return;
            }
            const values = (Array.isArray(value) ? value : [value])
              .map((item) => pluginSearchResultSchema.safeParse(item))
              .filter((item): item is { success: true; data: PluginSearchResult } => item.success)
              .map((item) => item.data)
              .slice(0, Math.max(0, message.request.maxResults - sent));
            for (let offset = 0; offset < values.length; offset += 64) {
              options.postMessage({
                type: 'plugin-trusted.search-chunk',
                instanceId: message.instanceId,
                invokeId: message.request.invokeId,
                items: values.slice(offset, offset + 64),
              });
            }
            sent += values.length;
          };
          try {
            const handler = current.searchHandlers.get(message.request.providerId);
            if (handler === undefined) {
              status = 'failed';
              errorCode = 'PROVIDER_HANDLER_MISSING';
              errorDetail = 'No search provider handler is registered.';
            } else if (Date.now() >= message.request.deadlineAt) {
              status = 'cancelled';
              errorCode = 'PROVIDER_DEADLINE_EXCEEDED';
              errorDetail = 'The provider deadline elapsed before invocation.';
            } else {
              const output = await handler(message.request, controller.signal);
              if (output !== null && typeof output === 'object'
                && typeof (output as { next?: unknown }).next === 'function') {
                const iterator = output as { next(): Promise<{ done?: boolean; value?: unknown }> };
                while (!controller.signal.aborted && sent < message.request.maxResults) {
                  const step = await iterator.next();
                  if (step.done) break;
                  await emit(step.value);
                }
              } else {
                await emit(output);
              }
              if (controller.signal.aborted && status === 'succeeded') {
                status = 'cancelled';
                errorCode = 'PROVIDER_CANCELLED';
              }
            }
          } catch (error) {
            status = controller.signal.aborted ? 'cancelled' : 'failed';
            errorCode = controller.signal.aborted ? 'PROVIDER_CANCELLED' : 'PROVIDER_HANDLER_FAILED';
            errorDetail = error instanceof Error ? error.message.slice(0, 4_096) : 'Search provider failed.';
          } finally {
            current.searchControllers.delete(message.request.invokeId);
            options.postMessage({
              type: 'plugin-trusted.search-complete',
              instanceId: message.instanceId,
              invokeId: message.request.invokeId,
              status,
              nextOffset: message.request.offset + sent,
              ...(errorCode === undefined ? {} : { errorCode }),
              ...(errorDetail === undefined ? {} : { errorDetail }),
            });
          }
        })();
        return;
      }
      if (message.type === 'plugin-trusted.command-invoke') {
        const current = instances.get(message.instanceId);
        if (current === undefined) return;
        void (async () => {
          const handler = current.commandHandlers.get(message.invoke.commandId);
          let complete: PluginCommandComplete = {
            invokeId: message.invoke.invokeId,
            status: 'succeeded',
          };
          if (handler === undefined) {
            complete = {
              invokeId: message.invoke.invokeId,
              status: 'failed',
              errorCode: 'PLUGIN_COMMAND_HANDLER_MISSING',
              errorDetail: 'No handler registered for this command.',
            };
          } else {
            try {
              await handler(message.invoke.context);
            } catch (error) {
              complete = {
                invokeId: message.invoke.invokeId,
                status: 'failed',
                errorCode: 'PLUGIN_COMMAND_HANDLER_FAILED',
                errorDetail: error instanceof Error
                  ? error.message.slice(0, 4_096)
                  : 'Command handler failed.',
              };
            }
          }
          options.postMessage({
            type: 'plugin-trusted.command-complete',
            instanceId: message.instanceId,
            invokeId: complete.invokeId,
            status: complete.status,
            ...(complete.errorCode === undefined ? {} : { errorCode: complete.errorCode }),
            ...(complete.errorDetail === undefined ? {} : { errorDetail: complete.errorDetail }),
          });
        })();
        return;
      }
      if (message.type === 'plugin-trusted.input-capture.started') {
        const current = instances.get(message.instanceId);
        if (current === undefined) return;
        const pending = current.pendingHostRequests.get(message.requestId);
        if (pending === undefined) return;
        current.pendingHostRequests.delete(message.requestId);
        pending.resolve({ sessionId: message.sessionId });
        return;
      }
      if (message.type === 'plugin-trusted.input-capture.event') {
        const current = instances.get(message.instanceId);
        if (current === undefined) return;
        const queue = current.inputCaptureQueues.get(message.sessionId) ?? createInputCaptureQueue();
        current.inputCaptureQueues.set(message.sessionId, queue);
        queue.push(message.event);
        return;
      }
      if (message.type === 'plugin-trusted.input-capture.end') {
        const current = instances.get(message.instanceId);
        if (current === undefined) return;
        current.inputCaptureQueues.get(message.sessionId)?.end();
        return;
      }
      if (message.type === 'plugin-trusted.input-capture.error') {
        const current = instances.get(message.instanceId);
        if (current === undefined) return;
        const pending = current.pendingHostRequests.get(message.requestId);
        if (pending === undefined) return;
        current.pendingHostRequests.delete(message.requestId);
        pending.reject(new Error(`${message.code}: ${message.message}`));
        return;
      }
      if (message.type === 'plugin-trusted.host-result'
        || message.type === 'plugin-trusted.storage-result'
        || message.type === 'plugin-trusted.job-enqueue-result') {
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
          type: 'plugin-trusted.deactivate',
          instanceId,
          reason: 'supervisor-shutdown',
        });
      }
    },
  };
}
