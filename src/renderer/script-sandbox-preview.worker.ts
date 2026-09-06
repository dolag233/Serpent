/// <reference lib="webworker" />

import {
  isScriptSandboxPreviewWorkerRequest,
} from './script-sandbox-preview-protocol';
import {
  automationScriptCommandIdSchema,
  type PluginHostCommandId,
} from '../shared/automation-script-api';
import { runScriptSandboxPreview } from './script-sandbox-preview-runtime';

declare const self: DedicatedWorkerGlobalScope;

const pendingCommands = new Map<
  string,
  { resolve(value: unknown): void; reject(reason?: unknown): void }
>();

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (!isScriptSandboxPreviewWorkerRequest(event.data)) return;
  if (event.data.type === 'automation-result') {
    const pending = pendingCommands.get(event.data.requestId);
    if (!pending) return;
    pendingCommands.delete(event.data.requestId);
    if (event.data.result.ok) pending.resolve(event.data.result.result);
    else pending.reject(new Error(event.data.result.error.message));
    return;
  }

  const { runId } = event.data;
  const executeAutomationCommand = (
    commandId: PluginHostCommandId,
    input: unknown,
  ): Promise<unknown> => {
    const parsed = automationScriptCommandIdSchema.safeParse(commandId);
    if (!parsed.success) {
      return Promise.reject(new Error('This command is not available to scripts.'));
    }
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      pendingCommands.set(requestId, { resolve, reject });
      self.postMessage({ type: 'automation-command', runId, requestId, commandId: parsed.data, input });
    });
  };
  void runScriptSandboxPreview(event.data, { executeAutomationCommand })
    .then((message) => self.postMessage(message));
});
