import { randomUUID } from 'node:crypto';
import { parseWorkerRequest, type WorkerRequest } from '../shared/protocol/requests';
import {
  parseWorkerControlMessage,
  type WorkerResponse,
  type WorkerResult,
} from '../shared/protocol/responses';
import type { ParentPort } from 'electron';
import {
  BUNDLED_HDRI_PRESET_IDS,
} from '../shared/hdri-presets';
import {
  MODEL_THUMBNAIL_DEFAULT_EDGE,
  MODEL_THUMBNAIL_RENDER_TIMEOUT_MS,
  MODEL_THUMBNAIL_WORKER_REQUEST_TIMEOUT_MS,
  modelThumbnailFormatForFileName,
  parseModelThumbnailRenderResponse,
  type ModelThumbnailSourceAuthorization,
  type ModelThumbnailRenderRequest,
  type ModelThumbnailRenderResult,
} from '../shared/model-thumbnail-protocol';
import { isBenignThumbnailErrorCode } from '../shared/thumbnail-support';
import {
  LibraryService,
  LibraryServiceError,
  type ModelThumbnailRenderOutcome,
} from './library-service';
import { publicErrorForWorkerFailure } from './public-error';
import { OpenAIVendorAdapter } from './ai/openai-adapter';
import { GeminiVendorAdapter } from './ai/gemini-adapter';
import { AnthropicVendorAdapter } from './ai/anthropic-adapter';
import { DashScopeVendorAdapter } from './ai/dashscope-adapter';
import {
  DEFAULT_AI_ANALYSIS_SETTINGS,
  normalizeAiAnalysisSettings,
} from '../shared/ai-analysis-settings';
import { apiFormatLimiterKey, formatAiLanguagesForPrompt } from '../shared/ai-endpoints';
import { VendorAdapterError } from './ai/vendor-adapter';
import type { VendorAdapter } from './ai/vendor-adapter';
import type { AiAnalysisRequest } from './ai/protocol';
import {
  AI_ARTIFACT_PENDING_CODES,
  AI_ARTIFACT_PENDING_MAX_ATTEMPTS,
  findVendorError,
  safeAiConnectionFailure,
  safeAiDiagnostic,
  safeAiErrorDetail,
  vendorFailure,
} from './ai/error-mapping';
import { AiJobAbortRegistry } from './ai/job-abort-registry';
import { readFileSync } from 'node:fs';
import { encodeAiAnalysisImage, loadAiImageInput } from './ai/image-input';
import {
  DEFAULT_AI_ANALYSIS_IMAGE_EDGE_PX,
  normalizeAiAnalysisImageEdgePx,
} from '../shared/ai-analysis-image';
import { ProviderConcurrencyLimiter } from './ai/provider-concurrency-limiter';
import { runLimitedAiRequest } from './ai/limited-request';
import { AiProgressThrottler } from './ai/progress-throttler';
import { DEFAULT_AI_ANALYSIS_CONCURRENCY } from '../shared/ai-concurrency';
import { DEFAULT_AI_RELIABILITY_SETTINGS } from '../shared/ai-reliability';
import { dispatchAutomationReadOnlyRequest } from './automation-readonly-dispatch';
import {
  boundedWriteLibraryId,
  executeBoundedWriteWorkerCommand,
} from './bounded-write-command';
import {
  parsePluginMediaProviderResponse,
  type PluginMediaProviderRequest,
  type PluginMediaProviderResult,
} from '../shared/plugin-media-protocol';
import { handleFbxConvertCommand } from './fbx/convert-command';

const parentPort: ParentPort | undefined = process.parentPort;
const aiJobAbortRegistry = new AiJobAbortRegistry();
const providerConcurrencyLimiter = new ProviderConcurrencyLimiter(
  DEFAULT_AI_ANALYSIS_CONCURRENCY,
);
const aiProgressThrottler = new AiProgressThrottler((event) => parentPort?.postMessage(event));
const analysisControls = new Map<string, {
  jobId: string;
  signal: AbortSignal;
  canWrite: () => boolean;
  requestTimeoutMs: number;
}>();
const activeThumbnailQueues = new Set<string>();
const rescheduledThumbnailQueues = new Set<string>();
const pendingPluginMediaProviderRequests = new Map<string, {
  resolve: (result: PluginMediaProviderResult) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

if (!parentPort) {
  throw new Error('Library Worker must be started by the Electron main process.');
}

const libraryService = new LibraryService({
  onAssetsChanged: (event) => parentPort.postMessage(event),
  onLibraryChanged: (event) => parentPort.postMessage(event),
  onProgress: (event) => parentPort.postMessage(event),
  onDiagnostic: ({ scope, error, context }) => {
    try {
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        scope: `worker.${scope}`,
        context,
        error: errorForLog(error),
      }));
    } catch {
      // A serialization or stderr failure must not change the background operation.
    }
  },
});

// Electron's ParentPort delivers IPC messages but does not provide a documented
// event-loop ref. Development builds happen to have other active handles; a
// packaged utility process can otherwise exit cleanly immediately after ready.
const processLifetime = setInterval(() => {}, 60 * 60_000);

function requestPluginMediaProvider(input: Omit<PluginMediaProviderRequest, 'type' | 'requestId'>): Promise<PluginMediaProviderResult> {
  const requestId = randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingPluginMediaProviderRequests.delete(requestId);
      resolve({
        status: 'native-fallback',
        assetId: input.assetId,
        kind: input.kind,
        errorCode: 'PLUGIN_PROVIDER_TIMEOUT',
      });
    }, 35_000);
    timer.unref?.();
    pendingPluginMediaProviderRequests.set(requestId, { resolve, timer });
    parentPort?.postMessage({
      type: 'plugin-media-provider.request',
      requestId,
      ...input,
    });
  });
}

// ── Slice E: offscreen model-thumbnail render client (Serpent-hnmg) ────

const pendingModelThumbnailRenders = new Map<string, {
  resolve: (result: ModelThumbnailRenderResult) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

/**
 * Ask Main to render one model thumbnail in the shared offscreen window.
 * Resolves with the typed result (never rejects except on abort); a missing
 * Main response degrades to MODEL_RENDER_TIMEOUT after
 * MODEL_THUMBNAIL_WORKER_REQUEST_TIMEOUT_MS.
 */
function requestModelThumbnailRender(
  input: Omit<ModelThumbnailRenderRequest, 'type' | 'requestId'> & {
    sourceAuthorizations: readonly ModelThumbnailSourceAuthorization[];
  },
  signal?: AbortSignal,
): Promise<ModelThumbnailRenderResult> {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingModelThumbnailRenders.delete(requestId);
      resolve({
        status: 'failed',
        errorCode: 'MODEL_RENDER_TIMEOUT',
        reason: 'no render response from Main within the worker deadline',
      });
    }, MODEL_THUMBNAIL_WORKER_REQUEST_TIMEOUT_MS);
    timer.unref?.();
    const onAbort = (): void => {
      clearTimeout(timer);
      pendingModelThumbnailRenders.delete(requestId);
      reject(new DOMException('Model thumbnail render request aborted.', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    pendingModelThumbnailRenders.set(requestId, { resolve, timer });
    parentPort?.postMessage({
      type: 'model-thumbnail.render-request',
      requestId,
      ...input,
    });
  });
}

/**
 * Process-wide single-flight gate: at most ONE model render is in flight at
 * any time (the shared offscreen window renders serially in Main; a second
 * concurrent request would only queue there and fight the worker deadline).
 * The acquire waits for the previous render and honors cancellation.
 */
let modelRenderTail: Promise<void> = Promise.resolve();
async function withModelRenderGate<T>(
  signal: AbortSignal | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = modelRenderTail;
  let release!: () => void;
  modelRenderTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  if (signal?.aborted) {
    release();
    throw new DOMException('Model render cancelled before acquiring the render gate.', 'AbortError');
  }
  try {
    return await fn();
  } finally {
    release();
  }
}

/** URL builders mirror 3d-viewer/url-remap (kept local to avoid a renderer import). */
function modelSourceUrl(libraryId: string, assetId: string, revisionId: string): string {
  return `serpent://source/${libraryId}/${assetId}?revision=${encodeURIComponent(revisionId)}`;
}
function modelPreviewUrl(libraryId: string, artifactId: string): string {
  return `serpent://preview/${libraryId}/${artifactId}`;
}

/**
 * Offscreen render orchestration for one queued model job: format dispatch,
 * FBX→GLB conversion first (a conversion failure fails the job with the typed
 * FBX_* code — the renderer never sees the raw FBX), companion index, then
 * the Main render request.
 */
async function renderModelThumbnailViaMain(input: {
  libraryId: string;
  assetId: string;
  revisionId: string;
  relativeFilePath: string;
  byteSize: number | null;
  signal: AbortSignal;
}): Promise<ModelThumbnailRenderOutcome> {
  // The gate is a global one-render-at-a-time policy, not a per-job failure.
  return withModelRenderGate(input.signal, async () => {
    try {
      return await orchestrateRender(input);
    } catch (error) {
      // Cancellation must propagate so the queue's cancelled path runs;
      // anything else becomes a benign typed failure (card keeps the generic
      // 3D icon, no badge).
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      libraryService.reportDiagnostic('model-thumbnail.orchestrate', error, {
        libraryId: input.libraryId,
        assetId: input.assetId,
      });
      return { status: 'failed', errorCode: 'MODEL_LOAD_FAILED' };
    }
  });
}

async function orchestrateRender(input: {
  libraryId: string;
  assetId: string;
  revisionId: string;
  relativeFilePath: string;
  byteSize: number | null;
  signal: AbortSignal;
}): Promise<ModelThumbnailRenderOutcome> {
    const format = modelThumbnailFormatForFileName(input.relativeFilePath);
    if (!format) {
      return { status: 'failed', errorCode: 'MODEL_LOAD_FAILED' };
    }
    let effectiveFormat: ModelThumbnailRenderRequest['format'] = format;
    let renderUrl: string;
    if (format === 'fbx') {
      // Slice B single-flight conversion; only the cached GLB is rendered.
      const conversion = await handleFbxConvertCommand(libraryService, {
        libraryId: input.libraryId,
        assetId: input.assetId,
      });
      if (conversion.status !== 'ready') {
        return {
          status: 'failed',
          errorCode: conversion.errorCode,
          ...(conversion.reason === undefined ? {} : { reason: conversion.reason }),
        };
      }
      effectiveFormat = 'glb';
      renderUrl = modelPreviewUrl(input.libraryId, conversion.glbArtifactId);
    } else {
      renderUrl = modelSourceUrl(input.libraryId, input.assetId, input.revisionId);
    }
    const companions = libraryService.resolveModelCompanions({
      libraryId: input.libraryId,
      assetId: input.assetId,
    });
    const sourceAuthorizations: ModelThumbnailSourceAuthorization[] = [
      authorizeModelSource(libraryService, {
        libraryId: input.libraryId,
        assetId: input.assetId,
        revisionId: input.revisionId,
      }),
      ...companions.map((companion) =>
        authorizeModelSource(libraryService, {
          libraryId: input.libraryId,
          assetId: companion.assetId,
          revisionId: companion.revisionId,
        })),
    ];
    return requestModelThumbnailRender(
      {
        libraryId: input.libraryId,
        assetId: input.assetId,
        revisionId: input.revisionId,
        format: effectiveFormat,
        renderUrl,
        companionMap: companions.map((companion) => ({
          relativeFilePath: companion.relativeFilePath,
          assetId: companion.assetId,
          revisionId: companion.revisionId,
          extension: companion.extension,
        })),
        hdriPresetId: BUNDLED_HDRI_PRESET_IDS[0]!,
        width: MODEL_THUMBNAIL_DEFAULT_EDGE,
        height: MODEL_THUMBNAIL_DEFAULT_EDGE,
        timeoutMs: MODEL_THUMBNAIL_RENDER_TIMEOUT_MS,
        sourceAuthorizations,
      },
      input.signal,
    );
}

function authorizeModelSource(
  service: LibraryService,
  input: Pick<ModelThumbnailSourceAuthorization, 'libraryId' | 'assetId' | 'revisionId'>,
): ModelThumbnailSourceAuthorization {
  const source = service.getCurrentMediaSource(
    input.libraryId,
    input.assetId,
    input.revisionId,
  );
  return {
    ...input,
    absolutePath: source.absolutePath,
    mimeType: source.mimeType,
  };
}

async function writePluginMediaArtifact(input: {
  libraryId: string;
  assetId: string;
  kind: 'preview' | 'thumbnail';
  asset?: PluginMediaProviderRequest['asset'];
}): Promise<{ artifactId: string } | null> {
  const result = await requestPluginMediaProvider(input);
  if (result.status !== 'provided' || result.assetId !== input.assetId || !result.media) {
    return null;
  }
  try {
    return libraryService.writePluginMediaArtifact({
      libraryId: input.libraryId,
      assetId: input.assetId,
      mimeType: result.media.mimeType,
      bytesBase64: result.media.bytesBase64,
      ...(result.providerId === undefined ? {} : { providerId: result.providerId }),
    });
  } catch (error) {
    libraryService.reportDiagnostic('plugin-media-artifact.write', error, {
      libraryId: input.libraryId,
      assetId: input.assetId,
      kind: input.kind,
    });
    return null;
  }
}

function scheduleThumbnailQueue(
  libraryId: string,
  options: {
    assetIds?: string[];
    limit?: number;
    priority?: number;
    repairFailed?: boolean;
  } = {},
): number {
  let enqueued: number;
  try {
    enqueued = libraryService.enqueueThumbnailJobs(libraryId, options);
  } catch (error) {
    libraryService.reportDiagnostic('thumbnail-schedule.enqueue', error, { libraryId });
    throw error;
  }

  if (activeThumbnailQueues.has(libraryId)) {
    rescheduledThumbnailQueues.add(libraryId);
    return enqueued;
  }
  activeThumbnailQueues.add(libraryId);

  const runBatch = async (): Promise<void> => {
    let continueImmediately = false;
    try {
      const onResult = (result: {
        assetId: string;
        artifactId?: string;
        errorCode?: string;
      }) => {
        if (result.artifactId) {
          parentPort?.postMessage({
            type: 'asset.thumbnail.ready',
            libraryId,
            assetId: result.assetId,
            artifactId: result.artifactId,
          });
        } else {
          const errorCode = result.errorCode ?? 'THUMBNAIL_GENERATION_FAILED';
          if (isBenignThumbnailErrorCode(errorCode)) return;
          parentPort?.postMessage({
            type: 'asset.thumbnail.failed',
            libraryId,
            assetId: result.assetId,
            errorCode,
            reason: thumbnailFailureReason(errorCode),
          });
        }
      };
      // Two consumers make the existing Sharp(2) semaphore effective for a
      // normal single-library session. FFmpeg remains serialized by its own
      // semaphore, and atomic job claims prevent duplicate processing.
      const processed = (await Promise.all([0, 1].map(() =>
        libraryService.processThumbnailQueue(libraryId, {
          maxJobs: 2,
          onResult,
          pluginMediaProvider: async ({ assetId, signal, asset }) => {
            if (signal?.aborted) return null;
            return (await writePluginMediaArtifact({
              libraryId,
              assetId,
              kind: 'thumbnail',
              ...(asset === undefined ? {} : { asset }),
            }))?.artifactId ?? null;
          },
          // Slice E (Serpent-hnmg): model jobs render offscreen in Main; the
          // shared-window gate inside renderModelThumbnailViaMain keeps at
          // most one render in flight process-wide.
          modelThumbnailRenderer: (input) => renderModelThumbnailViaMain(input),
        })))).reduce((total, count) => total + count, 0);
      continueImmediately = processed === 4;
    } catch (error) {
      libraryService.reportDiagnostic('thumbnail-schedule.process', error, { libraryId });
    }
    if (continueImmediately) {
      setTimeout(() => void runBatch(), 0);
      return;
    }
    activeThumbnailQueues.delete(libraryId);
    if (rescheduledThumbnailQueues.delete(libraryId)) {
      activeThumbnailQueues.add(libraryId);
      setTimeout(() => void runBatch(), 0);
    }
  };

  setTimeout(() => void runBatch(), 0);
  return enqueued;
}

type ThumbnailScheduleScene = 'startup' | 'refresh' | 'visible' | 'linked' | 'restore' | 'mutation';

/** Best-effort scheduling for normal product flows; explicit media commands use the throwing primitive. */
function scheduleThumbnailScene(
  libraryId: string,
  scene: ThumbnailScheduleScene,
  assetIds?: string[],
): void {
  const configs: Record<ThumbnailScheduleScene, { limit?: number; priority: number; maxIds?: number }> = {
    startup: { limit: 50, priority: 100 },
    refresh: { limit: 50, priority: 150 },
    visible: { limit: 50, priority: 200, maxIds: 50 },
    linked: { limit: 50, priority: 250, maxIds: 50 },
    restore: { priority: 250, maxIds: 500 },
    mutation: { priority: 300, maxIds: 500 },
  };
  const config = configs[scene];
  try {
    scheduleThumbnailQueue(libraryId, {
      ...(assetIds ? { assetIds: assetIds.slice(0, config.maxIds ?? 500) } : {}),
      ...(config.limit === undefined ? {} : { limit: config.limit }),
      priority: config.priority,
      repairFailed: true,
    });
  } catch {
    // scheduleThumbnailQueue already wrote the complete diagnostic. Automatic
    // media work must never turn a successful import/list/relink into failure.
  }
}

function thumbnailFailureReason(errorCode: string): string {
  switch (errorCode) {
    case 'FFMPEG_REQUIRED': return '无法生成视频缩略图（媒体组件不可用）。请重新安装或修复 Serpent 后重试。';
    case 'OIIO_REQUIRED': return '缺少 OpenImageIO，无法解码此图片。请安装图像组件后重试。';
    case 'SHARP_UNAVAILABLE': return '图片解码组件不可用。请重新安装或更新 Serpent 后重试。';
    case 'SOURCE_NOT_FOUND': return '源文件不存在或当前不可访问。请恢复文件后重试。';
    default: return '缩略图生成失败，文件可能损坏或格式不受支持。请检查源文件后重试。';
  }
}

function errorForLog(error: unknown, depth = 0): unknown {
  if (depth > 5) return { truncated: true };
  if (!(error instanceof Error)) return { value: String(error) };
  return {
    name: error.name,
    message: error.message,
    code: 'code' in error && typeof error.code === 'string' ? error.code : undefined,
    reason: 'reason' in error && typeof error.reason === 'string' ? error.reason : undefined,
    stack: error.stack,
    cause: error.cause === undefined ? undefined : errorForLog(error.cause, depth + 1),
  };
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

function safeAiJobState(libraryId: string, jobId: string): string | null {
  try {
    return libraryService.getAiJobState(libraryId, jobId);
  } catch (error) {
    if (error instanceof LibraryServiceError && error.code === 'LIBRARY_NOT_OPEN') return null;
    throw error;
  }
}

function publishAiProgress(libraryId: string): void {
  try {
    const status = libraryService.getAiJobStatus(libraryId);
    aiProgressThrottler.publish({
      type: 'ai.progress',
      libraryId,
      queued: status.queued,
      running: status.running,
      succeeded: status.succeeded,
      failed: status.failed,
    });
  } catch (error) {
    if (!(error instanceof LibraryServiceError && error.code === 'LIBRARY_NOT_OPEN')) throw error;
  }
}

async function handleRequest(request: WorkerRequest): Promise<WorkerResult> {
  const automationResult = dispatchAutomationReadOnlyRequest(libraryService, request);
  if (automationResult) return automationResult;

  const libraryId = boundedWriteLibraryId(request.command);
  if (!libraryId) return handleRequestWithoutWriteLease(request);

  try {
    const result = await libraryService.runBoundedWrite(
      libraryId,
      () => executeBoundedWriteWorkerCommand(libraryService, request.command),
    );
    if (result === undefined) {
      throw new Error(`Bounded write command ${request.command.type} has no executor.`);
    }
    return result;
  } catch (error) {
    libraryService.reportDiagnostic('write-lease.execute', error, {
      libraryId,
      commandType: request.command.type,
    });
    throw error;
  }
}

async function handleRequestWithoutWriteLease(request: WorkerRequest): Promise<WorkerResult> {
  switch (request.command.type) {
    case 'library.list':
      return { ok: true, type: 'library.list', libraries: libraryService.listLibraries() };
    case 'library.change-sequence':
      return {
        ok: true,
        type: 'library.change-sequence',
        libraryId: request.command.libraryId,
        changeSequence: libraryService.getChangeSequence(request.command.libraryId),
      };
    case 'library.create': {
      const library = libraryService.createLibrary(request.command);
      scheduleThumbnailScene(library.libraryId, 'startup');
      return { ok: true, type: 'library.opened', library };
    }
    case 'library.open': {
      const library = libraryService.openLibrary(request.command.selectedLibraryPath);
      scheduleThumbnailScene(library.libraryId, 'startup');
      return { ok: true, type: 'library.opened', library };
    }
    case 'library.close':
      libraryService.cancelJobs(request.command.libraryId);
      publishAiProgress(request.command.libraryId);
      aiJobAbortRegistry.abort(request.command.libraryId);
      libraryService.closeLibrary(request.command.libraryId);
      return { ok: true, type: 'library.closed', libraryId: request.command.libraryId };
    case 'library.rename': {
      const renamed = libraryService.renameLibrary(request.command);
      return { ok: true, type: 'library.renamed', library: renamed };
    }
    case 'library.delete-from-disk': {
      libraryService.cancelJobs(request.command.libraryId);
      publishAiProgress(request.command.libraryId);
      aiJobAbortRegistry.abort(request.command.libraryId);
      const deleted = libraryService.deleteLibraryFromDisk(request.command.libraryId);
      return {
        ok: true,
        type: 'library.deleted',
        libraryId: deleted.libraryId,
        displayName: deleted.displayName,
        libraryPath: deleted.libraryPath,
      };
    }
    case 'folder.create':
      // Routed through runBoundedWrite / executeBoundedWriteWorkerCommand.
      throw new Error('Bounded folder.create write was not dispatched through its transaction fence.');
    case 'folder.rename': {
      const folder = libraryService.renameManagedFolder(request.command);
      return { ok: true, type: 'folder.renamed', folder };
    }
    case 'folder.clone': {
      const result = libraryService.cloneManagedFolder(request.command);
      return {
        ok: true,
        type: 'folder.cloned',
        folder: result.folder,
        clonedFolderCount: result.clonedFolderCount,
        clonedAssetCount: result.clonedAssetCount,
      };
    }
    case 'folder.move': {
      const result = libraryService.moveManagedFolders(request.command);
      return {
        ok: true,
        type: 'folder.moved',
        movedCount: result.movedCount,
        skippedCount: result.skippedCount,
        folders: result.folders,
      };
    }
    case 'folder.get-path': {
      // Main-only consumer (shell/clipboard); the path never reaches the Renderer.
      const absolutePath = libraryService.resolveFolderPath(
        request.command.libraryId,
        request.command.folderId,
      );
      return { ok: true, type: 'folder.path', folderId: request.command.folderId, absolutePath };
    }
    case 'folder.list':
      return {
        ok: true,
        type: 'folder.list',
        folders: libraryService.listManagedFolders(request.command.libraryId, request.command.showIgnored === true),
      };
    case 'folder.browse-entries':
      return {
        ok: true,
        type: 'folder.browse-entries',
        entries: libraryService.listFolderBrowseEntries({
          libraryId: request.command.libraryId,
          parentFolderId: request.command.parentFolderId,
          showIgnored: request.command.showIgnored === true,
        }),
      };
    case 'folder.list-trashed': {
      const folders = libraryService.listTrashedFolders(request.command.libraryId);
      return { ok: true, type: 'folder.list-trashed', folders };
    }
    case 'folder.restore-trashed': {
      const result = libraryService.restoreTrashedManagedFolder(request.command);
      return { ok: true, type: 'folder.restored-trashed', ...result };
    }
    case 'folder.trash': {
      const result = libraryService.trashManagedFolder(request.command);
      return {
        ok: true,
        type: 'folder.trashed',
        folderId: request.command.folderId,
        ...result,
      };
    }
    case 'folder.delete-from-disk': {
      const result = await libraryService.deleteManagedFolderFromDiskAsync(request.command);
      return {
        ok: true,
        type: 'folder.deleted-from-disk',
        folderId: request.command.folderId,
        ...result,
      };
    }
    case 'linked-folder.remove': {
      const result = libraryService.removeLinkedFolder(request.command);
      return {
        ok: true,
        type: 'linked-folder.removed',
        folderId: request.command.folderId,
        ...result,
      };
    }
    case 'linked-folder.delete-subtree': {
      const result = await libraryService.deleteLinkedFolderSubtree(request.command);
      return {
        ok: true,
        type: 'linked-folder.subtree-deleted',
        linkedFolderId: request.command.linkedFolderId,
        relativePath: request.command.relativePath,
        ...result,
      };
    }
    case 'asset.list':
      {
        const assets = libraryService.listAssets(request.command);
        scheduleThumbnailScene(
          request.command.libraryId,
          'visible',
          assets.flatMap((asset) =>
            asset.sequence?.frames.map((frame) => frame.assetId) ?? [asset.assetId],
          ),
        );
        return {
        ok: true,
        type: 'asset.list',
          assets,
        };
      }
    case 'asset.sequence.create': {
      const asset = libraryService.createImageSequence(request.command);
      scheduleThumbnailScene(
        request.command.libraryId,
        'mutation',
        asset.sequence?.frames.map((frame) => frame.assetId) ?? [asset.assetId],
      );
      return { ok: true, type: 'asset.sequence.created', asset };
    }
    case 'asset.sequence.dissolve': {
      const sequenceId = libraryService.dissolveImageSequence(request.command);
      return { ok: true, type: 'asset.sequence.dissolved', sequenceId };
    }
    case 'asset.sequence.dissolve-batch': {
      const result = libraryService.dissolveImageSequences(request.command);
      return { ok: true, type: 'asset.sequence.dissolved-batch', ...result };
    }
    case 'asset.sequence.set-fps': {
      const result = libraryService.setImageSequenceFps(request.command);
      return { ok: true, type: 'asset.sequence.fps-updated', ...result };
    }
    case 'asset.import.probe-sequences': {
      const offer = await libraryService.probeImageSequenceImportOffer(request.command);
      return {
        ok: true,
        type: 'asset.import.sequence-offer',
        offer: offer ?? {
          defaultFps: 30,
          libraryId: request.command.libraryId,
          selectedPaths: request.command.sourcePaths,
          sequences: [],
          ...(request.command.targetFolderId
            ? { targetFolderId: request.command.targetFolderId }
            : {}),
          ...(request.command.targetCollectionId
            ? { targetCollectionId: request.command.targetCollectionId }
            : {}),
        },
      };
    }
    case 'asset.import.prepare': {
      const prepared = libraryService.prepareOrExecuteImport(request.command);
      if (!('importId' in prepared)) {
        scheduleThumbnailScene(
          request.command.libraryId,
          'mutation',
          prepared.assets.flatMap((asset) =>
            asset.sequence?.frames.map((frame) => frame.assetId) ?? [asset.assetId],
          ),
        );
      }
      return 'importId' in prepared
        ? { ok: true, type: 'asset.import.conflicts', plan: prepared }
        : { ok: true, type: 'asset.import.completed', completion: prepared };
    }
    case 'asset.import.resolve': {
      const completion = libraryService.resolveImport(request.command);
      if (completion.assets.length > 0) {
        // The matching library already owns these opaque asset ids; schedule
        // through each open library without exposing paths to Main/Renderer.
        for (const library of libraryService.listLibraries()) {
          scheduleThumbnailScene(
            library.libraryId,
            'mutation',
            completion.assets.flatMap((asset) =>
              asset.sequence?.frames.map((frame) => frame.assetId) ?? [asset.assetId],
            ),
          );
        }
      }
      return {
        ok: true,
        type: 'asset.import.completed',
        completion,
      };
    }
    case 'asset.import.abandon':
      return {
        ok: true,
        type: 'asset.import.abandoned',
        importId: libraryService.abandonImport(request.command.importId),
      };
    case 'asset.refresh': {
      const refresh = libraryService.refreshManagedAssets(request.command.libraryId);
      scheduleThumbnailScene(request.command.libraryId, 'refresh');
      return { ok: true, type: 'asset.refreshed', ...refresh };
    }
    case 'asset.import-linked': {
      const linkedFolder = libraryService.importFolderAsLinked(request.command);
      const assets = libraryService.listAssets({
        libraryId: request.command.libraryId,
        folderId: linkedFolder.folderId,
        recursive: true,
      });
      scheduleThumbnailScene(request.command.libraryId, 'linked', assets.map((asset) => asset.assetId));
      return { ok: true, type: 'asset.import-linked.completed', linkedFolder };
    }
    case 'linked-folder.list':
      return {
        ok: true,
        type: 'linked-folder.list',
        folders: libraryService.listLinkedFolders(request.command.libraryId),
      };
    case 'linked-folder.relink': {
      const linkedFolder = libraryService.relinkMissingFolder(request.command);
      const assets = libraryService.listAssets({
        libraryId: request.command.libraryId,
        folderId: request.command.folderId,
        recursive: true,
      });
      scheduleThumbnailScene(request.command.libraryId, 'linked', assets.map((asset) => asset.assetId));
      return { ok: true, type: 'linked-folder.relinked', linkedFolder };
    }
    case 'linked-folder.rules.get':
      return { ok: true, type: 'linked-folder.rules', rules: libraryService.getLinkedFolderRules(request.command) };
    case 'linked-folder.rules.set': {
      const result = libraryService.setLinkedFolderRules(request.command);
      scheduleThumbnailScene(request.command.libraryId, 'linked');
      return { ok: true, type: 'linked-folder.rules.updated', ...result };
    }
    case 'ignore.list':
      return {
        ok: true,
        type: 'ignore.list',
        paths: libraryService.listIgnoredPaths(request.command.libraryId),
      };
    case 'ignore.gitignore.get':
      return {
        ok: true,
        type: 'ignore.gitignore',
        content: libraryService.getGitignore(request.command.libraryId).content,
      };
    case 'ignore.gitignore.set': {
      const result = libraryService.setGitignore(request.command);
      scheduleThumbnailScene(request.command.libraryId, 'refresh');
      return { ok: true, type: 'ignore.gitignore.updated', content: result.content };
    }
    case 'ignore.set': {
      const result = libraryService.setIgnore(request.command);
      scheduleThumbnailScene(request.command.libraryId, 'refresh');
      return { ok: true, type: 'ignore.updated', ...result };
    }
    case 'linked-folder.assets.copy': {
      const result = libraryService.copyAssetsToLinkedFolder(request.command);
      scheduleThumbnailScene(request.command.libraryId, 'linked', result.assets.map((asset) => asset.assetId));
      return { ok: true, type: 'linked-folder.assets.copied', ...result };
    }
    case 'linked-folder.convert': {
      const result = libraryService.convertLinkedFolderToManaged(request.command);
      scheduleThumbnailScene(request.command.libraryId, 'mutation', result.assets.map((asset) => asset.assetId));
      return { ok: true, type: 'linked-folder.converted', ...result };
    }
    case 'tag.list':
      return {
        ok: true,
        type: 'tag.list',
        tags: libraryService.listTags(request.command.libraryId),
      };
    case 'tag.create':
      throw new Error('Bounded tag.create write was not dispatched through its transaction fence.');
    case 'tag.rename': {
      const tag = libraryService.renameTag(request.command);
      return { ok: true, type: 'tag.renamed', tag };
    }
    case 'tag.delete':
      return {
        ok: true,
        type: 'tag.deleted',
        tagId: libraryService.deleteTag(request.command),
      };
    case 'tag.delete-many': {
      const { deletedTagIds } = libraryService.deleteTags(request.command);
      return { ok: true, type: 'tag.deleted-many', deletedTagIds };
    }
    case 'tag.merge': {
      const tag = libraryService.mergeTags(request.command);
      return {
        ok: true,
        type: 'tag.merged',
        tag,
        mergedTagIds: request.command.sourceTagIds,
      };
    }
    case 'tag.cooccurrence':
      return {
        ok: true,
        type: 'tag.cooccurrence',
        graph: libraryService.getTagCooccurrenceGraph(request.command),
      };
    case 'tag.assign':
      throw new Error('Bounded tag.assign write was not dispatched through its transaction fence.');
    case 'tag.remove':
      throw new Error('Bounded tag.remove write was not dispatched through its transaction fence.');
    case 'collection.list':
      return {
        ok: true,
        type: 'collection.list',
        collections: libraryService.listCollections(request.command.libraryId),
      };
    case 'collection.create':
      throw new Error('Bounded collection.create write was not dispatched through its transaction fence.');
    case 'collection.update': {
      const collection = libraryService.updateCollection(request.command);
      return { ok: true, type: 'collection.updated', collection };
    }
    case 'collection.reorder': {
      const orderedCollectionIds = libraryService.reorderCollections(request.command);
      return { ok: true, type: 'collection.reordered', orderedCollectionIds };
    }
    case 'collection.delete':
      return {
        ok: true,
        type: 'collection.deleted',
        collectionId: libraryService.deleteCollection(request.command),
      };
    case 'collection.assets.add':
      throw new Error('Bounded collection.assets.add write was not dispatched through its transaction fence.');
    case 'collection.assets.remove':
      throw new Error('Bounded collection.assets.remove write was not dispatched through its transaction fence.');
    case 'collection.assets.reorder': {
      const { collectionId } = libraryService.reorderCollectionAssets(request.command);
      return { ok: true, type: 'collection.assets.reordered', collectionId };
    }
    case 'collection.assets.list': {
      const assets = libraryService.listCollectionAssets(request.command);
      scheduleThumbnailScene(
        request.command.libraryId,
        'visible',
        assets.flatMap((asset) =>
          asset.sequence?.frames.map((frame) => frame.assetId) ?? [asset.assetId],
        ),
      );
      return { ok: true, type: 'collection.assets.list', assets };
    }
    case 'collection.assets.memberships': {
      const memberships = libraryService.listAssetCollectionMemberships(
        request.command,
      );
      return { ok: true, type: 'collection.assets.memberships', memberships };
    }
    case 'asset.metadata.get': {
      const metadata = libraryService.getAssetMetadata(request.command);
      return { ok: true, type: 'asset.metadata.got', metadata };
    }
    case 'asset.extracted-metadata.get': {
      const result = libraryService.getExtractedMetadata(request.command);
      return { ok: true, type: 'asset.extracted-metadata.got', result };
    }
    case 'asset.color-space.set': {
      const result = libraryService.setAssetColorSpaceOverride(request.command);
      return { ok: true, type: 'asset.color-space.updated', ...result };
    }
    case 'asset.metadata.set':
      throw new Error('Bounded asset.metadata.set write was not dispatched through its transaction fence.');
    case 'asset.metadata.backfill': {
      const { backfilledCount } = libraryService.backfillAssetMetadata(request.command.libraryId);
      return { ok: true, type: 'asset.metadata.backfilled', backfilledCount };
    }
    case 'asset.rating.set':
      // `handleRequest` routes this command through runBoundedWrite before
      // this legacy desktop switch. Keep the exhaustiveness case explicit so
      // a future dispatcher change cannot silently restore an unfenced path.
      throw new Error('Bounded rating write was not dispatched through its transaction fence.');
    case 'asset.search': {
      const result = libraryService.searchAssets({
        libraryId: request.command.libraryId,
        query: request.command.query,
        filters: request.command.filters ?? null,
        scope: request.command.scope ?? null,
        sort: request.command.sort ?? null,
        scopeMode: request.command.scopeMode ?? false,
        showIgnored: request.command.showIgnored === true,
        limit: request.command.scopeMode ? null : (request.command.limit ?? 50),
        offset: request.command.scopeMode ? 0 : (request.command.offset ?? 0),
      });
      scheduleThumbnailScene(
        request.command.libraryId,
        'visible',
        result.items.flatMap((asset) =>
          asset.sequence?.frames.map((frame) => frame.assetId) ?? [asset.assetId],
        ),
      );
      return {
        ok: true,
        type: 'asset.search.result',
        items: result.items,
        total: result.total,
        offset: result.offset,
        snippets: result.snippets,
      };
    }
    case 'smart-collection.list':
      return {
        ok: true,
        type: 'smart-collection.list',
        collections: libraryService.listSmartCollections(request.command.libraryId),
      };
    case 'smart-collection.create': {
      const sc = libraryService.createSmartCollection(request.command);
      return { ok: true, type: 'smart-collection.created', collection: sc };
    }
    case 'smart-collection.update': {
      const sc = libraryService.updateSmartCollection(request.command);
      return { ok: true, type: 'smart-collection.updated', collection: sc };
    }
    case 'smart-collection.delete':
      return {
        ok: true,
        type: 'smart-collection.deleted',
        collectionId: libraryService.deleteSmartCollection(request.command),
      };
    case 'smart-collection.execute': {
      const result = libraryService.executeSmartCollection(request.command);
      scheduleThumbnailScene(
        request.command.libraryId,
        'visible',
        result.items.map((asset) => asset.assetId),
      );
      return {
        ok: true,
        type: 'smart-collection.executed',
        items: result.items,
        total: result.total,
        offset: result.offset,
      };
    }
    case 'asset.trash': {
      if (request.command.automationPlan) {
        libraryService.validateAutomationFileOperationPlan({
          libraryId: request.command.libraryId,
          operation: 'trash',
          assetIds: request.command.assetIds,
          planHash: request.command.automationPlan.planHash,
          expectedChangeSequence: request.command.automationPlan.expectedChangeSequence,
          assetStates: request.command.automationPlan.assetStates,
        });
      }
      const { trashedCount, operationId } = libraryService.trashAssets(request.command);
      return { ok: true, type: 'asset.trashed', trashedCount, operationId };
    }
    case 'asset.content.replace': {
      if (request.command.automationPlan) {
        libraryService.validateAutomationFileOperationPlan({
          libraryId: request.command.libraryId,
          operation: 'replace-content',
          assetIds: [request.command.assetId],
          planHash: request.command.automationPlan.planHash,
          expectedChangeSequence: request.command.automationPlan.expectedChangeSequence,
          assetStates: request.command.automationPlan.assetStates,
        });
      }
      const result = libraryService.replaceManagedAssetContent(request.command);
      scheduleThumbnailScene(request.command.libraryId, 'mutation', [result.assetId]);
      return { ok: true, type: 'asset.content.replaced', ...result };
    }
    case 'asset.content.stage': {
      const result = libraryService.stageManagedAssetContent(request.command);
      return { ok: true, type: 'asset.content.staged', ...result };
    }
    case 'asset.content.replace-batch': {
      if (request.command.automationPlan) {
        libraryService.validateAutomationFileOperationPlan({
          libraryId: request.command.libraryId,
          operation: 'replace-content',
          assetIds: request.command.items.map((item) => item.assetId),
          planHash: request.command.automationPlan.planHash,
          expectedChangeSequence: request.command.automationPlan.expectedChangeSequence,
          assetStates: request.command.automationPlan.assetStates,
        });
      }
      const result = libraryService.replaceManagedAssetContentBatch(request.command);
      scheduleThumbnailScene(
        request.command.libraryId,
        'mutation',
        result.items.map((item) => item.assetId),
      );
      return { ok: true, type: 'asset.content.batch-replaced', ...result };
    }
    case 'asset.content.read': {
      const result = libraryService.readManagedAssetContent(request.command);
      return { ok: true, type: 'asset.content.read', ...result };
    }
    case 'asset.restore': {
      const { restoredCount, assets } = libraryService.restoreAssets(request.command);
      scheduleThumbnailScene(request.command.libraryId, 'restore', assets.map((asset) => asset.assetId));
      return { ok: true, type: 'asset.restored', restoredCount, assets };
    }
    case 'asset.restore-preview': {
      const preview = libraryService.previewRestoreAssets(request.command);
      return { ok: true, type: 'asset.restore-previewed', ...preview };
    }
    case 'asset.move': {
      if (request.command.automationPlan) {
        libraryService.validateAutomationFileOperationPlan({
          libraryId: request.command.libraryId,
          operation: 'move',
          assetIds: request.command.assetIds,
          targetFolderId: request.command.targetFolderId,
          ...(request.command.conflictStrategy === undefined
            ? {}
            : { conflictStrategy: request.command.conflictStrategy }),
          planHash: request.command.automationPlan.planHash,
          expectedChangeSequence: request.command.automationPlan.expectedChangeSequence,
          assetStates: request.command.automationPlan.assetStates,
        });
      }
      const { movedCount, skippedCount, operationId, assets } = libraryService.moveAssets(request.command);
      scheduleThumbnailScene(request.command.libraryId, 'visible', assets.map((asset) => asset.assetId));
      return { ok: true, type: 'asset.moved', movedCount, skippedCount, operationId, assets };
    }
    case 'asset.move-undo': {
      const { undoneCount, skippedCount, assets } = libraryService.undoMoveAssets(request.command);
      scheduleThumbnailScene(request.command.libraryId, 'visible', assets.map((asset) => asset.assetId));
      return { ok: true, type: 'asset.move-undone', undoneCount, skippedCount, assets };
    }
    case 'asset.trash-undo': {
      const { restoredCount, skippedCount, assets } = libraryService.undoTrashAssets(request.command);
      scheduleThumbnailScene(request.command.libraryId, 'restore', assets.map((asset) => asset.assetId));
      return { ok: true, type: 'asset.trash-undone', restoredCount, skippedCount, assets };
    }
    case 'asset.copy': {
      const { copiedCount, skippedCount, operationId, assets } = libraryService.copyAssets(request.command);
      scheduleThumbnailScene(request.command.libraryId, 'visible', assets.map((asset) => asset.assetId));
      return { ok: true, type: 'asset.copied', copiedCount, skippedCount, operationId, assets };
    }
    case 'asset.copy-undo': {
      const { undoneCount, skippedCount, assets } = libraryService.undoCopyAssets(request.command);
      scheduleThumbnailScene(request.command.libraryId, 'visible', assets.map((asset) => asset.assetId));
      return { ok: true, type: 'asset.copy-undone', undoneCount, skippedCount, assets };
    }
    case 'asset.rename-file': {
      if (request.command.automationPlan) {
        libraryService.validateAutomationFileOperationPlan({
          libraryId: request.command.libraryId,
          operation: 'rename-file',
          assetIds: [request.command.assetId],
          newBaseName: request.command.newBaseName,
          planHash: request.command.automationPlan.planHash,
          expectedChangeSequence: request.command.automationPlan.expectedChangeSequence,
          assetStates: request.command.automationPlan.assetStates,
        });
      }
      const { asset } = libraryService.renameAssetFile(request.command);
      return { ok: true, type: 'asset.file-renamed', asset };
    }
    case 'asset.rename-files': {
      if (request.command.automationPlan) {
        libraryService.validateAutomationFileOperationPlan({
          libraryId: request.command.libraryId,
          operation: 'rename-files',
          assetIds: request.command.items.map((item) => item.assetId),
          renameItems: request.command.items,
          planHash: request.command.automationPlan.planHash,
          expectedChangeSequence: request.command.automationPlan.expectedChangeSequence,
          assetStates: request.command.automationPlan.assetStates,
        });
      }
      const result = libraryService.renameAssetFiles(request.command);
      return { ok: true, type: 'asset.files-renamed', ...result };
    }
    case 'asset.restore-if-original-vacant': {
      if (request.command.automationPlan) {
        libraryService.validateAutomationFileOperationPlan({
          libraryId: request.command.libraryId,
          operation: 'restore-if-original-vacant',
          assetIds: request.command.assetIds,
          planHash: request.command.automationPlan.planHash,
          expectedChangeSequence: request.command.automationPlan.expectedChangeSequence,
          assetStates: request.command.automationPlan.assetStates,
        });
      }
      const result = libraryService.restoreAssetsIfOriginalVacant(request.command);
      scheduleThumbnailScene(request.command.libraryId, 'restore', result.assets.map((asset) => asset.assetId));
      return { ok: true, type: 'asset.restored-if-original-vacant', ...result };
    }
    case 'asset.palette.aggregate-recent': {
      const result = libraryService.aggregateRecentAssetPalette(request.command);
      return { ok: true, type: 'asset.palette.aggregated-recent', ...result };
    }
    case 'asset.text.read': {
      const result = libraryService.readTextAsset(request.command);
      return { ok: true, type: 'asset.text.read', ...result };
    }
    case 'asset.text.save': {
      const result = libraryService.saveTextAsset(request.command);
      return { ok: true, type: 'asset.text.saved', ...result };
    }
    case 'asset.delete-permanent': {
      const { deletedCount, skippedCount, skippedReasons } = libraryService.deleteAssetsPermanent(request.command);
      return { ok: true, type: 'asset.deleted-permanent', deletedCount, skippedCount, skippedReasons };
    }
    case 'asset.delete-from-disk': {
      const { deletedCount } = await libraryService.deleteAssetsFromDiskAsync(request.command);
      return { ok: true, type: 'asset.deleted-from-disk', deletedCount };
    }
    case 'asset.delete-linked': {
      const { deletedCount, failedCount, failures } = await libraryService.deleteLinkedAssets(request.command);
      return { ok: true, type: 'asset.deleted-linked', deletedCount, failedCount, failures };
    }
    case 'asset.list-trash': {
      const assets = libraryService.listTrash(request.command.libraryId);
      return { ok: true, type: 'asset.list-trash', assets };
    }
    case 'asset.purge-trash': {
      const { purgedCount, skippedCount, failures } = libraryService.emptyTrash(request.command.libraryId);
      return { ok: true, type: 'asset.purge-trash', purgedCount, skippedCount, failures };
    }
    case 'asset.relink': {
      const { asset, batchFollowUpRoot } = libraryService.relinkAsset(request.command);
      scheduleThumbnailScene(request.command.libraryId, 'mutation', [asset.assetId]);
      return { ok: true, type: 'asset.relinked', asset, batchFollowUpRoot };
    }
    case 'asset.relink-batch.preview': {
      const preview = libraryService.relinkBatchPreview(request.command);
      return { ok: true, type: 'asset.relink-batch.preview', ...preview };
    }
    case 'asset.relink-batch.apply': {
      const { restoredCount, unchangedMissingCount, assets } = libraryService.relinkBatchApply(request.command);
      scheduleThumbnailScene(request.command.libraryId, 'mutation', assets.map((asset) => asset.assetId));
      return { ok: true, type: 'asset.relink-batch.applied', restoredCount, unchangedMissingCount, assets };
    }
    case 'extension.save-from-url': {
      const { asset } = await libraryService.saveAssetFromUrl(request.command);
      scheduleThumbnailScene(request.command.libraryId, 'mutation', [asset.assetId]);
      return { ok: true, type: 'extension.asset-saved', asset };
    }
    case 'extension.save-from-file': {
      const { asset } = await libraryService.saveAssetFromFile(request.command);
      scheduleThumbnailScene(request.command.libraryId, 'mutation', [asset.assetId]);
      return { ok: true, type: 'extension.asset-saved', asset };
    }
    case 'library.export': {
      if (request.command.format === 'zip') {
        const exported = await libraryService.exportLibraryToZip({
          libraryId: request.command.libraryId,
          destinationPath: request.command.destinationPath,
          includeLinkedContent: request.command.includeLinkedContent,
        });
        return {
          ok: true,
          type: 'library.exported',
          exportId: exported.exportId,
          libraryId: request.command.libraryId,
          format: 'zip' as const,
          fileCount: exported.fileCount,
          totalBytes: exported.totalBytes,
          excludedPreviewCount: exported.excludedPreviewCount,
          includedLinkedContent: exported.includedLinkedContent,
          durationMs: exported.durationMs,
        };
      }
      const exported = await libraryService.exportLibraryToFolder({
        libraryId: request.command.libraryId,
        destinationPath: request.command.destinationPath,
        includeLinkedContent: request.command.includeLinkedContent,
      });
      return {
        ok: true,
        type: 'library.exported',
        exportId: exported.exportId,
        libraryId: request.command.libraryId,
        format: 'folder' as const,
        fileCount: exported.fileCount,
        totalBytes: exported.totalBytes,
        excludedPreviewCount: exported.excludedPreviewCount,
        includedLinkedContent: exported.includedLinkedContent,
        durationMs: exported.durationMs,
      };
    }
    case 'library.export-cancel':
      libraryService.cancelExport(request.command.exportId);
      return { ok: true, type: 'library.closed', libraryId: request.command.exportId };
    case 'library.import-folder': {
      const imported = await libraryService.importLibraryFromFolder({
        sourceFolderPath: request.command.sourceFolderPath,
        copyToParentPath: request.command.copyToParentPath,
      });
      return {
        ok: true,
        type: 'library.imported',
        importId: imported.importId,
        libraryId: imported.libraryId,
        displayName: imported.displayName,
        libraryPath: imported.libraryPath,
      };
    }
    case 'library.import-zip': {
      const imported = await libraryService.importLibraryFromZip({
        sourceZipPath: request.command.sourceZipPath,
        destinationParentPath: request.command.destinationParentPath,
      });
      return {
        ok: true,
        type: 'library.imported',
        importId: imported.importId,
        libraryId: imported.libraryId,
        displayName: imported.displayName,
        libraryPath: imported.libraryPath,
      };
    }
    case 'library.import-cancel':
      libraryService.cancelImport(request.command.importId);
      return { ok: true, type: 'library.closed', libraryId: request.command.importId };
    case 'library.import-validate': {
      const validated = libraryService.validateImportSource(request.command.sourceFolderPath);
      return {
        ok: true,
        type: 'library.import-validated',
        importId: request.command.importId,
        libraryId: validated.libraryId,
        displayName: validated.displayName,
      };
    }
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
      const controls = analysisControls.get(request.requestId);

      // Resolve asset file path + mime.
      const { filePath, mime, isVideo } = libraryService.resolveAssetFilePath(
        libraryId,
        assetId,
      );

      let imageBase64: string | undefined;
      let contactSheetBase64: string | undefined;
      let contactSheetDescription: string | undefined;
      let requestMime: string;

      if (isVideo) {
        // Video: require contact_sheet + video_poster artifacts (generated by slice 0006).
        const contactSheet = libraryService.getCurrentArtifact(
          libraryId, assetId, 'contact_sheet',
        );
        if (!contactSheet || contactSheet.status !== 'ready') {
          return {
            ok: true,
            type: 'asset.analyze-unsupported' as const,
            assetId,
            reason: 'CONTACT_SHEET_REQUIRED',
          };
        }

        const poster = libraryService.getCurrentArtifact(
          libraryId, assetId, 'video_poster',
        );
        if (!poster || poster.status !== 'ready') {
          return {
            ok: true,
            type: 'asset.analyze-unsupported' as const,
            assetId,
            reason: 'CONTACT_SHEET_REQUIRED',
          };
        }

        // Read artifact byte content.
        const posterAbsPath = libraryService.getArtifactAbsolutePath(
          libraryId, poster.artifactId,
        );
        const sheetAbsPath = libraryService.getArtifactAbsolutePath(
          libraryId, contactSheet.artifactId,
        );

        let posterBytes: Buffer;
        let sheetBytes: Buffer;
        try {
          posterBytes = readFileSync(posterAbsPath);
          sheetBytes = readFileSync(sheetAbsPath);
        } catch (error) {
          throw new LibraryServiceError('ASSET_NOT_FOUND', { cause: error });
        }

        try {
          const posterEncoded = await encodeAiAnalysisImage(
            posterBytes,
            maxAnalysisImageEdgePx,
          );
          imageBase64 = posterEncoded.imageBase64;
          requestMime = posterEncoded.mime;
        } catch {
          imageBase64 = posterBytes.toString('base64');
          requestMime = poster.mimeType;
        }
        try {
          const sheetEncoded = await encodeAiAnalysisImage(
            sheetBytes,
            maxAnalysisImageEdgePx,
          );
          contactSheetBase64 = sheetEncoded.imageBase64;
        } catch {
          contactSheetBase64 = sheetBytes.toString('base64');
        }

        // Optional: include contextual description from extracted metadata.
        const metadataArtifact = libraryService.getCurrentArtifact(
          libraryId, assetId, 'extracted_metadata',
        );
        if (metadataArtifact && metadataArtifact.status === 'ready') {
          try {
            const metaAbsPath = libraryService.getArtifactAbsolutePath(
              libraryId, metadataArtifact.artifactId,
            );
            const metaJson = JSON.parse(readFileSync(metaAbsPath, 'utf-8'));
            const durationLabel =
              typeof metaJson.durationMs === 'number'
                ? `${(metaJson.durationMs / 1000).toFixed(1)}s`
                : 'unknown';
            contactSheetDescription = [
              `Video dimensions: ${metaJson.width ?? '?'}x${metaJson.height ?? '?'}`,
              `Duration: ${durationLabel}`,
              `Codec: ${metaJson.videoCodec ?? 'unknown'}`,
            ].join('; ');
          } catch {
            // Best-effort; ignore metadata parse failures.
          }
        }
      } else if (mime.startsWith('image/')) {
        // Resize source to the configured longest-edge cap (default 2K).
        // Unreadable originals (e.g. some EXR) fall back to the thumbnail.
        try {
          const imageInput = await loadAiImageInput(
            libraryService,
            libraryId,
            assetId,
            {
              sourcePath: filePath,
              maxEdgePx: maxAnalysisImageEdgePx,
            },
          );
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
        imageBase64,
        contactSheetBase64,
        contactSheetDescription,
        language,
        enabledFields: effectiveEnabled,
        existingTagNames,
        analysisSettings,
      };

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
      try {
        analysisResult = await runLimitedAiRequest(
          providerConcurrencyLimiter,
          apiFormatLimiterKey(apiFormat),
          controls?.signal,
          controls?.requestTimeoutMs
            ?? DEFAULT_AI_RELIABILITY_SETTINGS.requestTimeoutMs,
          (requestSignal) => adapter.analyze(aiRequest, requestSignal),
        );
      } catch (error) {
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

      parentPort?.postMessage({
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
    case 'media.generate-thumbnail': {
      const pluginArtifact = await writePluginMediaArtifact({
        libraryId: request.command.libraryId,
        assetId: request.command.assetId,
        kind: 'thumbnail',
      });
      const generated = pluginArtifact
        ?? await libraryService.generateThumbnail(request.command);
      if (!generated && libraryService.isModelAsset(
        request.command.libraryId,
        request.command.assetId,
      )) {
        // Model thumbnails render offscreen in Main (slice E): the explicit
        // request enqueues through the queue, and the thumbnail.ready event
        // arrives asynchronously once the offscreen frame lands.
        scheduleThumbnailScene(
          request.command.libraryId,
          'mutation',
          [request.command.assetId],
        );
      }
      if (generated) {
        // Publish the thumbnail-ready event to the renderer
        if (parentPort) {
          parentPort.postMessage({
            type: 'asset.thumbnail.ready',
            libraryId: request.command.libraryId,
            assetId: request.command.assetId,
            artifactId: generated.artifactId,
          });
        }
      }
      return {
        ok: true,
        type: 'media.thumbnail.generated',
        assetId: request.command.assetId,
        ...(generated ? { artifactId: generated.artifactId } : {}),
      };
    }
    case 'media.retry-artifact': {
      const { libraryId, assetId, kind } = request.command;
      libraryService.enqueueArtifactRetry({ libraryId, assetId, kind });
      // The idempotent queue scheduler owns all FFmpeg work; normal IPC returns
      // before poster/proxy generation and never starts a second drain.
      scheduleThumbnailScene(libraryId, 'mutation', [assetId]);
      return {
        ok: true,
        type: 'media.retry-artifact.queued',
        assetId,
        kind,
      };
    }
    case 'model.convert-fbx': {
      // Slice-0030-B: ufbx WASM → GLB cache. Single-flight + typed error codes
      // live in src/worker/fbx/convert-command.ts; slice C routes failures to
      // the FBXLoader fallback.
      const result = await handleFbxConvertCommand(libraryService, request.command);
      return {
        ok: true,
        type: 'model.convert-fbx.done' as const,
        assetId: request.command.assetId,
        ...result,
      };
    }
    case 'media.get-artifact-path': {
      const absolutePath = libraryService.getArtifactAbsolutePath(
        request.command.libraryId,
        request.command.artifactId,
        request.command.usage,
      );
      return { ok: true, type: 'media.artifact-path', artifactId: request.command.artifactId, absolutePath };
    }
    case 'media.get-source-path': {
      const source = libraryService.getCurrentMediaSource(
        request.command.libraryId,
        request.command.assetId,
        request.command.revisionId,
      );
      return {
        ok: true,
        type: 'media.source-path',
        assetId: request.command.assetId,
        revisionId: request.command.revisionId,
        ...source,
      };
    }
    case 'media.get-thumbnail-artifact': {
      const info = libraryService.getThumbnailArtifact(
        request.command.libraryId,
        request.command.assetId,
      );
      if (!info) throw new LibraryServiceError('ASSET_NOT_FOUND');
      return {
        ok: true,
        type: 'media.thumbnail-artifact',
        artifactId: info.artifactId,
        filePath: info.filePath,
        width: info.width,
        height: info.height,
      };
    }
    case 'media.get-preview-artifact': {
      const pluginArtifact = await writePluginMediaArtifact({
        libraryId: request.command.libraryId,
        assetId: request.command.assetId,
        kind: 'preview',
      });
      // Opening a preview is also an idempotent, high-priority generation hint.
      // A provided plugin artifact already satisfies the request, so avoid
      // enqueueing a native job that could overwrite it.
      if (!pluginArtifact) {
        scheduleThumbnailScene(
          request.command.libraryId,
          'mutation',
          [request.command.assetId],
        );
      }
      const preview = await libraryService.resolvePreviewArtifact(
        request.command.libraryId,
        request.command.assetId,
        request.command.exrPlane,
        request.command.colorSpace,
      );
      return {
        ok: true,
        type: 'media.preview-artifact',
        assetId: request.command.assetId,
        ...preview,
      };
    }
    case 'media.get-asset-path': {
      const absolutePath = libraryService.resolveAssetPath(
        request.command.libraryId,
        request.command.assetId,
      );
      return { ok: true, type: 'media.asset-path', assetId: request.command.assetId, absolutePath };
    }
    case 'model.resolve-companions': {
      // Slice A pipeline: the renderer 3D loader (slice C) rewrites OBJ+MTL /
      // FBX external texture references using this relative-path → assetId
      // index. Read-only; absolute paths never leave the Worker.
      const companions = libraryService.resolveModelCompanions(request.command);
      return {
        ok: true,
        type: 'model.companions',
        assetId: request.command.assetId,
        companions,
      };
    }
    case 'media.get-asset-paths': {
      // Main-only consumer (OS clipboard); paths never reach the Renderer.
      const { libraryId, assetIds } = request.command;
      const absolutePaths = assetIds.map((assetId) =>
        libraryService.resolveAssetPath(libraryId, assetId),
      );
      return {
        ok: true,
        type: 'media.asset-paths',
        assetIds,
        absolutePaths,
      };
    }
    case 'media.enqueue-thumbnail-jobs': {
      const enqueued = scheduleThumbnailQueue(request.command.libraryId, { limit: 50 });
      return { ok: true, type: 'media.jobs.enqueued', libraryId: request.command.libraryId, enqueued };
    }
    case 'media.process-thumbnail-queue': {
      const processed = await libraryService.processThumbnailQueue(request.command.libraryId);
      return { ok: true, type: 'media.jobs.processed', libraryId: request.command.libraryId, processed };
    }
    case 'media.list-jobs': {
      const status = libraryService.listMediaJobs(request.command.libraryId);
      return {
        ok: true,
        type: 'media.jobs.listed',
        libraryId: request.command.libraryId,
        ...status,
      };
    }
    case 'media.pause-jobs': {
      const result = libraryService.pauseMediaJobs(
        request.command.libraryId,
        request.command.jobIds,
      );
      return {
        ok: true,
        type: 'media.jobs.paused',
        libraryId: request.command.libraryId,
        ...result,
      };
    }
    case 'media.resume-jobs': {
      const result = libraryService.resumeMediaJobs(
        request.command.libraryId,
        request.command.jobIds,
      );
      scheduleThumbnailQueue(request.command.libraryId);
      return {
        ok: true,
        type: 'media.jobs.resumed',
        libraryId: request.command.libraryId,
        ...result,
      };
    }
    case 'media.cancel-jobs': {
      const result = libraryService.cancelMediaJobs(
        request.command.libraryId,
        request.command.jobIds,
      );
      return {
        ok: true,
        type: 'media.jobs.cancelled',
        libraryId: request.command.libraryId,
        ...result,
      };
    }
    case 'media.retry-jobs': {
      const result = libraryService.retryMediaJobs(
        request.command.libraryId,
        request.command.jobIds,
      );
      scheduleThumbnailQueue(request.command.libraryId);
      return {
        ok: true,
        type: 'media.jobs.retried',
        libraryId: request.command.libraryId,
        ...result,
      };
    }
    case 'plugin.jobs.enqueue': {
      const job = libraryService.enqueuePluginJob({
        libraryId: request.command.libraryId,
        ownerPluginId: request.command.ownerPluginId,
        ownerPackageHash: request.command.ownerPackageHash,
        ownerPluginInstanceId: request.command.ownerPluginInstanceId,
        ownerScope: request.command.ownerScope,
        ownerLibraryId: request.command.ownerLibraryId,
        pluginHandlerId: request.command.pluginHandlerId,
        payload: request.command.payload,
        recoveryStrategy: request.command.recoveryStrategy,
        priority: request.command.priority,
      });
      return {
        ok: true,
        type: 'plugin.jobs.enqueued',
        libraryId: request.command.libraryId,
        job,
      };
    }
    case 'plugin.jobs.list': {
      const jobs = libraryService.listPluginJobs(request.command.libraryId);
      return {
        ok: true,
        type: 'plugin.jobs.listed',
        libraryId: request.command.libraryId,
        jobs,
      };
    }
    case 'plugin.jobs.claim-next': {
      const job = libraryService.claimNextPluginJob({
        libraryId: request.command.libraryId,
        ownerPluginId: request.command.ownerPluginId,
        ownerPackageHash: request.command.ownerPackageHash,
        ownerPluginInstanceId: request.command.ownerPluginInstanceId,
        ownerScope: request.command.ownerScope,
        ownerLibraryId: request.command.ownerLibraryId,
      });
      return {
        ok: true,
        type: 'plugin.jobs.claimed',
        libraryId: request.command.libraryId,
        job,
      };
    }
    case 'plugin.jobs.complete': {
      const job = libraryService.completePluginJob(request.command);
      return {
        ok: true,
        type: 'plugin.jobs.completed',
        libraryId: request.command.libraryId,
        job,
      };
    }
    case 'plugin.jobs.cancel': {
      const job = libraryService.controlPluginJob({ ...request.command, action: 'cancel' });
      return {
        ok: true,
        type: 'plugin.jobs.cancelled',
        libraryId: request.command.libraryId,
        job,
      };
    }
    case 'plugin.jobs.pause': {
      const job = libraryService.controlPluginJob({ ...request.command, action: 'pause' });
      return {
        ok: true,
        type: 'plugin.jobs.job-paused',
        libraryId: request.command.libraryId,
        job,
      };
    }
    case 'plugin.jobs.resume': {
      const job = libraryService.controlPluginJob({ ...request.command, action: 'resume' });
      return {
        ok: true,
        type: 'plugin.jobs.resumed',
        libraryId: request.command.libraryId,
        job,
      };
    }
    case 'plugin.jobs.retry': {
      const job = libraryService.controlPluginJob({ ...request.command, action: 'retry' });
      return {
        ok: true,
        type: 'plugin.jobs.retried',
        libraryId: request.command.libraryId,
        job,
      };
    }
    case 'plugin.jobs.report-progress': {
      const job = libraryService.reportPluginJobProgress(request.command);
      return {
        ok: true,
        type: 'plugin.jobs.completed',
        libraryId: request.command.libraryId,
        job,
      };
    }
    case 'plugin.jobs.pause-owners': {
      const pausedCount = libraryService.pausePluginJobsForOwners({
        libraryId: request.command.libraryId,
        owners: request.command.owners,
        errorCode: request.command.errorCode,
        errorDetail: request.command.errorDetail,
      });
      return {
        ok: true,
        type: 'plugin.jobs.paused',
        libraryId: request.command.libraryId,
        pausedCount,
      };
    }
    case 'plugin.derived-fields.materialize': {
      const result = libraryService.materializePluginDerivedFields(request.command);
      return {
        ok: true,
        type: 'plugin.derived-fields.materialized',
        libraryId: request.command.libraryId,
        ...result,
      };
    }
    case 'plugin.derived-fields.query': {
      const result = libraryService.queryPluginDerivedFields(request.command);
      return {
        ok: true,
        type: 'plugin.derived-fields.queried',
        libraryId: request.command.libraryId,
        ...result,
        offset: request.command.offset ?? 0,
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
      publishAiProgress(request.command.libraryId);
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
      providerConcurrencyLimiter.setLimit(concurrencyLimit);
      let processed = 0;
      let succeeded = 0;
      let failed = 0;
      let requeued = 0;
      const attemptedJobIds: string[] = [];

      const processLane = async (): Promise<void> => {
        while (processed < maxJobs) {
          const job = libraryService.claimNextAiJob(libraryId, attemptedJobIds);
          if (!job) break;
          attemptedJobIds.push(job.jobId);
          processed++;
          publishAiProgress(libraryId);
          const controller = aiJobAbortRegistry.register(libraryId, job.jobId);
          const nestedRequestId = `${request.requestId}:${job.jobId}`;
          analysisControls.set(nestedRequestId, {
            jobId: job.jobId,
            signal: controller.signal,
            canWrite: () => safeAiJobState(libraryId, job.jobId) === 'running',
            requestTimeoutMs,
          });
          try {
            const result = await handleRequest({
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
            });
            if (controller.signal.aborted || safeAiJobState(libraryId, job.jobId) !== 'running') {
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
              const failure = libraryService.failAiJob(libraryId, job.jobId, {
                errorCode,
                retryable: artifactPending,
                maxAttempts: artifactPending
                  ? AI_ARTIFACT_PENDING_MAX_ATTEMPTS
                  : maxAttempts,
                errorDetail: detail,
              });
              if (failure.status === 'queued') requeued++;
              else failed++;
              publishAiProgress(libraryId);
              continue;
            }
            libraryService.completeAiJob(libraryId, job.jobId);
            succeeded++;
            publishAiProgress(libraryId);
          } catch (error) {
            if (controller.signal.aborted || safeAiJobState(libraryId, job.jobId) !== 'running') {
              continue;
            }
            const classification = aiQueueFailure(error);
            libraryService.reportDiagnostic(
              'ai.queue.analysis',
              safeAiDiagnostic(classification.errorCode, error),
              { libraryId, jobId: job.jobId, assetId: job.assetId, errorCode: classification.errorCode },
            );
            const failure = libraryService.failAiJob(libraryId, job.jobId, {
              ...classification,
              maxAttempts: classification.maxAttempts ?? maxAttempts,
              errorDetail: safeAiErrorDetail(classification.errorCode, error),
            });
            if (failure.status === 'queued') requeued++;
            else failed++;
            publishAiProgress(libraryId);
          } finally {
            analysisControls.delete(nestedRequestId);
            aiJobAbortRegistry.unregister(job.jobId);
          }
        }
      };

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
    }
    case 'ai.set-concurrency-limit': {
      providerConcurrencyLimiter.setLimit(request.command.concurrencyLimit);
      return {
        ok: true,
        type: 'ai.concurrency.updated' as const,
        concurrencyLimit: request.command.concurrencyLimit,
      };
    }
    case 'ai.clear-content': {
      const { clearedCount, affectedAssetIds } = libraryService.clearAiContent(request.command);
      // Publish ai.content.cleared event
      if (parentPort) {
        parentPort.postMessage({
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
      aiJobAbortRegistry.abort(request.command.libraryId, request.command.jobIds);
      publishAiProgress(request.command.libraryId);
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
      publishAiProgress(request.command.libraryId);
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
      aiJobAbortRegistry.abort(request.command.libraryId, request.command.jobIds);
      publishAiProgress(request.command.libraryId);
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
      publishAiProgress(request.command.libraryId);
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
    case 'automation.file-operation-plan':
      // This preflight is deliberately accepted only through the fail-closed
      // automation-readonly dispatcher above. A normal desktop request must
      // not be able to manufacture a plan outside Main approval.
      throw new Error('Automation file-operation planning requires automation-readonly dispatch.');
    case 'automation.file-import-plan':
      throw new Error('Automation import planning requires automation-readonly dispatch.');
    default:
      return assertNever(request.command);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Worker command: ${String(value)}`);
}

function requestIdFrom(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null || !('requestId' in input)) return undefined;
  const requestId = input.requestId;
  return typeof requestId === 'string' && requestId.trim() !== '' && requestId.length <= 255
    ? requestId
    : undefined;
}

parentPort.on('message', async (event) => {
  const input: unknown = event.data;

  try {
    const providerResponse = parsePluginMediaProviderResponse(input);
    const pending = pendingPluginMediaProviderRequests.get(providerResponse.requestId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingPluginMediaProviderRequests.delete(providerResponse.requestId);
      pending.resolve(providerResponse.result);
    }
    return;
  } catch {
    // A normal Worker request or control message; validate it below.
  }

  try {
    // Slice E: Main's offscreen render result (PNG bytes or typed failure).
    const renderResponse = parseModelThumbnailRenderResponse(input);
    const pending = pendingModelThumbnailRenders.get(renderResponse.requestId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingModelThumbnailRenders.delete(renderResponse.requestId);
      pending.resolve(renderResponse.result);
    }
    return;
  } catch {
    // A normal Worker request or control message; validate it below.
  }

  try {
    const control = parseWorkerControlMessage(input);
    if (control.type === 'worker.shutdown') {
      aiJobAbortRegistry.abortAll();
      aiProgressThrottler.clearAll();
      libraryService.closeAll();
      parentPort.postMessage({ type: 'worker.shutdown.ack' });
      clearInterval(processLifetime);
      return;
    }
  } catch {
    // A normal request is not a control message; validate it below.
  }

  const requestId = requestIdFrom(input);
  if (!requestId) return;

  let response: WorkerResponse;
  try {
    const request = parseWorkerRequest(input);
    response = { requestId: request.requestId, result: await handleRequest(request) };
  } catch (error) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      scope: 'worker.request',
      requestId,
      commandType:
        typeof input === 'object' && input !== null && 'command' in input &&
        typeof input.command === 'object' && input.command !== null && 'type' in input.command
          ? String(input.command.type)
          : 'malformed',
      error: errorForLog(error),
    }));
    response = {
      requestId,
      result: {
        ok: false,
        error: publicErrorForWorkerFailure(error),
      },
    };
  }

  parentPort.postMessage(response);
});

parentPort.postMessage({ type: 'worker.ready' });
