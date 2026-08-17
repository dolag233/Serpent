import {
  QuickJsSandboxPrototypeError,
  runQuickJsSandboxPrototype,
  type QuickJsSandboxPrototypeHost,
} from './quickjs-sandbox-prototype';
import type { AutomationScriptCommandId } from '../shared/automation-script-api';
import type { PluginDomainEvent } from '../plugins/plugin-domain-events';
import type { PluginHookDecision, PluginHookInvoke } from '../plugins/plugin-hooks';
import type { PluginJobComplete, PluginJobRecord } from '../plugins/plugin-jobs';
import type { PluginCommandComplete, PluginCommandInvoke } from '../plugins/plugin-commands';
import type { PluginJobCheckpoint } from '../plugins/plugin-jobs';
import type {
  PluginProviderBatchResult,
  PluginProviderInvoke,
} from '../plugins/plugin-providers';
import type {
  PluginSearchChunk,
  PluginSearchComplete,
  PluginSearchEvent,
} from '../plugins/plugin-search';
import type {
  PluginInputCaptureEvent,
  PluginInputCaptureOptions,
} from '../shared/plugin-input-capture';

/**
 * Standard plugin entries may use ESM `export` forms or plain function
 * declarations. The QuickJS guest realm evaluates a wrapped global script, so
 * strip export keywords while preserving setup/dispose bindings.
 */
export function normalizePluginEntryJavaScript(entryJavaScript: string): string {
  return entryJavaScript
    .replace(/\bexport\s+async\s+function\s+/gu, 'async function ')
    .replace(/\bexport\s+function\s+/gu, 'function ')
    .replace(/\bexport\s+\{[^}]+\}\s*;?/gu, '')
    .replace(/\bexport\s+default\s+/gu, '');
}

/**
 * Injects `serpent.events.on` and `serpent.hooks.onWill` as guest JS over host
 * pull bridges, so QuickJS never retains raw guest function handles across
 * Host messages.
 */
export function buildPluginSetupSource(entryJavaScript: string, context: {
  pluginId: string;
  pluginInstanceId: string;
  installationScope: 'user' | 'library';
  instanceScope: 'global' | 'library';
}): string {
  return [
    normalizePluginEntryJavaScript(entryJavaScript),
    'if (typeof setup !== "function") {',
    '  throw new Error("Plugin entry must define async function setup(context).");',
    '}',
    'if (serpent.events && typeof serpent.events.next === "function") {',
    '  serpent.events.on = function(kind, handler) {',
    '    void (async function() {',
    '      for (;;) {',
    '        const event = await serpent.events.next();',
    '        if (event === null) return;',
    '        if (kind !== "*" && event.kind !== kind) continue;',
    '        const chain = (event.causeChain || []).concat([event.eventId]);',
    '        if (typeof serpent.events.__setCause === "function") serpent.events.__setCause(chain);',
    '        try {',
    '          await handler(event);',
    '        } finally {',
    '          if (typeof serpent.events.__setCause === "function") serpent.events.__setCause([]);',
    '        }',
    '      }',
    '    })();',
    '  };',
    '}',
    'if (serpent.hooks && typeof serpent.hooks.__nextInvoke === "function") {',
    '  const __hookHandlers = Object.create(null);',
    '  serpent.hooks.onWill = function(event, handler) {',
    '    __hookHandlers[String(event)] = handler;',
    '  };',
    '  void (async function() {',
    '    for (;;) {',
    '      const invoke = await serpent.hooks.__nextInvoke();',
    '      if (invoke === null) return;',
    '      const handler = __hookHandlers[invoke.event];',
    '      let decision = { action: "allow" };',
    '      if (typeof handler === "function") {',
    '        try {',
    '          const result = await handler(invoke.context);',
    '          if (result && typeof result.action === "string") decision = result;',
    '        } catch (_error) {',
    '          decision = { action: "allow" };',
    '        }',
    '      }',
    '      await serpent.hooks.__respond(invoke.invokeId, decision);',
    '    }',
    '  })();',
    '}',
    'if (serpent.jobs && typeof serpent.jobs.__nextJob === "function") {',
    '  const __jobHandlers = Object.create(null);',
    '  serpent.jobs.registerHandler = function(id, handler) {',
    '    __jobHandlers[String(id)] = handler;',
    '  };',
    '  serpent.jobs.enqueue = function(input) {',
    '    const request = input && typeof input === "object" ? input : {};',
    '    return serpent.jobs.__enqueue({',
    '      handlerId: String(request.handlerId ?? ""),',
    '      payload: request.payload ?? {},',
    '      recoveryStrategy: request.recoveryStrategy,',
    '    });',
    '  };',
    '  serpent.jobs.reportProgress = function(input) {',
    '    const request = input && typeof input === "object" ? input : {};',
    '    const completedValue = Number(request.completed);',
    '    const totalValue = Number(request.total);',
    '    const progressValue = Number(request.progress);',
    '    const completed = Number.isFinite(completedValue) ? Math.max(0, completedValue) : 0;',
    '    const total = Number.isFinite(totalValue) ? Math.max(completed, totalValue) : completed;',
    '    const progress = Number.isFinite(progressValue) ? Math.min(1, Math.max(0, progressValue)) : (total > 0 ? Math.min(1, completed / total) : 0);',
    '    return serpent.jobs.__reportProgress({',
    '      jobId: String(request.jobId ?? ""),',
    '      completed,',
    '      total,',
    '      progress,',
    '      ...(typeof request.phase === "string" ? { phase: request.phase.slice(0, 128) } : {}),',
    '      ...(typeof request.message === "string" ? { message: request.message.slice(0, 4096) } : {}),',
    '    });',
    '  };',
    '  serpent.jobs.cancel = function(input) { return serpent.jobs.__control({ ...(input || {}), action: "cancel" }); };',
    '  serpent.jobs.pause = function(input) { return serpent.jobs.__control({ ...(input || {}), action: "pause" }); };',
    '  serpent.jobs.resume = function(input) { return serpent.jobs.__control({ ...(input || {}), action: "resume" }); };',
    '  serpent.jobs.retry = function(input) { return serpent.jobs.__control({ ...(input || {}), action: "retry" }); };',
    '  const __jobSignal = function(jobId) {',
    '    const signal = {};',
    '    Object.defineProperty(signal, "aborted", { enumerable: true, get: function() { return serpent.jobs.__isAborted(String(jobId)); } });',
    '    signal.throwIfAborted = function() { if (signal.aborted) { const error = new Error("The plugin job was cancelled."); error.name = "AbortError"; throw error; } };',
    '    return signal;',
    '  };',
    '  void (async function() {',
    '    for (;;) {',
    '      const job = await serpent.jobs.__nextJob();',
    '      if (job === null) return;',
    '      const handler = __jobHandlers[job.pluginHandlerId];',
    '      let status = "succeeded";',
    '      let errorCode;',
    '      let errorDetail;',
    '      if (typeof handler !== "function") {',
    '        status = "failed";',
    '        errorCode = "PLUGIN_JOB_HANDLER_MISSING";',
    '        errorDetail = "No handler registered for this job.";',
    '      } else {',
    '        try {',
      '          job.signal = __jobSignal(job.jobId);',
      '          await handler(job.payload, job, job.signal);',
      '          job.signal.throwIfAborted();',
    '        } catch (error) {',
    '          if (job.signal && job.signal.aborted) {',
    '            status = "cancelled";',
    '            errorCode = "PLUGIN_JOB_CANCELLED";',
    '            errorDetail = "The plugin job was cancelled.";',
    '          } else {',
    '            status = "failed";',
    '            errorCode = "PLUGIN_JOB_HANDLER_FAILED";',
    '            errorDetail = error && error.message ? String(error.message).slice(0, 4096) : "Job handler failed.";',
    '          }',
    '        }',
    '      }',
    '      await serpent.jobs.__respond(job.jobId, {',
    '        status,',
    '        ...(errorCode ? { errorCode } : {}),',
    '        ...(errorDetail ? { errorDetail } : {}),',
    '      });',
    '    }',
    '  })();',
    '}',
    'if (serpent.providers && typeof serpent.providers.__nextInvoke === "function") {',
    '  const __providerHandlers = Object.create(null);',
    '  serpent.providers.register = function(kind, provider) {',
    '    if (!provider || typeof provider.compute !== "function") throw new Error("Provider requires compute(batch).");',
    '    __providerHandlers[String(provider.id)] = { kind: String(kind), compute: provider.compute };',
    '  };',
    '  void (async function() {',
    '    for (;;) {',
    '      const invoke = await serpent.providers.__nextInvoke();',
    '      if (invoke === null) return;',
    '      const registered = __providerHandlers[String(invoke.providerId)];',
    '      let result = { invokeId: invoke.invokeId, status: "succeeded", values: [] };',
    '      if (!registered || registered.kind !== invoke.kind) {',
    '        result = { invokeId: invoke.invokeId, status: "failed", values: [], errorCode: "PROVIDER_HANDLER_MISSING", errorDetail: "No provider handler is registered." };',
    '      } else if (Date.now() >= invoke.deadlineAt) {',
    '        result = { invokeId: invoke.invokeId, status: "cancelled", values: [], errorCode: "PROVIDER_DEADLINE_EXCEEDED", errorDetail: "The provider deadline elapsed before invocation." };',
    '      } else {',
    '        try {',
    '          const values = await registered.compute(invoke.batch, { deadlineAt: invoke.deadlineAt, maxResults: invoke.maxResults });',
    '          result.values = Array.isArray(values) ? values.slice(0, invoke.maxResults) : [];',
    '        } catch (error) {',
    '          result = { invokeId: invoke.invokeId, status: "failed", values: [], errorCode: "PROVIDER_HANDLER_FAILED", errorDetail: error && error.message ? String(error.message).slice(0, 4096) : "Provider handler failed." };',
    '        }',
    '      }',
    '      await serpent.providers.__respond(invoke.invokeId, result);',
    '    }',
    '  })();',
    '}',
    'if (serpent.providers && typeof serpent.providers.__nextSearchEvent === "function") {',
    '  const __searchHandlers = Object.create(null);',
    '  const __searchSignals = Object.create(null);',
    '  serpent.providers.registerSearch = function(provider) {',
    '    if (!provider || typeof provider.search !== "function") throw new Error("Search provider requires search(request, signal).");',
    '    __searchHandlers[String(provider.id)] = provider.search;',
    '  };',
    '  const __searchChunk = async function(invokeId, items) {',
    '    const values = Array.isArray(items) ? items : [items];',
    '    for (let offset = 0; offset < values.length; offset += 64) {',
    '      await serpent.providers.__respondSearchChunk({',
    '        invokeId,',
    '        items: values.slice(offset, offset + 64),',
    '      });',
    '    }',
    '  };',
    '  const __searchSignal = function(invokeId) {',
    '    let aborted = false;',
    '    const listeners = [];',
    '    return {',
    '      get aborted() { return aborted; },',
    '      addEventListener: function(type, listener) {',
    '        if (type === "abort" && typeof listener === "function") listeners.push(listener);',
    '      },',
    '      removeEventListener: function(type, listener) {',
    '        if (type !== "abort") return;',
    '        const index = listeners.indexOf(listener);',
    '        if (index >= 0) listeners.splice(index, 1);',
    '      },',
    '      __abort: function() {',
    '        if (aborted) return;',
    '        aborted = true;',
    '        listeners.slice().forEach(function(listener) { try { listener(); } catch (_error) {} });',
    '      },',
    '      __invokeId: invokeId,',
    '    };',
    '  };',
    '  const __runSearch = async function(request) {',
    '    const search = __searchHandlers[String(request.providerId)];',
    '    const signal = __searchSignal(request.invokeId);',
    '    __searchSignals[String(request.invokeId)] = signal;',
    '    let status = "succeeded";',
    '    let errorCode;',
    '    let errorDetail;',
    '    let sent = 0;',
    '    try {',
    '      if (typeof search !== "function") {',
    '        status = "failed";',
    '        errorCode = "PROVIDER_HANDLER_MISSING";',
    '        errorDetail = "No search provider handler is registered.";',
    '      } else if (Date.now() >= request.deadlineAt) {',
    '        status = "cancelled";',
    '        errorCode = "PROVIDER_DEADLINE_EXCEEDED";',
    '        errorDetail = "The provider deadline elapsed before invocation.";',
    '      } else {',
    '        const output = await search(request, signal);',
    '        const emit = async function(value) {',
    '          if (signal.aborted || Date.now() >= request.deadlineAt) { status = "cancelled"; errorCode = "PROVIDER_DEADLINE_EXCEEDED"; return; }',
    '          const values = Array.isArray(value) ? value : [value];',
    '          const bounded = values.slice(0, Math.max(0, request.maxResults - sent));',
    '          if (bounded.length === 0) return;',
    '          await __searchChunk(request.invokeId, bounded);',
    '          sent += bounded.length;',
    '        };',
    '        if (output && typeof output.next === "function") {',
    '          for (;;) {',
    '            if (signal.aborted || sent >= request.maxResults) break;',
    '            const step = await output.next();',
    '            if (!step || step.done) break;',
    '            await emit(step.value);',
    '          }',
    '        } else {',
    '          await emit(output);',
    '        }',
    '        if (signal.aborted && status === "succeeded") { status = "cancelled"; errorCode = "PROVIDER_CANCELLED"; }',
    '      }',
    '    } catch (error) {',
    '      status = signal.aborted ? "cancelled" : "failed";',
    '      errorCode = signal.aborted ? "PROVIDER_CANCELLED" : "PROVIDER_HANDLER_FAILED";',
    '      errorDetail = error && error.message ? String(error.message).slice(0, 4096) : "Search provider failed.";',
    '    } finally {',
    '      delete __searchSignals[String(request.invokeId)];',
    '      await serpent.providers.__respondSearchComplete({',
    '        invokeId: request.invokeId,',
    '        status,',
    '        nextOffset: request.offset + sent,',
    '        ...(errorCode ? { errorCode } : {}),',
    '        ...(errorDetail ? { errorDetail } : {}),',
    '      });',
    '    }',
    '  };',
    '  void (async function() {',
    '    for (;;) {',
    '      const event = await serpent.providers.__nextSearchEvent();',
    '      if (event === null) return;',
    '      if (event.type === "cancel") {',
    '        __searchSignals[String(event.cancel.invokeId)]?.__abort();',
    '      } else {',
    '        void __runSearch(event.request);',
    '      }',
    '    }',
    '  })();',
    '}',
    'if (serpent.commands && typeof serpent.commands.__nextCommand === "function") {',
    '  const __commandHandlers = Object.create(null);',
    '  serpent.commands.register = function(id, handler) {',
    '    __commandHandlers[String(id)] = handler;',
    '  };',
    '  void (async function() {',
    '    for (;;) {',
    '      const invoke = await serpent.commands.__nextCommand();',
    '      if (invoke === null) return;',
    '      const handler = __commandHandlers[invoke.commandId];',
    '      let status = "succeeded";',
    '      let errorCode;',
    '      let errorDetail;',
    '      if (typeof handler !== "function") {',
    '        status = "failed";',
    '        errorCode = "PLUGIN_COMMAND_HANDLER_MISSING";',
    '        errorDetail = "No handler registered for this command.";',
    '      } else {',
    '        try {',
    '          await handler(invoke.context);',
    '        } catch (error) {',
    '          status = "failed";',
    '          errorCode = "PLUGIN_COMMAND_HANDLER_FAILED";',
    '          errorDetail = error && error.message ? String(error.message).slice(0, 4096) : "Command handler failed.";',
    '        }',
    '      }',
    '      await serpent.commands.__respond(invoke.invokeId, {',
    '        status,',
    '        ...(errorCode ? { errorCode } : {}),',
    '        ...(errorDetail ? { errorDetail } : {}),',
    '      });',
    '    }',
    '  })();',
    '}',
    'if (serpent.input && typeof serpent.input.__start === "function") {',
    '  serpent.input.capture = function(options) {',
    '    return serpent.input.__start(options || {}).then(function(session) {',
    '      const events = {',
    '        next: function() { return serpent.input.__nextEvent(session.sessionId); },',
    '      };',
    '      if (typeof Symbol === "function" && Symbol.asyncIterator) {',
    '        events[Symbol.asyncIterator] = function() { return events; };',
    '      }',
    '      return {',
    '        sessionId: session.sessionId,',
    '        events: events,',
    '        release: function() { return serpent.input.__release(session.sessionId); },',
    '      };',
    '    });',
    '  };',
    '}',
    'const __pluginSubscriptions = [];',
    'const __disposePluginSubscriptions = function() {',
    '  for (let index = __pluginSubscriptions.length - 1; index >= 0; index -= 1) {',
    '    const value = __pluginSubscriptions[index];',
    '    try { if (typeof value === "function") value(); else if (value && typeof value.dispose === "function") value.dispose(); } catch (_error) {}',
    '  }',
    '  __pluginSubscriptions.length = 0;',
    '};',
    'const subscriptions = {',
    '  add: function(value) { if (value !== null && value !== undefined) __pluginSubscriptions.push(value); return value; },',
    '  dispose: __disposePluginSubscriptions,',
    '};',
    'const signal = {};',
    'Object.defineProperty(signal, "aborted", { enumerable: true, get: function() { return typeof serpent.__isDeactivated === "function" && serpent.__isDeactivated(); } });',
    'signal.addEventListener = function(type, listener) {',
    '  if (type !== "abort" || typeof listener !== "function" || typeof serpent.__waitUntilDeactivate !== "function") return;',
    '  void serpent.__waitUntilDeactivate().then(function() { try { listener({ type: "abort", target: signal }); } catch (_error) {} });',
    '};',
    'signal.removeEventListener = function() {};',
    'signal.throwIfAborted = function() { if (signal.aborted) { const error = new Error("The plugin instance was deactivated."); error.name = "AbortError"; throw error; } };',
    'try {',
    `  await setup(Object.assign({}, serpent, { pluginId: ${JSON.stringify(context.pluginId)}, pluginInstanceId: ${JSON.stringify(context.pluginInstanceId)}, installationScope: ${JSON.stringify(context.installationScope)}, instanceScope: { kind: ${JSON.stringify(context.instanceScope)} }, subscriptions: subscriptions, signal: signal, serpent: serpent }));`,
    '  if (typeof serpent.__waitUntilDeactivate === "function") {',
    '    await serpent.__waitUntilDeactivate();',
    '  }',
    '  if (typeof dispose === "function") {',
    '    await dispose(typeof serpent.__getDeactivateReason === "function" ? serpent.__getDeactivateReason() : undefined);',
    '  }',
    '} finally {',
    '  __disposePluginSubscriptions();',
    '}',
    'return { ok: true };',
  ].join('\n');
}

export type PluginGuestActivateResult =
  | { ok: true; output: string[] }
  | {
    ok: false;
    code: QuickJsSandboxPrototypeError['code'] | 'ENTRY_INVALID' | 'ACTIVATE_REJECTED';
    message: string;
  };

export async function runPluginGuestActivate(input: {
  entryJavaScript: string;
  setupContext?: {
    pluginId: string;
    pluginInstanceId: string;
    installationScope: 'user' | 'library';
    instanceScope: 'global' | 'library';
  };
  executeAutomationCommand: (
    commandId: AutomationScriptCommandId,
    commandInput: unknown,
    options?: {
      causeChain?: readonly string[];
      targetLibraryId?: string;
    },
  ) => Promise<unknown>;
  executeStorageOperation?: (input: {
    operation: 'get' | 'set' | 'delete' | 'list';
    scope?: 'library' | 'user';
    key?: string;
    value?: unknown;
  }) => Promise<unknown>;
  waitUntilDeactivate: () => Promise<void>;
  getDeactivateReason?: () => string | undefined;
  waitForDomainEvent?: () => Promise<PluginDomainEvent | null>;
  waitForHookInvoke?: () => Promise<PluginHookInvoke | null>;
  respondHookDecision?: (invokeId: string, decision: PluginHookDecision) => Promise<void>;
  waitForJobInvoke?: () => Promise<PluginJobRecord | null>;
  respondJobComplete?: (jobId: string, complete: PluginJobComplete) => Promise<void>;
  waitForProviderInvoke?: () => Promise<PluginProviderInvoke | null>;
  respondProviderComplete?: (
    invokeId: string,
    result: PluginProviderBatchResult,
  ) => Promise<void>;
  waitForSearchEvent?: () => Promise<PluginSearchEvent | null>;
  respondSearchChunk?: (chunk: PluginSearchChunk) => Promise<void>;
  respondSearchComplete?: (complete: PluginSearchComplete) => Promise<void>;
  waitForCommandInvoke?: () => Promise<PluginCommandInvoke | null>;
  respondCommandComplete?: (invokeId: string, complete: PluginCommandComplete) => Promise<void>;
  requestInputCapture?: (
    input: PluginInputCaptureOptions,
  ) => Promise<{ sessionId: string }>;
  releaseInputCapture?: (sessionId: string) => void;
  waitForInputCaptureEvent?: (
    sessionId: string,
  ) => Promise<PluginInputCaptureEvent | null>;
  enqueuePluginJob?: (input: {
    handlerId: string;
    payload: Record<string, unknown>;
    recoveryStrategy?: 'idempotent' | 'checkpoint';
    targetLibraryId?: string;
  }) => Promise<unknown>;
  reportJobProgress?: (input: {
    jobId: string;
    completed: number;
    total: number;
    phase?: string;
    message?: string;
    progress?: number;
    targetLibraryId?: string;
  }) => Promise<void>;
  controlPluginJob?: (input: {
    jobId: string;
    action: 'pause' | 'resume' | 'cancel' | 'retry';
    reason?: string;
    retryInput?: Record<string, unknown>;
    checkpoint?: PluginJobCheckpoint;
    targetLibraryId?: string;
  }) => Promise<unknown>;
  isJobAborted?: (jobId: string) => boolean;
  setActiveCauseChain?: (causeChain: readonly string[]) => void;
  signal?: AbortSignal;
  /** Lifecycle signal exposed to setup/dispose; kept separate from engine abort. */
  setupSignal?: AbortSignal;
  wallTimeoutMs?: number;
  /** Test/host overrides for QuickJS resource limits. */
  sandboxLimits?: Partial<{
    cpuTimeoutMs: number;
    memoryLimitBytes: number;
    maxOutputBytes: number;
    maxPendingHostCalls: number;
  }>;
  onActivated?: () => void;
}): Promise<PluginGuestActivateResult> {
  if (input.entryJavaScript.trim().length === 0) {
    return { ok: false, code: 'ENTRY_INVALID', message: 'Plugin entry JavaScript is empty.' };
  }

  let activatedNotified = false;
  const host: QuickJsSandboxPrototypeHost = {
    executeAutomationCommand: input.executeAutomationCommand,
    ...(input.setupSignal === undefined && input.signal === undefined
      ? {}
      : { signal: input.setupSignal ?? input.signal }),
    ...(input.executeStorageOperation === undefined
      ? {}
      : { executeStorageOperation: input.executeStorageOperation }),
    waitUntilDeactivate: async () => {
      if (!activatedNotified) {
        activatedNotified = true;
        input.onActivated?.();
      }
      await input.waitUntilDeactivate();
    },
    ...(input.getDeactivateReason === undefined
      ? {}
      : { getDeactivateReason: input.getDeactivateReason }),
    ...(input.waitForDomainEvent === undefined
      ? {}
      : { waitForDomainEvent: input.waitForDomainEvent }),
    ...(input.waitForHookInvoke === undefined
      ? {}
      : { waitForHookInvoke: input.waitForHookInvoke }),
    ...(input.respondHookDecision === undefined
      ? {}
      : { respondHookDecision: input.respondHookDecision }),
    ...(input.waitForJobInvoke === undefined
      ? {}
      : { waitForJobInvoke: input.waitForJobInvoke }),
    ...(input.respondJobComplete === undefined
      ? {}
      : { respondJobComplete: input.respondJobComplete }),
    ...(input.waitForProviderInvoke === undefined
      ? {}
      : { waitForProviderInvoke: input.waitForProviderInvoke }),
    ...(input.respondProviderComplete === undefined
      ? {}
      : { respondProviderComplete: input.respondProviderComplete }),
    ...(input.waitForSearchEvent === undefined
      ? {}
      : { waitForSearchEvent: input.waitForSearchEvent }),
    ...(input.respondSearchChunk === undefined
      ? {}
      : { respondSearchChunk: input.respondSearchChunk }),
    ...(input.respondSearchComplete === undefined
      ? {}
      : { respondSearchComplete: input.respondSearchComplete }),
    ...(input.enqueuePluginJob === undefined
      ? {}
      : { enqueuePluginJob: input.enqueuePluginJob }),
    ...(input.reportJobProgress === undefined
      ? {}
      : { reportJobProgress: input.reportJobProgress }),
    ...(input.controlPluginJob === undefined
      ? {}
      : { controlPluginJob: input.controlPluginJob }),
    ...(input.isJobAborted === undefined
      ? {}
      : { isJobAborted: input.isJobAborted }),
    ...(input.waitForCommandInvoke === undefined
      ? {}
      : { waitForCommandInvoke: input.waitForCommandInvoke }),
    ...(input.respondCommandComplete === undefined
      ? {}
      : { respondCommandComplete: input.respondCommandComplete }),
    ...(input.requestInputCapture === undefined
      ? {}
      : { requestInputCapture: input.requestInputCapture }),
    ...(input.releaseInputCapture === undefined
      ? {}
      : { releaseInputCapture: input.releaseInputCapture }),
    ...(input.waitForInputCaptureEvent === undefined
      ? {}
      : { waitForInputCaptureEvent: input.waitForInputCaptureEvent }),
    ...(input.setActiveCauseChain === undefined
      ? {}
      : { setActiveCauseChain: input.setActiveCauseChain }),
  };

  try {
    const result = await runQuickJsSandboxPrototype(
      buildPluginSetupSource(input.entryJavaScript, input.setupContext ?? {
        pluginId: 'unknown',
        pluginInstanceId: 'unknown',
        installationScope: 'library',
        instanceScope: 'library',
      }),
      host,
      {
        signal: input.signal,
        ...(input.wallTimeoutMs === undefined ? {} : { wallTimeoutMs: input.wallTimeoutMs }),
        ...(input.sandboxLimits ?? {}),
        // Plugin entries are already compiled; skip TS transpile cost by keeping
        // the source JS-compatible. The prototype still runs transpile which is
        // a no-op for plain JS.
        maxSourceBytes: 512 * 1024,
      },
    );
    if (!activatedNotified) {
      // setup() returned without parking: treat as successful short-lived plugin.
      input.onActivated?.();
    }
    return { ok: true, output: result.output };
  } catch (error) {
    if (error instanceof QuickJsSandboxPrototypeError) {
      return { ok: false, code: error.code, message: error.message };
    }
    return {
      ok: false,
      code: 'ACTIVATE_REJECTED',
      message: error instanceof Error ? error.message : 'Plugin activation failed.',
    };
  }
}
