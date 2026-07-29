import {
  isScriptSandboxPreviewWorkerResponse,
  type ScriptSandboxPreviewWorkerCompleted,
  type ScriptSandboxPreviewWorkerFailed,
  type ScriptSandboxPreviewWorkerRequest,
  type ScriptSandboxPreviewWorkerResponse,
} from './script-sandbox-preview-protocol';

export type ScriptSandboxPreviewWorker = {
  onerror: ((event: { message: string }) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: ScriptSandboxPreviewWorkerRequest): void;
  terminate(): void;
};

export type ScriptSandboxPreviewController = {
  run(source: string): void;
  stop(): void;
  dispose(): void;
};

export type CreateScriptSandboxPreviewControllerOptions = {
  createWorker(): ScriptSandboxPreviewWorker;
  newRunId(): string;
  onCompleted(message: ScriptSandboxPreviewWorkerCompleted): void;
  onFailed(message: ScriptSandboxPreviewWorkerFailed): void;
  onStateChange(state: 'idle' | 'running'): void;
  onAutomationCommand?(message: Extract<ScriptSandboxPreviewWorkerResponse, { type: 'automation-command' }>): Promise<
    { ok: true; result: unknown } | { ok: false; error: { code: string; message: string } }
  >;
};

/**
 * Owns a short-lived renderer Web Worker for the intentionally isolated script
 * preview. Every run gets a fresh worker so an interrupted QuickJS runtime can
 * never affect a following run; late messages are ignored by run ID.
 */
export function createScriptSandboxPreviewController(
  options: CreateScriptSandboxPreviewControllerOptions,
): ScriptSandboxPreviewController {
  let active: { runId: string; worker: ScriptSandboxPreviewWorker } | undefined;

  const finish = (runId: string, worker: ScriptSandboxPreviewWorker): boolean => {
    if (!active || active.runId !== runId || active.worker !== worker) return false;
    active = undefined;
    worker.terminate();
    options.onStateChange('idle');
    return true;
  };

  const stop = (): void => {
    if (!active) return;
    const { worker } = active;
    active = undefined;
    worker.terminate();
    options.onStateChange('idle');
  };

  return {
    run(source: string): void {
      stop();
      const runId = options.newRunId();
      const worker = options.createWorker();
      active = { runId, worker };
      worker.onmessage = (event) => {
        if (!isScriptSandboxPreviewWorkerResponse(event.data)) {
          if (finish(runId, worker)) {
            options.onFailed({
              type: 'failed',
              runId,
              code: 'RUNTIME_ERROR',
              message: 'The script preview worker returned an invalid result.',
            });
          }
          return;
        }
        const message = event.data;
        if (message.runId !== runId) return;
        if (message.type === 'automation-command') {
          const command = options.onAutomationCommand;
          if (!command) {
            worker.postMessage({
              type: 'automation-result',
              runId,
              requestId: message.requestId,
              result: { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Automation is unavailable.' } },
            });
            return;
          }
          void command(message).then(
            (result) => worker.postMessage({
              type: 'automation-result',
              runId,
              requestId: message.requestId,
              result,
            }),
            () => worker.postMessage({
              type: 'automation-result',
              runId,
              requestId: message.requestId,
              result: {
                ok: false,
                error: { code: 'INTERNAL_ERROR', message: 'The automation command could not complete.' },
              },
            }),
          );
          return;
        }
        if (!finish(runId, worker)) return;
        if (message.type === 'completed') options.onCompleted(message);
        else options.onFailed(message);
      };
      worker.onerror = () => {
        if (!finish(runId, worker)) return;
        options.onFailed({
          type: 'failed',
          runId,
          code: 'RUNTIME_ERROR',
          message: 'The script preview worker stopped unexpectedly.',
        });
      };
      options.onStateChange('running');
      worker.postMessage({ type: 'run', runId, source });
    },
    stop,
    dispose: stop,
  };
}
