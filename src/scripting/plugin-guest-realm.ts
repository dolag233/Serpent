import {
  QuickJsSandboxPrototypeError,
  runQuickJsSandboxPrototype,
  type QuickJsSandboxPrototypeHost,
} from './quickjs-sandbox-prototype';
import type { AutomationScriptCommandId } from '../shared/automation-script-api';

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

export function buildPluginActivateSource(entryJavaScript: string): string {
  return [
    normalizePluginEntryJavaScript(entryJavaScript),
    'if (typeof activate !== "function") {',
    '  throw new Error("Plugin entry must define async function activate(serpent).");',
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
  executeAutomationCommand: (commandId: AutomationScriptCommandId, commandInput: unknown) => Promise<unknown>;
  executeStorageOperation?: (input: {
    operation: 'get' | 'set' | 'delete' | 'list';
    scope?: 'library' | 'user';
    key?: string;
    value?: unknown;
  }) => Promise<unknown>;
  waitUntilDeactivate: () => Promise<void>;
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
