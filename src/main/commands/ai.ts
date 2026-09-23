import type { RendererRequest, WorkerCommand } from "../../shared/protocol/requests";
import { toWireAiAnalysisSettings } from "../../shared/ai-analysis-settings";
import type { AiAnalysisSettings } from "../../shared/ai-analysis-settings";
import type { AiApiFormat } from "../../shared/ai-endpoints";

export type AiCommandConfig = {
  hasKey: boolean;
  apiFormat?: AiApiFormat;
  model: string;
  baseUrl: string;
  descriptionEnabled: boolean;
  tagEnabled: boolean;
  ratingEnabled: boolean;
  analysisSettings: AiAnalysisSettings;
  languages: Array<"zh-CN" | "en" | "ja" | "ko">;
  maxAnalysisImageEdgePx: number;
};

export type AiCommandRuntime = {
  loadAiConfig: () => AiCommandConfig;
  getDecryptedApiKey: () => string;
};

export function executeAiMainCommand(
  request: RendererRequest,
  runtime: AiCommandRuntime,
): WorkerCommand | undefined {
  switch (request.type) {
    case "ai.config.get.request":
    case "ai.config.set.request":
    case "ai.list-models.request":
      // Handled directly in handleLibraryRequest — should never reach here.
      return undefined;
    case "ai.test-connection.request": {
      // Resolve plaintext key in Main (safeStorage lives here). Pass ephemeral
      // plaintext to Worker on the private channel — same pattern as asset.analyze.
      // Do not re-encrypt for Worker: UtilityProcess cannot decrypt Main ciphertext.
      let apiKey = request.apiKey?.trim() ?? "";
      if (!apiKey) {
        try {
          apiKey = runtime.getDecryptedApiKey();
        } catch {
          return undefined;
        }
      }
      return {
        type: "ai.test-connection",
        apiFormat: request.apiFormat,
        model: request.model,
        apiKey,
        ...(request.baseUrl?.trim()
          ? { baseUrl: request.baseUrl.trim() }
          : {}),
      };
    }
    case "ai.clear-content.request":
      return {
        type: "ai.clear-content",
        libraryId: request.libraryId,
        scope: request.scope,
        confirm: request.confirm,
        ...(request.fields ? { fields: request.fields } : {}),
      };
    case "ai.pause-jobs.request":
      return {
        type: "ai.pause-jobs",
        libraryId: request.libraryId,
        jobIds: request.jobIds,
      };
    case "ai.resume-jobs.request":
      return {
        type: "ai.resume-jobs",
        libraryId: request.libraryId,
        jobIds: request.jobIds,
      };
    case "ai.cancel-jobs.request":
      return {
        type: "ai.cancel-jobs",
        libraryId: request.libraryId,
        jobIds: request.jobIds,
      };
    case "ai.retry-jobs.request":
      return {
        type: "ai.retry-jobs",
        libraryId: request.libraryId,
        jobIds: request.jobIds,
      };
    case "ai.status.request":
      return {
        type: "ai.status",
        libraryId: request.libraryId,
        ...(request.jobIds ? { jobIds: request.jobIds } : {}),
      };
    case "ai.pending-assets.request":
      return {
        type: "ai.pending-assets.request",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
      };
    case "asset.analyze.request": {
      const config = runtime.loadAiConfig();
      if (!config.hasKey) return undefined; // Will be handled as error downstream.
      if (!config.apiFormat) return undefined;
      let apiKey: string;
      try {
        apiKey = runtime.getDecryptedApiKey();
      } catch {
        return undefined;
      }
      return {
        type: "asset.analyze",
        libraryId: request.libraryId,
        assetId: request.assetId,
        apiFormat: config.apiFormat,
        model: config.model,
        apiKey,
        ...(config.baseUrl.trim() ? { baseUrl: config.baseUrl.trim() } : {}),
        enabledFields: {
          description: config.descriptionEnabled,
          tags: config.tagEnabled,
          rating: config.ratingEnabled,
        },
        analysisSettings: toWireAiAnalysisSettings(config.analysisSettings),
        languages: config.languages,
        maxAnalysisImageEdgePx: config.maxAnalysisImageEdgePx,
      };
    }
    case "assets.analyze.request":
      // Handled before generic Worker-command dispatch because it atomically
      // enqueues the whole selected batch and starts the scheduler once.
      return undefined;
    case "ai.content.get.request":
      return {
        type: "ai.content.get",
        libraryId: request.libraryId,
        assetId: request.assetId,
      };
    default:
      return undefined;
  }
}
