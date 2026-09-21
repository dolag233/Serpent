import type { RendererRequest, WorkerCommand } from "../../shared/protocol/requests";
import type { RendererResult, WorkerResult } from "../../shared/protocol/responses";
import { createPublicError } from "../../shared/protocol/errors";
import {
  DEFAULT_AI_ANALYSIS_SETTINGS,
  normalizeAiAnalysisSettings,
  toWireAiAnalysisSettings,
  type AiAnalysisSettings,
} from "../../shared/ai-analysis-settings";
import { normalizeAiAnalysisConcurrency } from "../../shared/ai-concurrency";
import { normalizeAiAnalysisImageEdgePx } from "../../shared/ai-analysis-image";
import { normalizeAiReliabilitySettings, type AiReliabilitySettings } from "../../shared/ai-reliability";
import {
  DEFAULT_AI_LANGUAGES,
  listAiModels,
  normalizeAiLanguages,
  type AiApiFormat,
} from "../../shared/ai-endpoints";
import { aiSearchFailureReason, planAiSearch } from "../ai-search-planner";

export type AiOwnedConfig = {
  hasKey: boolean;
  apiFormat: AiApiFormat;
  model: string;
  baseUrl: string;
  descriptionEnabled: boolean;
  tagEnabled: boolean;
  ratingEnabled: boolean;
  analysisSettings: AiAnalysisSettings;
  concurrencyLimit: number;
  maxAnalysisImageEdgePx: number;
  reliabilitySettings: AiReliabilitySettings;
  languages: Array<"zh-CN" | "en" | "ja" | "ko">;
  autoAnalyzeEnabled: boolean;
  disclaimerAccepted: boolean;
};

export type AiOwnedSavedConfig = Omit<AiOwnedConfig, "hasKey">;

export type AiOwnedRequestRuntime = {
  loadAiConfig: () => AiOwnedConfig;
  getDecryptedApiKey: () => string;
  saveAiConfig: (config: AiOwnedSavedConfig) => void;
  saveEncryptedApiKey: (apiKey: string) => void;
  workerAvailable: () => boolean;
  requestWorker: (command: WorkerCommand) => Promise<WorkerResult>;
  processAiQueue: (libraryId: string) => void;
  logInfo: (scope: string, message: string, context?: Record<string, unknown>) => void;
  logError: (scope: string, error: unknown, context?: Record<string, unknown>) => void;
};

/**
 * Main-owned AI config, search-plan, and analysis enqueue replies.
 * Undefined means the request is not fully handled here (including
 * `asset.analyze.request` falling through to synchronous Worker analyze).
 */
export async function tryHandleAiOwnedRequest(
  request: RendererRequest,
  runtime: AiOwnedRequestRuntime,
): Promise<RendererResult | undefined> {
  switch (request.type) {
    case "assets.analyze.request": {
      const config = runtime.loadAiConfig();
      if (!config.hasKey || !config.apiFormat) {
        return {
          ok: false,
          error: createPublicError("AI_ANALYSIS_FAILED", "AI_NOT_CONFIGURED"),
        } satisfies RendererResult;
      }
      try {
        runtime.getDecryptedApiKey();
      } catch {
        return {
          ok: false,
          error: createPublicError("AI_ANALYSIS_FAILED", "AI_NOT_CONFIGURED"),
        } satisfies RendererResult;
      }
      if (!runtime.workerAvailable()) throw new Error("Library Worker is unavailable.");
      try {
        const enqueueResult = await runtime.requestWorker({
          type: "ai.enqueue-analysis",
          libraryId: request.libraryId,
          assetIds: request.assetIds,
          resumePaused: true,
          // 手动分析可覆盖已有 AI 结果（8-09 WIP 恢复：worker 已支持）
          forceExisting: true,
        });
        if (enqueueResult.ok && enqueueResult.type === "ai.jobs.enqueued") {
          const jobIds = [
            ...enqueueResult.jobIds,
            ...enqueueResult.alreadyPendingJobIds,
          ];
          if (jobIds.length > 0) {
            void runtime.processAiQueue(request.libraryId);
            return {
              ok: true,
              type: "assets.analyze-queued",
              assetIds: request.assetIds,
              jobIds,
              skippedAssetIds: enqueueResult.skippedAssetIds,
              enqueued: enqueueResult.enqueued,
            } satisfies RendererResult;
          }
        }
      } catch (error) {
        runtime.logError("ai.analyze.batch-enqueue", error);
      }
      return {
        ok: false,
        error: createPublicError("AI_ANALYSIS_FAILED"),
      } satisfies RendererResult;
    }
    case "asset.analyze.request": {
      const config = runtime.loadAiConfig();
      if (!config.hasKey || !config.apiFormat) {
        return {
          ok: false,
          error: createPublicError("AI_ANALYSIS_FAILED", "AI_NOT_CONFIGURED"),
        } satisfies RendererResult;
      }
      try {
        runtime.getDecryptedApiKey();
      } catch {
        return {
          ok: false,
          error: createPublicError("AI_ANALYSIS_FAILED", "AI_NOT_CONFIGURED"),
        } satisfies RendererResult;
      }
      if (!runtime.workerAvailable()) throw new Error("Library Worker is unavailable.");
      try {
        const enqueueResult = await runtime.requestWorker({
          type: "ai.enqueue-analysis",
          libraryId: request.libraryId,
          assetIds: [request.assetId],
          // 手动分析可覆盖已有 AI 结果（8-09 WIP 恢复：worker 已支持）
          forceExisting: true,
        });
        if (
          enqueueResult.ok &&
          enqueueResult.type === "ai.jobs.enqueued" &&
          enqueueResult.enqueued > 0
        ) {
          void runtime.processAiQueue(request.libraryId);
          return {
            ok: true,
            type: "asset.analyze-queued",
            assetId: request.assetId,
            enqueued: enqueueResult.enqueued,
          } satisfies RendererResult;
        }
        if (
          enqueueResult.ok &&
          enqueueResult.type === "ai.jobs.enqueued" &&
          enqueueResult.enqueued === 0
        ) {
          const statusResult = await runtime.requestWorker({
            type: "ai.status",
            libraryId: request.libraryId,
          });
          const alreadyPending =
            statusResult.ok &&
            statusResult.type === "ai.jobs.status" &&
            statusResult.jobs.some(
              (job) =>
                job.assetId === request.assetId &&
                (job.status === "queued" ||
                  job.status === "running" ||
                  job.status === "paused"),
            );
          if (alreadyPending) {
            void runtime.processAiQueue(request.libraryId);
            return {
              ok: true,
              type: "asset.analyze-queued",
              assetId: request.assetId,
              enqueued: 1,
            } satisfies RendererResult;
          }
        }
      } catch (error) {
        runtime.logError("ai.analyze.enqueue", error);
      }
      // Fall through to synchronous asset.analyze for eligibility errors.
      return undefined;
    }
    case "ai.config.get.request": {
      const config = runtime.loadAiConfig();
      return {
        ok: true,
        type: "ai.config.got",
        apiFormat: config.apiFormat,
        model: config.model,
        baseUrl: config.baseUrl ?? "",
        hasKey: config.hasKey,
        enabledFields: {
          description: config.descriptionEnabled,
          tags: config.tagEnabled,
          rating: config.ratingEnabled,
        },
        analysisSettings: toWireAiAnalysisSettings(config.analysisSettings),
        languages: config.languages,
        concurrencyLimit: config.concurrencyLimit,
        maxAnalysisImageEdgePx: config.maxAnalysisImageEdgePx,
        reliabilitySettings: config.reliabilitySettings,
        autoAnalyzeEnabled: config.autoAnalyzeEnabled,
        disclaimerAccepted: config.disclaimerAccepted,
      } satisfies RendererResult;
    }
    case "ai.config.set.request": {
      const currentConfig = runtime.loadAiConfig();
      if (request.autoAnalyzeEnabled && !request.disclaimerAccepted) {
        return {
          ok: false,
          error: createPublicError("CONFIRMATION_REQUIRED"),
        } satisfies RendererResult;
      }
      if (!request.apiKey && !currentConfig.hasKey) {
        return {
          ok: false,
          error: createPublicError("AI_SETTINGS_INCOMPLETE"),
        } satisfies RendererResult;
      }
      const savedConfig: AiOwnedSavedConfig = {
        apiFormat: request.apiFormat,
        model: request.model,
        baseUrl: (request.baseUrl ?? "").trim(),
        descriptionEnabled: request.enabledFields?.description ?? true,
        tagEnabled: request.enabledFields?.tags ?? true,
        ratingEnabled: request.enabledFields?.rating ?? true,
        analysisSettings: normalizeAiAnalysisSettings({
          ...DEFAULT_AI_ANALYSIS_SETTINGS,
          ...request.analysisSettings,
          descriptionEnabled: request.enabledFields?.description ?? true,
          tagEnabled: request.enabledFields?.tags ?? true,
          ratingEnabled: request.enabledFields?.rating ?? true,
        }),
        concurrencyLimit: normalizeAiAnalysisConcurrency(
          request.concurrencyLimit ?? currentConfig.concurrencyLimit,
        ),
        maxAnalysisImageEdgePx: normalizeAiAnalysisImageEdgePx(
          request.maxAnalysisImageEdgePx ?? currentConfig.maxAnalysisImageEdgePx,
        ),
        // Retry policy remains durable but is no longer a user-facing setting.
        reliabilitySettings: request.reliabilitySettings
          ? normalizeAiReliabilitySettings(request.reliabilitySettings)
          : currentConfig.reliabilitySettings,
        languages: normalizeAiLanguages(
          request.languages ?? request.language ?? DEFAULT_AI_LANGUAGES,
        ),
        autoAnalyzeEnabled: request.autoAnalyzeEnabled,
        disclaimerAccepted: request.disclaimerAccepted,
      };
      runtime.saveAiConfig(savedConfig);
      if (request.apiKey) runtime.saveEncryptedApiKey(request.apiKey);
      if (runtime.workerAvailable()) {
        try {
          const update = await runtime.requestWorker({
            type: "ai.set-concurrency-limit",
            concurrencyLimit: savedConfig.concurrencyLimit,
          });
          if (!update.ok || update.type !== "ai.concurrency.updated") {
            runtime.logError(
              "ai.config.concurrency-update",
              new Error("Library Worker did not acknowledge the AI concurrency update."),
              { concurrencyLimit: savedConfig.concurrencyLimit },
            );
          }
        } catch (error) {
          // Saving stays durable even if the Worker is restarting. The next
          // queue batch always reapplies this value before dispatching work.
          runtime.logError("ai.config.concurrency-update", error, {
            concurrencyLimit: savedConfig.concurrencyLimit,
          });
        }
      }
      return { ok: true, type: "ai.config.saved" } satisfies RendererResult;
    }
    case "ai.test-connection.request": {
      // Resolve credentials here so a missing key returns AI_NOT_CONFIGURED
      // instead of the generic CANCELLED path from commandFor().
      let apiKey = request.apiKey?.trim() ?? "";
      if (!apiKey) {
        try {
          apiKey = runtime.getDecryptedApiKey();
        } catch {
          return {
            ok: false,
            error: createPublicError("AI_ANALYSIS_FAILED", "AI_NOT_CONFIGURED"),
          } satisfies RendererResult;
        }
      }
      if (!runtime.workerAvailable()) throw new Error("Library Worker is unavailable.");
      const workerResult = await runtime.requestWorker({
        type: "ai.test-connection",
        apiFormat: request.apiFormat,
        model: request.model,
        apiKey,
        ...(request.baseUrl?.trim()
          ? { baseUrl: request.baseUrl.trim() }
          : {}),
      });
      if (!workerResult.ok) {
        return {
          ok: false,
          error: workerResult.error,
        } satisfies RendererResult;
      }
      if (workerResult.type !== "ai.test-connection.result") {
        return {
          ok: false,
          error: createPublicError("AI_ANALYSIS_FAILED"),
        } satisfies RendererResult;
      }
      return {
        ok: true,
        type: "ai.test-connection.result",
        success: workerResult.success,
        ...(workerResult.errorKind
          ? { errorKind: workerResult.errorKind }
          : {}),
        ...(workerResult.reason ? { reason: workerResult.reason } : {}),
      } satisfies RendererResult;
    }
    case "ai.list-models.request": {
      let apiKey = request.apiKey?.trim() ?? "";
      if (!apiKey) {
        try {
          apiKey = runtime.getDecryptedApiKey();
        } catch {
          return {
            ok: true,
            type: "ai.list-models.result",
            models: [],
            errorKind: "auth",
            reason: "API key is required to list models.",
          } satisfies RendererResult;
        }
      }
      const listed = await listAiModels({
        apiFormat: request.apiFormat,
        apiKey,
        baseUrl: request.baseUrl,
      });
      if (!listed.ok) {
        return {
          ok: true,
          type: "ai.list-models.result",
          models: [],
          errorKind: listed.errorKind,
          reason: listed.reason,
        } satisfies RendererResult;
      }
      return {
        ok: true,
        type: "ai.list-models.result",
        models: listed.models,
      } satisfies RendererResult;
    }
    case "ai.search-plan.request": {
      const config = runtime.loadAiConfig();
      if (!config.hasKey || !config.disclaimerAccepted) {
        runtime.logInfo(
          "ai.search-plan.unavailable",
          "AI search requires configured credentials and accepted disclosure.",
          {
            apiFormat: config.apiFormat,
            hasKey: config.hasKey,
            disclaimerAccepted: config.disclaimerAccepted,
          },
        );
        return {
          ok: false,
          error: createPublicError("AI_SEARCH_FAILED", "AI_NOT_CONFIGURED"),
        } satisfies RendererResult;
      }
      let apiKey: string;
      try {
        apiKey = runtime.getDecryptedApiKey();
      } catch (caught) {
        runtime.logError("ai.search-plan.credentials", caught, {
          apiFormat: config.apiFormat,
        });
        return {
          ok: false,
          error: createPublicError("AI_SEARCH_FAILED", "AI_NOT_CONFIGURED"),
        } satisfies RendererResult;
      }
      try {
        const plan = await planAiSearch({
          apiFormat: config.apiFormat,
          model: config.model,
          apiKey,
          baseUrl: config.baseUrl,
          languages: config.languages,
          naturalQuery: request.naturalQuery,
        });
        runtime.logInfo("ai.search-plan.completed", "AI search plan validated.", {
          apiFormat: config.apiFormat,
          model: config.model,
          keywordCount: plan.keywords.length,
          synonymCount: plan.synonyms.length,
          exclusionCount: plan.exclusions.length,
          filterCount: plan.filters.length,
        });
        return {
          ok: true,
          type: "ai.search-plan.result",
          plan,
          apiFormat: config.apiFormat,
          model: config.model,
        } satisfies RendererResult;
      } catch (caught) {
        const reason = aiSearchFailureReason(caught);
        runtime.logError("ai.search-plan.failed", caught, {
          apiFormat: config.apiFormat,
          model: config.model,
          reason,
        });
        return {
          ok: false,
          error: createPublicError("AI_SEARCH_FAILED", reason),
        } satisfies RendererResult;
      }
    }
    default:
      return undefined;
  }
}
