import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  parseWorkerRequest,
  type WorkerCommand,
  type WorkerRequest,
} from '../shared/protocol/requests';
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
import {
  DOCUMENT_THUMBNAIL_WORKER_REQUEST_TIMEOUT_MS,
  parseDocumentThumbnailRenderResponse,
  type DocumentThumbnailRenderRequest,
  type DocumentThumbnailRenderResponse,
} from '../shared/document-thumbnail-protocol';
import { isBenignThumbnailErrorCode } from '../shared/thumbnail-support';
import { SyncEngine, type SyncEngineOptions } from './sync/sync-engine';
import { createLibrarySyncPort } from './sync/library-port';
import { WebDAVDriver } from './sync/webdav-driver';
import { parseManifest, serializeManifest } from './sync/manifest';
import {
  SYNC_MANIFEST_FILE,
  SYNC_ASSETS_DIR,
  sanitizeSyncDirectoryName,
  normalizeWebDAVBaseUrl,
} from '../shared/sync-paths';
import { RemoteStorageError } from './sync/remote-storage';
import {
  LibraryService,
  LibraryServiceError,
  THUMBNAIL_VISIBLE_PAGE_SIZE,
  shutdownActiveMediaProcesses,
  shutdownWorkerResources,
  type ImportFailurePoint,
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
import { loadAiImageInput } from './ai/image-input';
import { loadVideoAiInput } from './ai/video-input';
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
import { workerMediaDecodeWaveSize } from './media-concurrency';
import { mediaResourceGuard } from './media-resource-guard';
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
import {
  LatestSearchRequestCoordinator,
  searchRequestLaneKey,
} from './search-request-coordinator';
import {
  performanceLaneForCommand,
  performanceInteractionKeyForCommand,
  isInteractivePerformanceLane,
  shouldPreemptAutomaticMedia,
  type PerformanceRequestEnvelope,
} from '../shared/performance-contract';
import { createPublicError } from '../shared/protocol/errors';
import {
  InteractiveScheduler,
  SchedulerCancelledError,
} from './interactive-scheduler';
import { LibraryGenerationRegistry } from './library-generation';
import {
  isViewportOnlyThumbnailWave,
  shouldPreemptVisibleWindow,
  shouldRunThumbnailBackgroundRepair,
} from './visible-window-policy';
import {
  StartupBurstGateRegistry,
  type StartupBurstGateToken,
} from './startup-burst-gate';

const parentPort: ParentPort | undefined = process.parentPort;
const aiJobAbortRegistry = new AiJobAbortRegistry();
const libraryGenerationRegistry = new LibraryGenerationRegistry();
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
// Serpent-4bdd26 收编 codex/large-library-performance@15f3325c：视口抢占机制。
const activeThumbnailQueueControllers = new Map<string, AbortController>();
/**
 * The active queue's claim scope is mutable because a visible-window report
 * can arrive while processThumbnailQueue is awaiting native work. Updating
 * the scope makes the current pump stop claiming stale queued ids without
 * aborting overlapping native jobs and immediately decoding them again.
 */
const activeThumbnailQueueAssetScopes = new Map<string, {
  current: string[] | undefined;
}>();
const pendingThumbnailQueueAborts = new Set<string>();
const deferredMediaResourceRetries = new Map<string, ReturnType<typeof setTimeout>>();
// Lifecycle admission fence: aborting a queue is cooperative, so its cleanup
// can run after library.close has been admitted. Keep that cleanup from
// creating a fresh timer/pump until a later library.open succeeds.
const closingLibraryIds = new Set<string>();
/**
 * A visible-window request can arrive while a low-priority startup wave is
 * decoding. Priority promotion alone is not enough in that case: the next
 * batch would still inherit the startup lane's intentionally small wave
 * size. Remember the largest current viewport until the active queue reaches
 * its next batch boundary, then let that viewport claim one full wave.
 */
const pendingVisibleThumbnailWaves = new Map<string, {
  assetIds: string[];
  waveSize: number;
}>();
/** Stable viewport sets are idempotent until the library changes. */
const lastVisibleWindowKeyByLibrary = new Map<string, string>();
/** The key alone cannot distinguish geometry churn from real navigation. */
const lastVisibleWindowAssetIdsByLibrary = new Map<string, string[]>();
const deferredStartupThumbnailQueues = new Map<string, ReturnType<typeof setTimeout>>();
type VisibleDimensionProbeState = {
  assetIds: Set<string>;
  controller: AbortController;
  running: boolean;
};
/**
 * Header probes are useful for correcting masonry geometry, but they are not
 * part of the visible-window ACK. Keep them cancellable and drain them in
 * small async batches so a cold source volume cannot queue behind a scroll.
 */
const visibleDimensionProbeStates = new Map<string, VisibleDimensionProbeState>();
// Keep the startup backfill off the primary decoder lane until the renderer
// has reported its first real viewport. A fixed delay is not sufficient on a
// large library: opening the shell can take longer than the timer, so the
// old backfill could claim the decoder just before the first visible-window
// request arrived.
const startupThumbnailVisibleWindows = new Set<string>();
const latestAssetSearchRequests = new LatestSearchRequestCoordinator();
const interactiveScheduler = new InteractiveScheduler();
const pendingPluginMediaProviderRequests = new Map<string, {
  resolve: (result: PluginMediaProviderResult) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

if (!parentPort) {
  throw new Error('Library Worker must be started by the Electron main process.');
}

// Serpent-8ca259: Electron's UtilityProcess sets process.type = 'utility'.
// pdfjs-dist's isNodeJS detection explicitly excludes Electron processes with
// a non-browser process.type, so pdfjs would take its browser code paths
// (DOM canvas factory, FontFace font loading, real Worker construction) —
// none of which exist inside the Library Worker. Neutralizing process.type
// makes pdfjs load its Node build paths (fake worker, Node canvas factory,
// embedded-font support), which is what PDF thumbnail generation needs.
// Nothing else in the Worker branches on process.type.
Object.defineProperty(process, 'type', { value: undefined, configurable: true });

const e2eTerminateProcessAt = (() => {
  if (process.env.SERPENT_E2E !== '1') return undefined;
  const configured = process.env.SERPENT_E2E_LIBRARY_TERMINATE_AT;
  if (configured !== 'crash-after-place') return undefined;
  return configured as ImportFailurePoint;
})();

const libraryService = new LibraryService({
  onAssetsChanged: (event) => {
    lastVisibleWindowKeyByLibrary.delete(event.libraryId);
    lastVisibleWindowAssetIdsByLibrary.delete(event.libraryId);
    parentPort.postMessage(event);
  },
  onLibraryChanged: (event) => {
    lastVisibleWindowKeyByLibrary.delete(event.libraryId);
    lastVisibleWindowAssetIdsByLibrary.delete(event.libraryId);
    parentPort.postMessage(event);
  },
  onProgress: (event) => parentPort.postMessage(event),
  // Serpent-8ca259: HTML document thumbnails capture offscreen in Main.
  documentThumbnailRenderer: (input) => renderDocumentThumbnailViaMain(input),
  ...(e2eTerminateProcessAt === undefined
    ? {}
    : {
        failAt: e2eTerminateProcessAt,
        terminateProcessAt: e2eTerminateProcessAt,
      }),
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

function automaticMediaAdmissionAllowed(libraryId: string): boolean {
  return !closingLibraryIds.has(libraryId) && libraryService.hasOpenLibrary(libraryId);
}

// Electron's ParentPort delivers IPC messages but does not provide a documented
// event-loop ref. Development builds happen to have other active handles; a
// packaged utility process can otherwise exit cleanly immediately after ready.
const processLifetime = setInterval(() => {}, 60 * 60_000);

/** Serpent-xffq：按设备身份构建同步引擎（deviceId 由 Main 持久化生成）。 */
function buildSyncEngine(
  deviceId: string,
  onProgress?: SyncEngineOptions['onProgress'],
): SyncEngine {
  return new SyncEngine(createLibrarySyncPort(libraryService), { deviceId, onProgress });
}

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
 */let modelRenderTail: Promise<void> = Promise.resolve();
/**
 * Serpent-8ca259: ask Main to capture an HTML document thumbnail in a fresh
 * offscreen window. Resolves with the typed result (never rejects except on
 * abort); a missing Main response degrades to DOCUMENT_RENDER_TIMEOUT.
 */
const pendingDocumentThumbnailRenders = new Map<string, {
  resolve: (result: DocumentThumbnailRenderResponse['result']) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

function requestDocumentThumbnailRender(
  input: Omit<DocumentThumbnailRenderRequest, 'type' | 'requestId'>,
  signal?: AbortSignal,
): Promise<DocumentThumbnailRenderResponse['result']> {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingDocumentThumbnailRenders.delete(requestId);
      resolve({
        status: 'failed',
        errorCode: 'DOCUMENT_RENDER_TIMEOUT',
        reason: 'no render response from Main within the worker deadline',
      });
    }, DOCUMENT_THUMBNAIL_WORKER_REQUEST_TIMEOUT_MS);
    timer.unref?.();
    const onAbort = (): void => {
      clearTimeout(timer);
      pendingDocumentThumbnailRenders.delete(requestId);
      reject(new DOMException('Document thumbnail render request aborted.', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    pendingDocumentThumbnailRenders.set(requestId, { resolve, timer });
    parentPort?.postMessage({
      type: 'document-thumbnail.render-request',
      requestId,
      ...input,
    });
  });
}

/** Worker-side handler consumed by the LibraryService documentThumbnailRenderer. */
async function renderDocumentThumbnailViaMain(input: {
  libraryId: string;
  assetId: string;
  revisionId: string;
  url: string;
  signal?: AbortSignal;
}): Promise<{ png: Uint8Array; width: number; height: number } | null> {
  try {
    const result = await requestDocumentThumbnailRender(
      { url: input.url, width: 1024 },
      input.signal,
    );
    if (result.status === 'ok') {
      return { png: result.png, width: result.width, height: result.height };
    }
    return null;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    libraryService.reportDiagnostic('document-thumbnail.orchestrate', error, {
      libraryId: input.libraryId,
      assetId: input.assetId,
    });
    return null;
  }
}

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

const MODEL_FILE_EXTENSIONS = new Set(['.fbx', '.obj', '.glb', '.gltf', '.stl']);

function isModelFileFormat(filePath: string): boolean {
  return MODEL_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

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

async function renderModelAiViewsViaMain(input: {
  libraryId: string;
  assetId: string;
  revisionId: string;
  relativeFilePath: string;
  byteSize: number | null;
  signal: AbortSignal;
  views?: ReadonlyArray<readonly [number, number, number]>;
}): Promise<ModelThumbnailRenderOutcome> {
  return withModelRenderGate(input.signal, async () => {
    try {
      return await orchestrateRender({ ...input, views: input.views });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      libraryService.reportDiagnostic('model-views.orchestrate', error, {
        libraryId: input.libraryId,
        assetId: input.assetId,
      });
      return { status: 'failed', errorCode: 'MODEL_LOAD_FAILED' };
    }
  });
}

/**
 * Offscreen render orchestration for one queued model job: format dispatch,
 * FBX→GLB conversion first (a conversion failure fails the job with the typed
 * FBX_* code — the renderer never sees the raw FBX), companion index, then
 * the Main render request.
 */
async function orchestrateRender(input: {
  libraryId: string;
  assetId: string;
  revisionId: string;
  relativeFilePath: string;
  byteSize: number | null;
  signal: AbortSignal;
  /** Multi-view render (AI four views) — omitted for the single thumbnail. */
  views?: ReadonlyArray<readonly [number, number, number]>;
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
        ...(input.views === undefined
          ? {}
          : { views: input.views.map((v) => [v[0], v[1], v[2]] as [number, number, number]) }),
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
  const providerAsset = input.asset
    ?? libraryService.getPluginMediaProviderAsset(input.libraryId, input.assetId);
  const result = await requestPluginMediaProvider({
    ...input,
    ...(providerAsset === undefined ? {} : { asset: providerAsset }),
  });
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

/**
 * Import planning/copying still has synchronous filesystem sections inside
 * the Worker. Keep native decoder lanes from claiming another job while that
 * critical path owns the event loop; existing bounded jobs may finish and
 * their durable state remains untouched.
 */
async function withMediaSchedulingSuspended<T>(
  libraryId: string | undefined,
  operation: () => T | PromiseLike<T>,
): Promise<T> {
  mediaResourceGuard.enterExternalHold();
  try {
    return await operation();
  } finally {
    mediaResourceGuard.exitExternalHold();
    if (!mediaResourceGuard.isCoolingDown()) {
      const libraryIds = libraryId
        ? [libraryId]
        : libraryService.listLibraries().map((library) => library.libraryId);
      for (const scheduledLibraryId of libraryIds) {
        if (!libraryService.hasOpenLibrary(scheduledLibraryId)) continue;
        try {
          scheduleThumbnailQueue(scheduledLibraryId);
        } catch (error) {
          libraryService.reportDiagnostic('thumbnail-schedule.after-import', error, {
            libraryId: scheduledLibraryId,
          });
        }
      }
    }
  }
}

function scheduleMediaResourceRetry(libraryId: string): void {
  if (mediaResourceGuard.hasExternalHold() || !mediaResourceGuard.isCoolingDown()) return;
  if (deferredMediaResourceRetries.has(libraryId)) return;
  const delayMs = Math.max(1_000, mediaResourceGuard.remainingMs());
  const timer = setTimeout(() => {
    deferredMediaResourceRetries.delete(libraryId);
    if (!automaticMediaAdmissionAllowed(libraryId)) return;
    try {
      scheduleThumbnailQueue(libraryId);
    } catch (error) {
      libraryService.reportDiagnostic('thumbnail-schedule.resource-retry', error, { libraryId });
    }
  }, delayMs);
  timer.unref?.();
  deferredMediaResourceRetries.set(libraryId, timer);
}

function cancelMediaResourceRetry(libraryId: string): void {
  const timer = deferredMediaResourceRetries.get(libraryId);
  if (timer !== undefined) clearTimeout(timer);
  deferredMediaResourceRetries.delete(libraryId);
}

function scheduleThumbnailQueue(
  libraryId: string,
  options: {
    assetIds?: string[];
    limit?: number;
    priority?: number;
    repairFailed?: boolean;
    retryFailed?: boolean;
    /** Serpent-x9xu light scenes skip stale-artifact invalidation sweeps. */
    skipStaleRepair?: boolean;
    /** Serpent-4bdd26: cap in-flight decodes for this scene (startup backfill). */
    processMaxJobs?: number;
    /**
     * A visible-window destination change may preempt the active queue. When
     * geometry reports overlap the current destination, keep the active wave
     * running and let the latest visible ids run at the next safe boundary.
     */
    preemptVisible?: boolean;
  } = {},
): number {
  if (!automaticMediaAdmissionAllowed(libraryId)) return 0;
  let enqueued: number;
  try {
    enqueued = libraryService.enqueueThumbnailJobs(libraryId, options);
  } catch (error) {
    libraryService.reportDiagnostic('thumbnail-schedule.enqueue', error, { libraryId });
    throw error;
  }

  if (activeThumbnailQueues.has(libraryId)) {
    if (
      options.skipStaleRepair
      && options.assetIds
      && options.priority !== undefined
      && options.priority >= 350
    ) {
      pendingVisibleThumbnailWaves.set(
        libraryId,
        {
          // A new viewport supersedes the previous viewport. Keeping the
          // latest ids here is stronger than priority promotion: when the
          // active queue reaches its next claim boundary it cannot spend the
          // batch on stale startup assets first.
          assetIds: [...new Set(options.assetIds)].slice(0, 100),
          waveSize: Math.max(
            pendingVisibleThumbnailWaves.get(libraryId)?.waveSize ?? 0,
            options.assetIds.length,
          ),
        },
      );
      // The current pump may have claimed a large startup/initial-page wave.
      // Narrow the current pump to the newest visible ids. A destination
      // change already interrupted running jobs outside that set; aborting
      // the whole queue here would also requeue overlapping jobs and make the
      // replacement wave decode the same first cards twice.
      const assetScope = activeThumbnailQueueAssetScopes.get(libraryId);
      if (assetScope) {
        assetScope.current = [...new Set(options.assetIds)].slice(0, 100);
      }
    }
    rescheduledThumbnailQueues.add(libraryId);
    return enqueued;
  }
  activeThumbnailQueues.add(libraryId);

  const runBatch = async (): Promise<void> => {
    let continueImmediately = false;
    let pendingVisibleWaveCompleted = false;
    const pendingVisibleWave = pendingVisibleThumbnailWaves.get(libraryId);
    const queueController = new AbortController();
    const assetScope = activeThumbnailQueueAssetScopes.get(libraryId)
      ?? { current: undefined };
    activeThumbnailQueueControllers.set(libraryId, queueController);
    activeThumbnailQueueAssetScopes.set(libraryId, assetScope);
    if (pendingThumbnailQueueAborts.delete(libraryId)) {
      queueController.abort();
    }
    try {
      const onResult = (result: {
        assetId: string;
        artifactId?: string;
        errorCode?: string;
        width?: number;
        height?: number;
        durationMs?: number;
      }) => {
        if (result.artifactId) {
          parentPort?.postMessage({
            type: 'asset.thumbnail.ready',
            libraryId,
            assetId: result.assetId,
            artifactId: result.artifactId,
            ...(result.width === undefined ? {} : { width: result.width }),
            ...(result.height === undefined ? {} : { height: result.height }),
            ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs }),
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
      // Image thumbs share a small Sharp semaphore. Video/OIIO stay separately
      // bounded. Claim a wave of 2× concurrency so the pool stays
      // full instead of draining and waiting for the next setTimeout. A light
      // visible-window request claims the whole reported window in one queue
      // call; the service still caps actual decoder concurrency, but this
      // avoids inserting a timer/query boundary between visible thumbnails.
      const thumbnailWaveSize = workerMediaDecodeWaveSize();
      // A light explicit wave belongs only to the reported viewport. Falling
      // back to a 500-row library fill when those ids have no primary work
      // turns a cheap visible report into a synchronous large-library scan
      // and can starve browse/page messages in the Worker event loop. A
      // pending viewport wave keeps the same restriction even when it
      // arrived while a background queue was active.
      const viewportOnlyWave = isViewportOnlyThumbnailWave({
        skipStaleRepair: options.skipStaleRepair,
        assetIds: options.assetIds,
        pendingVisibleWindow: pendingVisibleWave !== undefined,
      });
      const visibleAssetIds = pendingVisibleWave?.assetIds
        ?? (options.skipStaleRepair && options.assetIds
          ? [...new Set(options.assetIds)].slice(0, 100)
          : undefined);
      if (assetScope.current === undefined && visibleAssetIds !== undefined) {
        assetScope.current = visibleAssetIds;
      }
      const processWaveSize = pendingVisibleWave !== undefined
        ? Math.max(1, Math.min(100, Math.trunc(pendingVisibleWave.waveSize)))
        : options.processMaxJobs !== undefined
          ? Math.max(1, Math.min(100, Math.trunc(options.processMaxJobs)))
          : options.skipStaleRepair && options.assetIds
            ? Math.min(100, Math.max(thumbnailWaveSize, options.assetIds.length))
            : thumbnailWaveSize;
      const processed = await libraryService.processThumbnailQueue(libraryId, {
        maxJobs: processWaveSize,
        jobKinds: ['generate_thumbnail', 'generate_video_poster'],
        interactive: viewportOnlyWave,
        ...(visibleAssetIds === undefined ? {} : { assetIds: visibleAssetIds }),
        signal: queueController.signal,
        claimAssetIdsRef: assetScope,
        onResult,
        onAiInputReady: (event) => {
          parentPort?.postMessage({
            type: 'asset.ai-input.ready',
            libraryId,
            assetId: event.assetId,
            artifactId: event.artifactId,
          });
        },
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
        modelAiViewsRenderer: (input) => renderModelAiViewsViaMain(input),
      });
      pendingVisibleWaveCompleted = true;
      const queueWasAborted = queueController.signal.aborted;
      if (mediaResourceGuard.isCoolingDown()) scheduleMediaResourceRetry(libraryId);
      // A visible wave must yield after its bounded claim even when it filled
      // the requested window. Continuing the old closure here would skip the
      // cleanup below and let a background queue turn the next tick into a
      // whole-library fill before the latest visible ids are admitted.
      continueImmediately = !queueWasAborted
        && !viewportOnlyWave
        && processed === processWaveSize;
      // A visible report can arrive while a startup/maintenance wave is
      // awaiting native work. Do not let that older closure launch its
      // whole-library repair tail before the pending viewport takes over.
      const visibleWavePending = pendingVisibleThumbnailWaves.has(libraryId);
      const mayRunBackgroundRepair = () => shouldRunThumbnailBackgroundRepair({
        viewportOnlyWave,
        queueWasAborted,
        continueImmediately,
        visibleWavePending,
      });
      if (mayRunBackgroundRepair()) {
        const filled = libraryService.enqueueThumbnailJobs(libraryId, {
          limit: 500,
          priority: 50,
          skipStaleRepair: true,
        });
        continueImmediately = filled > 0;
      }
      if (mayRunBackgroundRepair()) {
        try {
          const dimensions = libraryService.backfillMissingImageDimensions(libraryId, 48);
          for (const item of dimensions) {
            parentPort?.postMessage({
              type: 'asset.dimensions.ready',
              libraryId,
              assetId: item.assetId,
              width: item.width,
              height: item.height,
            });
          }
          if (dimensions.length > 0) continueImmediately = true;
        } catch (dimensionError) {
          libraryService.reportDiagnostic('thumbnail-schedule.dimensions', dimensionError, {
            libraryId,
          });
        }
      }
    } catch (error) {
      libraryService.reportDiagnostic('thumbnail-schedule.process', error, { libraryId });
    }
    if (continueImmediately) {
      setTimeout(() => void runBatch(), 0);
      return;
    }
    if (activeThumbnailQueueControllers.get(libraryId) === queueController) {
      activeThumbnailQueueControllers.delete(libraryId);
    }
    if (activeThumbnailQueueAssetScopes.get(libraryId) === assetScope) {
      activeThumbnailQueueAssetScopes.delete(libraryId);
    }
    activeThumbnailQueues.delete(libraryId);
    const completedVisibleWaveIsCurrent = pendingVisibleWaveCompleted
      && pendingVisibleWave !== undefined
      && pendingVisibleThumbnailWaves.get(libraryId) === pendingVisibleWave
      && !queueController.signal.aborted;
    if (completedVisibleWaveIsCurrent) {
      // The visible wave was the only work requested by the reschedule. Do
      // not immediately restart the old background closure: that would turn
      // a bounded viewport report into a 500-row fill/dimension sweep. A
      // later browse/refresh or the independent maintenance scheduler can
      // admit background work again after the interactive wave has yielded.
      pendingVisibleThumbnailWaves.delete(libraryId);
    }
    // A visible report can have arrived while this queue was unwinding. The
    // primary queue must resume first; otherwise palette/proxy work starts in
    // the gap and competes with the wave that the user is waiting for.
    if (rescheduledThumbnailQueues.delete(libraryId)) {
      if (completedVisibleWaveIsCurrent) {
        scheduleSecondaryMediaQueue(libraryId);
        return;
      }
      activeThumbnailQueues.add(libraryId);
      setTimeout(() => void runBatch(), 0);
      return;
    }
    scheduleSecondaryMediaQueue(libraryId);
  };

  setTimeout(() => void runBatch(), 0);
  return enqueued;
}

const STARTUP_THUMBNAIL_DELAY_MS = 1_000;
// Serpent-4bdd26 收编 codex/large-library-performance@15f3325c：等待首个真实视口。
const STARTUP_THUMBNAIL_VISIBLE_WAIT_MS = 250;
const STARTUP_THUMBNAIL_MAX_VISIBLE_WAIT_MS = 8_000;

// Serpent-onch/9e1d8d: per-command timing log, off by default.
const WORKER_CMD_LOG = process.env.SERPENT_WORKER_CMD_LOG === '1';

// Serpent-2cc492（真实 NAS 生产库事故，2026-08-23）：开库后台对账若与渲染端
// startup 请求风暴同时运行，SMB 上 21,508 条目的 artifact 枚举实测 ~16.5s，
// 加上各同步 SQL 步骤，startup 突发全部撞上主进程 15s 超时且 late 响应被
// 丢弃（一次 E2E 记录到 462 条）——画布永远等不到第一页数据。因此对账必须
// 等首个浏览查询真正服务完毕、且在飞命令清零后才启动；StartupBurstGateRegistry
// 还按 libraryId + generation 隔离状态，避免多个打开库互相释放或取消启动门。
const startupBurstGates = new StartupBurstGateRegistry();

/** Run the open reconciliation only after the startup burst has drained. */
function scheduleOpenBackgroundReconciliation(
  libraryId: string,
  libraryGeneration: number,
): StartupBurstGateToken {
  // Keep a sentinel until the opened response is posted. This lets the gate
  // be installed before Main can send the first browse request, while the
  // registry still keeps all counts scoped to this library and generation.
  const token = startupBurstGates.open(libraryId, libraryGeneration);
  void startupBurstGates.waitForDrain(token).then(() => {
    if (!automaticMediaAdmissionAllowed(libraryId)) return undefined;
    return interactiveScheduler.schedule(
      {
        requestId: `reconciliation:${libraryId}:${libraryGeneration}`,
        lane: 'maintenance',
        libraryId,
        libraryGeneration,
        isCurrent: () => libraryGenerationRegistry.isCurrent(libraryId, libraryGeneration),
      },
      () => libraryService.runOpenBackgroundReconciliation(libraryId),
      { cancel: () => libraryService.cancelOpenBackgroundReconciliation(libraryId) },
    );
  }).catch(() => {
    // runOpenBackgroundReconciliation diagnoses internally; a gate failure
    // must never surface as an unhandled rejection.
  });
  return token;
}

/**
 * Do not let the library-open backfill claim the primary decoder before the
 * renderer has had a chance to report its first visible window. Re-arm the
 * delay whenever interactive media work extends the idle window below.
 */
function deferStartupThumbnailScene(
  libraryId: string,
  libraryGeneration: number,
): void {
  const previous = deferredStartupThumbnailQueues.get(libraryId);
  if (previous !== undefined) clearTimeout(previous);
  startupThumbnailVisibleWindows.delete(libraryId);

  // Serpent-140fe2 direction (user, 2026-08-22): thumbnails must be queued
  // for the WHOLE library right after open, not lazily per viewport. The
  // queue itself provides ordering — visible-window waves boost the current
  // viewport above the low-priority backfill — so interactive activity no
  // longer postpones the enqueue (it only ever postponed it forever during
  // continuous browsing).
  // Serpent-4bdd26 收编：大库上开壳可能比固定延迟更久，旧回填会在首个
  // visible-window 到达前抢占解码器。每 250ms 轮询视口标记（最多 8s），
  // 看到视口后再启动 startup 场景。
  const waitDeadline = Date.now() + STARTUP_THUMBNAIL_MAX_VISIBLE_WAIT_MS;
  const attempt = () => {
    deferredStartupThumbnailQueues.delete(libraryId);
    if (
      !startupThumbnailVisibleWindows.has(libraryId)
      && Date.now() < waitDeadline
    ) {
      deferredStartupThumbnailQueues.set(
        libraryId,
        setTimeout(attempt, STARTUP_THUMBNAIL_VISIBLE_WAIT_MS),
      );
      return;
    }
    // Serpent-2cc492（真实 NAS 生产库事故第二轮归因，2026-08-23）：startup
    // 全量入队与处理本身就是一个持续数十秒的 Worker 风暴源（大库上 stale
    // repair 扫描 + 每个失败任务一次 journal 写事务），与开库对账同样会饿死
    // 渲染端首屏请求。因此 startup 场景与后台对账共用同一个 startup-burst
    // 门闩：首屏浏览响应投递且在飞清零之前不入队不处理；15s 上限兜底。
    const token = { libraryId, generation: libraryGeneration };
    void startupBurstGates.waitForDrain(token).then(() => {
      if (automaticMediaAdmissionAllowed(libraryId)) {
        scheduleThumbnailScene(libraryId, 'startup');
      }
      return undefined;
    }).catch(() => {
      // Never let automatic media work surface as an unhandled rejection.
    });
  };

  deferredStartupThumbnailQueues.set(
    libraryId,
    setTimeout(attempt, STARTUP_THUMBNAIL_DELAY_MS),
  );
}

function cancelDeferredStartupThumbnailScene(libraryId: string): void {
  const timer = deferredStartupThumbnailQueues.get(libraryId);
  if (timer !== undefined) clearTimeout(timer);
  deferredStartupThumbnailQueues.delete(libraryId);
  startupThumbnailVisibleWindows.delete(libraryId);
  pendingVisibleThumbnailWaves.delete(libraryId);
  lastVisibleWindowKeyByLibrary.delete(libraryId);
  lastVisibleWindowAssetIdsByLibrary.delete(libraryId);
}

function enqueueVisibleWindowDimensionProbes(
  libraryId: string,
  assetIds: readonly string[],
): void {
  let state = visibleDimensionProbeStates.get(libraryId);
  if (!state) {
    state = {
      assetIds: new Set(),
      controller: new AbortController(),
      running: false,
    };
    visibleDimensionProbeStates.set(libraryId, state);
  }
  for (const assetId of assetIds) state.assetIds.add(assetId);
  if (state.running) return;
  state.running = true;
  void drainVisibleWindowDimensionProbes(libraryId, state);
}

async function drainVisibleWindowDimensionProbes(
  libraryId: string,
  state: VisibleDimensionProbeState,
): Promise<void> {
  try {
    while (state.assetIds.size > 0 && !state.controller.signal.aborted) {
      const batch: string[] = [];
      for (const assetId of state.assetIds) {
        state.assetIds.delete(assetId);
        batch.push(assetId);
        if (batch.length >= 16) break;
      }
      try {
        const dimensions = await libraryService.persistVisibleWindowImageDimensionsAsync(
          libraryId,
          batch,
          state.controller.signal,
        );
        if (state.controller.signal.aborted) return;
        for (const item of dimensions) {
          if (state.controller.signal.aborted) return;
          parentPort?.postMessage({
            type: 'asset.dimensions.ready',
            libraryId,
            assetId: item.assetId,
            width: item.width,
            height: item.height,
          });
        }
      } catch (error) {
        if (!state.controller.signal.aborted) {
          libraryService.reportDiagnostic('visible-window.dimensions', error, { libraryId });
        }
        return;
      }
      // Let queued search/preview requests run before the next source batch.
      // The first browse after open is different: it must claim the Worker
      // before the sidebar/count burst can run. The per-library startup gate
      // remains unserved until that response is posted, so the first page is
      // serviced synchronously while later searches retain the coalescing
      // yield.
      if (startupBurstGates.isBrowseServed(libraryId)) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
  } finally {
    if (visibleDimensionProbeStates.get(libraryId) === state) {
      visibleDimensionProbeStates.delete(libraryId);
    }
  }
}

function cancelVisibleWindowDimensionProbes(libraryId: string): void {
  const state = visibleDimensionProbeStates.get(libraryId);
  if (!state) return;
  state.assetIds.clear();
  state.controller.abort();
  visibleDimensionProbeStates.delete(libraryId);
}

const SECONDARY_MEDIA_JOB_KINDS = [
  'extract_metadata',
  'generate_contact_sheet',
  'generate_webm_proxy',
  'generate_audio_proxy',
  'extract_palette',
] as const;
const activeSecondaryMediaQueues = new Set<string>();
const activeSecondaryMediaQueueControllers = new Map<string, AbortController>();
const secondaryMediaIdleUntil = new Map<string, number>();
const rescheduledSecondaryMediaQueues = new Set<string>();
const urgentSecondaryMediaQueues = new Set<string>();
const urgentSecondaryMediaAssetIds = new Map<string, Set<string>>();
const secondaryMediaRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const secondaryMediaFairnessTurns = new Map<string, number>();
const RAW_METADATA_BACKFILL_BATCH_SIZE = 256;

function cancelSecondaryMediaRetry(libraryId: string): void {
  const timer = secondaryMediaRetryTimers.get(libraryId);
  if (timer !== undefined) clearTimeout(timer);
  secondaryMediaRetryTimers.delete(libraryId);
}

function scheduleSecondaryMediaRetry(libraryId: string, delayMs: number): void {
  if (secondaryMediaRetryTimers.has(libraryId)) return;
  const timer = setTimeout(() => {
    secondaryMediaRetryTimers.delete(libraryId);
    if (automaticMediaAdmissionAllowed(libraryId)) scheduleSecondaryMediaQueue(libraryId);
  }, Math.max(250, delayMs));
  timer.unref?.();
  secondaryMediaRetryTimers.set(libraryId, timer);
}

function noteInteractiveMediaRequest(
  libraryId: string,
  options: { abortSecondary?: boolean } = {},
): void {
  // Serpent-4bdd26 收编 codex/large-library-performance@15f3325c：冷可见波包含
  // 解码 + artifact 发布 + 渲染协议投递。1 秒的空闲窗允许开库对账在该波仍在
  // 填充视口时恢复（NAS 上尤其明显）。磁盘维护让出接下来 2 秒的交互；
  // 另一次 search/viewport 请求会继续延长窗口。
  const idleUntil = Date.now() + 2_000;
  secondaryMediaIdleUntil.set(libraryId, idleUntil);
  libraryService.noteInteractiveActivity(libraryId, 2_000);
  // The secondary pump may already be inside a palette/proxy job when the
  // first visible-window report arrives. Pausing only its next claim still
  // leaves that native work competing with the primary visible wave. Abort
  // the current derivative cooperatively; its durable job remains queued for
  // the next idle window.
  // An explicit viewer fallback is already admitted as an urgent secondary
  // request. The viewer polls this same Worker while the proxy is queued;
  // aborting the queue for every poll can starve it forever before its timer
  // gets a chance to claim the durable job. Keep the urgent, asset-scoped
  // pump alive and continue pausing only ordinary background derivatives.
  if (options.abortSecondary !== false && !urgentSecondaryMediaQueues.has(libraryId)) {
    const controller = activeSecondaryMediaQueueControllers.get(libraryId);
    if (controller) {
      rescheduledSecondaryMediaQueues.add(libraryId);
      controller.abort();
    }
  }
}

/**
 * Automatic media pumps must yield before an interactive request enters the
 * single Worker/SQLite owner. Abort is cooperative: a decoder reaches its
 * safe point and durable state is requeued, while no new background claim can
 * slip in behind the user request.
 */
function suspendAutomaticMediaForInteractive(libraryId: string): void {
  const thumbnailController = activeThumbnailQueueControllers.get(libraryId);
  if (thumbnailController) {
    thumbnailController.abort();
  } else if (activeThumbnailQueues.has(libraryId)) {
    // The queue can be between enqueue and its setTimeout start. Preserve the
    // pause across that boundary so its first batch cannot claim work.
    pendingThumbnailQueueAborts.add(libraryId);
  }
  // Keep an explicit viewer fallback alive. `media.get-preview-artifact` is
  // polled while the proxy is generating, and this preemption hook runs before
  // the request handler's activity note; aborting the urgent pump here would
  // starve the very job that the viewer is waiting for.
  if (!urgentSecondaryMediaQueues.has(libraryId)) {
    const controller = activeSecondaryMediaQueueControllers.get(libraryId);
    if (controller) {
      rescheduledSecondaryMediaQueues.add(libraryId);
      controller.abort();
    }
  }
}

function cancelAutomaticMediaForLibrary(libraryId: string): void {
  const thumbnailController = activeThumbnailQueueControllers.get(libraryId);
  if (thumbnailController) {
    thumbnailController.abort();
  } else if (activeThumbnailQueues.has(libraryId)) {
    pendingThumbnailQueueAborts.add(libraryId);
  } else {
    pendingThumbnailQueueAborts.delete(libraryId);
  }
  rescheduledThumbnailQueues.delete(libraryId);
  const secondaryController = activeSecondaryMediaQueueControllers.get(libraryId);
  if (secondaryController) secondaryController.abort();
  rescheduledSecondaryMediaQueues.delete(libraryId);
  cancelSecondaryMediaRetry(libraryId);
  secondaryMediaFairnessTurns.delete(libraryId);
  secondaryMediaIdleUntil.delete(libraryId);
  urgentSecondaryMediaQueues.delete(libraryId);
  urgentSecondaryMediaAssetIds.delete(libraryId);
}

/**
 * Secondary derivatives remain automatic, but drain one at a time and only
 * after an interactive idle window. They used to share the CPU-3 preview
 * wave, allowing palette/proxy work to monopolize a large-library Worker.
 */
function scheduleSecondaryMediaQueue(
  libraryId: string,
  options: { urgent?: boolean; assetId?: string } = {},
): void {
  if (!automaticMediaAdmissionAllowed(libraryId)) return;
  cancelSecondaryMediaRetry(libraryId);
  if (options.urgent) {
    // An explicit viewer fallback is a user-visible recovery path, not an
    // automatic derivative. Let it bypass the idle window so a queued proxy
    // cannot remain behind an import/startup wave while the viewer is already
    // showing the source codec failure.
    urgentSecondaryMediaQueues.add(libraryId);
    if (options.assetId) {
      const assetIds = urgentSecondaryMediaAssetIds.get(libraryId) ?? new Set<string>();
      assetIds.add(options.assetId);
      urgentSecondaryMediaAssetIds.set(libraryId, assetIds);
    }
    secondaryMediaIdleUntil.set(libraryId, Date.now());
  }
  if (activeSecondaryMediaQueues.has(libraryId)) {
    // A visible request can abort the old pump between its timer and its
    // cleanup. Remember the admission so a later primary-wave completion does
    // not get lost behind the stale active marker.
    if (activeSecondaryMediaQueueControllers.get(libraryId)?.signal.aborted) {
      rescheduledSecondaryMediaQueues.add(libraryId);
    }
    return;
  }
  activeSecondaryMediaQueues.add(libraryId);
  const queueController = new AbortController();
  activeSecondaryMediaQueueControllers.set(libraryId, queueController);
  let resumeNormalAfterUrgentDrain = false;
  const clearUrgentSecondaryAdmission = (): void => {
    urgentSecondaryMediaQueues.delete(libraryId);
    urgentSecondaryMediaAssetIds.delete(libraryId);
  };
  const finish = () => {
    if (activeSecondaryMediaQueueControllers.get(libraryId) === queueController) {
      activeSecondaryMediaQueueControllers.delete(libraryId);
      activeSecondaryMediaQueues.delete(libraryId);
      const shouldReschedule = rescheduledSecondaryMediaQueues.has(libraryId);
      const shouldKeepOpen = automaticMediaAdmissionAllowed(libraryId);
      const shouldResumeNormal = resumeNormalAfterUrgentDrain && shouldKeepOpen;
      // A viewer fallback may arrive while the previous secondary pump is
      // cooperatively aborting for an interactive request. Keep that urgent
      // admission alive across the old pump's final cleanup; otherwise the
      // viewer waits for a proxy that no queue will ever claim.
      if ((urgentSecondaryMediaQueues.has(libraryId) || shouldReschedule) && shouldKeepOpen) {
        const urgent = urgentSecondaryMediaQueues.has(libraryId);
        rescheduledSecondaryMediaQueues.delete(libraryId);
        setTimeout(() => scheduleSecondaryMediaQueue(
          libraryId,
          urgent ? { urgent: true } : {},
        ), 0);
      } else {
        rescheduledSecondaryMediaQueues.delete(libraryId);
        clearUrgentSecondaryAdmission();
        if (shouldResumeNormal) {
          setTimeout(() => scheduleSecondaryMediaQueue(libraryId), 0);
        }
      }
    }
  };
  const runOne = async (): Promise<void> => {
    if (queueController.signal.aborted) {
      finish();
      return;
    }
    const urgent = urgentSecondaryMediaQueues.has(libraryId);
    if (mediaResourceGuard.isCoolingDown()) {
      scheduleMediaResourceRetry(libraryId);
      // The normal resource retry will re-admit this durable job after the
      // cooldown. Do not keep an urgent marker alive and spin an empty pump
      // while the process-wide guard is deliberately refusing native work.
      if (urgent) {
        clearUrgentSecondaryAdmission();
        resumeNormalAfterUrgentDrain = true;
      }
      finish();
      return;
    }
    const waitMs = urgent
      ? 0
      : (secondaryMediaIdleUntil.get(libraryId) ?? 0) - Date.now();
    if (waitMs > 0) {
      setTimeout(() => void runOne(), waitMs);
      return;
    }
    try {
      const urgentAssetIds = urgentSecondaryMediaAssetIds.get(libraryId);
      let admittedRawMetadata = 0;
      if (!urgent) {
        // A startup scene only admits one bounded RAW batch. Keep admitting
        // the next batch here after the current secondary queue drains so a
        // 50k-camera library eventually reaches every Inspector record.
        admittedRawMetadata = libraryService.enqueueRawImageMetadataBackfill(
          libraryId,
          RAW_METADATA_BACKFILL_BATCH_SIZE,
        );
      }
      const fairnessTurn = (secondaryMediaFairnessTurns.get(libraryId) ?? 0) + 1;
      secondaryMediaFairnessTurns.set(libraryId, fairnessTurn);
      // Palette/proxy jobs can be numerous and have a higher historical
      // priority. Every fourth normal turn explicitly services metadata so
      // RAW Inspector work cannot be starved while keeping the ordinary
      // secondary ordering for the other three turns.
      const preferRawMetadata = !urgent && fairnessTurn % 4 === 0;
      const runSecondaryJobs = (
        jobKinds: typeof SECONDARY_MEDIA_JOB_KINDS | readonly ['extract_metadata'],
      ) =>
        libraryService.processThumbnailQueue(libraryId, {
          maxJobs: 1,
          jobKinds,
          ...(urgentAssetIds && urgentAssetIds.size > 0
            ? { assetIds: [...urgentAssetIds] }
            : {}),
          signal: queueController.signal,
          onDerivedReady: (event) => {
            parentPort?.postMessage({
              type: 'asset.derived.ready',
              libraryId,
              assetId: event.assetId,
              kind: event.kind,
            });
          },
        });
      let processed = await runSecondaryJobs(
        preferRawMetadata ? ['extract_metadata'] : SECONDARY_MEDIA_JOB_KINDS,
      );
      if (processed === 0 && preferRawMetadata && !queueController.signal.aborted) {
        // No metadata was ready for this fairness turn; let palette/proxy
        // work make progress instead of treating the empty lane as drained.
        processed = await runSecondaryJobs(SECONDARY_MEDIA_JOB_KINDS);
      }
      if (mediaResourceGuard.isCoolingDown()) {
        scheduleMediaResourceRetry(libraryId);
        if (urgent) {
          clearUrgentSecondaryAdmission();
          resumeNormalAfterUrgentDrain = true;
        }
        finish();
        return;
      }
      if (processed > 0 && !queueController.signal.aborted) {
        setTimeout(() => void runOne(), 50);
        return;
      }
      if (!urgent && !queueController.signal.aborted) {
        const retryDelay = libraryService.rawImageMetadataRetryDelayMs(libraryId);
        if (retryDelay !== null) scheduleSecondaryMediaRetry(libraryId, retryDelay);
        // `admittedRawMetadata` is intentionally read here: if a new batch
        // was admitted but no job was claimable, keep the pump alive for one
        // more turn so a race with a terminal artifact cannot strand it.
        if (admittedRawMetadata > 0) {
          setTimeout(() => void runOne(), 50);
          return;
        }
      }
      if (urgent) {
        // `assetIds` scopes the claim to the explicit fallback set. A zero
        // result therefore means that set is drained; keeping the urgent bit
        // would reschedule an empty queue forever.
        clearUrgentSecondaryAdmission();
        resumeNormalAfterUrgentDrain = true;
      }
    } catch (error) {
      if (!queueController.signal.aborted) {
        libraryService.reportDiagnostic('secondary-media-schedule.process', error, { libraryId });
        if (urgent) {
          clearUrgentSecondaryAdmission();
          resumeNormalAfterUrgentDrain = true;
        }
      }
    }
    finish();
  };
  setTimeout(() => void runOne(), options.urgent ? 0 : 1_000);
}

type ThumbnailScheduleScene = 'startup' | 'refresh' | 'visible' | 'linked' | 'restore' | 'mutation' | 'cover';

/**
 * Serpent-x9xu redesign: scenes that fire on every browse/search response are
 * "light" — they boost priorities without running the expensive auto-repair /
 * stale-artifact scans, which belong to the explicit refresh wave. Keeps the
 * per-page scheduling cheap enough that appending a page never stalls the
 * Worker behind repair sweeps.
 */
function scheduleThumbnailScene(
  libraryId: string,
  scene: ThumbnailScheduleScene,
  assetIds?: string[],
  maxIdsOverride?: number,
  options: { light?: boolean; preemptVisible?: boolean } = {},
): void {
  const configs: Record<ThumbnailScheduleScene, { limit?: number; priority: number; maxIds?: number; processMaxJobs?: number }> = {
    // Serpent-4bdd26 回归修正：processMaxJobs 1→2。用户报告 Windows 上缩略图
    // 生成巨慢——单任务在飞让 startup 波在慢盘/杀毒环境下串行拖到数十秒。
    // 可见波抢占的主要手段是 interruptThumbnailJobsOutsideViewport（只中断
    // running），双任务在飞的可浪费上限是可接受的。
    startup: { limit: 50, priority: 100, processMaxJobs: 2 },
    refresh: { limit: 50, priority: 150 },
    // Serpent-azf6: the CURRENT VIEW must outrank the import flood — browsing
    // a freshly imported library otherwise waits behind hundreds of priority-300
    // mutation jobs. visible is the highest tier so the user always sees the
    // assets in front of them appear first; the import wave fills in behind.
    // Serpent-x9xu / Serpent-87pd: the visible wave covers the current
    // browse/search window (BROWSE_PAGE_SIZE = 100), not a stale larger
    // page. Unbrowsed assets are never included (callers pass only the
    // returned page ids), so visible slots stay reserved for what the
    // user is actually looking at.
    visible: { limit: THUMBNAIL_VISIBLE_PAGE_SIZE, priority: 350, maxIds: THUMBNAIL_VISIBLE_PAGE_SIZE },
    linked: { limit: 50, priority: 250, maxIds: 50 },
    restore: { priority: 250, maxIds: 500 },
    mutation: { priority: 300, maxIds: 500 },
    // Serpent-d0nv: folder-card covers are direct assets of child folders,
    // outside the current view's visible wave — generate them before the
    // assets below the fold. maxIds defaults to 3 per child folder; the
    // folder.browse-entries handler passes its exact child count × 3.
    cover: { limit: 100, priority: 400, maxIds: 300 },
  };
  const config = configs[scene];
  const maxIds = maxIdsOverride ?? config.maxIds ?? 500;
  try {
    scheduleThumbnailQueue(libraryId, {
      ...(assetIds ? { assetIds: assetIds.slice(0, maxIds) } : {}),
      ...(config.limit === undefined ? {} : { limit: config.limit }),
      priority: config.priority,
      ...(config.processMaxJobs === undefined ? {} : { processMaxJobs: config.processMaxJobs }),
      repairFailed: !options.light,
      // Serpent-5xbg: every browse/refresh wave re-opens retryable failed
      // artifacts (throttled) — generation failures are healed in the
      // background whenever the asset surfaces, no periodic scan needed.
      retryFailed: true,
      ...(options.light ? { skipStaleRepair: true } : {}),
      ...(options.preemptVisible === undefined ? {} : { preemptVisible: options.preemptVisible }),
    });
  } catch {
    // scheduleThumbnailQueue already wrote the complete diagnostic. Automatic
    // media work must never turn a successful import/list/relink into failure.
  }
}

function thumbnailFailureReason(errorCode: string): string {
  switch (errorCode) {
    case 'MEDIA_RESOURCE_EXHAUSTED': return '系统内存压力过高，缩略图任务已延迟重试；请稍后再试。';
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

function destructiveBackupLibraryId(command: WorkerCommand): string | undefined {
  switch (command.type) {
    case 'asset.delete-permanent':
    case 'asset.delete-from-disk':
    case 'asset.delete-linked':
    case 'asset.purge-trash':
    case 'folder.delete-from-disk':
    case 'folder.delete-empty':
    case 'linked-folder.remove':
    case 'linked-folder.delete-subtree':
      return command.libraryId;
    default:
      return undefined;
  }
}

async function handleRequest(request: WorkerRequest): Promise<WorkerResult> {
  const automationResult = dispatchAutomationReadOnlyRequest(libraryService, request);
  if (automationResult) return automationResult;

  const destructiveLibraryId = destructiveBackupLibraryId(request.command);
  if (destructiveLibraryId) {
    // Keep a verified online snapshot immediately before an irreversible
    // command. A failed snapshot is diagnosed by the service, while the
    // operation itself retains its existing typed error/confirmation path.
    await libraryService.createDatabaseBackup(destructiveLibraryId);
  }

  if (request.command.type === 'history.group.begin' || request.command.type === 'history.group.complete') {
    const lease = await libraryService.acquireWriteLease(request.command.libraryId);
    try {
      const historyContext = request.historyContext;
      if (historyContext?.sourceReference === undefined || historyContext.sourceReference === null) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
      if (request.command.type === 'history.group.begin') {
        const result = libraryService.beginOperationHistoryGroup({
          libraryId: request.command.libraryId,
          source: historyContext.source,
          sourceReference: historyContext.sourceReference,
        });
        return { ok: true, type: 'history.group.begun', historyEntryId: result.historyEntryId };
      }
      const result = libraryService.completeOperationHistoryGroup(
        request.command.libraryId,
        request.command.expectedHistoryEntryId,
      );
      return {
        ok: true,
        type: 'history.group.completed',
        historyEntryId: result.historyEntryId,
        status: libraryService.getOperationHistoryStatus(request.command.libraryId),
      };
    } finally {
      lease.release();
    }
  }

  // Mixed desktop trash is a filesystem batch, so it cannot run inside the
  // synchronous SQLite transaction used by bounded metadata writes. It still
  // owns the same durable per-library writer lease for the entire
  // preflight→execute→history-commit window.
  if (request.command.type === 'selection.trash') {
    const lease = await libraryService.acquireWriteLease(request.command.libraryId);
    try {
      const result = await libraryService.trashSelectionAsync({
        libraryId: request.command.libraryId,
        assetIds: request.command.assetIds,
        folderIds: request.command.folderIds,
        source: request.historyContext?.source ?? 'desktop',
        sourceReference: request.historyContext?.sourceReference ?? null,
      });
      return { ok: true, type: 'selection.trashed', ...result };
    } finally {
      try {
        lease.release();
      } catch (error) {
        libraryService.reportDiagnostic('selection.trash.lease-release', error, {
          libraryId: request.command.libraryId,
        });
      }
    }
  }

  const libraryId = boundedWriteLibraryId(request.command);
  if (!libraryId) return handleRequestWithoutWriteLease(request);

  try {
    const result = await libraryService.runBoundedWrite(
      libraryId,
      () => executeBoundedWriteWorkerCommand(libraryService, request.command, request.historyContext),
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

function recordDesktopAssetHistory(
  command: Extract<WorkerCommand,
    { type: 'asset.move' | 'asset.copy' | 'asset.trash' }>,
  result: {
    count: number;
    operationId: string | null;
    outputAssetIdsBySource?: ReadonlyArray<{ sourceAssetId: string; newAssetId: string }>;
  },
  historyContext?: WorkerRequest['historyContext'],
): string | undefined {
  if (result.count <= 0 || !result.operationId) return undefined;
  let kind: string;
  let inverseKind: string;
  let forwardPayload: Record<string, unknown>;
  switch (command.type) {
    case 'asset.move':
      kind = 'managed-asset-move';
      inverseKind = 'managed-asset-move-undo';
      forwardPayload = {
        assetIds: command.assetIds,
        targetFolderId: command.targetFolderId,
        conflictStrategy: command.conflictStrategy,
      };
      break;
    case 'asset.copy':
      kind = 'managed-asset-copy';
      inverseKind = 'managed-asset-copy-undo';
      forwardPayload = {
        assetIds: command.assetIds,
        targetFolderId: command.targetFolderId,
        conflictStrategy: command.conflictStrategy,
        ...(result.outputAssetIdsBySource && result.outputAssetIdsBySource.length > 0
          ? { outputAssetIds: result.outputAssetIdsBySource }
          : {}),
      };
      break;
    case 'asset.trash':
      kind = 'asset-trash';
      inverseKind = 'asset-trash-undo';
      forwardPayload = { assetIds: command.assetIds };
      break;
  }
  return libraryService.recordOperationHistory({
    libraryId: command.libraryId,
    source: historyContext?.source ?? 'desktop',
    sourceReference: historyContext?.sourceReference ?? null,
    commandId: command.type,
    labelKey: `history.${command.type}`,
    labelArgs: { count: result.count },
    affectedCount: result.count,
    affectedEntities: command.assetIds,
    forwardRecipe: { kind, version: 1, payload: forwardPayload },
    inverseRecipe: {
      kind: inverseKind,
      version: 1,
      payload: { operationId: result.operationId },
    },
  }).historyEntryId;
}

function recordPermanentDeleteBarrier(
  input: {
    affectedCount: number;
    affectedEntities?: readonly string[];
    commandId: string;
    labelKey: string;
    libraryId: string;
    reason: string;
    historyContext?: WorkerRequest['historyContext'];
  },
): void {
  if (input.affectedCount <= 0) return;
  libraryService.recordOperationHistoryBarrier({
    libraryId: input.libraryId,
    source: input.historyContext?.source ?? 'desktop',
    sourceReference: input.historyContext?.sourceReference ?? null,
    commandId: input.commandId,
    labelKey: input.labelKey,
    reason: input.reason,
    affectedCount: input.affectedCount,
    affectedEntities: input.affectedEntities,
  });
}

function recordDesktopAssetRenameHistory(
  command: Extract<WorkerCommand, { type: 'asset.rename-file' }>,
  beforeFileName: string,
  historyContext?: WorkerRequest['historyContext'],
): string {
  const usesCompleteFileName = command.newFileName !== undefined;
  const beforeExtension = path.extname(beforeFileName);
  const beforeBaseName = beforeExtension.length > 0
    ? beforeFileName.slice(0, -beforeExtension.length)
    : beforeFileName;
  const forwardPayload = usesCompleteFileName
    ? {
      assetId: command.assetId,
      expectedFileName: beforeFileName,
      newFileName: command.newFileName!,
    }
    : {
      assetId: command.assetId,
      expectedBaseName: beforeBaseName,
      newBaseName: command.newBaseName!,
    };
  const inversePayload = usesCompleteFileName
    ? {
      assetId: command.assetId,
      expectedFileName: command.newFileName!,
      newFileName: beforeFileName,
    }
    : {
      assetId: command.assetId,
      expectedBaseName: command.newBaseName!,
      newBaseName: beforeBaseName,
    };
  return libraryService.recordOperationHistory({
    libraryId: command.libraryId,
    source: historyContext?.source ?? 'desktop',
    sourceReference: historyContext?.sourceReference ?? null,
    commandId: command.type,
    labelKey: 'history.asset.rename',
    labelArgs: { count: 1 },
    affectedCount: 1,
    affectedEntities: [command.assetId],
    forwardRecipe: {
      kind: 'asset-rename',
      version: 1,
      payload: forwardPayload,
    },
    inverseRecipe: {
      kind: 'asset-rename',
      version: 1,
      payload: inversePayload,
    },
  }).historyEntryId;
}

/**
 * Serpent-fatf：构造 WebDAVDriver 前规范化服务器地址（缺协议自动补
 * http://、非法地址抛可读的 INVALID_URL，而不是 new URL 的 TypeError
 * 落到 INTERNAL_ERROR 兜底）。所有 sync 命令入口统一走这里。
 */
function syncWebDAVDriver(input: {
  baseUrl: string;
  username?: string;
  password?: string;
  allowInsecureTls?: boolean;
}): WebDAVDriver {
  const normalized = normalizeWebDAVBaseUrl(input.baseUrl);
  if (!normalized.ok) {
    throw new RemoteStorageError('INVALID_URL', normalized.error);
  }
  return new WebDAVDriver({ ...input, baseUrl: normalized.value });
}

async function handleRequestWithoutWriteLease(request: WorkerRequest): Promise<WorkerResult> {
  switch (request.command.type) {
    case 'library.list':
      return { ok: true, type: 'library.list', libraries: libraryService.listLibraries() };
    case 'sync.probe': {
      // Serpent-xffq：连接级能力探测（不触碰库）。
      const driver = syncWebDAVDriver({
        baseUrl: request.command.baseUrl,
        username: request.command.username,
        password: request.command.password,
        allowInsecureTls: request.command.allowInsecureTls,
      });
      const capabilities = await driver.probe();
      return { ok: true, type: 'sync.probed', capabilities };
    }
    case 'sync.preview': {
      const normalized = normalizeWebDAVBaseUrl(request.command.baseUrl);
      if (!normalized.ok) {
        throw new RemoteStorageError('INVALID_URL', normalized.error);
      }
      const engine = buildSyncEngine(request.command.deviceId);
      const report = await engine.previewSync(request.command.libraryId, {
        id: 'request',
        baseUrl: normalized.value,
        username: request.command.username,
        password: request.command.password,
        allowInsecureTls: request.command.allowInsecureTls,
        directoryName: request.command.directoryName,
      });
      return { ok: true, type: 'sync.previewed', report };
    }
    case 'sync.run': {
      const libraryId = request.command.libraryId;
      const normalized = normalizeWebDAVBaseUrl(request.command.baseUrl);
      if (!normalized.ok) {
        throw new RemoteStorageError('INVALID_URL', normalized.error);
      }
      const engine = buildSyncEngine(request.command.deviceId, (done, total, bytesDone, bytesTotal) => {
        if (parentPort) {
          parentPort.postMessage({
            type: 'sync.progress',
            libraryId,
            phase: 'run',
            filesDone: done,
            filesTotal: total,
            bytesDone,
            bytesTotal,
          });
        }
      });
      const sessionId = libraryService.beginSyncSession(libraryId);
      try {
        const outcome = await engine.syncOnce(libraryId, {
          id: 'request',
          baseUrl: normalized.value,
          username: request.command.username,
          password: request.command.password,
          allowInsecureTls: request.command.allowInsecureTls,
          directoryName: request.command.directoryName,
        });
        libraryService.finishSyncSession(libraryId, sessionId, 'done');
        if (parentPort) {
          parentPort.postMessage({
            type: 'sync.progress',
            libraryId,
            phase: 'complete',
            filesDone: 0,
            filesTotal: 0,
            bytesDone: 0,
            bytesTotal: 0,
          });
        }
        return { ok: true, type: 'sync.completed', report: outcome.report, conflicts: outcome.conflicts };
      } catch (error) {
        libraryService.finishSyncSession(
          libraryId,
          sessionId,
          'failed',
          error instanceof Error ? error.message : String(error),
        );
        if (parentPort) {
          parentPort.postMessage({
            type: 'sync.progress',
            libraryId,
            phase: 'complete',
            filesDone: 0,
            filesTotal: 0,
            bytesDone: 0,
            bytesTotal: 0,
          });
        }
        throw error;
      }
    }
    case 'sync.poll-remote': {
      // 自动同步轮询（Serpent-bfsb 后续）：轻量检测远端 manifest 变化，
      // 不做本地全量 hash，供 Main 定时调度器决定是否触发完整同步。
      // Serpent-140fe2/308675: pollRemoteChange 先打一轮 WebDAV 网络请求、
      // 之后才读本地缓存（需要库已打开）。对未打开的库必须快速跳过——
      // 否则每个轮询周期都用一次网络往返占用单线程 Worker，交互命令
      // （翻页/缩略图路径解析）在其后排队，表现为数秒级浏览卡顿。
      if (!libraryService.isLibraryOpen(request.command.libraryId)) {
        return {
          ok: true,
          type: 'sync.poll-remote.result',
          changed: false,
        };
      }
      const engine = buildSyncEngine(request.command.deviceId);
      const changed = await engine.pollRemoteChange(request.command.libraryId, {
        id: 'request',
        baseUrl: request.command.baseUrl,
        username: request.command.username,
        password: request.command.password,
        allowInsecureTls: request.command.allowInsecureTls,
        directoryName: request.command.directoryName,
      });
      return { ok: true, type: 'sync.poll-remote.result', changed };
    }
    case 'sync.list-remote-libraries': {
      const driver = syncWebDAVDriver({
        baseUrl: request.command.baseUrl,
        username: request.command.username,
        password: request.command.password,
        allowInsecureTls: request.command.allowInsecureTls,
      });
      const entries = await driver.list('', '1');
      const libraries: Array<{ libraryId: string; displayName: string; directoryName: string }> = [];
      for (const entry of entries) {
        // 跳过根目录条目（path 为空）与非目录。
        if (!entry.isDirectory || entry.path === '') continue;
        try {
          const read = await driver.read(`${entry.path}/${SYNC_MANIFEST_FILE}`);
          const manifest = parseManifest(read.body.toString('utf-8'));
          libraries.push({
            libraryId: manifest.libraryId,
            displayName: manifest.displayName,
            directoryName: manifest.directoryName,
          });
        } catch {
          // 无有效 manifest 的目录不是同步库，跳过。
        }
      }
      return { ok: true, type: 'sync.remote-libraries', remoteLibraries: libraries };
    }
    case 'sync.open-remote-library': {
      const driver = syncWebDAVDriver({
        baseUrl: request.command.baseUrl,
        username: request.command.username,
        password: request.command.password,
        allowInsecureTls: request.command.allowInsecureTls,
      });
      const directoryName = sanitizeSyncDirectoryName(
        request.command.directoryName || request.command.displayName,
        request.command.libraryId,
      );
      const manifest = parseManifest(
        (await driver.read(`${directoryName}/${SYNC_MANIFEST_FILE}`)).body.toString('utf-8'),
      );
      const created = libraryService.createLibrary({
        displayName: request.command.displayName || manifest.displayName,
        selectedParentPath: request.command.selectedParentPath,
        libraryId: request.command.libraryId || manifest.libraryId,
      });
      try {
        for (const [syncId, entry] of Object.entries(manifest.entries)) {
          const read = await driver.read(`${directoryName}/${SYNC_ASSETS_DIR}/${entry.path}`);
          libraryService.applySyncContentUpdate(created.libraryId, syncId, entry.path, read.body);
        }
      } catch (error) {
        // 下载失败：关闭已创建的库并向上抛，用户可删除部分库后重试。
        try {
          libraryService.closeLibrary(created.libraryId);
        } catch {
          // 关闭失败不掩盖原始错误。
        }
        throw error;
      }
      libraryService.writeSyncManifestCache(created.libraryId, serializeManifest(manifest));
      return { ok: true, type: 'library.opened', library: created };
    }
    case 'library.change-sequence':
      return {
        ok: true,
        type: 'library.change-sequence',
        libraryId: request.command.libraryId,
        changeSequence: libraryService.getChangeSequence(request.command.libraryId),
      };
    case 'history.status':
      return {
        ok: true,
        type: 'history.status',
        status: libraryService.getOperationHistoryStatus(request.command.libraryId),
      };
    case 'history.group.begin':
    case 'history.group.complete':
      throw new Error('History group control was not dispatched through its write lease.');
    case 'library.create': {
      const library = libraryService.createLibrary(request.command);
      return { ok: true, type: 'library.opened', library };
    }
    case 'library.open': {
      const library = libraryService.openLibrary(request.command.selectedLibraryPath);
      return { ok: true, type: 'library.opened', library };
    }
    case 'library.recovery-report':
      return {
        ok: true,
        type: 'library.recovery-report',
        reportPath: libraryService.getRecoveryReportPath(request.command.libraryId),
      };
    case 'library.inspect-eagle': {
      const inspected = libraryService.inspectEagleLibrary(
        request.command.sourceRootPath,
      );
      return {
        ok: true,
        type: 'library.eagle-inspected',
        displayName: inspected.displayName,
      };
    }
    case 'library.open-eagle': {
      const library = await libraryService.openEagleLibrary(request.command);
      return { ok: true, type: 'library.opened', library };
    }
    case 'library.inspect-billfish': {
      const inspected = libraryService.inspectBillfishLibrary(
        request.command.sourceRootPath,
        request.command.sourceDisplayName,
      );
      return {
        ok: true,
        type: 'library.billfish-inspected',
        displayName: inspected.displayName,
      };
    }
    case 'library.open-billfish': {
      const library = await libraryService.openBillfishLibrary(request.command);
      return { ok: true, type: 'library.opened', library };
    }
    case 'library.close':
      cancelDeferredStartupThumbnailScene(request.command.libraryId);
      cancelAutomaticMediaForLibrary(request.command.libraryId);
      cancelMediaResourceRetry(request.command.libraryId);
      cancelVisibleWindowDimensionProbes(request.command.libraryId);
      lastVisibleWindowKeyByLibrary.delete(request.command.libraryId);
      lastVisibleWindowAssetIdsByLibrary.delete(request.command.libraryId);
      libraryService.cancelJobs(request.command.libraryId);
      publishAiProgress(request.command.libraryId);
      aiJobAbortRegistry.abort(request.command.libraryId);
      await libraryService.closeLibraryAsync(request.command.libraryId);
      return { ok: true, type: 'library.closed', libraryId: request.command.libraryId };
    case 'library.rename': {
      const renamed = libraryService.renameLibrary(request.command);
      return { ok: true, type: 'library.renamed', library: renamed };
    }
    case 'library.delete-from-disk': {
      cancelDeferredStartupThumbnailScene(request.command.libraryId);
      cancelAutomaticMediaForLibrary(request.command.libraryId);
      cancelMediaResourceRetry(request.command.libraryId);
      cancelVisibleWindowDimensionProbes(request.command.libraryId);
      lastVisibleWindowKeyByLibrary.delete(request.command.libraryId);
      lastVisibleWindowAssetIdsByLibrary.delete(request.command.libraryId);
      libraryService.cancelJobs(request.command.libraryId);
      publishAiProgress(request.command.libraryId);
      aiJobAbortRegistry.abort(request.command.libraryId);
      // Keep the last verified snapshot before the irreversible library-root
      // deletion. The delete operation itself remains synchronous for its
      // existing recovery/reopen contract.
      await libraryService.drainLibraryMedia(request.command.libraryId);
      await libraryService.createDatabaseBackup(request.command.libraryId);
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
      const command = request.command;
      const before = libraryService.getManagedFolderHistorySnapshot({
        libraryId: command.libraryId,
        folderIds: [command.folderId],
      });
      const folder = libraryService.renameManagedFolder(command);
      const after = libraryService.getManagedFolderHistorySnapshot({
        libraryId: command.libraryId,
        folderIds: [command.folderId],
      });
      const beforeRoot = before.find((item) => item.folderId === command.folderId);
      const afterRoot = after.find((item) => item.folderId === command.folderId);
      if (!beforeRoot || !afterRoot) throw new LibraryServiceError('LIBRARY_CORRUPT');
      const historyEntryId = libraryService.recordOperationHistory({
        libraryId: command.libraryId,
        source: request.historyContext?.source ?? 'desktop',
        sourceReference: request.historyContext?.sourceReference ?? null,
        commandId: command.type,
        labelKey: 'history.folder.rename',
        labelArgs: { count: 1 },
        affectedCount: 1,
        affectedEntities: [command.folderId],
        forwardRecipe: {
          kind: 'managed-folder-rename',
          version: 1,
          payload: {
            folderId: command.folderId,
            expectedName: beforeRoot.name,
            newName: afterRoot.name,
          },
        },
        inverseRecipe: {
          kind: 'managed-folder-rename',
          version: 1,
          payload: {
            folderId: command.folderId,
            expectedName: afterRoot.name,
            newName: beforeRoot.name,
          },
        },
      }).historyEntryId;
      return { ok: true, type: 'folder.renamed', folder, historyEntryId };
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
      const before = libraryService.getManagedFolderHistorySnapshot({
        libraryId: request.command.libraryId,
        folderIds: request.command.folderIds,
      });
      const result = libraryService.moveManagedFolders(request.command);
      const after = result.folders.length === 0
        ? []
        : libraryService.getManagedFolderHistorySnapshot({
          libraryId: request.command.libraryId,
          folderIds: result.folders.map((folder) => folder.folderId),
        });
      const beforeById = new Map(before.map((item) => [item.folderId, item]));
      const afterById = new Map(after.map((item) => [item.folderId, item]));
      const movedRoots = result.folders
        .map((folder) => ({ before: beforeById.get(folder.folderId), after: afterById.get(folder.folderId) }))
        .filter((item): item is { before: NonNullable<typeof item.before>; after: NonNullable<typeof item.after> } => item.before !== undefined && item.after !== undefined);
      const historyEntryId = movedRoots.length === 0 ? undefined : libraryService.recordOperationHistory({
        libraryId: request.command.libraryId,
        source: request.historyContext?.source ?? 'desktop',
        sourceReference: request.historyContext?.sourceReference ?? null,
        commandId: request.command.type,
        labelKey: 'history.folder.move',
        labelArgs: { count: movedRoots.length },
        affectedCount: movedRoots.length,
        affectedEntities: movedRoots.map((item) => item.after.folderId),
        forwardRecipe: {
          kind: 'managed-folder-move',
          version: 1,
          payload: {
            moves: movedRoots.map((item) => ({
              folderId: item.after.folderId,
              expectedName: item.before.name,
              expectedParentFolderId: item.before.parentFolderId,
              targetParentFolderId: item.after.parentFolderId,
              targetName: item.after.name,
            })),
          },
        },
        inverseRecipe: {
          kind: 'managed-folder-move',
          version: 1,
          payload: {
            moves: movedRoots.map((item) => ({
              folderId: item.before.folderId,
              expectedName: item.after.name,
              expectedParentFolderId: item.after.parentFolderId,
              targetParentFolderId: item.before.parentFolderId,
              targetName: item.before.name,
            })),
          },
        },
      }).historyEntryId;
      return {
        ok: true,
        type: 'folder.moved',
        movedCount: result.movedCount,
        skippedCount: result.skippedCount,
        folders: result.folders,
        ...(historyEntryId ? { historyEntryId } : {}),
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
    case 'folder.browse-entries': {
      const entries = libraryService.listFolderBrowseEntries({
        libraryId: request.command.libraryId,
        parentFolderId: request.command.parentFolderId,
        showIgnored: request.command.showIgnored === true,
      });
      // Serpent-d0nv: folder covers are direct assets of child folders —
      // outside the current view's visible wave (asset.list only schedules
      // the current folder's assets). Schedule the cover candidates at the
      // cover tier (400 > visible 350) so folder cards get covers before the
      // rest of the library's p50 path-alphabetical backfill. maxIds = up to
      // 3 candidates per child folder.
      const coverAssetIds = entries.flatMap((entry) => entry.coverAssetIds);
      if (coverAssetIds.length > 0) {
        scheduleThumbnailScene(
          request.command.libraryId,
          'cover',
          coverAssetIds,
          entries.length * 3,
        );
      }
      return {
        ok: true,
        type: 'folder.browse-entries',
        entries,
      };
    }
    case 'folder.list-trashed': {
      const folders = libraryService.listTrashedFolders(request.command.libraryId);
      return { ok: true, type: 'folder.list-trashed', folders };
    }
    case 'folder.restore-trashed': {
      const result = libraryService.restoreTrashedManagedFolder(request.command);
      const restoredRoot = result.folders[0];
      const historyEntryId = restoredRoot ? libraryService.recordOperationHistory({
        libraryId: request.command.libraryId,
        source: request.historyContext?.source ?? 'desktop',
        sourceReference: request.historyContext?.sourceReference ?? null,
        commandId: request.command.type,
        labelKey: 'history.folder.restore',
        labelArgs: { count: result.restoredFolderCount },
        affectedCount: result.restoredFolderCount,
        affectedEntities: result.folders.map((folder) => folder.folderId),
        forwardRecipe: {
          kind: 'managed-folder-restore',
          version: 1,
          payload: { tombstoneId: request.command.tombstoneId },
        },
        inverseRecipe: {
          kind: 'managed-folder-trash',
          version: 1,
          payload: { folderId: restoredRoot.folderId },
        },
      }).historyEntryId : undefined;
      return { ok: true, type: 'folder.restored-trashed', ...result, ...(historyEntryId ? { historyEntryId } : {}) };
    }
    case 'folder.trash': {
      const result = await libraryService.trashManagedFolderAsync(request.command);
      const historyEntryId = result.rootTombstoneId ? libraryService.recordOperationHistory({
        libraryId: request.command.libraryId,
        source: request.historyContext?.source ?? 'desktop',
        sourceReference: request.historyContext?.sourceReference ?? null,
        commandId: request.command.type,
        labelKey: 'history.folder.trash',
        labelArgs: { count: result.removedFolderCount },
        affectedCount: result.removedFolderCount,
        affectedEntities: [request.command.folderId],
        forwardRecipe: {
          kind: 'managed-folder-trash',
          version: 1,
          payload: { folderId: request.command.folderId },
        },
        inverseRecipe: {
          kind: 'managed-folder-restore',
          version: 1,
          payload: { tombstoneId: result.rootTombstoneId },
        },
      }).historyEntryId : undefined;
      const { rootTombstoneId: internalRootTombstoneId, ...publicResult } = result;
      void internalRootTombstoneId;
      return {
        ok: true,
        type: 'folder.trashed',
        folderId: request.command.folderId,
        ...publicResult,
        ...(historyEntryId ? { historyEntryId } : {}),
      };
    }
    case 'folder.delete-from-disk': {
      const result = await libraryService.deleteManagedFolderFromDiskAsync(request.command);
      recordPermanentDeleteBarrier({
        libraryId: request.command.libraryId,
        commandId: request.command.type,
        labelKey: 'history.folder.delete-from-disk',
        reason: 'managed-folder-permanent-delete',
        affectedCount: result.deletedAssetCount + result.removedFolderCount,
        affectedEntities: [request.command.folderId],
        historyContext: request.historyContext,
      });
      return {
        ok: true,
        type: 'folder.deleted-from-disk',
        folderId: request.command.folderId,
        ...result,
      };
    }
    case 'folder.delete-empty': {
      const before = libraryService.getManagedFolderHistorySnapshot({
        libraryId: request.command.libraryId,
        folderIds: request.command.folderIds,
      });
      const result = libraryService.deleteEmptyManagedFolders(request.command);
      const deletedIds = new Set(result.deletedFolderIds);
      const deletedBefore = before.filter((folder) => deletedIds.has(folder.folderId));
      const historyEntryId = deletedBefore.length === 0
        ? undefined
        : libraryService.recordManagedFolderSnapshotHistory({
          libraryId: request.command.libraryId,
          before: deletedBefore,
          after: [],
          commandId: request.command.type,
          labelKey: 'history.folder.delete-empty',
          affectedCount: deletedBefore.length,
          source: request.historyContext?.source ?? 'desktop',
          sourceReference: request.historyContext?.sourceReference ?? null,
        }).historyEntryId;
      return {
        ok: true,
        type: 'folder.empty-deleted',
        ...result,
        ...(historyEntryId ? { historyEntryId } : {}),
      };
    }
    case 'linked-folder.remove': {
      const result = libraryService.removeLinkedFolder(request.command);
      recordPermanentDeleteBarrier({
        libraryId: request.command.libraryId,
        commandId: request.command.type,
        labelKey: 'history.linked-folder.remove',
        reason: 'linked-folder-index-remove',
        affectedCount: Math.max(1, result.removedAssetCount),
        affectedEntities: [request.command.folderId],
        historyContext: request.historyContext,
      });
      return {
        ok: true,
        type: 'linked-folder.removed',
        folderId: request.command.folderId,
        ...result,
      };
    }
    case 'linked-folder.delete-subtree': {
      const result = await libraryService.deleteLinkedFolderSubtree(request.command);
      recordPermanentDeleteBarrier({
        libraryId: request.command.libraryId,
        commandId: request.command.type,
        labelKey: 'history.linked-folder.delete-subtree',
        reason: request.command.deleteFromDisk
          ? 'linked-folder-source-permanent-delete'
          : 'linked-folder-source-os-trash-and-index-remove',
        affectedCount: Math.max(1, result.deletedAssetCount),
        affectedEntities: [request.command.linkedFolderId],
        historyContext: request.historyContext,
      });
      return {
        ok: true,
        type: 'linked-folder.subtree-deleted',
        linkedFolderId: request.command.linkedFolderId,
        relativePath: request.command.relativePath,
        ...result,
      };
    }
    case 'linked-folder.create-directory': {
      const lease = await libraryService.acquireWriteLease(request.command.libraryId);
      try {
        const folder = libraryService.createLinkedFolderDirectory(request.command);
        return { ok: true, type: 'linked-folder.directory-created', folder };
      } finally {
        lease.release();
      }
    }
    case 'linked-folder.rename-directory': {
      const lease = await libraryService.acquireWriteLease(request.command.libraryId);
      try {
        const folder = libraryService.renameLinkedFolderDirectory(request.command);
        return { ok: true, type: 'linked-folder.directory-renamed', folder };
      } finally {
        lease.release();
      }
    }
    case 'asset.list':
      {
        const assets = libraryService.listAssets(request.command);
        // Serpent-4bdd26 收编 codex/large-library-performance@d5f58088：渲染端
        // 布局完成后会上报真实视口。在这里先开一页规模的解码波会与该上报竞争，
        // 让首个可见窗口反而等待折叠线以下的任务；visible-window 处理器是
        // 浏览优先级的唯一来源。startup/import/mutation 场景仍为非渲染端调用方
        // 填充队列。
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
      const command = request.command;
      const prepared = await withMediaSchedulingSuspended(request.command.libraryId, () =>
        libraryService.prepareOrExecuteImport(command));
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
    case 'asset.import-eagle': {
      const command = request.command;
      // Eagle entries bring their own still thumbnail. Do not enqueue a
      // whole-library video proxy wave here; visible-window/on-demand media
      // requests remain the only paths that may encode a source later.
      const result = await withMediaSchedulingSuspended(command.libraryId, () =>
        libraryService.importEagleLibrary(command));
      return { ok: true, type: 'asset.import-eagle.completed', result };
    }
    case 'asset.import-billfish': {
      const command = request.command;
      const result = await withMediaSchedulingSuspended(command.libraryId, () =>
        libraryService.importBillfishLibrary(command));
      return { ok: true, type: 'asset.import-billfish.completed', result };
    }
    case 'asset.import.resolve': {
      const command = request.command;
      const completion = await withMediaSchedulingSuspended(undefined, () =>
        libraryService.resolveImport(command));
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
      const refresh = libraryService.refreshManagedAssets(request.command.libraryId, {
        includeAssets: true,
      });
      scheduleThumbnailScene(request.command.libraryId, 'refresh');
      return {
        ok: true,
        type: 'asset.refreshed',
        changedCount: refresh.changedCount,
        missingCount: refresh.missingCount,
        assets: refresh.assets ?? [],
      };
    }
    case 'asset.import-linked': {
      const command = request.command;
      const linkedFolder = await withMediaSchedulingSuspended(command.libraryId, () =>
        libraryService.importFolderAsLinked(command));
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
      // Serpent-4bdd26 收编 codex/large-library-performance@d5f58088：同
      // asset.list——视口上报（asset.thumbnail.visible-window）才是可见波的唯一触发源。
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
    case 'asset.metadata.set-many':
      throw new Error('Bounded asset.metadata.set-many write was not dispatched through its transaction fence.');
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
      // Search is synchronous inside LibraryService. Yield once before
      // entering SQLite so a burst of keystrokes can mark this request stale
      // and discard it while it is still queued in the Worker event loop.
      // The first browse after open is the exception: App posts it before
      // sidebar/count hydration, and yielding here would let that burst enter
      // SQLite ahead of the primary page. Later searches keep the coalescing
      // yield so stale keystrokes are discarded before a synchronous query.
      if (startupBurstGates.isBrowseServed(request.command.libraryId)) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      const laneKey = searchRequestLaneKey(request.command);
      if (!latestAssetSearchRequests.isLatest(request.command.libraryId, laneKey, request.requestId)) {
        return {
          ok: true,
          type: 'asset.search.result',
          items: [],
          total: 0,
          offset: request.command.scopeMode ? 0 : (request.command.offset ?? 0),
        };
      }
      const result = libraryService.searchAssets({
        libraryId: request.command.libraryId,
        query: request.command.query,
        filters: request.command.filters ?? null,
        scope: request.command.scope ?? null,
        sort: request.command.sort ?? null,
        scopeMode: request.command.scopeMode ?? false,
        idsOnly: request.command.idsOnly ?? false,
        layoutOnly: request.command.layoutOnly ?? false,
        showIgnored: request.command.showIgnored === true,
        limit: request.command.scopeMode ? null : (request.command.limit ?? 50),
        offset: request.command.scopeMode ? 0 : (request.command.offset ?? 0),
      });
      return {
        ok: true,
        type: 'asset.search.result',
        items: result.items,
        total: result.total,
        offset: result.offset,
        snippets: result.snippets,
        ...(result.assetIds ? { assetIds: result.assetIds } : {}),
        ...(result.layout ? { layout: result.layout } : {}),
      };
    }
    case 'browse.session.open': {
      const result = libraryService.createBrowseSession({
        libraryId: request.command.libraryId,
        libraryGeneration: libraryGenerationRegistry.current(request.command.libraryId) ?? 0,
        query: request.command.query,
        filters: request.command.filters ?? null,
        scope: request.command.scope ?? null,
        sort: request.command.sort ?? null,
        smartCollectionId: request.command.smartCollectionId ?? null,
        limit: request.command.limit ?? 100,
        showIgnored: request.command.showIgnored === true,
      });
      return {
        ok: true,
        type: 'browse.session.opened',
        sessionId: result.session.sessionId,
        libraryGeneration: result.session.libraryGeneration,
        changeSequence: result.session.changeSequence,
        queryFingerprint: result.session.queryFingerprint,
        items: result.items,
        total: result.total,
        offset: result.offset,
        ...(result.snippets ? { snippets: result.snippets } : {}),
      };
    }
    case 'browse.session.page': {
      const result = libraryService.readBrowseSessionPage({
        libraryId: request.command.libraryId,
        libraryGeneration: libraryGenerationRegistry.current(request.command.libraryId) ?? 0,
        sessionId: request.command.sessionId,
        limit: request.command.limit ?? 100,
        offset: request.command.offset ?? 0,
      });
      if (result.status !== 'ready') {
        return {
          ok: true,
          type: 'browse.session.stale',
          sessionId: request.command.sessionId,
          reason: result.status === 'missing' ? 'missing' : result.reason,
        };
      }
      return {
        ok: true,
        type: 'browse.session.page',
        sessionId: result.session.sessionId,
        changeSequence: result.session.changeSequence,
        items: result.items,
        total: result.total,
        offset: result.offset,
        ...(result.snippets ? { snippets: result.snippets } : {}),
      };
    }
    case 'browse.session.geometry': {
      const result = libraryService.readBrowseSessionGeometry({
        libraryId: request.command.libraryId,
        libraryGeneration: libraryGenerationRegistry.current(request.command.libraryId) ?? 0,
        sessionId: request.command.sessionId,
        startIndex: request.command.startIndex,
        limit: request.command.limit ?? 128,
      });
      if (result.status !== 'ready') {
        return {
          ok: true,
          type: 'browse.session.stale',
          sessionId: request.command.sessionId,
          reason: result.status === 'missing' ? 'missing' : result.reason,
        };
      }
      return {
        ok: true,
        type: 'browse.session.geometry',
        libraryId: request.command.libraryId,
        sessionId: result.session.sessionId,
        startIndex: result.startIndex,
        changeSequence: result.session.changeSequence,
        entries: result.entries,
      };
    }
    case 'browse.session.ids': {
      const result = libraryService.readBrowseSessionAssetIds({
        libraryId: request.command.libraryId,
        libraryGeneration: libraryGenerationRegistry.current(request.command.libraryId) ?? 0,
        sessionId: request.command.sessionId,
      });
      if (result.status !== 'ready') {
        return {
          ok: true,
          type: 'browse.session.stale',
          sessionId: request.command.sessionId,
          reason: result.status === 'missing' ? 'missing' : result.reason,
        };
      }
      return {
        ok: true,
        type: 'browse.session.ids',
        libraryId: request.command.libraryId,
        sessionId: result.session.sessionId,
        changeSequence: result.session.changeSequence,
        assetIds: result.assetIds,
      };
    }
    case 'browse.session.close':
      libraryService.closeBrowseSession(request.command);
      return {
        ok: true,
        type: 'browse.session.closed',
        sessionId: request.command.sessionId,
      };
    case 'library.navigation-summary':
      return {
        ok: true,
        type: 'library.navigation-summary',
        summary: await libraryService.getLibraryNavigationSummaryAsync({
          libraryId: request.command.libraryId,
          showIgnored: request.command.showIgnored === true,
          includeTrashedFolders: request.command.includeTrashedFolders === true,
        }),
      };
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
      return {
        ok: true,
        type: 'smart-collection.executed',
        items: result.items,
        total: result.total,
        offset: result.offset,
        ...(result.assetIds ? { assetIds: result.assetIds } : {}),
        ...(result.layout ? { layout: result.layout } : {}),
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
      const historyEntryId = recordDesktopAssetHistory(request.command, {
        count: trashedCount,
        operationId,
      }, request.historyContext);
      return {
        ok: true,
        type: 'asset.trashed',
        trashedCount,
        operationId,
        ...(historyEntryId ? { historyEntryId } : {}),
      };
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
      const historyEntryId = restoredCount > 0 ? libraryService.recordOperationHistory({
        libraryId: request.command.libraryId,
        source: request.historyContext?.source ?? 'desktop',
        sourceReference: request.historyContext?.sourceReference ?? null,
        commandId: request.command.type,
        labelKey: 'history.asset.restore',
        labelArgs: { count: restoredCount },
        affectedCount: restoredCount,
        affectedEntities: assets.map((asset) => asset.assetId),
        forwardRecipe: {
          kind: 'asset-restore',
          version: 1,
          payload: {
            assetIds: assets.map((asset) => asset.assetId),
            targetFolderId: request.command.targetFolderId ?? undefined,
            conflictStrategy: request.command.conflictStrategy,
          },
        },
        inverseRecipe: {
          kind: 'asset-trash',
          version: 1,
          payload: { assetIds: assets.map((asset) => asset.assetId) },
        },
      }).historyEntryId : undefined;
      scheduleThumbnailScene(request.command.libraryId, 'restore', assets.map((asset) => asset.assetId));
      return { ok: true, type: 'asset.restored', restoredCount, assets, ...(historyEntryId ? { historyEntryId } : {}) };
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
      const historyEntryId = recordDesktopAssetHistory(request.command, {
        count: movedCount,
        operationId,
      }, request.historyContext);
      scheduleThumbnailScene(request.command.libraryId, 'visible', assets.map((asset) => asset.assetId));
      return {
        ok: true,
        type: 'asset.moved',
        movedCount,
        skippedCount,
        operationId,
        assets,
        ...(historyEntryId ? { historyEntryId } : {}),
      };
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
      const { copiedCount, skippedCount, operationId, assets, outputAssetIdsBySource } = libraryService.copyAssets(request.command);
      const historyEntryId = recordDesktopAssetHistory(request.command, {
        count: copiedCount,
        operationId,
        outputAssetIdsBySource,
      }, request.historyContext);
      scheduleThumbnailScene(request.command.libraryId, 'visible', assets.map((asset) => asset.assetId));
      return {
        ok: true,
        type: 'asset.copied',
        copiedCount,
        skippedCount,
        operationId,
        assets,
        ...(historyEntryId ? { historyEntryId } : {}),
      };
    }
    case 'asset.copy-undo': {
      const { undoneCount, skippedCount, assets } = libraryService.undoCopyAssets(request.command);
      scheduleThumbnailScene(request.command.libraryId, 'visible', assets.map((asset) => asset.assetId));
      return { ok: true, type: 'asset.copy-undone', undoneCount, skippedCount, assets };
    }
    case 'asset.rename-file': {
      if (request.command.automationPlan) {
        if (request.command.newBaseName === undefined) {
          throw new LibraryServiceError('INVALID_IMPORT_DECISION');
        }
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
      const beforeFileName = libraryService.getAssetFileName(request.command);
      const { asset } = libraryService.renameAssetFile(request.command);
      const requestedFileName = request.command.newFileName
        ?? `${request.command.newBaseName}${path.extname(beforeFileName)}`;
      const historyEntryId = beforeFileName === requestedFileName
        ? undefined
        : recordDesktopAssetRenameHistory(request.command, beforeFileName, request.historyContext);
      if (request.command.newFileName !== undefined
        && path.extname(beforeFileName).toLowerCase() !== path.extname(request.command.newFileName).toLowerCase()) {
        scheduleThumbnailScene(request.command.libraryId, 'mutation', [request.command.assetId]);
      }
      return { ok: true, type: 'asset.file-renamed', asset, ...(historyEntryId ? { historyEntryId } : {}) };
    }
    case 'asset.rename-files': {
      const command = request.command;
      if (command.automationPlan) {
        libraryService.validateAutomationFileOperationPlan({
          libraryId: command.libraryId,
          operation: 'rename-files',
          assetIds: command.items.map((item) => item.assetId),
          renameItems: command.items,
          planHash: command.automationPlan.planHash,
          expectedChangeSequence: command.automationPlan.expectedChangeSequence,
          assetStates: command.automationPlan.assetStates,
        });
      }
      const before = new Map(command.items.map((item) => [item.assetId, libraryService.getAssetFileBaseName({ libraryId: command.libraryId, assetId: item.assetId })]));
      const result = libraryService.renameAssetFiles(command);
      const successful = command.items.filter((item) => result.assets.some((asset) => asset.assetId === item.assetId));
      let historyEntryId: string | undefined;
      if (successful.length > 0) {
        historyEntryId = libraryService.recordOperationHistory({
          libraryId: command.libraryId,
          source: request.historyContext?.source ?? 'desktop',
          sourceReference: request.historyContext?.sourceReference ?? null,
          commandId: command.type,
          labelKey: 'history.asset.rename-many',
          labelArgs: { count: successful.length },
          affectedCount: successful.length,
          affectedEntities: successful.map((item) => item.assetId),
          forwardRecipe: {
            kind: 'asset-rename',
            version: 1,
            payload: {
              items: successful.map((item) => ({
                assetId: item.assetId,
                expectedBaseName: before.get(item.assetId),
                newBaseName: item.newBaseName,
              })),
            },
          },
          inverseRecipe: {
            kind: 'asset-rename',
            version: 1,
            payload: {
              items: successful.map((item) => ({
                assetId: item.assetId,
                expectedBaseName: item.newBaseName,
                newBaseName: before.get(item.assetId),
              })),
            },
          },
        }).historyEntryId;
      }
      return { ok: true, type: 'asset.files-renamed', ...result, ...(historyEntryId ? { historyEntryId } : {}) };
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
      recordPermanentDeleteBarrier({
        libraryId: request.command.libraryId,
        commandId: request.command.type,
        labelKey: 'history.asset.delete-permanent',
        reason: 'trash-asset-permanent-delete',
        affectedCount: deletedCount,
        affectedEntities: request.command.assetIds,
        historyContext: request.historyContext,
      });
      return { ok: true, type: 'asset.deleted-permanent', deletedCount, skippedCount, skippedReasons };
    }
    case 'asset.delete-from-disk': {
      const { deletedCount } = await libraryService.deleteAssetsFromDiskAsync(request.command);
      recordPermanentDeleteBarrier({
        libraryId: request.command.libraryId,
        commandId: request.command.type,
        labelKey: 'history.asset.delete-from-disk',
        reason: 'managed-asset-permanent-delete',
        affectedCount: deletedCount,
        affectedEntities: request.command.assetIds,
        historyContext: request.historyContext,
      });
      return { ok: true, type: 'asset.deleted-from-disk', deletedCount };
    }
    case 'asset.delete-linked': {
      const { deletedCount, failedCount, failures } = await libraryService.deleteLinkedAssets(request.command);
      recordPermanentDeleteBarrier({
        libraryId: request.command.libraryId,
        commandId: request.command.type,
        labelKey: 'history.asset.delete-linked',
        reason: request.command.deleteSourceFile
          ? 'linked-asset-source-os-trash-and-index-remove'
          : 'linked-asset-index-remove',
        affectedCount: deletedCount,
        affectedEntities: request.command.assetIds,
        historyContext: request.historyContext,
      });
      return { ok: true, type: 'asset.deleted-linked', deletedCount, failedCount, failures };
    }
    case 'asset.list-trash': {
      const assets = libraryService.listTrash(request.command.libraryId);
      return { ok: true, type: 'asset.list-trash', assets };
    }
    case 'asset.purge-trash': {
      const { purgedCount, skippedCount, failures } = libraryService.emptyTrash(request.command.libraryId);
      recordPermanentDeleteBarrier({
        libraryId: request.command.libraryId,
        commandId: request.command.type,
        labelKey: 'history.asset.purge-trash',
        reason: 'trash-purge',
        affectedCount: purgedCount,
        historyContext: request.historyContext,
      });
      return { ok: true, type: 'asset.purge-trash', purgedCount, skippedCount, failures };
    }
    case 'asset.relink': {
      const { asset, batchFollowUpRoot } = libraryService.relinkAsset(request.command);
      scheduleThumbnailScene(request.command.libraryId, 'mutation', [asset.assetId]);
      return { ok: true, type: 'asset.relinked', asset, batchFollowUpRoot };
    }
    case 'asset.recovery-probe':
      return {
        ok: true,
        type: 'asset.recovery-probe',
        assetId: request.command.assetId,
        probe: libraryService.probeMissingAssetRecovery(request.command),
      };
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
      let contactSheetMime: string | undefined;
      let contactSheetDescription: string | undefined;
      let requestMime: string;

      if (isVideo) {
        // Serpent-140fe2: contact sheets are generated lazily at analysis time
        // (never proactively scheduled), so materialize it for this video now.
        try {
          await libraryService.ensureVideoContactSheet(libraryId, assetId);
        } catch (error) {
          libraryService.reportDiagnostic('ai.contact-sheet.ensure', error, {
            libraryId,
            assetId,
          });
        }
        try {
          const input = await loadVideoAiInput({
            libraryId,
            assetId,
            maxEdgePx: maxAnalysisImageEdgePx,
            service: libraryService,
          });
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
      } else if (isModelFileFormat(filePath)) {
        // Serpent-6w40: 3D models get an AI four-view sheet — render the
        // views offscreen, tile them, then analyze the strip.
        try {
          const sheet = await libraryService.renderModelViewsSheet(
            { libraryId, assetId },
            new AbortController().signal,
          );
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
      if (kind === 'webm_proxy' || kind === 'audio_proxy') {
        // Explicit source-playback fallback must not wait for the normal
        // secondary idle window. A primary poster/import wave may remain
        // active, but the proxy gets its own bounded FFmpeg lane immediately.
        scheduleSecondaryMediaQueue(libraryId, { assetId, urgent: true });
      } else {
        scheduleThumbnailScene(libraryId, 'mutation', [assetId]);
      }
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
    case 'media.get-artifact-paths': {
      const entries = libraryService.getArtifactAbsolutePaths(
        request.command.libraryId,
        request.command.artifactIds,
        request.command.usage,
      );
      return { ok: true, type: 'media.artifact-paths', entries };
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
      const preview = await libraryService.resolvePreviewArtifact(
        request.command.libraryId,
        request.command.assetId,
        request.command.exrPlane,
        request.command.colorSpace,
        request.command.intent,
      );
      // Opening a preview is also an idempotent, high-priority generation hint.
      // Do not enqueue it before resolving the source: enqueueThumbnailJobs is
      // synchronous and can contend with a large-library metadata sweep. The
      // viewer must receive a native image URL (or the current placeholder)
      // first; the light visible wave can start on the next turn without
      // delaying that response. A provided plugin artifact already satisfies
      // the request, so avoid enqueueing a native job that could overwrite it.
      // Serpent-tz35: the viewer wave stays at priority 350 and skips repair
      // scans, but it is deliberately detached from the first-paint request.
      if (!pluginArtifact) {
        const previewLibraryId = request.command.libraryId;
        const previewAssetId = request.command.assetId;
        setTimeout(() => {
          scheduleThumbnailScene(
            previewLibraryId,
            'visible',
            [previewAssetId],
            1,
            { light: true },
          );
        }, 0);
      }
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
    case 'media.get-asset-drag-infos': {
      // Main-only cache primer for native drag. Resolve visible entries before
      // dragstart: webContents.startDrag cannot wait for this Worker round trip.
      // Serpent-v4jf: batched resolution — the legacy per-asset loop cost 3-4
      // point queries per asset (~150k+ queries for a 50k browse result) and
      // stalled the Worker event loop; resolveAssetDragInfos batches in 500-id
      // chunks with identical per-entry semantics (missing skipped, hard
      // failures throw).
      const { libraryId, assetIds } = request.command;
      return {
        ok: true,
        type: 'media.asset-drag-infos',
        entries: libraryService.resolveAssetDragInfos(libraryId, assetIds),
      };
    }
    case 'asset.thumbnail.visible-window': {
      // Serpent-visible-window: the renderer reports what the user is actually
      // looking at after scrolling. Two effects, both cheap:
      // 1) queue-jump — the visible wave (350, light) boosts these assets'
      //    and restricts the next queue claim to them, so the current viewport
      //    finishes first no matter how the queue was filled;
      // 2) placeholder sizing — header-probe dimensions land immediately so
      //    masonry placeholders stop reflowing when thumbnails finish later.
      const { libraryId, assetIds } = request.command;
      startupThumbnailVisibleWindows.add(libraryId);
      // Serpent-4bc4ac: ignored assets are not indexed or operated on —
      // drop them before dimension probes and thumbnail scheduling.
      const visibleAssetIds = libraryService.filterIgnoredAssetIds(
        libraryId,
        assetIds,
      );
      // The renderer order is meaningful for the first visual wave (top to
      // bottom), while the key and overlap calculation are set-like. Keep the
      // stable key sorted without destroying the caller's scheduling order.
      const visibleWindowKey = [...visibleAssetIds].toSorted().join('\u0000');
      if (visibleWindowKey === lastVisibleWindowKeyByLibrary.get(libraryId)) {
        return { ok: true, type: 'asset.thumbnail.visible-window.acknowledged' };
      }
      const preemptVisible = shouldPreemptVisibleWindow(
        lastVisibleWindowAssetIdsByLibrary.get(libraryId),
        visibleAssetIds,
      );
      lastVisibleWindowKeyByLibrary.set(libraryId, visibleWindowKey);
      lastVisibleWindowAssetIdsByLibrary.set(libraryId, visibleAssetIds);
      // A low-overlap destination change can preempt work outside the new
      // viewport. Small geometry changes keep the current decoder wave alive;
      // the scheduler still records the latest ids for its next batch.
      if (preemptVisible) {
        libraryService.interruptThumbnailJobsOutsideViewport(libraryId, visibleAssetIds);
      }
      // Models use Main's single-flight offscreen renderer. Keep that
      // potentially slow/timeout-prone work out of the fast visible raster
      // wave so it cannot occupy one of the two Worker queue slots while the
      // user-visible image/video cards are being filled. Startup and mutation
      // scenes still process model jobs in the background, and an explicit
      // model preview request still uses the normal visible hint.
      const fastVisibleAssetIds = libraryService.filterVisibleThumbnailAssetIds(
        libraryId,
        visibleAssetIds,
      );
      if (fastVisibleAssetIds.length > 0) {
        scheduleThumbnailScene(
          libraryId,
          'visible',
          fastVisibleAssetIds,
          fastVisibleAssetIds.length,
          { light: true, preemptVisible },
        );
      }
      // Header probes used to run synchronously here, before the ACK. On a
      // cold/remote volume that made a scroll report monopolize the Worker
      // behind dozens of open/read/close calls and delayed the next page
      // query. Keep the geometry correction, but drain it asynchronously after
      // this command has returned and let it be cancelled on library close.
      enqueueVisibleWindowDimensionProbes(libraryId, visibleAssetIds);
      return { ok: true, type: 'asset.thumbnail.visible-window.acknowledged' };
    }
    case 'media.resolve-asset-paths': {
      const assetIds = libraryService.resolveAssetIdsByAbsolutePaths(
        request.command.libraryId,
        request.command.sourcePaths,
      );
      return { ok: true, type: 'media.asset-ids-resolved', assetIds };
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
    case 'history.undo':
      {
        const result = await libraryService.undoOperationHistory(request.command);
        return {
          ok: true,
          type: 'history.undone',
          historyEntryId: result.historyEntryId,
          affectedCount: result.affectedCount,
          status: result.status,
        };
      }
    case 'history.redo': {
      const result = await libraryService.redoOperationHistory(request.command);
      return {
        ok: true,
        type: 'history.redone',
        historyEntryId: result.historyEntryId,
        affectedCount: result.affectedCount,
        status: result.status,
        };
      }
    case 'selection.trash':
      throw new Error('Selection trash must be dispatched through its writer lease.');
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

function performanceEnvelopeForRequest(request: WorkerRequest): PerformanceRequestEnvelope {
  if (request.performance) return request.performance;
  const libraryId = 'libraryId' in request.command && typeof request.command.libraryId === 'string'
    ? request.command.libraryId
    : undefined;
  const interactionKey = performanceInteractionKeyForCommand(request.command);
  return {
    lane: performanceLaneForCommand(request.command),
    sentAtEpochMs: request.sentAt ?? Date.now(),
    ...(libraryId === undefined ? {} : { libraryId }),
    ...(interactionKey === undefined ? {} : { interactionKey }),
  };
}

function performanceAssetIdForRequest(request: WorkerRequest): string | undefined {
  return 'assetId' in request.command && typeof request.command.assetId === 'string'
    ? request.command.assetId
    : undefined;
}

function logWorkerRequestSpan(input: {
  request: WorkerRequest;
  performanceEnvelope: PerformanceRequestEnvelope;
  callbackAt: number;
  executeMs: number;
  outcome: 'ok' | 'cancelled' | 'failed';
  reasonCode?: string;
}): void {
  if (!WORKER_CMD_LOG) return;
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    scope: 'performance.span',
    requestId: input.request.requestId,
    ownerId: 'library-worker.request',
    libraryId: input.performanceEnvelope.libraryId,
    assetId: performanceAssetIdForRequest(input.request),
    lane: input.performanceEnvelope.lane,
    stage: 'request',
    queueMs: Math.max(0, input.callbackAt - input.performanceEnvelope.sentAtEpochMs),
    executeMs: Math.max(0, input.executeMs),
    outcome: input.outcome,
    ...(input.reasonCode === undefined ? {} : { reasonCode: input.reasonCode }),
  }));
}

parentPort.on('message', async (event) => {
  const input: unknown = event.data;
  const callbackAt = WORKER_CMD_LOG ? Date.now() : 0;

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
    // Serpent-8ca259: Main's offscreen document capture result.
    const documentResponse = parseDocumentThumbnailRenderResponse(input);
    const pendingDocument = pendingDocumentThumbnailRenders.get(documentResponse.requestId);
    if (pendingDocument) {
      clearTimeout(pendingDocument.timer);
      pendingDocumentThumbnailRenders.delete(documentResponse.requestId);
      pendingDocument.resolve(documentResponse.result);
    }
    return;
  } catch {
    // A normal Worker request or control message; validate it below.
  }

  try {
    const control = parseWorkerControlMessage(input);
    if (control.type === 'worker.shutdown') {
      startupBurstGates.cancelAll('Worker shutdown cancelled startup reconciliation.');
      aiJobAbortRegistry.abortAll();
      aiProgressThrottler.clearAll();
      for (const libraryId of [...deferredMediaResourceRetries.keys()]) {
        cancelMediaResourceRetry(libraryId);
      }
      for (const libraryId of [...visibleDimensionProbeStates.keys()]) {
        cancelVisibleWindowDimensionProbes(libraryId);
      }
      for (const libraryId of new Set([
        ...activeThumbnailQueues,
        ...activeThumbnailQueueControllers.keys(),
        ...activeSecondaryMediaQueues,
        ...activeSecondaryMediaQueueControllers.keys(),
        ...secondaryMediaRetryTimers.keys(),
        ...pendingThumbnailQueueAborts,
      ])) {
        cancelAutomaticMediaForLibrary(libraryId);
      }
      interactiveScheduler.cancelAllQueued();
      closingLibraryIds.clear();
      libraryGenerationRegistry.reset();
      // Kill real encoder children first so a stuck media promise cannot hold
      // shutdown hostage. Abort/close then runs as a bounded second pass, and
      // the final cleanup catches children that raced the first termination.
      await shutdownWorkerResources(
        (timeoutMs) => libraryService.closeAllAsync(timeoutMs),
        shutdownActiveMediaProcesses,
        500,
      );
      parentPort.postMessage({ type: 'worker.shutdown.ack' });
      clearInterval(processLifetime);
      return;
    }
  } catch {
    // A normal request is not a control message; validate it below.
  }

  const requestId = requestIdFrom(input);
  if (!requestId) return;

  // Serpent-onch/9e1d8d: SERPENT_WORKER_CMD_LOG=1 emits one JSON line per
  // command with event-loop wait (message → dispatch) and service time, so
  // browse-latency attribution can see what the single Worker thread was
  // doing while the renderer waited.
  const cmdLogReceivedAt = WORKER_CMD_LOG ? performance.now() : 0;

  let response: WorkerResponse;
  // Serpent-2cc492: track in-flight commands so the open-reconciliation gate
  // can tell "startup burst drained" apart from "gap between burst waves".
  const responseCommandType =
    typeof input === 'object' && input !== null && 'command' in input &&
    typeof input.command === 'object' && input.command !== null && 'type' in input.command
      ? String(input.command.type)
      : '';
  let trackedLibraryId: string | undefined;
  let trackedLibraryGeneration: number | undefined;
  let startupResponseGate: StartupBurstGateToken | undefined;
  try {
    const request = parseWorkerRequest(input);
    const performanceEnvelope = performanceEnvelopeForRequest(request);
    trackedLibraryId = performanceEnvelope.libraryId;
    trackedLibraryGeneration = performanceEnvelope.libraryGeneration
      ?? (trackedLibraryId === undefined
        ? undefined
        : libraryGenerationRegistry.current(trackedLibraryId));
    if (trackedLibraryId !== undefined) {
      startupBurstGates.beginCommand(trackedLibraryId, trackedLibraryGeneration);
    }
    const generationBoundLibraryId = performanceEnvelope.libraryId;
    const generationBoundGeneration = performanceEnvelope.libraryGeneration;
    const generationBound = generationBoundGeneration === undefined
      || generationBoundLibraryId === undefined
      ? undefined
      : () => libraryGenerationRegistry.isCurrent(
        generationBoundLibraryId,
        generationBoundGeneration,
      );

    const scheduledRequest = {
      requestId: request.requestId,
      lane: performanceEnvelope.lane,
      ...(performanceEnvelope.deadlineAtEpochMs === undefined
        ? {}
        : { deadlineAtEpochMs: performanceEnvelope.deadlineAtEpochMs }),
      ...(performanceEnvelope.libraryId === undefined
        ? {}
        : { libraryId: performanceEnvelope.libraryId }),
      ...(performanceEnvelope.libraryGeneration === undefined
        ? {}
        : { libraryGeneration: performanceEnvelope.libraryGeneration }),
      ...(performanceEnvelope.interactionKey === undefined
        ? {}
        : { interactionKey: performanceEnvelope.interactionKey }),
      ...(performanceEnvelope.interactionGeneration === undefined
        ? {}
        : { interactionGeneration: performanceEnvelope.interactionGeneration }),
      ...(generationBound === undefined ? {} : { isCurrent: generationBound }),
    } as const;
    const lifecycleBoundary = request.command.type === 'library.close'
      || request.command.type === 'library.delete-from-disk';
    const lifecycleLibraryId = request.command.type === 'library.close'
      || request.command.type === 'library.delete-from-disk'
      ? request.command.libraryId
      : undefined;
    const onAdmitted = (): void => {
      if (lifecycleBoundary) {
        closingLibraryIds.add(lifecycleLibraryId!);
        startupBurstGates.cancel(
          lifecycleLibraryId!,
          'Library lifecycle boundary superseded startup reconciliation.',
        );
      }
      if (
        isInteractivePerformanceLane(performanceEnvelope.lane)
        && performanceEnvelope.libraryId !== undefined
        && shouldPreemptAutomaticMedia(request.command, performanceEnvelope.lane)
      ) {
        suspendAutomaticMediaForInteractive(performanceEnvelope.libraryId);
      }
      if (
        request.command.type === 'media.get-preview-artifact'
        || request.command.type === 'asset.text.read'
        || request.command.type === 'media.get-source-path'
      ) {
        // Source paths are cheap control lookups; preview resolution is a
        // viewer upgrade and may need to claim a decoder for RAW/OIIO/ICO or a
        // plugin artifact. Both still record activity before the handler.
        noteInteractiveMediaRequest(request.command.libraryId, {
          abortSecondary: request.command.type !== 'media.get-source-path',
        });
        if (request.command.type === 'media.get-preview-artifact') {
          libraryService.interruptThumbnailJobsOutsideViewport(
            request.command.libraryId,
            [request.command.assetId],
          );
        }
      }
      if (request.command.type === 'asset.search') {
        noteInteractiveMediaRequest(request.command.libraryId, { abortSecondary: false });
        latestAssetSearchRequests.mark(
          request.command.libraryId,
          searchRequestLaneKey(request.command),
          request.requestId,
        );
      } else if (request.command.type === 'asset.thumbnail.visible-window') {
        noteInteractiveMediaRequest(request.command.libraryId);
      }
    };
    const runScheduled = async (): Promise<WorkerResult> => {
      const dispatchStartedAt = performance.now();
      let outcome: 'ok' | 'failed' = 'ok';
      let reasonCode: string | undefined;
      try {
        const result = await handleRequest(request);
        if (!result.ok) {
          outcome = 'failed';
          reasonCode = result.error.code;
        }
        libraryGenerationRegistry.observeResult(result);
        if (
          result.ok
          && result.type === 'library.opened'
        ) {
          closingLibraryIds.delete(result.library.libraryId);
          if (result.library.readOnly) return result;
          const generation = libraryGenerationRegistry.current(result.library.libraryId);
          if (generation !== undefined) {
            deferStartupThumbnailScene(result.library.libraryId, generation);
            startupResponseGate = scheduleOpenBackgroundReconciliation(
              result.library.libraryId,
              generation,
            );
          }
        }
        return result;
      } catch (error) {
        outcome = 'failed';
        reasonCode = error instanceof Error ? error.name : 'UNKNOWN_ERROR';
        throw error;
      } finally {
        if (lifecycleBoundary && outcome === 'failed') {
          closingLibraryIds.delete(lifecycleLibraryId!);
        }
        const executeMs = performance.now() - dispatchStartedAt;
        logWorkerRequestSpan({
          request,
          performanceEnvelope,
          callbackAt,
          executeMs,
          outcome,
          ...(reasonCode === undefined ? {} : { reasonCode }),
        });
        if (WORKER_CMD_LOG) {
          console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            scope: 'worker.cmd',
            requestId: request.requestId,
            type: request.command.type,
            lane: performanceEnvelope.lane,
            callbackAt,
            sentAt: performanceEnvelope.sentAtEpochMs,
            queueMs: Math.max(0, callbackAt - performanceEnvelope.sentAtEpochMs),
            schedulerWaitMs: Math.round((dispatchStartedAt - cmdLogReceivedAt) * 100) / 100,
            runMs: Math.round(executeMs * 100) / 100,
            outcome,
            ...(reasonCode === undefined ? {} : { reasonCode }),
          }));
        }
      }
    };
    try {
      response = {
        requestId: request.requestId,
        result: await interactiveScheduler.schedule(scheduledRequest, runScheduled, {
          ...(lifecycleBoundary
            ? { cancelQueuedForLibrary: lifecycleLibraryId! }
            : {}),
          onAdmitted,
        }),
      };
    } catch (error) {
      if (!(error instanceof SchedulerCancelledError)) throw error;
      logWorkerRequestSpan({
        request,
        performanceEnvelope,
        callbackAt,
        executeMs: 0,
        outcome: 'cancelled',
        reasonCode: error.reasonCode,
      });
      response = {
        requestId: request.requestId,
        result: { ok: false, error: createPublicError('CANCELLED') },
      };
    }
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
  // Serpent-2cc492: settle the open-reconciliation startup gate only after the
  // response has actually been posted to Main — "served" must mean delivered.
  if (startupResponseGate !== undefined) {
    startupBurstGates.finishOpenResponse(startupResponseGate);
  }
  if (trackedLibraryId !== undefined) {
    startupBurstGates.finishCommand({
      libraryId: trackedLibraryId,
      ...(trackedLibraryGeneration === undefined
        ? {}
        : { generation: trackedLibraryGeneration }),
      commandType: responseCommandType,
      servedSuccessfully: response.result.ok,
    });
  }
});

// CI 诊断：UtilityProcess fork 后若模块加载失败/被系统杀，main 只见握手
// 超时且无任何输出。ready 前打印 boot 行（经 stdout 转发到 app-log），
// 可区分「worker 未执行」与「执行但握手慢」。
process.stdout.write(
  `${JSON.stringify({ scope: 'worker.boot', message: 'worker module loaded, sending ready.' })}\n`,
);
parentPort.postMessage({ type: 'worker.ready' });
