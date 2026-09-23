import { expect, test, vi } from 'vitest';

import { DEFAULT_AI_ANALYSIS_SETTINGS } from '../../src/shared/ai-analysis-settings';
import type { WorkerRequest } from '../../src/shared/protocol/requests';
import { AiJobAbortRegistry } from '../../src/worker/ai/job-abort-registry';
import { ProviderConcurrencyLimiter } from '../../src/worker/ai/provider-concurrency-limiter';
import { executeAiWorkerCommand, type AiRuntime } from '../../src/worker/handlers/ai';
import type { LibraryService } from '../../src/worker/library-service';

function aiRequest(command: WorkerRequest['command']): WorkerRequest {
  return { requestId: 'req-1', command };
}

function aiRuntime(overrides?: Partial<AiRuntime>): AiRuntime {
  return {
    analysisControls: new Map(),
    publishAiProgress: vi.fn(),
    aiJobAbortRegistry: new AiJobAbortRegistry(),
    providerConcurrencyLimiter: new ProviderConcurrencyLimiter(2),
    aiProcessBatchAbortControllers: new Map(),
    parentPort: undefined,
    runWithoutAdmission: async (_requestId, work) => work(),
    ...overrides,
  };
}

test('unrelated commands fall through', async () => {
  await expect(executeAiWorkerCommand(
    {} as LibraryService,
    aiRequest({ type: 'library.list' }),
    aiRuntime(),
  )).resolves.toBeUndefined();
});

test('ai.configure acknowledges receipt', async () => {
  await expect(executeAiWorkerCommand(
    {} as LibraryService,
    aiRequest({
      type: 'ai.configure',
      apiFormat: 'openai_chat',
      encryptedApiKeyBase64: 'Zg==',
      model: 'gpt-4o',
      autoAnalyzeEnabled: false,
    }),
    aiRuntime(),
  )).resolves.toEqual({
    ok: true,
    type: 'ai.config.saved',
  });
});

test('ai.content.get maps description, tags, rating and model version', async () => {
  const libraryService = {
    getAiContent: vi.fn(() => [
      { fieldName: 'description', value: 'A still from a night scene', modelVersion: 'v1' },
      { fieldName: 'rating', value: '4', modelVersion: 'v1' },
    ]),
    listAiTagNames: vi.fn(() => ['neon', 'city']),
    getAiTagModelVersion: vi.fn(() => 'v1'),
  } as unknown as LibraryService;

  await expect(executeAiWorkerCommand(
    libraryService,
    aiRequest({
      type: 'ai.content.get',
      libraryId: 'lib-1',
      assetId: 'asset-1',
    }),
    aiRuntime(),
  )).resolves.toEqual({
    ok: true,
    type: 'ai.content.got',
    assetId: 'asset-1',
    description: 'A still from a night scene',
    tags: ['neon', 'city'],
    rating: 4,
    modelVersion: 'v1',
  });
});

test('ai.set-concurrency-limit updates the provider limiter', async () => {
  const limiter = new ProviderConcurrencyLimiter(2);
  await expect(executeAiWorkerCommand(
    {} as LibraryService,
    aiRequest({ type: 'ai.set-concurrency-limit', concurrencyLimit: 4 }),
    aiRuntime({ providerConcurrencyLimiter: limiter }),
  )).resolves.toEqual({
    ok: true,
    type: 'ai.concurrency.updated',
    concurrencyLimit: 4,
  });
  expect(limiter.snapshot().limit).toBe(4);
});

test('ai.clear-content posts the cleared event', async () => {
  const postMessage = vi.fn();
  const libraryService = {
    clearAiContent: vi.fn(() => ({
      clearedCount: 2,
      affectedAssetIds: ['asset-1', 'asset-2'],
    })),
  } as unknown as LibraryService;

  await expect(executeAiWorkerCommand(
    libraryService,
    aiRequest({
      type: 'ai.clear-content',
      libraryId: 'lib-1',
      scope: { kind: 'library' },
      confirm: true,
    }),
    aiRuntime({ parentPort: { postMessage } as unknown as AiRuntime['parentPort'] }),
  )).resolves.toEqual({
    ok: true,
    type: 'ai.content.cleared',
    libraryId: 'lib-1',
    clearedCount: 2,
    affectedAssetIds: ['asset-1', 'asset-2'],
  });
  expect(postMessage).toHaveBeenCalledWith({
    type: 'ai.content.cleared',
    libraryId: 'lib-1',
    affectedAssetCount: 2,
    affectedAssetIds: ['asset-1', 'asset-2'],
  });
});

test('ai.enqueue-analysis publishes progress after enqueue', async () => {
  const publishAiProgress = vi.fn();
  const libraryService = {
    enqueueAiAnalysisJobs: vi.fn(() => ({
      enqueued: 1,
      jobIds: ['job-1'],
      alreadyPendingJobIds: [],
      skippedAssetIds: [],
    })),
  } as unknown as LibraryService;

  await expect(executeAiWorkerCommand(
    libraryService,
    aiRequest({
      type: 'ai.enqueue-analysis',
      libraryId: 'lib-1',
      assetIds: ['asset-1'],
    }),
    aiRuntime({ publishAiProgress }),
  )).resolves.toEqual({
    ok: true,
    type: 'ai.jobs.enqueued',
    libraryId: 'lib-1',
    enqueued: 1,
    jobIds: ['job-1'],
    alreadyPendingJobIds: [],
    skippedAssetIds: [],
  });
  expect(publishAiProgress).toHaveBeenCalledWith('lib-1');
});

test('ai.process-queue nested-analyzes claimed jobs through the extracted handler', async () => {
  const publishAiProgress = vi.fn();
  const libraryService = {
    claimNextAiJob: vi.fn((_libraryId: string, excluded: string[]) => (
      excluded.length === 0
        ? { jobId: 'job-1', assetId: 'asset-1', kind: 'ai.image.analysis', attemptCount: 1 }
        : null
    )),
    getAiJobState: vi.fn(() => 'running'),
    resolveAssetFilePath: vi.fn(() => ({
      filePath: 'notes.txt',
      mime: 'text/plain',
      isVideo: false,
    })),
    failAiJob: vi.fn(() => ({ status: 'failed' })),
    reportDiagnostic: vi.fn(),
    getAiJobStatus: vi.fn(() => ({ queued: 0, running: 0, succeeded: 0, failed: 1 })),
  } as unknown as LibraryService;

  await expect(executeAiWorkerCommand(
    libraryService,
    aiRequest({
      type: 'ai.process-queue',
      libraryId: 'lib-1',
      apiFormat: 'openai_chat',
      model: 'gpt-4o',
      apiKey: 'sk-test',
      enabledFields: { description: true, tags: true, rating: false },
      analysisSettings: DEFAULT_AI_ANALYSIS_SETTINGS,
      languages: ['zh-CN'],
      concurrencyLimit: 1,
      requestTimeoutMs: 15_000,
      maxAttempts: 3,
      maxJobs: 1,
    }),
    aiRuntime({ publishAiProgress }),
  )).resolves.toEqual({
    ok: true,
    type: 'ai.jobs.processed',
    libraryId: 'lib-1',
    processed: 1,
    succeeded: 0,
    failed: 1,
    requeued: 0,
  });
  expect(libraryService.resolveAssetFilePath).toHaveBeenCalledWith('lib-1', 'asset-1');
  expect(libraryService.failAiJob).toHaveBeenCalledWith(
    'lib-1',
    'job-1',
    expect.objectContaining({
      errorCode: 'unsupported mime type: text/plain',
      retryable: false,
    }),
  );
});
