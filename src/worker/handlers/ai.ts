import path from 'node:path';
import type { ParentPort } from 'electron';
import type { WorkerRequest } from '../../shared/protocol/requests';
import type { AiProgressEvent, WorkerResult } from '../../shared/protocol/responses';
import { OpenAIVendorAdapter } from '../ai/openai-adapter';
import { GeminiVendorAdapter } from '../ai/gemini-adapter';
import { AnthropicVendorAdapter } from '../ai/anthropic-adapter';
import { DashScopeVendorAdapter } from '../ai/dashscope-adapter';
import {
  DEFAULT_AI_ANALYSIS_SETTINGS,
  normalizeAiAnalysisSettings,
} from '../../shared/ai-analysis-settings';
import { apiFormatLimiterKey, formatAiLanguagesForPrompt } from '../../shared/ai-endpoints';
import { VendorAdapterError } from '../ai/vendor-adapter';
import type { VendorAdapter } from '../ai/vendor-adapter';
import { applyAiOutputPolicy, type AiAnalysisRequest } from '../ai/protocol';
import {
  AI_ARTIFACT_PENDING_CODES,
  AI_ARTIFACT_PENDING_MAX_ATTEMPTS,
  findVendorError,
  safeAiConnectionFailure,
  safeAiDiagnostic,
  safeAiErrorDetail,
  vendorFailure,
} from '../ai/error-mapping';
import type { AiJobAbortRegistry } from '../ai/job-abort-registry';
import { loadAiImageInput } from '../ai/image-input';
import { loadVideoAiInput } from '../ai/video-input';
import {
  DEFAULT_AI_ANALYSIS_IMAGE_EDGE_PX,
  normalizeAiAnalysisImageEdgePx,
} from '../../shared/ai-analysis-image';
import type { ProviderConcurrencyLimiter } from '../ai/provider-concurrency-limiter';
import { runLimitedAiRequest } from '../ai/limited-request';
import { DEFAULT_AI_RELIABILITY_SETTINGS } from '../../shared/ai-reliability';
import { LibraryServiceError, type LibraryService } from '../library-service';

export type AiAnalysisControls = {
  jobId: string;
  signal: AbortSignal;
  canWrite: () => boolean;
  requestTimeoutMs: number;
  /**
   * Release the outer ai.process-queue admission while doing media/provider
   * work, then reacquire it before the caller continues to its next short
   * claim/commit section. Direct asset.analyze requests leave this undefined.
   */
  runExternal?: <T>(work: () => Promise<T> | T) => Promise<T>;
};

export type AiRuntime = {
  analysisControls: Map<string, AiAnalysisControls>;
  publishAiProgress: (
    libraryId: string,
    changedJob?: NonNullable<AiProgressEvent['changedJobs']>[number],
  ) => void;
  aiJobAbortRegistry: AiJobAbortRegistry;
  providerConcurrencyLimiter: ProviderConcurrencyLimiter;
  aiProcessBatchAbortControllers: Map<string, AbortController>;
  parentPort: ParentPort | undefined;
  runWithoutAdmission: <T>(requestId: string, work: () => Promise<T> | T) => Promise<T>;
};

const WORKER_CMD_LOG = process.env.SERPENT_WORKER_CMD_LOG === '1';
const MODEL_FILE_EXTENSIONS = new Set(['.fbx', '.obj', '.glb', '.gltf', '.stl']);

function isModelFileFormat(filePath: string): boolean {
  return MODEL_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function logAiProcessPhase(input: {
  phase: 'claim' | 'prepare' | 'external-await' | 'commit';
  requestId: string;
  libraryId: string;
  jobId?: string;
  startedAt: number;
  outcome?: string;
}): void {
  if (!WORKER_CMD_LOG) return;
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    scope: 'worker.ai.phase',
    phase: input.phase,
    requestId: input.requestId,
    libraryId: input.libraryId,
    ...(input.jobId === undefined ? {} : { jobId: input.jobId }),
    durationMs: Math.round((performance.now() - input.startedAt) * 100) / 100,
    ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
  }));
}

function aiQueueFailure(error: unknown): {
  errorCode: string;
  retryable: boolean;
  maxAttempts?: number;
} {
  const vendorError = findVendorError(error);
  if (vendorError) {
    const failure = vendorFailure(vendorError);
    return { errorCode: failure.errorCode, retryable: failure.retryable };
  }
  if (error instanceof LibraryServiceError) {
    if (error.code === 'AI_ANALYSIS_FAILED' && error.reason) {
      if (AI_ARTIFACT_PENDING_CODES.has(error.reason)) {
        return {
          errorCode: error.reason,
          retryable: true,
          maxAttempts: AI_ARTIFACT_PENDING_MAX_ATTEMPTS,
        };
      }
      return {
        errorCode: error.reason,
        retryable: error.retryable
          ?? (error.reason === 'AI_NETWORK'
            || error.reason === 'AI_TIMEOUT'
            || error.reason === 'AI_RATE_LIMIT'),
      };
    }
    return { errorCode: error.code, retryable: false };
  }
  return { errorCode: 'AI_INTERNAL_ERROR', retryable: false };
}

function safeAiJobState(libraryService: LibraryService, libraryId: string, jobId: string): string | null {
  try {
    return libraryService.getAiJobState(libraryId, jobId);
  } catch (error) {
    if (error instanceof LibraryServiceError && error.code === 'LIBRARY_NOT_OPEN') return null;
    throw error;
  }
}

export async function executeAiWorkerCommand(
  libraryService: LibraryService,
  request: WorkerRequest,
  hooks: AiRuntime,
): Promise<WorkerResult | undefined> {
  switch (request.command.type) {
    case 'asset.analyze': {
      const {
        libraryId,
        assetId,
        apiFormat,
        model,
        apiKey,
        enabledFields,
        analysisSettings: rawAnalysisSettings,
        languages,
        baseUrl,
        maxAnalysisImageEdgePx: rawMaxEdge,
      } = request.command;
      const resolvedBaseUrl = baseUrl?.trim() || undefined;
      const language = formatAiLanguagesForPrompt(languages);
      const maxAnalysisImageEdgePx = normalizeAiAnalysisImageEdgePx(
        rawMaxEdge ?? DEFAULT_AI_ANALYSIS_IMAGE_EDGE_PX,
      );
      const analysisSettings = normalizeAiAnalysisSettings({
        ...DEFAULT_AI_ANALYSIS_SETTINGS,
        ...rawAnalysisSettings,
        descriptionEnabled: enabledFields.description,
        tagEnabled: enabledFields.tags,
        ratingEnabled: enabledFields.rating,
      });
      const controls = hooks.analysisControls.get(request.requestId);
      const prepareStartedAt = performance.now();
      const runExternal = <T>(work: () => Promise<T> | T): Promise<T> =>
        controls?.runExternal ? controls.runExternal(work) : Promise.resolve().then(work);

      // Resolve asset file path + mime.
      const { filePath, mime, isVideo } = libraryService.resolveAssetFilePath(
        libraryId,
        assetId,
      );

      let imageBase64: string | undefined;
      let contactSheetBase64: string | undefined;
      let contactSheetMime: string | undefined;
      let contactSheetDescription: string | undefined;
      let requestMime: string;

      if (isVideo) {
        // Serpent-140fe2: contact sheets are generated lazily at analysis time
        // (never proactively scheduled), so materialize it for this video now.
        try {
          await runExternal(() => libraryService.ensureVideoContactSheet(libraryId, assetId, {
            signal: controls?.signal,
          }));
        } catch (error) {
          if (controls?.signal.aborted) throw error;
          libraryService.reportDiagnostic('ai.contact-sheet.ensure', error, {
            libraryId,
            assetId,
          });
        }
        try {
          const input = await runExternal(() => loadVideoAiInput({
              libraryId,
              assetId,
              maxEdgePx: maxAnalysisImageEdgePx,
              service: libraryService,
              signal: controls?.signal,
            }));
          contactSheetBase64 = input.contactSheetBase64;
          contactSheetMime = input.contactSheetMime;
          contactSheetDescription = input.contactSheetDescription;
          requestMime = input.mime;
        } catch {
          return {
            ok: true,
            type: 'asset.analyze-unsupported' as const,
            assetId,
            reason: 'CONTACT_SHEET_REQUIRED',
          };
        }
      } else if (mime.startsWith('image/')) {
        // Resize source to the configured longest-edge cap (default 2K).
        // Unreadable originals (e.g. some EXR) fall back to the thumbnail.
        try {
          const imageInput = await runExternal(() => loadAiImageInput(
              libraryService,
              libraryId,
              assetId,
              {
                sourcePath: filePath,
                maxEdgePx: maxAnalysisImageEdgePx,
                signal: controls?.signal,
              },
            ));
          imageBase64 = imageInput.imageBase64;
          requestMime = imageInput.mime;
        } catch (error) {
          throw new LibraryServiceError('AI_ANALYSIS_FAILED', {
            cause: error,
            reason: error instanceof LibraryServiceError
              ? (error.reason ?? 'THUMBNAIL_REQUIRED')
              : 'THUMBNAIL_REQUIRED',
          });
        }
      } else if (isModelFileFormat(filePath)) {
        // Serpent-6w40: 3D models get an AI four-view sheet — render the
        // views offscreen, tile them, then analyze the strip.
        try {
          const sheet = await runExternal(() => libraryService.renderModelViewsSheet(
              { libraryId, assetId },
              controls?.signal ?? new AbortController().signal,
            ));
          // The strip is already ≤2048 wide (4×512) — send it as-is.
          imageBase64 = Buffer.from(sheet.pngBytes).toString('base64');
          requestMime = sheet.mime;
        } catch {
          return {
            ok: true,
            type: 'asset.analyze-unsupported' as const,
            assetId,
            reason: 'THUMBNAIL_REQUIRED',
          };
        }
      } else {
        // Non-image, non-video assets (e.g., .txt, .pdf).
        return {
          ok: true,
          type: 'asset.analyze-unsupported' as const,
          assetId,
          reason: `unsupported mime type: ${mime}`,
        };
      }

      const filename = filePath.split(/[/\\]/).pop() ?? 'asset';

      // F8: skip AI description when human description already exists.
      const skipDescription =
        enabledFields.description &&
        libraryService.hasHumanDescription(libraryId, assetId);
      const effectiveEnabled = {
        description: enabledFields.description && !skipDescription,
        tags: enabledFields.tags,
        rating: enabledFields.rating,
      };
      if (
        !effectiveEnabled.description &&
        !effectiveEnabled.tags &&
        !effectiveEnabled.rating
      ) {
        return {
          ok: true,
          type: 'asset.analyze-unsupported' as const,
          assetId,
          reason: 'NO_AI_FIELDS_TO_WRITE',
        };
      }

      const folderId = libraryService.getAssetManagedFolderId(libraryId, assetId);
      const existingTagNames = libraryService.listTagNamesForAiPrompt(
        libraryId,
        folderId,
        100,
      );

      const displayName = libraryService.getAssetDisplayName(libraryId, assetId);
      const aiRequest: AiAnalysisRequest = {
        displayName,
        filename,
        mime: requestMime,
        mediaType: isModelFileFormat(filePath) ? 'model' : (isVideo ? 'video' : 'image'),
        imageBase64,
        contactSheetBase64,
        contactSheetMime,
        contactSheetDescription,
        language,
        enabledFields: effectiveEnabled,
        existingTagNames,
        analysisSettings,
      };

      logAiProcessPhase({
        phase: 'prepare',
        requestId: request.requestId,
        libraryId,
        ...(controls?.jobId === undefined ? {} : { jobId: controls.jobId }),
        startedAt: prepareStartedAt,
        outcome: 'ready',
      });

      // Create adapter based on CC Switch wire apiFormat.
      let adapter: VendorAdapter;
      switch (apiFormat) {
        case 'dashscope_native':
          adapter = new DashScopeVendorAdapter(apiKey, model, undefined, resolvedBaseUrl);
          break;
        case 'openai_chat':
          adapter = new OpenAIVendorAdapter(
            apiKey,
            model,
            undefined,
            resolvedBaseUrl,
            'openai_chat',
          );
          break;
        case 'openai_responses':
          adapter = new OpenAIVendorAdapter(
            apiKey,
            model,
            undefined,
            resolvedBaseUrl,
            'openai_responses',
          );
          break;
        case 'gemini_native':
          adapter = new GeminiVendorAdapter(apiKey, model, undefined, resolvedBaseUrl);
          break;
        case 'anthropic':
          adapter = new AnthropicVendorAdapter(apiKey, model, undefined, resolvedBaseUrl);
          break;
        default:
          return {
            ok: true,
            type: 'asset.analyze-unsupported' as const,
            assetId,
            reason: `apiFormat ${apiFormat as string} not supported`,
          };
      }

      let analysisResult;
      const externalStartedAt = performance.now();
      try {
        analysisResult = await runExternal(() => runLimitedAiRequest(
            hooks.providerConcurrencyLimiter,
            apiFormatLimiterKey(apiFormat),
            controls?.signal,
            controls?.requestTimeoutMs
              ?? DEFAULT_AI_RELIABILITY_SETTINGS.requestTimeoutMs,
            (requestSignal) => adapter.analyze(aiRequest, requestSignal),
          ));
        logAiProcessPhase({
          phase: 'external-await',
          requestId: request.requestId,
          libraryId,
          ...(controls?.jobId === undefined ? {} : { jobId: controls.jobId }),
          startedAt: externalStartedAt,
          outcome: 'completed',
        });
      } catch (error) {
        logAiProcessPhase({
          phase: 'external-await',
          requestId: request.requestId,
          libraryId,
          ...(controls?.jobId === undefined ? {} : { jobId: controls.jobId }),
          startedAt: externalStartedAt,
          outcome: controls?.signal.aborted ? 'aborted' : 'error',
        });
        if (error instanceof VendorAdapterError) {
          const failure = vendorFailure(error);
          throw new LibraryServiceError('AI_ANALYSIS_FAILED', {
            cause: safeAiDiagnostic(failure.errorCode, error),
            reason: failure.reason,
            retryable: failure.retryable,
          });
        }
        throw error;
      }

      if (controls && (controls.signal.aborted || !controls.canWrite())) {
        return {
          ok: true,
          type: 'asset.analyze-unsupported' as const,
          assetId,
          reason: 'AI_JOB_INTERRUPTED',
        };
      }

      analysisResult = applyAiOutputPolicy(analysisResult, {
        settings: analysisSettings,
        existingTagNames,
        language,
      });

      const commitStartedAt = performance.now();
      const { tagsWritten, fieldsWritten, committed } = libraryService.writeAiAnalysisResult({
        libraryId,
        assetId,
        description: analysisResult.description,
        tags: analysisResult.tags,
        rating: analysisResult.rating,
        modelId: model,
        modelVersion: analysisResult.modelVersion,
        guardJobId: controls?.jobId,
        enabledFields: effectiveEnabled,
      });
      logAiProcessPhase({
        phase: 'commit',
        requestId: request.requestId,
        libraryId,
        ...(controls?.jobId === undefined ? {} : { jobId: controls.jobId }),
        startedAt: commitStartedAt,
        outcome: committed ? 'completed' : 'rejected',
      });

      if (!committed || (controls && (controls.signal.aborted || !controls.canWrite()))) {
        return {
          ok: true,
          type: 'asset.analyze-unsupported' as const,
          assetId,
          reason: 'AI_JOB_INTERRUPTED',
        };
      }

      const generatedFields: {
        description?: string;
        tags?: string[];
        rating?: number;
      } = {};
      if (tagsWritten.length > 0) generatedFields.tags = tagsWritten;
      if (fieldsWritten.includes('description') && analysisResult.description) {
        generatedFields.description = analysisResult.description;
      }
      if (fieldsWritten.includes('rating') && analysisResult.rating != null) {
        generatedFields.rating = analysisResult.rating;
      }

      hooks.parentPort?.postMessage({
        type: 'ai.analysis.completed',
        libraryId,
        assetId,
        fieldCount: fieldsWritten.length,
        tagCount: tagsWritten.length,
      });

      return {
        ok: true,
        type: 'asset.analyzed' as const,
        assetId,
        generatedFields,
        modelVersion: analysisResult.modelVersion,
      };
    }
    case 'ai.content.get': {
      const { libraryId, assetId } = request.command;
      const rows = libraryService.getAiContent(libraryId, assetId);
      const tags = libraryService.listAiTagNames(libraryId, assetId);
      let description: string | null = null;
      let rating: number | null = null;
      let modelVersion: string | null = null;
      for (const row of rows) {
        modelVersion = row.modelVersion;
        if (row.fieldName === 'description') description = row.value;
        if (row.fieldName === 'rating') {
          const parsed = Number.parseInt(row.value, 10);
          if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 5) {
            rating = parsed;
          }
        }
      }
      if (!modelVersion) {
        modelVersion = libraryService.getAiTagModelVersion(libraryId, assetId);
      }
      return {
        ok: true,
        type: 'ai.content.got' as const,
        assetId,
        description,
        tags,
        rating,
        modelVersion,
      };
    }
    case 'ai.configure': {
      // The Worker caches configuration in-memory; the caller should
      // pass encryptedApiKey in each analyze call. This configure
      // just acknowledges receipt.
      // In a future slice, this could cache the decrypted key in memory.
      return { ok: true, type: 'ai.config.saved' as const };
    }
    case 'ai.test-connection': {
      // Main already decrypted via safeStorage; Worker receives ephemeral plaintext
      // (same trust boundary as asset.analyze / ai.process-queue).
      const { apiFormat, model, apiKey, baseUrl } = request.command;
      const resolvedBaseUrl = baseUrl?.trim() || undefined;

      // Build a minimal adapter and try a request.
      let testAdapter: VendorAdapter;
      switch (apiFormat) {
        case 'dashscope_native':
          testAdapter = new DashScopeVendorAdapter(apiKey, model, undefined, resolvedBaseUrl);
          break;
        case 'openai_chat':
          testAdapter = new OpenAIVendorAdapter(
            apiKey,
            model,
            undefined,
            resolvedBaseUrl,
            'openai_chat',
          );
          break;
        case 'openai_responses':
          testAdapter = new OpenAIVendorAdapter(
            apiKey,
            model,
            undefined,
            resolvedBaseUrl,
            'openai_responses',
          );
          break;
        case 'gemini_native':
          testAdapter = new GeminiVendorAdapter(apiKey, model, undefined, resolvedBaseUrl);
          break;
        case 'anthropic':
          testAdapter = new AnthropicVendorAdapter(apiKey, model, undefined, resolvedBaseUrl);
          break;
        default:
          return {
            ok: true,
            type: 'ai.test-connection.result' as const,
            success: false,
            errorKind: 'invalid_response',
            reason: `Unsupported apiFormat: ${apiFormat as string}`,
          };
      }

      // Lightweight probe — no vision / tool_use / json_schema (avoids
      // midstream "Expected tool_use but got text" false negatives).
      try {
        await testAdapter.probeConnection(AbortSignal.timeout(15_000));
        return {
          ok: true,
          type: 'ai.test-connection.result' as const,
          success: true,
        };
      } catch (error) {
        const failure = safeAiConnectionFailure(error);
        const errorCode = `AI_${failure.errorKind.toUpperCase()}`;
        libraryService.reportDiagnostic(
          'ai.connection.test',
          safeAiDiagnostic(errorCode, error),
          { apiFormat, model, errorCode },
        );
        return {
          ok: true,
          type: 'ai.test-connection.result' as const,
          success: false,
          errorKind: failure.errorKind,
          reason: failure.reason,
        };
      }
    }
    case 'ai.enqueue-analysis': {
      const { enqueued, jobIds, alreadyPendingJobIds, skippedAssetIds } = libraryService.enqueueAiAnalysisJobs(request.command);
      hooks.publishAiProgress(request.command.libraryId);
      return {
        ok: true,
        type: 'ai.jobs.enqueued' as const,
        libraryId: request.command.libraryId,
        enqueued,
        jobIds,
        alreadyPendingJobIds,
        skippedAssetIds,
      };
    }
    case 'ai.pending-assets.request': {
      return {
        ok: true,
        type: 'ai.pending-assets' as const,
        assetIds: libraryService.pendingAiAssets(request.command),
      };
    }
    case 'ai.process-queue': {
      const {
        libraryId,
        maxJobs,
        concurrencyLimit,
        requestTimeoutMs,
        maxAttempts,
        ...analysisConfig
      } = request.command;
      // This is a process-wide cap. Setting it here makes a saved preference
      // take effect for the next queue batch without restarting Serpent, while
      // the limiter lets already in-flight requests finish safely.
      hooks.providerConcurrencyLimiter.setLimit(concurrencyLimit);
      let processed = 0;
      let succeeded = 0;
      let failed = 0;
      let requeued = 0;
      const attemptedJobIds: string[] = [];
      const batchAbortController = new AbortController();
      hooks.aiProcessBatchAbortControllers.set(request.requestId, batchAbortController);

      const processLane = async (): Promise<void> => {
        while (processed < maxJobs && !batchAbortController.signal.aborted) {
          const claimStartedAt = performance.now();
          const job = libraryService.claimNextAiJob(libraryId, attemptedJobIds);
          logAiProcessPhase({
            phase: 'claim',
            requestId: request.requestId,
            libraryId,
            ...(job === null ? {} : { jobId: job.jobId }),
            startedAt: claimStartedAt,
            outcome: job === null ? 'empty' : 'claimed',
          });
          if (!job) break;
          attemptedJobIds.push(job.jobId);
          processed++;
          hooks.publishAiProgress(libraryId, { jobId: job.jobId, status: 'running' });
          const controller = hooks.aiJobAbortRegistry.register(libraryId, job.jobId);
          const nestedRequestId = `${request.requestId}:${job.jobId}`;
          hooks.analysisControls.set(nestedRequestId, {
            jobId: job.jobId,
            signal: controller.signal,
            canWrite: () => safeAiJobState(libraryService, libraryId, job.jobId) === 'running',
            requestTimeoutMs,
            runExternal: <T>(work: () => Promise<T> | T) =>
              hooks.runWithoutAdmission(request.requestId, work),
          });
          try {
            const nestedResult = await executeAiWorkerCommand(libraryService, {
              requestId: nestedRequestId,
              command: {
                type: 'asset.analyze',
                libraryId,
                assetId: job.assetId,
                apiFormat: analysisConfig.apiFormat,
                model: analysisConfig.model,
                apiKey: analysisConfig.apiKey,
                baseUrl: analysisConfig.baseUrl,
                enabledFields: analysisConfig.enabledFields,
                analysisSettings: analysisConfig.analysisSettings,
                languages: analysisConfig.languages,
                maxAnalysisImageEdgePx: analysisConfig.maxAnalysisImageEdgePx,
              },
            }, hooks);
            if (nestedResult === undefined) {
              throw new Error('Unhandled nested asset.analyze command');
            }
            const result = nestedResult;
            if (controller.signal.aborted || safeAiJobState(libraryService, libraryId, job.jobId) !== 'running') {
              continue;
            }
            if (!result.ok || result.type !== 'asset.analyzed') {
              const errorCode = !result.ok
                ? result.error.code
                : result.type === 'asset.analyze-unsupported'
                  ? result.reason
                  : 'AI_INTERNAL_ERROR';
              const artifactPending = AI_ARTIFACT_PENDING_CODES.has(errorCode);
              const detail = safeAiErrorDetail(
                errorCode,
                !result.ok
                  ? result.error.message
                  : result.type === 'asset.analyze-unsupported'
                    ? result.reason
                    : undefined,
              );
              libraryService.reportDiagnostic(
                'ai.queue.analysis',
                safeAiDiagnostic(errorCode),
                { libraryId, jobId: job.jobId, assetId: job.assetId, errorCode },
              );
              const commitStartedAt = performance.now();
              const failure = libraryService.failAiJob(libraryId, job.jobId, {
                errorCode,
                retryable: artifactPending,
                maxAttempts: artifactPending
                  ? AI_ARTIFACT_PENDING_MAX_ATTEMPTS
                  : maxAttempts,
                errorDetail: detail,
              });
              logAiProcessPhase({
                phase: 'commit',
                requestId: request.requestId,
                libraryId,
                jobId: job.jobId,
                startedAt: commitStartedAt,
                outcome: `job-state-${failure.status}`,
              });
              if (failure.status === 'queued') requeued++;
              else failed++;
              hooks.publishAiProgress(libraryId, {
                jobId: job.jobId,
                status: failure.status,
                errorCode,
              });
              continue;
            }
            const commitStartedAt = performance.now();
            libraryService.completeAiJob(libraryId, job.jobId);
            logAiProcessPhase({
              phase: 'commit',
              requestId: request.requestId,
              libraryId,
              jobId: job.jobId,
              startedAt: commitStartedAt,
              outcome: 'job-state-completed',
            });
            succeeded++;
            hooks.publishAiProgress(libraryId, { jobId: job.jobId, status: 'succeeded' });
          } catch (error) {
            if (controller.signal.aborted || safeAiJobState(libraryService, libraryId, job.jobId) !== 'running') {
              continue;
            }
            const classification = aiQueueFailure(error);
            libraryService.reportDiagnostic(
              'ai.queue.analysis',
              safeAiDiagnostic(classification.errorCode, error),
              { libraryId, jobId: job.jobId, assetId: job.assetId, errorCode: classification.errorCode },
            );
            const commitStartedAt = performance.now();
            const failure = libraryService.failAiJob(libraryId, job.jobId, {
              ...classification,
              maxAttempts: classification.maxAttempts ?? maxAttempts,
              errorDetail: safeAiErrorDetail(classification.errorCode, error),
            });
            logAiProcessPhase({
              phase: 'commit',
              requestId: request.requestId,
              libraryId,
              jobId: job.jobId,
              startedAt: commitStartedAt,
              outcome: `job-state-${failure.status}`,
            });
            if (failure.status === 'queued') requeued++;
            else failed++;
            hooks.publishAiProgress(libraryId, {
              jobId: job.jobId,
              status: failure.status,
              errorCode: classification.errorCode,
            });
          } finally {
            hooks.analysisControls.delete(nestedRequestId);
            hooks.aiJobAbortRegistry.unregister(job.jobId);
          }
        }
      };

      // Keep the outer request admitted so claim and commit stay short,
      // scheduler-accounted sections. Each media/provider await uses the
      // per-analysis runExternal callback above to release this admission and
      // reacquire it before the next local section. This prevents a whole
      // bounded wave from becoming one opaque owner while preserving the
      // single-threaded claim/commit ordering.
      try {
        await Promise.all(
          Array.from({ length: Math.min(concurrencyLimit, maxJobs) }, () => processLane()),
        );
        return {
          ok: true,
          type: 'ai.jobs.processed' as const,
          libraryId,
          processed,
          succeeded,
          failed,
          requeued,
        };
      } finally {
        hooks.aiProcessBatchAbortControllers.delete(request.requestId);
      }
    }
    case 'ai.set-concurrency-limit': {
      hooks.providerConcurrencyLimiter.setLimit(request.command.concurrencyLimit);
      return {
        ok: true,
        type: 'ai.concurrency.updated' as const,
        concurrencyLimit: request.command.concurrencyLimit,
      };
    }
    case 'ai.clear-content': {
      const { clearedCount, affectedAssetIds } = libraryService.clearAiContent(request.command);
      // Publish ai.content.cleared event
      if (hooks.parentPort) {
        hooks.parentPort.postMessage({
          type: 'ai.content.cleared',
          libraryId: request.command.libraryId,
          affectedAssetCount: clearedCount,
          affectedAssetIds,
        });
      }
      return {
        ok: true,
        type: 'ai.content.cleared' as const,
        libraryId: request.command.libraryId,
        clearedCount,
        affectedAssetIds,
      };
    }
    case 'ai.pause-jobs': {
      const { pausedCount } = libraryService.pauseJobs(
        request.command.libraryId,
        request.command.jobIds,
      );
      hooks.aiJobAbortRegistry.abort(request.command.libraryId, request.command.jobIds);
      hooks.publishAiProgress(request.command.libraryId);
      return {
        ok: true,
        type: 'ai.jobs.paused' as const,
        libraryId: request.command.libraryId,
        pausedCount,
      };
    }
    case 'ai.resume-jobs': {
      const { resumedCount } = libraryService.resumeJobs(
        request.command.libraryId,
        request.command.jobIds,
      );
      hooks.publishAiProgress(request.command.libraryId);
      return {
        ok: true,
        type: 'ai.jobs.resumed' as const,
        libraryId: request.command.libraryId,
        resumedCount,
      };
    }
    case 'ai.cancel-jobs': {
      const { cancelledCount } = libraryService.cancelJobs(
        request.command.libraryId,
        request.command.jobIds,
      );
      hooks.aiJobAbortRegistry.abort(request.command.libraryId, request.command.jobIds);
      hooks.publishAiProgress(request.command.libraryId);
      return {
        ok: true,
        type: 'ai.jobs.cancelled' as const,
        libraryId: request.command.libraryId,
        cancelledCount,
      };
    }
    case 'ai.retry-jobs': {
      const { retriedCount } = libraryService.retryJobs(
        request.command.libraryId,
        request.command.jobIds,
      );
      hooks.publishAiProgress(request.command.libraryId);
      return {
        ok: true,
        type: 'ai.jobs.retried' as const,
        libraryId: request.command.libraryId,
        retriedCount,
      };
    }
    case 'ai.status': {
      const status = libraryService.getAiJobStatus(
        request.command.libraryId,
        request.command.jobIds,
      );
      return {
        ok: true,
        type: 'ai.jobs.status' as const,
        libraryId: request.command.libraryId,
        ...status,
      };
    }
    default:
      return undefined;
  }
}
