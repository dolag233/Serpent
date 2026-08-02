import {
  QuickJsSandboxPrototypeError,
  runQuickJsSandboxPrototype,
} from './quickjs-sandbox-prototype';
import {
  scriptRuntimeParentMessageSchema,
  type ScriptRuntimeChildMessage,
  type ScriptRuntimeParentMessage,
} from '../shared/script-runtime-utility-protocol';
import type { AutomationScriptCommandId } from '../shared/automation-script-api';

type PendingHostRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

export type ScriptRuntimeUtilityHandler = {
  handle(message: unknown): void;
  dispose(): void;
};

export function createScriptRuntimeUtilityHandler(options: {
  postMessage(message: ScriptRuntimeChildMessage): void;
}): ScriptRuntimeUtilityHandler {
  let active: {
    executionId: string;
    abortController: AbortController;
    pendingHostRequests: Map<string, PendingHostRequest>;
  } | undefined;

  const finish = (): void => {
    const current = active;
    if (current === undefined) return;
    active = undefined;
    for (const pending of current.pendingHostRequests.values()) {
      pending.reject(new Error('The script runtime execution ended.'));
    }
    current.pendingHostRequests.clear();
  };

  const cancelPendingHostRequests = (current: NonNullable<typeof active>): void => {
    for (const pending of current.pendingHostRequests.values()) {
      pending.reject(new Error('The script runtime execution was cancelled.'));
    }
    current.pendingHostRequests.clear();
  };

  const execute = async (request: Extract<ScriptRuntimeParentMessage, { type: 'script-runtime.run' }>): Promise<void> => {
    if (active !== undefined) {
      options.postMessage({
        type: 'script-runtime.failed',
        executionId: request.executionId,
        code: 'RUNTIME_ERROR',
        message: 'The script runtime already has an active execution.',
      });
      return;
    }
    const abortController = new AbortController();
    const pendingHostRequests = new Map<string, PendingHostRequest>();
    active = { executionId: request.executionId, abortController, pendingHostRequests };
    const callHost = (commandId: AutomationScriptCommandId, input: unknown): Promise<unknown> => new Promise((resolve, reject) => {
      const current = active;
      if (current === undefined || current.executionId !== request.executionId || current.abortController.signal.aborted) {
        reject(new Error('The script runtime execution was cancelled.'));
        return;
      }
      const requestId = globalThis.crypto.randomUUID();
      current.pendingHostRequests.set(requestId, { resolve, reject });
      options.postMessage({
        type: 'script-runtime.host-command',
        executionId: request.executionId,
        requestId,
        commandId,
        input,
      });
    });

    try {
      const result = await runQuickJsSandboxPrototype(request.source, {
        executeAutomationCommand: callHost,
      }, {
        ...request.limits,
        signal: abortController.signal,
      });
      if (active?.executionId !== request.executionId) return;
      options.postMessage({
        type: 'script-runtime.completed',
        executionId: request.executionId,
        value: result.value,
        output: result.output,
        transpiledJavaScript: result.transpiledJavaScript,
      });
    } catch (error) {
      if (active?.executionId !== request.executionId) return;
      if (abortController.signal.aborted) {
        options.postMessage({
          type: 'script-runtime.failed',
          executionId: request.executionId,
          code: 'CANCELLED',
          message: 'The script was cancelled.',
        });
      } else if (error instanceof QuickJsSandboxPrototypeError) {
        options.postMessage({
          type: 'script-runtime.failed',
          executionId: request.executionId,
          code: error.code,
          message: error.message,
          ...(error.guestStack === undefined ? {} : { guestStack: error.guestStack }),
        });
      } else {
        options.postMessage({
          type: 'script-runtime.failed',
          executionId: request.executionId,
          code: 'RUNTIME_ERROR',
          message: 'The isolated script runtime could not complete.',
        });
      }
    } finally {
      if (active?.executionId === request.executionId) finish();
    }
  };

  return {
    handle(input: unknown): void {
      const parsed = scriptRuntimeParentMessageSchema.safeParse(input);
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.type === 'script-runtime.run') {
        void execute(message);
        return;
      }
      const current = active;
      if (current === undefined || current.executionId !== message.executionId) return;
      if (message.type === 'script-runtime.abort') {
        current.abortController.abort();
        cancelPendingHostRequests(current);
        return;
      }
      const pending = current.pendingHostRequests.get(message.requestId);
      if (pending === undefined) return;
      current.pendingHostRequests.delete(message.requestId);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error?.message ?? 'The host request failed.'));
    },
    dispose(): void {
      active?.abortController.abort();
      finish();
    },
  };
}
