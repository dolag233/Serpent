import {
  QuickJsSandboxPrototypeError,
  runQuickJsSandboxPrototype,
  type QuickJsSandboxPrototypeLimits,
  type QuickJsSandboxPrototypeHost,
} from '../scripting/quickjs-sandbox-prototype';
import {
  SCRIPT_SANDBOX_PREVIEW_MAX_SOURCE_BYTES,
  utf8ByteLength,
} from '../shared/script-sandbox-limits';
import type {
  ScriptSandboxPreviewWorkerRequest,
  ScriptSandboxPreviewWorkerResponse,
} from './script-sandbox-preview-protocol';

const previewHost = {
  /**
   * Deliberately a local echo-only host capability. It proves async bridging
   * without exposing a Library, IPC, Node, network, or filesystem surface.
   */
  readText: async (input: string): Promise<string> => {
    const delay = /^wait:(\d{1,4})$/u.exec(input);
    if (delay) {
      const milliseconds = Math.min(Number(delay[1]), 4_000);
      await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
      return `preview waited ${milliseconds}ms`;
    }
    return `preview: ${input}`;
  },
};

// The Desktop Console needs enough wall time to paginate a large local library,
// while the Worker remains independently terminable from the Renderer. These
// bounds stay at or below the Main-owned execution budget where they overlap.
const DESKTOP_CONSOLE_SANDBOX_LIMITS: Partial<QuickJsSandboxPrototypeLimits> = {
  cpuTimeoutMs: 1_000,
  wallTimeoutMs: 60_000,
  memoryLimitBytes: 32 * 1024 * 1024,
  maxOutputBytes: 1024 * 1024,
  maxPendingHostCalls: 8,
  maxPendingGuestPromises: 128,
};

function failureFor(
  runId: string,
  error: unknown,
): Extract<ScriptSandboxPreviewWorkerResponse, { type: 'failed' }> {
  if (error instanceof QuickJsSandboxPrototypeError) {
    return {
      type: 'failed',
      runId,
      code: error.code,
      message: error.message,
      ...(error.guestStack ? { guestStack: error.guestStack } : {}),
    };
  }
  return {
    type: 'failed',
    runId,
    code: 'RUNTIME_ERROR',
    message: 'The script preview could not complete.',
  };
}

/**
 * The real Worker boundary calls this one request-at-a-time function. Keeping
 * it independent from `self` lets tests exercise the same source validation,
 * bridge and error mapping without running a second Electron renderer.
 */
export async function runScriptSandboxPreview(
  request: ScriptSandboxPreviewWorkerRequest,
  host: QuickJsSandboxPrototypeHost = previewHost,
): Promise<ScriptSandboxPreviewWorkerResponse> {
  if (request.type !== 'run') {
    throw new Error('Only run messages may start a sandbox execution.');
  }
  if (utf8ByteLength(request.source) > SCRIPT_SANDBOX_PREVIEW_MAX_SOURCE_BYTES) {
    return {
      type: 'failed',
      runId: request.runId,
      code: 'SOURCE_TOO_LARGE',
      message: `The script exceeds the ${SCRIPT_SANDBOX_PREVIEW_MAX_SOURCE_BYTES}-byte source limit.`,
    };
  }
  try {
    const result = await runQuickJsSandboxPrototype(request.source, host, {
      ...DESKTOP_CONSOLE_SANDBOX_LIMITS,
      maxSourceBytes: SCRIPT_SANDBOX_PREVIEW_MAX_SOURCE_BYTES,
    });
    return {
      type: 'completed',
      runId: request.runId,
      value: result.value,
      output: result.output,
      transpiledJavaScript: result.transpiledJavaScript,
    };
  } catch (error: unknown) {
    return failureFor(request.runId, error);
  }
}
