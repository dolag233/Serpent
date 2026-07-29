import type { QuickJsSandboxPrototypeErrorCode } from '../scripting/quickjs-sandbox-prototype';
import {
  automationScriptCommandIdSchema,
  type AutomationScriptCommandId,
} from '../shared/automation-script-api';

export const SCRIPT_SANDBOX_PREVIEW_ERROR_CODES: readonly QuickJsSandboxPrototypeErrorCode[] = [
  'SOURCE_NOT_ALLOWED',
  'SOURCE_TOO_LARGE',
  'CPU_TIMEOUT',
  'WALL_TIMEOUT',
  'CANCELLED',
  'MEMORY_LIMIT',
  'OUTPUT_LIMIT',
  'HOST_CALL_LIMIT',
  'PROMISE_LIMIT',
  'RUNTIME_ERROR',
];

function isScriptSandboxPreviewErrorCode(value: unknown): value is QuickJsSandboxPrototypeErrorCode {
  return typeof value === 'string'
    && SCRIPT_SANDBOX_PREVIEW_ERROR_CODES.includes(value as QuickJsSandboxPrototypeErrorCode);
}

export type ScriptSandboxPreviewWorkerRequest = {
  type: 'run';
  runId: string;
  source: string;
} | {
  type: 'automation-result';
  runId: string;
  requestId: string;
  result: { ok: true; result: unknown } | { ok: false; error: { code: string; message: string } };
};

export type ScriptSandboxPreviewWorkerCompleted = {
  type: 'completed';
  runId: string;
  value: unknown;
  output: string[];
  transpiledJavaScript: string;
};

export type ScriptSandboxPreviewWorkerFailed = {
  type: 'failed';
  runId: string;
  code: QuickJsSandboxPrototypeErrorCode;
  message: string;
  guestStack?: string;
};

export type ScriptSandboxPreviewWorkerResponse =
  | ScriptSandboxPreviewWorkerCompleted
  | ScriptSandboxPreviewWorkerFailed
  | {
    type: 'automation-command';
    runId: string;
    requestId: string;
    commandId: AutomationScriptCommandId;
    input: unknown;
  };

export function isScriptSandboxPreviewWorkerRequest(
  value: unknown,
): value is ScriptSandboxPreviewWorkerRequest {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { runId?: unknown }).runId === 'string'
    && (((value as { type?: unknown }).type === 'run'
      && typeof (value as { source?: unknown }).source === 'string')
      || ((value as { type?: unknown }).type === 'automation-result'
        && typeof (value as { requestId?: unknown }).requestId === 'string'
        && typeof (value as { result?: unknown }).result === 'object'
        && (value as { result?: unknown }).result !== null));
}

export function isScriptSandboxPreviewWorkerResponse(
  value: unknown,
): value is ScriptSandboxPreviewWorkerResponse {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as {
    type?: unknown;
    runId?: unknown;
    value?: unknown;
    output?: unknown;
    transpiledJavaScript?: unknown;
    code?: unknown;
    message?: unknown;
    guestStack?: unknown;
  };
  if (typeof candidate.runId !== 'string') return false;
  if (candidate.type === 'automation-command') {
    const commandId = (candidate as { commandId?: unknown }).commandId;
    return typeof (candidate as { requestId?: unknown }).requestId === 'string'
      && automationScriptCommandIdSchema.safeParse(commandId).success;
  }
  if (candidate.type === 'completed') {
    return Array.isArray(candidate.output)
      && candidate.output.every((line) => typeof line === 'string')
      && typeof candidate.transpiledJavaScript === 'string';
  }
  return candidate.type === 'failed'
    && isScriptSandboxPreviewErrorCode(candidate.code)
    && typeof candidate.message === 'string'
    && (candidate.guestStack === undefined || typeof candidate.guestStack === 'string');
}
