import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WorkerRequest } from '../../src/shared/protocol/requests';
import { performanceLaneForCommand } from '../../src/shared/performance-contract';
import { AnthropicVendorAdapter } from '../../src/worker/ai/anthropic-adapter';
import { DashScopeVendorAdapter } from '../../src/worker/ai/dashscope-adapter';
import { GeminiVendorAdapter } from '../../src/worker/ai/gemini-adapter';
import { OpenAIVendorAdapter } from '../../src/worker/ai/openai-adapter';
import { AiJobAbortRegistry } from '../../src/worker/ai/job-abort-registry';
import { ProviderConcurrencyLimiter } from '../../src/worker/ai/provider-concurrency-limiter';
import { VendorAdapterError } from '../../src/worker/ai/vendor-adapter';
import { executeLibraryIdentityWorkerCommand } from '../../src/worker/handlers/library-identity';
import { executeAiWorkerCommand, type AiRuntime } from '../../src/worker/handlers/ai';
import { InteractiveScheduler, type ScheduledRequest } from '../../src/worker/interactive-scheduler';
import type { LibraryService } from '../../src/worker/library-service';

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = () => res();
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function settlesWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([promise.then(() => true, () => true), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function testConnectionRequest(
  requestId: string,
  apiFormat: 'dashscope_native' | 'openai_chat' | 'openai_responses' | 'gemini_native' | 'anthropic',
): WorkerRequest {
  return {
    requestId,
    command: {
      type: 'ai.test-connection',
      apiFormat,
      apiKey: 'fixture-key',
      model: 'fixture-model',
    },
  };
}

function aiRuntime(
  scheduler?: InteractiveScheduler,
): AiRuntime {
  return {
    analysisControls: new Map(),
    publishAiProgress: vi.fn(),
    aiJobAbortRegistry: new AiJobAbortRegistry(),
    providerConcurrencyLimiter: new ProviderConcurrencyLimiter(2),
    aiProcessBatchAbortControllers: new Map(),
    parentPort: undefined,
    runWithoutAdmission: async (requestId, work) => scheduler
      ? scheduler.runWithoutAdmission(requestId, work)
      : work(),
  };
}

function scheduledRequest(request: WorkerRequest): ScheduledRequest {
  const command = request.command;
  return {
    requestId: request.requestId,
    lane: performanceLaneForCommand(command),
    label: command.type,
    ...('libraryId' in command ? { libraryId: command.libraryId } : {}),
  };
}

function createHistoryService(): LibraryService {
  return {
    getOperationHistoryStatus: vi.fn((libraryId: string) => ({
      libraryId,
      undoTop: null,
      redoTop: null,
      staleTop: null,
      transitionInProgress: false,
    })),
    reportDiagnostic: vi.fn(),
  } as unknown as LibraryService;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ai.test-connection scheduler integration', () => {
  it('releases the probe wait, then waits to reacquire before returning success', async () => {
    const scheduler = new InteractiveScheduler();
    const libraryService = createHistoryService();
    const probeEntered = deferred();
    const probeRelease = deferred();
    const probeFinished = deferred();
    const mutationEntered = deferred();
    const mutationRelease = deferred();
    vi.spyOn(OpenAIVendorAdapter.prototype, 'probeConnection').mockImplementation(async () => {
      probeEntered.resolve();
      try {
        await probeRelease.promise;
      } finally {
        probeFinished.resolve();
      }
    });

    const request = testConnectionRequest('ai-probe', 'openai_chat');
    const runtime = aiRuntime(scheduler);
    let probeTask: Promise<unknown> | undefined;
    let statusTask: Promise<unknown> | undefined;
    let mutationTask: Promise<void> | undefined;
    try {
      probeTask = scheduler.schedule(
        scheduledRequest(request),
        () => executeAiWorkerCommand(libraryService, request, runtime),
      );
      expect(await settlesWithin(probeEntered.promise, 1_000)).toBe(true);

      const statusRequest: WorkerRequest = {
        requestId: 'history-status-during-ai-probe',
        command: { type: 'history.status', libraryId: 'lib-fixture' },
      };
      statusTask = scheduler.schedule(
        scheduledRequest(statusRequest),
        () => executeLibraryIdentityWorkerCommand(libraryService, statusRequest),
      );
      // A yielding AI probe leaves the scheduler slot available immediately.
      // The pre-fix handler holds it until the external probe settles.
      expect(scheduler.queuedCount).toBe(0);
      await expect(statusTask).resolves.toMatchObject({ type: 'history.status' });

      mutationTask = scheduler.schedule(
        { requestId: 'folder-mutation-hold', lane: 'mutation', libraryId: 'lib-fixture', label: 'folder.rename' },
        () => {
          mutationEntered.resolve();
          return mutationRelease.promise;
        },
      );
      expect(await settlesWithin(mutationEntered.promise, 1_000)).toBe(true);

      probeRelease.resolve();
      await probeFinished.promise;
      // The probe work has finished, but the AI request must not return until
      // the scheduler admits it again after this mutation releases the slot.
      expect(await settlesWithin(probeTask, 40)).toBe(false);

      mutationRelease.resolve();
      await mutationTask;
      await expect(probeTask).resolves.toMatchObject({
        type: 'ai.test-connection.result',
        success: true,
      });
    } finally {
      probeRelease.resolve();
      mutationRelease.resolve();
      await Promise.allSettled([
        ...(probeTask ? [probeTask] : []),
        ...(statusTask ? [statusTask] : []),
        ...(mutationTask ? [mutationTask] : []),
      ]);
    }
  });

  it('preserves probe failure category and sanitized diagnostic', async () => {
    const scheduler = new InteractiveScheduler();
    const reportDiagnostic = vi.fn();
    const libraryService = { reportDiagnostic } as unknown as LibraryService;
    const probeEntered = deferred();
    const failProbe = deferred();
    const vendorFailure = new VendorAdapterError('auth', 'HTTP 401 rejected fixture credential');
    vi.spyOn(OpenAIVendorAdapter.prototype, 'probeConnection').mockImplementation(async () => {
      probeEntered.resolve();
      await failProbe.promise;
      throw vendorFailure;
    });

    const request = testConnectionRequest('ai-probe-failure', 'openai_chat');
    const task = scheduler.schedule(
      scheduledRequest(request),
      () => executeAiWorkerCommand(libraryService, request, aiRuntime(scheduler)),
    );
    try {
      expect(await settlesWithin(probeEntered.promise, 1_000)).toBe(true);
      failProbe.resolve();
      await expect(task).resolves.toEqual({
        ok: true,
        type: 'ai.test-connection.result',
        success: false,
        errorKind: 'auth',
        reason: 'AI service authentication failed.',
      });
      expect(reportDiagnostic).toHaveBeenCalledWith(
        'ai.connection.test',
        expect.any(Error),
        { apiFormat: 'openai_chat', model: 'fixture-model', errorCode: 'AI_AUTH' },
      );
      const diagnostic = reportDiagnostic.mock.calls[0]?.[1];
      expect(diagnostic).toMatchObject({ message: 'AI queue analysis failed.' });
      expect((diagnostic as Error).cause).toMatchObject({
        message: expect.stringContaining('Provider failure category: AI_AUTH'),
      });
    } finally {
      failProbe.resolve();
      await task;
    }
  });

  it('keeps every supported adapter format branch callable', async () => {
    const openAiProbe = vi.spyOn(OpenAIVendorAdapter.prototype, 'probeConnection').mockResolvedValue();
    const dashScopeProbe = vi.spyOn(DashScopeVendorAdapter.prototype, 'probeConnection').mockResolvedValue();
    const geminiProbe = vi.spyOn(GeminiVendorAdapter.prototype, 'probeConnection').mockResolvedValue();
    const anthropicProbe = vi.spyOn(AnthropicVendorAdapter.prototype, 'probeConnection').mockResolvedValue();
    const formats = [
      'dashscope_native',
      'openai_chat',
      'openai_responses',
      'gemini_native',
      'anthropic',
    ] as const;
    const service = {} as LibraryService;

    for (const [index, apiFormat] of formats.entries()) {
      await expect(executeAiWorkerCommand(
        service,
        testConnectionRequest(`format-${index}`, apiFormat),
        aiRuntime(),
      )).resolves.toMatchObject({ success: true, type: 'ai.test-connection.result' });
    }

    expect(dashScopeProbe).toHaveBeenCalledTimes(1);
    expect(openAiProbe).toHaveBeenCalledTimes(2);
    expect(geminiProbe).toHaveBeenCalledTimes(1);
    expect(anthropicProbe).toHaveBeenCalledTimes(1);
  });
});
