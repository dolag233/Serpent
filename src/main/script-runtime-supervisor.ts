import { DEFAULT_QUICKJS_SANDBOX_PROTOTYPE_LIMITS } from '../scripting/quickjs-sandbox-prototype';
import {
  scriptRuntimeChildMessageSchema,
  type ScriptRuntimeChildMessage,
  type ScriptRuntimeErrorCode,
  type ScriptRuntimeLimitOverrides,
} from '../shared/script-runtime-utility-protocol';
import type { AutomationScriptCommandId } from '../shared/automation-script-api';

const READY_TIMEOUT_MS = 5_000;
const TERMINATION_GRACE_MS = 1_500;

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

export type ScriptRuntimeSupervisorResult =
  | {
    ok: true;
    value: unknown;
    output: string[];
    transpiledJavaScript: string;
  }
  | {
    ok: false;
    error: {
      code: ScriptRuntimeErrorCode;
      message: string;
      guestStack?: string;
    };
  };

export interface ScriptRuntimeSupervisorRunInput {
  executionId: string;
  source: string;
  limits?: ScriptRuntimeLimitOverrides;
  signal?: AbortSignal;
  host: {
    execute(commandId: AutomationScriptCommandId, commandInput: unknown): Promise<unknown>;
  };
}

/** Narrow seam for Main IPC tests; real production instances are supervisors. */
export interface ScriptRuntimeExecutor {
  run(input: ScriptRuntimeSupervisorRunInput): Promise<ScriptRuntimeSupervisorResult>;
}

export interface ScriptRuntimeSupervisorLogger {
  info(scope: string, message: string, context?: Record<string, unknown>): void;
  error(scope: string, error: unknown, context?: Record<string, unknown>): void;
}

/**
 * Main-owned factory for one-run QuickJS UtilityProcesses. A child never sees
 * Library Worker handles, Renderer IPC, filesystem paths or credentials: its
 * only callback surface is a request/response pair for declared Gateway IDs.
 */
export class ScriptRuntimeSupervisor implements ScriptRuntimeExecutor {
  constructor(
    private readonly options: {
      fork(modulePath: string): RuntimeChild;
      modulePath: string;
      logger?: ScriptRuntimeSupervisorLogger;
    },
  ) {}

  run(input: ScriptRuntimeSupervisorRunInput): Promise<ScriptRuntimeSupervisorResult> {
    return new Promise((resolve) => {
      const child = this.options.fork(this.options.modulePath);
      child.stdout?.on('data', (chunk) => {
        this.options.logger?.info('automation.runtime.stdout', String(chunk).trim(), {
          executionId: input.executionId,
        });
      });
      child.stderr?.on('data', (chunk) => {
        this.options.logger?.error('automation.runtime.stderr', new Error(String(chunk).trim()), {
          executionId: input.executionId,
        });
      });
      let settled = false;
      let ready = false;
      const wallTimeoutMs = input.limits?.wallTimeoutMs ?? DEFAULT_QUICKJS_SANDBOX_PROTOTYPE_LIMITS.wallTimeoutMs;
      const complete = (result: ScriptRuntimeSupervisorResult, terminate: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(readyTimer);
        clearTimeout(hardTimeout);
        input.signal?.removeEventListener('abort', onAbort);
        child.off('message', onMessage);
        child.off('exit', onExit);
        child.off('error', onError);
        if (terminate) child.kill();
        resolve(result);
      };
      const fail = (code: ScriptRuntimeErrorCode, message: string, terminate = true): void => {
        complete({ ok: false, error: { code, message } }, terminate);
      };
      const onAbort = (): void => {
        if (!ready) {
          fail('CANCELLED', 'The script was cancelled before its runtime became ready.');
          return;
        }
        child.postMessage({ type: 'script-runtime.abort', executionId: input.executionId });
        fail('CANCELLED', 'The script was cancelled.');
      };
      const onExit = (...details: unknown[]): void => {
        if (settled) return;
        const code = typeof details[0] === 'number' ? details[0] : 'unknown';
        fail('RUNTIME_PROCESS_EXITED', `The isolated script runtime exited unexpectedly (${code}).`, false);
      };
      const onError = (...details: unknown[]): void => {
        if (settled) return;
        this.options.logger?.error(
          'automation.runtime.fatal',
          new Error('The isolated script runtime reported a fatal process error.'),
          { executionId: input.executionId, detailCount: details.length },
        );
        fail('RUNTIME_PROCESS_EXITED', 'The isolated script runtime could not start.');
      };
      const respondToHostCommand = (message: Extract<ScriptRuntimeChildMessage, { type: 'script-runtime.host-command' }>): void => {
        void input.host.execute(message.commandId, message.input).then(
          (result) => {
            if (settled) return;
            child.postMessage({
              type: 'script-runtime.host-result',
              executionId: message.executionId,
              requestId: message.requestId,
              ok: true,
              result,
            });
          },
          (error: unknown) => {
            this.options.logger?.error('automation.runtime.host-command-failed', error, {
              executionId: input.executionId,
              commandId: message.commandId,
            });
            if (settled) return;
            child.postMessage({
              type: 'script-runtime.host-result',
              executionId: message.executionId,
              requestId: message.requestId,
              ok: false,
              error: { code: 'HOST_COMMAND_FAILED', message: 'The automation command could not complete.' },
            });
          },
        );
      };
      const onMessage = (raw: unknown): void => {
        // UtilityProcess emits a payload in current Electron, but normalize a
        // MessageEvent too: ParentPort uses MessageEvent on the child side and
        // this keeps the protocol boundary explicit across Electron updates.
        const payload = typeof raw === 'object' && raw !== null && 'data' in raw
          ? (raw as { data: unknown }).data
          : raw;
        const parsed = scriptRuntimeChildMessageSchema.safeParse(payload);
        if (!parsed.success) {
          fail('RUNTIME_PROTOCOL_ERROR', 'The isolated script runtime sent an invalid message.');
          return;
        }
        const message = parsed.data;
        if (message.type === 'script-runtime.ready') {
          if (ready) {
            fail('RUNTIME_PROTOCOL_ERROR', 'The isolated script runtime sent a duplicate ready message.');
            return;
          }
          ready = true;
          if (input.signal?.aborted) {
            onAbort();
            return;
          }
          child.postMessage({
            type: 'script-runtime.run',
            executionId: input.executionId,
            source: input.source,
            ...(input.limits === undefined ? {} : { limits: input.limits }),
          });
          return;
        }
        if (!ready) {
          fail('RUNTIME_PROTOCOL_ERROR', 'The isolated script runtime sent a message before ready.');
          return;
        }
        if (message.executionId !== input.executionId) {
          fail('RUNTIME_PROTOCOL_ERROR', 'The isolated script runtime sent a message for another execution.');
          return;
        }
        if (message.type === 'script-runtime.host-command') {
          respondToHostCommand(message);
          return;
        }
        if (message.type === 'script-runtime.completed') {
          complete({
            ok: true,
            value: message.value,
            output: message.output,
            transpiledJavaScript: message.transpiledJavaScript,
          }, true);
          return;
        }
        complete({
          ok: false,
          error: {
            code: message.code,
            message: message.message,
            ...(message.guestStack === undefined ? {} : { guestStack: message.guestStack }),
          },
        }, true);
      };
      const readyTimer = setTimeout(() => fail('RUNTIME_PROCESS_EXITED', 'The isolated script runtime did not become ready.'), READY_TIMEOUT_MS);
      const hardTimeout = setTimeout(
        () => fail('WALL_TIMEOUT', 'The isolated script runtime exceeded its wall-clock limit.'),
        wallTimeoutMs + TERMINATION_GRACE_MS,
      );
      child.on('message', onMessage);
      child.once('exit', onExit);
      child.once('error', onError);
      input.signal?.addEventListener('abort', onAbort, { once: true });
      this.options.logger?.info('automation.runtime.spawn', 'Started an isolated QuickJS script runtime.', {
        executionId: input.executionId,
        pid: child.pid,
      });
    });
  }
}
