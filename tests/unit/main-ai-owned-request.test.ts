import { expect, test, vi } from "vitest";

import { DEFAULT_AI_ANALYSIS_SETTINGS } from "../../src/shared/ai-analysis-settings";
import { DEFAULT_AI_RELIABILITY_SETTINGS } from "../../src/shared/ai-reliability";
import {
  tryHandleAiOwnedRequest,
  type AiOwnedConfig,
  type AiOwnedRequestRuntime,
} from "../../src/main/library-request/ai";

function config(overrides?: Partial<AiOwnedConfig>): AiOwnedConfig {
  return {
    hasKey: true,
    apiFormat: "openai_chat",
    model: "gpt-4o",
    baseUrl: "",
    descriptionEnabled: true,
    tagEnabled: true,
    ratingEnabled: true,
    analysisSettings: DEFAULT_AI_ANALYSIS_SETTINGS,
    concurrencyLimit: 2,
    maxAnalysisImageEdgePx: 2048,
    reliabilitySettings: DEFAULT_AI_RELIABILITY_SETTINGS,
    languages: ["zh-CN", "en"],
    autoAnalyzeEnabled: false,
    disclaimerAccepted: true,
    ...overrides,
  };
}

function runtime(overrides?: Partial<AiOwnedRequestRuntime>): AiOwnedRequestRuntime {
  return {
    loadAiConfig: () => config(),
    getDecryptedApiKey: () => "sk-test",
    saveAiConfig: vi.fn(),
    saveEncryptedApiKey: vi.fn(),
    workerAvailable: () => true,
    requestWorker: vi.fn(async () => ({
      ok: false as const,
      error: { code: "INTERNAL_ERROR" as const, message: "unused" },
    })),
    processAiQueue: vi.fn(),
    logInfo: vi.fn(),
    logError: vi.fn(),
    ...overrides,
  };
}

test("unrelated renderer requests fall through", async () => {
  await expect(tryHandleAiOwnedRequest(
    { type: "folder.list.request", libraryId: "lib-1" },
    runtime(),
  )).resolves.toBeUndefined();
});

test("assets.analyze returns not-configured when the key is missing", async () => {
  await expect(tryHandleAiOwnedRequest(
    {
      type: "assets.analyze.request",
      libraryId: "lib-1",
      assetIds: ["asset-1"],
    },
    runtime({
      loadAiConfig: () => config({ hasKey: false }),
    }),
  )).resolves.toMatchObject({
    ok: false,
    error: { code: "AI_ANALYSIS_FAILED", reason: "AI_NOT_CONFIGURED" },
  });
});

test("asset.analyze falls through when enqueue does not create a job", async () => {
  await expect(tryHandleAiOwnedRequest(
    {
      type: "asset.analyze.request",
      libraryId: "lib-1",
      assetId: "asset-1",
    },
    runtime({
      requestWorker: vi.fn(async () => ({
        ok: true as const,
        type: "ai.jobs.enqueued" as const,
        libraryId: "lib-1",
        jobIds: [],
        alreadyPendingJobIds: [],
        skippedAssetIds: ["asset-1"],
        enqueued: 0,
      })),
    }),
  )).resolves.toBeUndefined();
});

test("ai.config.get maps the stored config onto the renderer payload", async () => {
  await expect(tryHandleAiOwnedRequest(
    { type: "ai.config.get.request" },
    runtime(),
  )).resolves.toMatchObject({
    ok: true,
    type: "ai.config.got",
    apiFormat: "openai_chat",
    model: "gpt-4o",
    hasKey: true,
  });
});
