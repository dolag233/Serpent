import {
  QuickJsSandboxPrototypeError,
  runQuickJsSandboxPrototype,
  type QuickJsSandboxPrototypeHost,
} from './quickjs-sandbox-prototype';
import type { AutomationScriptCommandId } from '../shared/automation-script-api';
import type { PluginDomainEvent } from '../plugins/plugin-domain-events';
import type { PluginHookDecision, PluginHookInvoke } from '../plugins/plugin-hooks';

/**
 * Standard plugin entries may use ESM `export` forms or plain function
 * declarations. The QuickJS guest realm evaluates a wrapped global script, so
 * strip export keywords while preserving activate/deactivate bindings.
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
export function buildPluginActivateSource(entryJavaScript: string): string {
  return [
    normalizePluginEntryJavaScript(entryJavaScript),
    'if (typeof activate !== "function") {',
    '  throw new Error("Plugin entry must define async function activate(serpent).");',
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
    'await activate(serpent);',
    'if (typeof serpent.__waitUntilDeactivate === "function") {',
    '  await serpent.__waitUntilDeactivate();',
    '}',
    'if (typeof deactivate === "function") {',
    '  await deactivate();',
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
  executeAutomationCommand: (
    commandId: AutomationScriptCommandId,
    commandInput: unknown,
    options?: { causeChain?: readonly string[] },
  ) => Promise<unknown>;
  executeStorageOperation?: (input: {
    operation: 'get' | 'set' | 'delete' | 'list';
    scope?: 'library' | 'user';
    key?: string;
    value?: unknown;
  }) => Promise<unknown>;
  waitUntilDeactivate: () => Promise<void>;
  waitForDomainEvent?: () => Promise<PluginDomainEvent | null>;
  waitForHookInvoke?: () => Promise<PluginHookInvoke | null>;
  respondHookDecision?: (invokeId: string, decision: PluginHookDecision) => Promise<void>;
  setActiveCauseChain?: (causeChain: readonly string[]) => void;
  signal?: AbortSignal;
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
    ...(input.waitForDomainEvent === undefined
      ? {}
      : { waitForDomainEvent: input.waitForDomainEvent }),
    ...(input.waitForHookInvoke === undefined
      ? {}
      : { waitForHookInvoke: input.waitForHookInvoke }),
    ...(input.respondHookDecision === undefined
      ? {}
      : { respondHookDecision: input.respondHookDecision }),
    ...(input.setActiveCauseChain === undefined
      ? {}
      : { setActiveCauseChain: input.setActiveCauseChain }),
  };

  try {
    const result = await runQuickJsSandboxPrototype(
      buildPluginActivateSource(input.entryJavaScript),
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
      // activate() returned without parking: treat as successful short-lived plugin.
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
