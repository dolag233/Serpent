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
  type AiProgressEvent,
} from '../shared/protocol/responses';
import { stopOutgoingLibrariesForOpen } from './library-open-stop';
import type { ParentPort } from 'electron';
import {
  BUNDLED_HDRI_PRESET_IDS,
} from '../shared/hdri-presets';
import {
  MODEL_THUMBNAIL_DEFAULT_EDGE,
  modelThumbnailFormatForFileName,
  parseModelThumbnailRenderResponse,
  type ModelThumbnailSourceAuthorization,
  type ModelThumbnailRenderRequest,
  type ModelThumbnailRenderResult,
} from '../shared/model-thumbnail-protocol';
import {
  parseDocumentThumbnailRenderResponse,
  type DocumentThumbnailRenderRequest,
  type DocumentThumbnailRenderResponse,
} from '../shared/document-thumbnail-protocol';
import { isBenignThumbnailErrorCode } from '../shared/thumbnail-support';
import { ThumbnailCompletionFanout } from '../shared/thumbnail-completion-fanout';
import {
  ViewportPriorityOverlay,
  claimIdsForThumbnailWave,
  resolveViewportClaimIds,
} from '../shared/viewport-priority';
import {
  LibraryService,
  LibraryServiceError,
  THUMBNAIL_VISIBLE_PAGE_SIZE,
  hasIdleForegroundImageSlot,
  shutdownActiveMediaProcesses,
  shutdownWorkerResources,
  type ImportFailurePoint,
  type ModelThumbnailRenderOutcome,
  type RawMetadataBackfillAdmissionState,
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
import { applyAiOutputPolicy, type AiAnalysisRequest } from './ai/protocol';
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
import { executeBrowseSessionWorkerCommand } from './handlers/browse-session';
import { executeLibraryIdentityWorkerCommand } from './handlers/library-identity';
import { executeLibraryTransferWorkerCommand } from './handlers/library-transfer';
import { executeExtensionWorkerCommand } from './handlers/extension';
import { executeFolderWorkerCommand } from './handlers/folders';
import { executeLinkedFolderWorkerCommand } from './handlers/linked-folders';
import { executeAssetIngestionWorkerCommand } from './handlers/asset-ingestion';
import { executeIgnoreWorkerCommand } from './handlers/ignore';
import { executeTagWorkerCommand } from './handlers/tags';
import { executeCollectionWorkerCommand } from './handlers/collections';
import { executeAssetMutationWorkerCommand } from './handlers/asset-mutations';
import { executePluginJobWorkerCommand } from './handlers/plugin-jobs';
import { executeMediaPathWorkerCommand } from './handlers/media-paths';
import { executeMediaJobWorkerCommand } from './handlers/media-jobs';
import { executeMediaGenerationWorkerCommand } from './handlers/media-generation';
import { executeVisibleWindowWorkerCommand } from './handlers/visible-window';
import { executeAssetQueryWorkerCommand } from './handlers/asset-query';
import { executeSmartCollectionWorkerCommand } from './handlers/smart-collections';
import { executeLibraryLifecycleWorkerCommand } from './handlers/library-lifecycle';
import { executeSyncWorkerCommand } from './handlers/sync';
import { LibraryGenerationRegistry } from './library-generation';
import {
  isViewportOnlyThumbnailWave,
  shouldRunThumbnailBackgroundRepair,
} from './visible-window-policy';
import {
  StartupBurstGateRegistry,
  type StartupBurstGateToken,
} from './startup-burst-gate';
import { DeferredThumbnailAdmission } from './deferred-thumbnail-admission';
import { RawMetadataBackfillAdmissionGate } from './raw-metadata-backfill-gate';

const parentPort: ParentPort | undefined = process.parentPort;
const aiJobAbortRegistry = new AiJobAbortRegistry();
const aiProcessBatchAbortControllers = new Map<string, AbortController>();
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
  /**
   * Release the outer ai.process-queue admission while doing media/provider
   * work, then reacquire it before the caller continues to its next short
   * claim/commit section. Direct asset.analyze requests leave this undefined.
   */
  runExternal?: <T>(work: () => Promise<T> | T) => Promise<T>;
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
/** Shared with the visible scene config below; cover (400) also owns this lane. */
const THUMBNAIL_VISIBLE_PRIORITY = 350;
/** Primary jobs invalidated by reconciliation, waiting for an idle exact pump. */
const pendingReconciledPrimaryAssetIds = new Map<string, Set<string>>();
type ReconciledPrimaryBatch = {
  assetIds: string[];
  superseded: boolean;
};
/** The one exact batch currently owned by a reconciliation-only pump. */
const activeReconciledPrimaryBatches = new Map<string, ReconciledPrimaryBatch>();
/** Ordinary queue continuations paused while exact reconciliation batches drain. */
const pendingReconciledPrimaryResumes = new Map<string, () => void>();
/** One retry timer per library while viewer activity owns the Worker. */
const pendingReconciledPrimaryIdleRetries = new Map<string, ReturnType<typeof setTimeout>>();
/** Stable viewport sets are idempotent until the library changes. */
const lastVisibleWindowKeyByLibrary = new Map<string, string>();
/** The key alone cannot distinguish geometry churn from real navigation. */
const lastVisibleWindowAssetIdsByLibrary = new Map<string, string[]>();
const thumbnailCompletionFanout = new ThumbnailCompletionFanout({
  publish: (event) => parentPort?.postMessage(event),
});
const viewportPriorityOverlay = new ViewportPriorityOverlay();
const lastViewportVisibleChangeAtMs = new Map<string, number>();
const lastViewportPreemptAtMs = new Map<string, number>();
const deferredStartupThumbnailGenerations = new Map<string, number>();
const pendingStartupThumbnailAdmission = new DeferredThumbnailAdmission();
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
// Serpent: a queue that cannot be admitted is either a short burst or a lane
// deadlock (a mutation needs a fully idle scheduler, an interactive lane needs
// no other interactive owner). Report the holder instead of hanging silently.
const interactiveScheduler = new InteractiveScheduler({
  onStall: (info) => {
    // console.error, not stdout: the worker.cmd diagnostics already land in the
    // app log through this channel, so a stall report stays attributable.
    console.error(JSON.stringify({ timestamp: new Date().toISOString(), scope: 'worker.scheduler.stall', ...info }));
  },
});
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
    thumbnailCompletionFanout.setImmediateAssetIds(event.libraryId, []);
    parentPort.postMessage(event);
  },
  onLibraryChanged: (event) => {
    lastVisibleWindowKeyByLibrary.delete(event.libraryId);
    lastVisibleWindowAssetIdsByLibrary.delete(event.libraryId);
    thumbnailCompletionFanout.setImmediateAssetIds(event.libraryId, []);
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
  cleanup: () => void;
}>();

/**
 * Ask Main to render one model thumbnail in the shared offscreen window.
 * Resolves with the typed result (never rejects except on abort). Local model
 * work has no honest wall-clock deadline; lifecycle disposal and the supplied
 * signal are the cancellation boundaries.
 */
function requestModelThumbnailRender(
  input: Omit<ModelThumbnailRenderRequest, 'type' | 'requestId'> & {
    sourceAuthorizations: readonly ModelThumbnailSourceAuthorization[];
  },
  signal?: AbortSignal,
): Promise<ModelThumbnailRenderResult> {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      pendingModelThumbnailRenders.delete(requestId);
      parentPort?.postMessage({
        type: 'model-thumbnail.render-cancel',
        requestId,
      });
      reject(new DOMException('Model thumbnail render request aborted.', 'AbortError'));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    const cleanup = (): void => signal?.removeEventListener('abort', onAbort);
    signal?.addEventListener('abort', onAbort, { once: true });
    pendingModelThumbnailRenders.set(requestId, { resolve, cleanup });
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
 * concurrent request would only queue there and compete for the same render
 * slot). There is no completion deadline for the local render itself.
 * The acquire waits for the previous render and honors cancellation.
 */
let modelRenderTail: Promise<void> = Promise.resolve();
/**
 * Serpent-8ca259: ask Main to capture an HTML document thumbnail in a fresh
 * offscreen window. Resolves with the typed result (never rejects except on
 * abort). Content size and load time are not converted into an arbitrary
 * failure; lifecycle cancellation remains available.
 */
const pendingDocumentThumbnailRenders = new Map<string, {
  resolve: (result: DocumentThumbnailRenderResponse['result']) => void;
  cleanup: () => void;
}>();

function requestDocumentThumbnailRender(
  input: Omit<DocumentThumbnailRenderRequest, 'type' | 'requestId'>,
  signal?: AbortSignal,
): Promise<DocumentThumbnailRenderResponse['result']> {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      pendingDocumentThumbnailRenders.delete(requestId);
      reject(new DOMException('Document thumbnail render request aborted.', 'AbortError'));
    };
    const cleanup = (): void => signal?.removeEventListener('abort', onAbort);
    signal?.addEventListener('abort', onAbort, { once: true });
    pendingDocumentThumbnailRenders.set(requestId, { resolve, cleanup });
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
  width: number;
  height?: number;
  signal?: AbortSignal;
}): Promise<{ png: Uint8Array; width: number; height: number } | null> {
  try {
    const result = await requestDocumentThumbnailRender(
      {
        url: input.url,
        width: input.width,
        ...(input.height === undefined ? {} : { height: input.height }),
      },
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
  let acquired = false;
  try {
    await waitForAbortable(previous, signal);
    acquired = true;
    if (signal?.aborted) {
      throw new DOMException('Model render cancelled before acquiring the render gate.', 'AbortError');
    }
    return await fn();
  } finally {
    if (acquired) {
      release();
    } else {
      // A queued cancellation must not resolve its tail before the previous
      // owner releases the gate, otherwise a later request can enter while
      // that owner is still rendering. Keep the chain intact and settle this
      // node only after the predecessor (which never rejects) completes.
      void previous.then(release, release);
    }
  }
}

function waitForAbortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(new DOMException('Operation aborted.', 'AbortError'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      cleanup();
      reject(new DOMException('Operation aborted.', 'AbortError'));
    };
    const cleanup = (): void => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
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
      }, input.signal);
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
        enableHdri: false,
        width: MODEL_THUMBNAIL_DEFAULT_EDGE,
        height: MODEL_THUMBNAIL_DEFAULT_EDGE,
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
  options: { resumeScheduling?: boolean } = {},
): Promise<T> {
  mediaResourceGuard.enterExternalHold();
  try {
    return await operation();
  } finally {
    mediaResourceGuard.exitExternalHold();
    // Linked-folder indexing can register tens of thousands of assets. An
    // unbounded resume here would SELECT/INSERT thumbnail jobs for the whole
    // catalog before the mutation returns, so browse stays queued. Callers
    // that need a bounded scene pass resumeScheduling: false and schedule it.
    const shouldResume = options.resumeScheduling !== false
      && !mediaResourceGuard.isCoolingDown();
    if (shouldResume) {
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

function isHighPriorityThumbnailQueue(options: {
  assetIds?: readonly string[];
  priority?: number;
}): boolean {
  return options.assetIds !== undefined
    && options.priority !== undefined
    && options.priority >= THUMBNAIL_VISIBLE_PRIORITY;
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
    /** Resume/retry existing durable jobs before admitting more catalogue work. */
    skipInitialEnqueue?: boolean;
    /** Consume only already-enqueued jobs; skip catalogue repair/backfill tails. */
    skipBackgroundRepair?: boolean;
    /** Keep this bounded primary pump from handing off to secondary media work. */
    suppressSecondaryQueue?: boolean;
    /** Continue a bounded, exact-asset pump after this queue becomes idle. */
    onQueueIdle?: (outcome?: {
      aborted: boolean;
      failed: boolean;
      rescheduled?: boolean;
    }) => void;
  } = {},
): number {
  if (!automaticMediaAdmissionAllowed(libraryId)) return 0;
  let enqueued: number;
  try {
    const { skipInitialEnqueue, ...enqueueOptions } = options;
    enqueued = skipInitialEnqueue
      ? 0
      : libraryService.enqueueThumbnailJobs(libraryId, enqueueOptions);
  } catch (error) {
    libraryService.reportDiagnostic('thumbnail-schedule.enqueue', error, { libraryId });
    throw error;
  }

  if (activeThumbnailQueues.has(libraryId)) {
    const reconciledBatch = activeReconciledPrimaryBatches.get(libraryId);
    if (
      isHighPriorityThumbnailQueue(options)
    ) {
      if (reconciledBatch) reconciledBatch.superseded = true;
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
            options.assetIds?.length ?? 0,
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
        assetScope.current = resolveViewportClaimIds(
          viewportPriorityOverlay.rankedClaimIds(libraryId),
          options.assetIds,
        );
      }
    }
    rescheduledThumbnailQueues.add(libraryId);
    return enqueued;
  }
  activeThumbnailQueues.add(libraryId);

  const runBatch = async (): Promise<void> => {
    let continueImmediately = false;
    let pendingVisibleWaveCompleted = false;
    let queueWasAborted = false;
    let queueFailed = false;
    const pendingVisibleWave = pendingVisibleThumbnailWaves.get(libraryId);
    const queueController = new AbortController();
    const assetScope = activeThumbnailQueueAssetScopes.get(libraryId)
      ?? { current: undefined };
    activeThumbnailQueueControllers.set(libraryId, queueController);
    activeThumbnailQueueAssetScopes.set(libraryId, assetScope);
    if (pendingThumbnailQueueAborts.delete(libraryId)) {
      queueController.abort();
    }
    const resumeOrdinaryQueue = () => {
      try {
        scheduleThumbnailQueue(libraryId, {
          ...options,
          skipInitialEnqueue: true,
        });
      } catch (error) {
        libraryService.reportDiagnostic('thumbnail-schedule.reconciled-resume', error, {
          libraryId,
        });
      }
    };
    // A completed ordinary wave may have scheduled its next timer before the
    // reconciliation callback added exact IDs. Hand the queue off before its
    // next claim boundary, preserving the original options for resumption.
    if (
      options.onQueueIdle === undefined
      && !isHighPriorityThumbnailQueue(options)
      && !pendingVisibleThumbnailWaves.has(libraryId)
      && hasPendingReconciledPrimaryAssetIds(libraryId)
    ) {
      if (activeThumbnailQueueControllers.get(libraryId) === queueController) {
        activeThumbnailQueueControllers.delete(libraryId);
      }
      if (activeThumbnailQueueAssetScopes.get(libraryId) === assetScope) {
        activeThumbnailQueueAssetScopes.delete(libraryId);
      }
      activeThumbnailQueues.delete(libraryId);
      rescheduledThumbnailQueues.delete(libraryId);
      if (drainPendingReconciledPrimaryQueue(libraryId, resumeOrdinaryQueue)) return;
      resumeOrdinaryQueue();
      return;
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
          thumbnailCompletionFanout.publishReady({
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
          thumbnailCompletionFanout.publishFailed({
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
      const waveClaimIds = claimIdsForThumbnailWave({
        viewportOnlyWave,
        rankedOverlayIds: viewportPriorityOverlay.rankedClaimIds(libraryId),
        fallbackIds: assetScope.current ?? visibleAssetIds,
      });
      if (viewportOnlyWave) {
        if (waveClaimIds !== undefined) assetScope.current = waveClaimIds;
      } else if (assetScope.current === undefined) {
        assetScope.current = waveClaimIds;
      }
      const processWaveSize = pendingVisibleWave !== undefined
        ? Math.max(1, Math.min(100, Math.trunc(pendingVisibleWave.waveSize)))
        : options.processMaxJobs !== undefined
          ? Math.max(1, Math.min(100, Math.trunc(options.processMaxJobs)))
          : options.skipStaleRepair && options.assetIds
            ? Math.min(100, Math.max(thumbnailWaveSize, options.assetIds.length))
            : thumbnailWaveSize;
      const processed = await traceActivity(
        `thumbnail-wave:${libraryId}`,
        () => libraryService.processThumbnailQueue(libraryId, {
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
        }),
      );
      pendingVisibleWaveCompleted = true;
      queueWasAborted = queueController.signal.aborted;
      if (mediaResourceGuard.isCoolingDown()) scheduleMediaResourceRetry(libraryId);
      // A visible wave must yield after its bounded claim even when it filled
      // the requested window. Continuing the old closure here would skip the
      // cleanup below and let a background queue turn the next tick into a
      // whole-library fill before the latest visible ids are admitted.
      continueImmediately = !queueWasAborted
        && !viewportOnlyWave
        && processed === processWaveSize
        && !hasPendingReconciledPrimaryAssetIds(libraryId);
      // A visible report can arrive while a startup/maintenance wave is
      // awaiting native work. Do not let that older closure launch its
      // whole-library repair tail before the pending viewport takes over.
      const visibleWavePending = pendingVisibleThumbnailWaves.has(libraryId);
      const mayRunBackgroundRepair = () => !options.skipBackgroundRepair
        && !hasPendingReconciledPrimaryAssetIds(libraryId)
        && shouldRunThumbnailBackgroundRepair({
          viewportOnlyWave,
          queueWasAborted,
          continueImmediately,
          visibleWavePending,
        });
      if (mayRunBackgroundRepair()) {
        const filled = await traceActivity(
          `thumbnail-enqueue:${libraryId}`,
          async () => libraryService.enqueueThumbnailJobs(libraryId, {
            limit: 500,
            priority: 50,
            skipStaleRepair: true,
          }),
        );
        continueImmediately = filled > 0;
      }
      if (mayRunBackgroundRepair()) {
        try {
          const dimensions = await traceActivity(
            `dimension-backfill:${libraryId}`,
            async () => libraryService.backfillMissingImageDimensions(libraryId, 48),
          );
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
      // Reconciliation may have completed while a repair tail was awaiting
      // storage. Yield at this same wave boundary instead of scheduling one
      // more ordinary claim before the exact IDs take ownership.
      if (options.onQueueIdle === undefined
        && hasPendingReconciledPrimaryAssetIds(libraryId)) {
        continueImmediately = false;
      }
    } catch (error) {
      queueFailed = true;
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
    thumbnailCompletionFanout.flush(libraryId);
    const completedVisibleWaveIsCurrent = pendingVisibleWaveCompleted
      && pendingVisibleWave !== undefined
      && pendingVisibleThumbnailWaves.get(libraryId) === pendingVisibleWave
      && !queueController.signal.aborted;
    const queueWasRescheduled = rescheduledThumbnailQueues.delete(libraryId);
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
    if (queueWasRescheduled) {
      if (completedVisibleWaveIsCurrent) {
        if (options.onQueueIdle) {
          options.onQueueIdle({
            aborted: queueWasAborted,
            failed: queueFailed,
            rescheduled: true,
          });
        } else if (drainPendingReconciledPrimaryQueue(libraryId)) {
          return;
        } else if (interactiveThumbnailIdleDelayMs(libraryId) > 0) {
          pendingReconciledPrimaryResumes.set(libraryId, resumeOrdinaryQueue);
          continueReconciledPrimaryWork(libraryId);
          return;
        } else if (resumePendingStartupThumbnailAdmission(libraryId)) {
          return;
        } else if (!options.suppressSecondaryQueue) {
          scheduleSecondaryMediaQueue(libraryId);
        }
        return;
      }
      // An exact reconciliation queue must finalize its in-flight batch before
      // another exact request can replace it. Visible work is the exception:
      // keep the closure alive so the pending visible wave runs first.
      if (options.onQueueIdle && !pendingVisibleThumbnailWaves.has(libraryId)) {
        options.onQueueIdle({
          aborted: queueWasAborted,
          failed: queueFailed,
          rescheduled: true,
        });
        return;
      }
      if (options.onQueueIdle === undefined
        && !pendingVisibleThumbnailWaves.has(libraryId)
        && drainPendingReconciledPrimaryQueue(libraryId, resumeOrdinaryQueue)) {
        return;
      }
      if (options.onQueueIdle === undefined
        && !pendingVisibleThumbnailWaves.has(libraryId)
        && interactiveThumbnailIdleDelayMs(libraryId) > 0) {
        pendingReconciledPrimaryResumes.set(libraryId, resumeOrdinaryQueue);
        continueReconciledPrimaryWork(libraryId);
        return;
      }
      activeThumbnailQueues.add(libraryId);
      setTimeout(() => void runBatch(), 0);
      return;
    }
    if (options.onQueueIdle) {
      options.onQueueIdle({ aborted: queueWasAborted, failed: queueFailed });
      return;
    }
    if (drainPendingReconciledPrimaryQueue(libraryId, resumeOrdinaryQueue)) {
      return;
    }
    if (interactiveThumbnailIdleDelayMs(libraryId) > 0) {
      pendingReconciledPrimaryResumes.set(libraryId, resumeOrdinaryQueue);
      continueReconciledPrimaryWork(libraryId);
      return;
    }
    if (resumePendingStartupThumbnailAdmission(libraryId)) {
      return;
    } else if (!options.suppressSecondaryQueue) {
      scheduleSecondaryMediaQueue(libraryId);
    }
  };

  setTimeout(() => void runBatch(), 0);
  return enqueued;
}

const RECONCILED_PRIMARY_ASSET_BATCH_SIZE = 100;

/**
 * Drain only the primary assets invalidated by this reconciliation pass.
 * Each queue owns one exact, bounded ID batch; completion schedules the next
 * batch, so a large Set never becomes a global catalogue claim or a dropped
 * tail. The queue is deliberately not allowed to hand off to secondary work.
 */
function drainPendingReconciledPrimaryQueue(
  libraryId: string,
  resumeAfterDrain?: () => void,
): boolean {
  if (
    !automaticMediaAdmissionAllowed(libraryId)
    || (
      !startupThumbnailVisibleWindows.has(libraryId)
      && deferredStartupThumbnailGenerations.has(libraryId)
    )
    || activeThumbnailQueues.has(libraryId)
  ) return false;
  const pending = pendingReconciledPrimaryAssetIds.get(libraryId);
  if (!pending || pending.size === 0) {
    pendingReconciledPrimaryAssetIds.delete(libraryId);
    return false;
  }
  if (resumeAfterDrain) {
    pendingReconciledPrimaryResumes.set(libraryId, resumeAfterDrain);
  }
  if (interactiveThumbnailIdleDelayMs(libraryId) > 0) {
    continueReconciledPrimaryWork(libraryId);
    return true;
  }
  const batch = [...pending].slice(0, RECONCILED_PRIMARY_ASSET_BATCH_SIZE);
  const batchState: ReconciledPrimaryBatch = { assetIds: batch, superseded: false };
  try {
    scheduleThumbnailQueue(libraryId, {
      assetIds: batch,
      limit: batch.length,
      processMaxJobs: batch.length,
      skipStaleRepair: true,
      skipInitialEnqueue: true,
      skipBackgroundRepair: true,
      suppressSecondaryQueue: true,
      onQueueIdle: (outcome) => {
        if (activeReconciledPrimaryBatches.get(libraryId) === batchState) {
          activeReconciledPrimaryBatches.delete(libraryId);
          if (outcome?.rescheduled && !pendingReconciledPrimaryResumes.has(libraryId)) {
            pendingReconciledPrimaryResumes.set(
              libraryId,
              () => scheduleQueuedThumbnailWork(libraryId),
            );
          }
          if (outcome?.aborted || outcome?.failed || batchState.superseded) {
            rememberReconciledPrimaryAssetIds(libraryId, batchState.assetIds);
          }
        }
        continueReconciledPrimaryWork(libraryId);
      },
    });
    // scheduleThumbnailQueue is synchronous up to its timer registration. Set
    // the owner before the next turn can run so a visible supersession can
    // replay this exact batch, and only then acknowledge the IDs as owned.
    activeReconciledPrimaryBatches.set(libraryId, batchState);
    for (const assetId of batch) pending.delete(assetId);
    if (pending.size === 0) pendingReconciledPrimaryAssetIds.delete(libraryId);
  } catch (error) {
    if (resumeAfterDrain && pendingReconciledPrimaryResumes.get(libraryId) === resumeAfterDrain) {
      pendingReconciledPrimaryResumes.delete(libraryId);
    }
    libraryService.reportDiagnostic('thumbnail-schedule.reconciled-missing-artifacts', error, {
      libraryId,
    });
    return false;
  }
  return true;
}

function hasPendingReconciledPrimaryAssetIds(libraryId: string): boolean {
  return (pendingReconciledPrimaryAssetIds.get(libraryId)?.size ?? 0) > 0;
}

function scheduleQueuedThumbnailWork(libraryId: string): void {
  try {
    scheduleThumbnailQueue(libraryId, {
      skipInitialEnqueue: true,
      skipBackgroundRepair: true,
    });
  } catch (error) {
    libraryService.reportDiagnostic('thumbnail-schedule.reconciled-resume', error, {
      libraryId,
    });
  }
}

function interactiveThumbnailIdleDelayMs(libraryId: string): number {
  return Math.max(0, (secondaryMediaIdleUntil.get(libraryId) ?? 0) - Date.now());
}

function continueReconciledPrimaryWork(libraryId: string): void {
  const delayMs = interactiveThumbnailIdleDelayMs(libraryId);
  if (delayMs > 0) {
    if (pendingReconciledPrimaryIdleRetries.has(libraryId)) return;
    const timer = setTimeout(() => {
      pendingReconciledPrimaryIdleRetries.delete(libraryId);
      if (!automaticMediaAdmissionAllowed(libraryId)) return;
      continueReconciledPrimaryWork(libraryId);
    }, delayMs);
    timer.unref?.();
    pendingReconciledPrimaryIdleRetries.set(libraryId, timer);
    return;
  }
  if (drainPendingReconciledPrimaryQueue(libraryId)) return;
  const resume = pendingReconciledPrimaryResumes.get(libraryId);
  if (resume) {
    pendingReconciledPrimaryResumes.delete(libraryId);
    setTimeout(resume, 0);
    return;
  }
  resumePendingStartupThumbnailAdmission(libraryId);
}

function cancelReconciledPrimaryIdleRetry(libraryId: string): void {
  const timer = pendingReconciledPrimaryIdleRetries.get(libraryId);
  if (timer !== undefined) clearTimeout(timer);
  pendingReconciledPrimaryIdleRetries.delete(libraryId);
}

function rememberReconciledPrimaryAssetIds(libraryId: string, assetIds: readonly string[]): void {
  if (assetIds.length === 0) return;
  const pending = pendingReconciledPrimaryAssetIds.get(libraryId) ?? new Set<string>();
  for (const assetId of assetIds) pending.add(assetId);
  pendingReconciledPrimaryAssetIds.set(libraryId, pending);
}

function scheduleReconciledMissingPrimaryQueue(
  libraryId: string,
  assetIds: readonly string[],
): void {
  rememberReconciledPrimaryAssetIds(libraryId, assetIds);
  drainPendingReconciledPrimaryQueue(libraryId);
}

// Serpent-onch/9e1d8d: per-command timing log, off by default.
const WORKER_CMD_LOG = process.env.SERPENT_WORKER_CMD_LOG === '1';

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
// Serpent-288cd9: RAW metadata 回填的「扫完即停」游标。置 0 即回到「只按 2 秒节流重扫」
// 的旧行为，用于同树 A/B 归因（生产不设即启用）。
const RAW_METADATA_EXHAUSTION_ENABLED = process.env.SERPENT_RAW_METADATA_EXHAUSTION !== '0';

/**
 * Commands the user is actively waiting on across a library transition. They
 * take the whole queue's priority so a switch cannot be starved by the
 * outgoing library's visible-window/media backlog (see LIFECYCLE_PRIORITY).
 */
function isLibraryTransitionCommand(commandType: string): boolean {
  return commandType === 'library.open'
    || commandType === 'library.open-eagle'
    || commandType === 'library.open-billfish'
    || commandType === 'library.create'
    || commandType === 'library.close'
    || commandType === 'library.delete-from-disk';
}

// 事件循环滞后监控（SERPENT_LAG_LOG=1）：被同步工作堵住的 Worker 会推迟接收
// 消息，此时 `queueMs` 与 `runMs` 都无法区分「在干活」和「根本没被调度」。
// 每秒测量计时器漂移，只在真正卡顿时输出，并带上当时正在运行的活动名。
let currentWorkerActivity = 'idle';

/** Run `work` while naming it as the Worker's current activity for lag reports. */
async function traceActivity<T>(label: string, work: () => Promise<T>): Promise<T> {
  const previous = currentWorkerActivity;
  currentWorkerActivity = label;
  try {
    return await work();
  } finally {
    currentWorkerActivity = previous;
  }
}

if (process.env.SERPENT_LAG_LOG === '1') {
  let lagWindowStart = Date.now();
  const lagTimer = setInterval(() => {
    const now = Date.now();
    const driftMs = now - lagWindowStart - 1_000;
    lagWindowStart = now;
    if (driftMs >= 200) {
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        scope: 'worker.eventLoop.lag',
        driftMs,
        activity: currentWorkerActivity,
      }));
    }
  }, 1_000);
  lagTimer.unref?.();
}

// Serpent-2cc492（真实 NAS 生产库事故，2026-08-23）：开库后台对账若与渲染端
// startup 请求风暴同时运行，SMB 上 21,508 条目的 artifact 枚举实测 ~16.5s，
// 加上各同步 SQL 步骤，startup 突发曾经撞上主进程的固定请求 deadline，late
// 响应被丢弃（一次 E2E 记录到 462 条）——画布永远等不到第一页数据。因此
// 对账必须等首个浏览查询真正服务完毕、且在飞命令清零后才启动；
// StartupBurstGateRegistry 还按 libraryId + generation 隔离状态，避免多个打开库
// 互相释放或取消启动门。
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
      () => traceActivity(
        `open-reconciliation:${libraryId}`,
        async () => {
          const missingPrimaryArtifactIds = new Set<string>();
          await libraryService.runOpenBackgroundReconciliation(libraryId, {
            // Serpent-be29a9: this pass runs in 60-asset batches for many seconds.
            // Release the single background admission between batches whenever an
            // interactive request or mutation is waiting.
            admissionYield: () => interactiveScheduler.yieldAdmission(
              `reconciliation:${libraryId}:${libraryGeneration}`,
            ),
            onMissingPrimaryArtifacts: (assetIds) => {
              // Queue only IDs found missing in this bounded reconciliation
              // batch. Persist jobs at background priority; after reconciliation,
              // the existing startup/visible scene can process them without
              // letting repair work outrank the current viewport.
              if (assetIds.length === 0) return;
              for (const assetId of assetIds) missingPrimaryArtifactIds.add(assetId);
              rememberReconciledPrimaryAssetIds(libraryId, assetIds);
              try {
                libraryService.enqueueThumbnailJobs(libraryId, {
                  assetIds,
                  limit: assetIds.length,
                  priority: 50,
                  skipStaleRepair: true,
                });
              } catch (error) {
                libraryService.reportDiagnostic(
                  'thumbnail-schedule.reconciled-missing-artifacts',
                  error,
                  { libraryId },
                );
              }
            },
          });
          if (
            missingPrimaryArtifactIds.size > 0
            && (
              startupThumbnailVisibleWindows.has(libraryId)
              || !deferredStartupThumbnailGenerations.has(libraryId)
            )
          ) {
            // All exact IDs have already been durably enqueued above. Drain
            // those IDs in bounded batches; never fall back to a global claim
            // or hand this reconciliation-only pump to secondary media work.
            // If another primary queue owns admission, its cleanup drains the
            // retained exact-ID set before any secondary handoff.
            scheduleReconciledMissingPrimaryQueue(
              libraryId,
              [...missingPrimaryArtifactIds],
            );
          }
        },
      ),
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
 * renderer has had a chance to report its first visible window. The pending
 * generation is released by that event or by library-close cancellation.
 */
function deferStartupThumbnailScene(
  libraryId: string,
  libraryGeneration: number,
): void {
  deferredStartupThumbnailGenerations.set(libraryId, libraryGeneration);
  startupThumbnailVisibleWindows.delete(libraryId);

  // Serpent-140fe2 direction (user, 2026-08-22): thumbnails must be queued
  // for the WHOLE library right after open, not lazily per viewport. The
  // queue itself provides ordering — visible-window waves boost the current
  // viewport above the low-priority backfill — so interactive activity no
  // longer postpones the enqueue (it only ever postponed it forever during
  // continuous browsing).
  // Serpent-4bdd26: a cold library can take arbitrarily long to produce its
  // first viewport on a slow local or network volume. Keep startup work
  // event-driven instead of polling for a fixed number of seconds; the first
  // visible-window report starts this scene, and close/open cancellation
  // removes the pending generation.
}

function cancelDeferredStartupThumbnailScene(libraryId: string): void {
  deferredStartupThumbnailGenerations.delete(libraryId);
  pendingStartupThumbnailAdmission.cancel(libraryId);
  startupThumbnailVisibleWindows.delete(libraryId);
  pendingVisibleThumbnailWaves.delete(libraryId);
  lastVisibleWindowKeyByLibrary.delete(libraryId);
  lastVisibleWindowAssetIdsByLibrary.delete(libraryId);
  thumbnailCompletionFanout.clear(libraryId);
  viewportPriorityOverlay.clearLibrary(libraryId);
  lastViewportVisibleChangeAtMs.delete(libraryId);
  lastViewportPreemptAtMs.delete(libraryId);
}

function admitStartupThumbnailScene(libraryId: string, libraryGeneration: number): void {
  if (
    !automaticMediaAdmissionAllowed(libraryId)
    || libraryGenerationRegistry.current(libraryId) !== libraryGeneration
  ) return;
  if (activeThumbnailQueues.has(libraryId)) {
    pendingStartupThumbnailAdmission.defer({ libraryId, generation: libraryGeneration });
    return;
  }
  scheduleThumbnailScene(libraryId, 'startup');
}

/** Start the one-shot startup fill after the active visible wave releases ownership. */
function resumePendingStartupThumbnailAdmission(libraryId: string): boolean {
  const generation = pendingStartupThumbnailAdmission.takeWhenIdle(
    libraryId,
    libraryGenerationRegistry.current(libraryId),
    activeThumbnailQueues.has(libraryId),
  );
  if (generation === undefined) return false;
  // Let the current runBatch stack finish before the next queue registers itself.
  setTimeout(() => admitStartupThumbnailScene(libraryId, generation), 0);
  return true;
}

function startDeferredStartupThumbnailScene(
  libraryId: string,
  libraryGeneration: number,
): void {
  if (deferredStartupThumbnailGenerations.get(libraryId) !== libraryGeneration) return;
  deferredStartupThumbnailGenerations.delete(libraryId);
  // Serpent-2cc492: startup enqueue/processing still waits for the first
  // browse response and in-flight commands to drain, but it no longer has a
  // time-based viewport wait before this gate is reached.
  const token = { libraryId, generation: libraryGeneration };
  void startupBurstGates.waitForDrain(token).then(() => {
    admitStartupThumbnailScene(libraryId, libraryGeneration);
    return undefined;
  }).catch(() => {
    // Never let automatic media work surface as an unhandled rejection.
  });
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
        const dimensions = await traceActivity(
          `dimension-probes:${libraryId}`,
          () => libraryService.persistVisibleWindowImageDimensionsAsync(
            libraryId,
            batch,
            state.controller.signal,
          ),
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
/**
 * Secondary derivatives used to claim exactly one job per turn and then wait a
 * fixed 50 ms before the next turn. Measured against 200 real images
 * (`npm run test:perf:palette -- <image-directory>`), that capped secondary
 * throughput at 12.5 jobs/s: each palette job costs ~12 ms, so a 20 000-asset
 * library needed ~26 minutes of `色卡` work, and a single-job claim also paid
 * ~8 ms of per-call claim/transaction overhead that a larger claim amortizes.
 *
 * The turn now claims a bounded wave, the way the primary preview lane claims
 * `workerMediaDecodeWaveSize()`. Native concurrency is still capped by
 * `workerMediaDecodeConcurrency()` (two background tasks, shared with the
 * primary lane through the Sharp semaphore) and by the per-decoder lanes, so
 * the wave is a claim budget rather than extra parallelism. A backlog is paced
 * with a short yield so it actually drains, while a queue that has almost
 * nothing left keeps the original 50 ms gap. Responsiveness is still governed
 * by the interactive idle window and the cooperative abort in
 * `scheduleSecondaryMediaQueue`, the claim-time deferral of secondary work
 * behind pending primary previews, and the decoder semaphores.
 */
const SECONDARY_MEDIA_BATCH_SIZE = Math.max(1, Math.min(8, workerMediaDecodeWaveSize()));
/** Pacing once a full wave was claimed, i.e. the secondary queue has a backlog. */
const SECONDARY_MEDIA_BACKLOG_YIELD_MS = 10;
/** Pacing when the queue is draining and the next turn will find little. */
const SECONDARY_MEDIA_IDLE_TURN_MS = 50;
const activeSecondaryMediaQueues = new Set<string>();
const activeSecondaryMediaQueueControllers = new Map<string, AbortController>();
const secondaryMediaIdleUntil = new Map<string, number>();
const rescheduledSecondaryMediaQueues = new Set<string>();
const urgentSecondaryMediaQueues = new Set<string>();
const urgentSecondaryMediaAssetIds = new Map<string, Set<string>>();
const secondaryMediaRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const secondaryMediaFairnessTurns = new Map<string, number>();
const rawMetadataBackfillAdmissionGate = new RawMetadataBackfillAdmissionGate();
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
  pendingReconciledPrimaryAssetIds.delete(libraryId);
  activeReconciledPrimaryBatches.delete(libraryId);
  pendingReconciledPrimaryResumes.delete(libraryId);
  cancelReconciledPrimaryIdleRetry(libraryId);
  pendingStartupThumbnailAdmission.cancel(libraryId);
  const secondaryController = activeSecondaryMediaQueueControllers.get(libraryId);
  if (secondaryController) secondaryController.abort();
  rescheduledSecondaryMediaQueues.delete(libraryId);
  cancelSecondaryMediaRetry(libraryId);
  secondaryMediaFairnessTurns.delete(libraryId);
  rawMetadataBackfillAdmissionGate.cancel(libraryId);
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
      if (RAW_METADATA_EXHAUSTION_ENABLED && !rawMetadataBackfillAdmissionGate.hasState(libraryId)) {
        try {
          const persistedAdmission: RawMetadataBackfillAdmissionState | null =
            libraryService.getRawMetadataBackfillAdmissionState(libraryId);
          if (persistedAdmission) {
            rawMetadataBackfillAdmissionGate.restore(libraryId, {
              exhaustedToken: persistedAdmission.exhausted ? persistedAdmission.token : null,
            });
          }
        } catch {
          // The service call below retains its lenient fallback for old/partial
          // libraries; a missing durable state must not stop the pump.
        }
      }
      // Serpent-288cd9：RAW backfill 的 catalog token 只使用 browse 序号。它覆盖
      // 新增资产、revision 与忽略规则变化，但不被 jobs/artifacts 后台写入噪声重置；
      // 到期 failed RAW retry 在 exhausted gate 之前走独立的有界 requeue 路径。
      // 取不到 token（老库缺表等）时退化为纯节流。
      const rawMetadataBackfillToken = RAW_METADATA_EXHAUSTION_ENABLED
        ? (() => {
          try {
            return String(libraryService.getBrowseChangeSequence(libraryId));
          } catch {
            return null;
          }
        })()
        : null;
      const attemptedRawMetadataBackfill = !urgent
        && rawMetadataBackfillAdmissionGate.shouldAttempt(libraryId, rawMetadataBackfillToken);
      if (attemptedRawMetadataBackfill) {
        // A startup scene only admits one bounded RAW batch. Keep admitting
        // the next batch here after the current secondary queue drains so a
        // 50k-camera library eventually reaches every Inspector record. The
        // full-catalog probe is throttled; explicit-asset admission remains
        // immediate in enqueueThumbnailJobs.
        try {
          const rawMetadataAdmission = await traceActivity(
            `raw-metadata-enqueue:${libraryId}`,
            async () => libraryService.enqueueRawImageMetadataBackfill(
              libraryId,
              RAW_METADATA_BACKFILL_BATCH_SIZE,
            ),
          );
          admittedRawMetadata = rawMetadataAdmission.admitted;
          rawMetadataBackfillAdmissionGate.noteResult(
            libraryId,
            rawMetadataBackfillToken,
            rawMetadataAdmission,
          );
          // Serpent-288cd9：候选探测的准入结果必须可观测，否则「扫完之后不再重扫」
          // 只能靠代码阅读而不是证据。
          if (WORKER_CMD_LOG) {
            console.error(JSON.stringify({
              timestamp: new Date().toISOString(),
              scope: 'raw-metadata.admission',
              admitted: rawMetadataAdmission.admitted,
              probed: rawMetadataAdmission.probed,
              budgetCapped: rawMetadataAdmission.budgetCapped,
              exhaustedSkips: rawMetadataBackfillAdmissionGate.stats().exhaustedSkips,
            }));
          }
        } catch (error) {
          // 探测失败不能让 secondary pump 停摆：按节流重试，且不标记扫完。
          rawMetadataBackfillAdmissionGate.noteResult(
            libraryId,
            rawMetadataBackfillToken,
            { admitted: 0, probed: 0, budgetCapped: true },
          );
          throw error;
        }
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
        traceActivity(
          `secondary-media:${libraryId}`,
          () => libraryService.processThumbnailQueue(libraryId, {
            maxJobs: SECONDARY_MEDIA_BATCH_SIZE,
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
              if (event.width && event.height) {
                parentPort?.postMessage({
                  type: 'asset.dimensions.ready',
                  libraryId,
                  assetId: event.assetId,
                  width: event.width,
                  height: event.height,
                  ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
                });
              }
            },
          }),
        );
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
        // A full wave means the secondary queue still holds work, so pace the
        // backlog with a short yield instead of the idle cadence; a short wave
        // means it is draining and the 50 ms gap costs nothing.
        const backlogged = !urgent && processed >= SECONDARY_MEDIA_BATCH_SIZE;
        setTimeout(
          () => void runOne(),
          backlogged ? SECONDARY_MEDIA_BACKLOG_YIELD_MS : SECONDARY_MEDIA_IDLE_TURN_MS,
        );
        return;
      }
      if (!urgent && !queueController.signal.aborted) {
        // Retry admission is deliberately an idle-lane probe. While a
        // secondary backlog is draining, avoid repeating the multi-predicate
        // retry candidate query on every turn; once no work is claimable, the
        // same bounded path requeues due RAW failures even when the catalog
        // admission gate is exhausted.
        let retryDelay = libraryService.rawImageMetadataRetryDelayMs(libraryId);
        if (retryDelay !== null && retryDelay <= 0) {
          admittedRawMetadata += await traceActivity(
            `raw-metadata-retry:${libraryId}`,
            async () => libraryService.requeueRawImageMetadataBackfillRetries(
              libraryId,
              RAW_METADATA_BACKFILL_BATCH_SIZE,
            ),
          );
          retryDelay = libraryService.rawImageMetadataRetryDelayMs(libraryId);
        }
        if (retryDelay !== null) scheduleSecondaryMediaRetry(libraryId, retryDelay);
        if (
          retryDelay === null
          && !attemptedRawMetadataBackfill
          && !rawMetadataBackfillAdmissionGate.shouldAttempt(libraryId, rawMetadataBackfillToken)
        ) {
          const backfillDelay = rawMetadataBackfillAdmissionGate.remainingDelayMs(libraryId);
          if (backfillDelay > 0) {
            setTimeout(() => void runOne(), backfillDelay);
            return;
          }
        }
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
    visible: {
      limit: THUMBNAIL_VISIBLE_PAGE_SIZE,
      priority: THUMBNAIL_VISIBLE_PRIORITY,
      maxIds: THUMBNAIL_VISIBLE_PAGE_SIZE,
    },
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
  if (scene === 'cover' && assetIds && assetIds.length > 0) {
    thumbnailCompletionFanout.addImmediateAssetIds(
      libraryId,
      assetIds.slice(0, maxIds),
    );
  }
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

function publishAiProgress(
  libraryId: string,
  changedJob?: NonNullable<AiProgressEvent['changedJobs']>[number],
): void {
  try {
    const status = libraryService.getAiJobStatus(libraryId);
    aiProgressThrottler.publish({
      type: 'ai.progress',
      libraryId,
      queued: status.queued,
      running: status.running,
      succeeded: status.succeeded,
      failed: status.failed,
      ...(changedJob ? { changedJobs: [changedJob] } : {}),
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

/**
 * Stop every automatic background task one library owns.
 *
 * Shared by `library.close`, `library.delete-from-disk` and — critically —
 * `library.open`. A switch through the recent list sends `library.open` for the
 * replacement WITHOUT a preceding `library.close`
 * (`library.open-recent.request` dispatches open directly), so the outgoing
 * library's media churn kept the single Worker busy and the open command starved
 * behind it: switching away from a busy network library never completed —
 * measured as ≥90 s with the loading overlay up and no Worker activity logged,
 * versus a completed switch once the churn is stopped.
 *
 * This stops *scheduling* work (queued jobs, retry loops, dimension probes).
 * Draining a decoder that is already running is a separate caller decision:
 * `closeLibraryAsync` and `library.delete-from-disk` do it, `library.open` does
 * not, because the outgoing library is released by its own close path.
 */
function stopAutomaticWorkForLibrary(
  libraryId: string,
  options?: { cancelQueuedJobs?: boolean },
): void {
  cancelDeferredStartupThumbnailScene(libraryId);
  cancelAutomaticMediaForLibrary(libraryId);
  cancelMediaResourceRetry(libraryId);
  cancelVisibleWindowDimensionProbes(libraryId);
  lastVisibleWindowKeyByLibrary.delete(libraryId);
  lastVisibleWindowAssetIdsByLibrary.delete(libraryId);
  thumbnailCompletionFanout.clear(libraryId);
  viewportPriorityOverlay.clearLibrary(libraryId);
  lastViewportVisibleChangeAtMs.delete(libraryId);
  lastViewportPreemptAtMs.delete(libraryId);
  // Closing and deleting destroy the library, so its queued jobs go with it. A
  // switch does not: `stopOutgoingLibrariesForOpen` passes false so the queued
  // work survives for the next open instead of being cancelled and re-enqueued.
  if (options?.cancelQueuedJobs !== false) libraryService.cancelJobs(libraryId);
  publishAiProgress(libraryId);
  aiJobAbortRegistry.abort(libraryId);
}

async function handleRequestWithoutWriteLease(request: WorkerRequest): Promise<WorkerResult> {
  switch (request.command.type) {
    case 'library.list':
    case 'library.change-sequence':
    case 'history.status':
    case 'history.group.begin':
    case 'history.group.complete':
    case 'history.undo':
    case 'history.redo':
    case 'library.create':
    case 'library.recovery-report':
    case 'library.inspect-eagle':
    case 'library.open-eagle':
    case 'library.inspect-billfish':
    case 'library.open-billfish':
    case 'library.navigation-summary': {
      const result = await executeLibraryIdentityWorkerCommand(libraryService, request);
      if (result === undefined) {
        throw new Error(`Unhandled library identity command: ${request.command.type}`);
      }
      return result;
    }
    case 'sync.probe':
    case 'sync.preview':
    case 'sync.run':
    case 'sync.poll-remote':
    case 'sync.asset-card-status':
    case 'sync.list-remote-libraries':
    case 'sync.open-remote-library': {
      const result = await executeSyncWorkerCommand(libraryService, parentPort, request);
      if (result === undefined) {
        throw new Error(`Unhandled sync command: ${request.command.type}`);
      }
      return result;
    }
    case 'library.open':
    case 'library.close':
    case 'library.rename':
    case 'library.delete-from-disk':
    case 'system.cleanup-pending-deletions': {
      const result = await executeLibraryLifecycleWorkerCommand(libraryService, request, {
        prepareForOpen: () => {
          stopOutgoingLibrariesForOpen({
            openLibraryIds: libraryService.listOpenLibraryIds(),
            cancelQueuedJobs: false,
            stopper: {
              stopScheduling: (outgoingLibraryId) => {
                cancelDeferredStartupThumbnailScene(outgoingLibraryId);
                cancelAutomaticMediaForLibrary(outgoingLibraryId);
                cancelMediaResourceRetry(outgoingLibraryId);
                cancelVisibleWindowDimensionProbes(outgoingLibraryId);
                lastVisibleWindowKeyByLibrary.delete(outgoingLibraryId);
                lastVisibleWindowAssetIdsByLibrary.delete(outgoingLibraryId);
                thumbnailCompletionFanout.clear(outgoingLibraryId);
                viewportPriorityOverlay.clearLibrary(outgoingLibraryId);
                lastViewportVisibleChangeAtMs.delete(outgoingLibraryId);
                lastViewportPreemptAtMs.delete(outgoingLibraryId);
              },
              cancelQueuedJobs: (outgoingLibraryId) => {
                libraryService.cancelJobs(outgoingLibraryId);
              },
              dropQueuedViewportHints: (outgoingLibraryId) => {
                interactiveScheduler.cancelQueuedViewportHintsForLibrary(outgoingLibraryId);
              },
              abortAiJobs: (outgoingLibraryId) => {
                aiJobAbortRegistry.abort(outgoingLibraryId);
              },
              publishAiProgress,
            },
          });
        },
        stopAutomaticWork: stopAutomaticWorkForLibrary,
      });
      if (result === undefined) {
        throw new Error(`Unhandled library lifecycle command: ${request.command.type}`);
      }
      return result;
    }
    case 'folder.create':
      // Routed through runBoundedWrite / executeBoundedWriteWorkerCommand.
      throw new Error('Bounded folder.create write was not dispatched through its transaction fence.');
    case 'appearance.set':
      throw new Error('Bounded appearance.set write was not dispatched through its transaction fence.');
    case 'folder.rename':
    case 'folder.clone':
    case 'folder.move':
    case 'folder.get-path':
    case 'folder.list':
    case 'folder.browse-entries':
    case 'folder.entries':
    case 'folder.list-trashed':
    case 'folder.restore-trashed':
    case 'folder.trash':
    case 'folder.delete-from-disk':
    case 'folder.delete-empty': {
      const result = await executeFolderWorkerCommand(libraryService, request, {
        scheduleCoverThumbnails: (libraryId, assetIds, maxIds) => {
          scheduleThumbnailScene(libraryId, 'cover', assetIds, maxIds);
        },
        recordPermanentDeleteBarrier,
      });
      if (result === undefined) {
        throw new Error(`Unhandled folder command: ${request.command.type}`);
      }
      return result;
    }
    case 'linked-folder.remove':
    case 'linked-folder.delete-subtree':
    case 'linked-folder.create-directory':
    case 'linked-folder.rename-directory':
    case 'linked-folder.list':
    case 'linked-folder.relink':
    case 'linked-folder.rules.get':
    case 'linked-folder.rules.set':
    case 'linked-folder.assets.copy':
    case 'linked-folder.convert': {
      const result = await executeLinkedFolderWorkerCommand(libraryService, request, {
        scheduleThumbnails: (libraryId, scene, assetIds) => {
          scheduleThumbnailScene(libraryId, scene, assetIds);
        },
        recordPermanentDeleteBarrier,
      });
      if (result === undefined) {
        throw new Error(`Unhandled linked-folder command: ${request.command.type}`);
      }
      return result;
    }
    case 'asset.list':
    case 'asset.sequence.create':
    case 'asset.sequence.dissolve':
    case 'asset.sequence.dissolve-batch':
    case 'asset.sequence.set-fps':
    case 'asset.import.probe-sequences':
    case 'asset.import.prepare':
    case 'asset.import-eagle':
    case 'asset.import-billfish':
    case 'asset.import.resolve':
    case 'asset.import.skip-source-failure':
    case 'asset.import.abandon':
    case 'asset.refresh':
    case 'asset.import-linked': {
      const result = await executeAssetIngestionWorkerCommand(libraryService, request, {
        scheduleThumbnails: (libraryId, scene, assetIds) => {
          scheduleThumbnailScene(libraryId, scene, assetIds);
        },
        withMediaSchedulingSuspended,
      });
      if (result === undefined) {
        throw new Error(`Unhandled asset ingestion command: ${request.command.type}`);
      }
      return result;
    }
    case 'ignore.list':
    case 'ignore.gitignore.get':
    case 'ignore.gitignore.set':
    case 'ignore.set': {
      const result = executeIgnoreWorkerCommand(libraryService, request, {
        scheduleRefreshThumbnails: (libraryId) => {
          scheduleThumbnailScene(libraryId, 'refresh');
        },
      });
      if (result === undefined) {
        throw new Error(`Unhandled ignore command: ${request.command.type}`);
      }
      return result;
    }
    case 'tag.list':
    case 'tag.create':
    case 'tag.rename':
    case 'tag.delete':
    case 'tag.delete-many':
    case 'tag.merge':
    case 'tag.cooccurrence':
    case 'tag.assign':
    case 'tag.remove': {
      const result = executeTagWorkerCommand(libraryService, request);
      if (result === undefined) {
        throw new Error(`Unhandled tag command: ${request.command.type}`);
      }
      return result;
    }
    case 'collection.list':
    case 'collection.create':
    case 'collection.update':
    case 'collection.reorder':
    case 'collection.delete':
    case 'collection.assets.add':
    case 'collection.assets.remove':
    case 'collection.assets.reorder':
    case 'collection.assets.list':
    case 'collection.assets.memberships': {
      const result = executeCollectionWorkerCommand(libraryService, request);
      if (result === undefined) {
        throw new Error(`Unhandled collection command: ${request.command.type}`);
      }
      return result;
    }
    case 'asset.metadata.get':
    case 'asset.extracted-metadata.get':
    case 'asset.color-space.set':
    case 'asset.metadata.set':
    case 'asset.metadata.set-many':
    case 'asset.metadata.backfill':
    case 'asset.rating.set':
    case 'asset.search': {
      const result = await executeAssetQueryWorkerCommand(libraryService, request, {
        shouldYieldForSearchCoalescing: (libraryId) => startupBurstGates.isBrowseServed(libraryId),
        isLatestSearchRequest: (libraryId, laneKey, requestId) => (
          latestAssetSearchRequests.isLatest(libraryId, laneKey, requestId)
        ),
      });
      if (result === undefined) {
        throw new Error(`Unhandled asset query command: ${request.command.type}`);
      }
      return result;
    }
    case 'browse.session.open':
    case 'browse.session.page':
    case 'browse.session.ids':
    case 'browse.session.close': {
      const result = executeBrowseSessionWorkerCommand(
        libraryService,
        (libraryId) => libraryGenerationRegistry.current(libraryId) ?? 0,
        request,
      );
      if (result === undefined) {
        throw new Error(`Unhandled browse session command: ${request.command.type}`);
      }
      return result;
    }
    case 'smart-collection.list':
    case 'smart-collection.create':
    case 'smart-collection.update':
    case 'smart-collection.delete':
    case 'smart-collection.execute': {
      const result = executeSmartCollectionWorkerCommand(libraryService, request);
      if (result === undefined) {
        throw new Error(`Unhandled smart-collection command: ${request.command.type}`);
      }
      return result;
    }
    case 'asset.trash':
    case 'asset.content.replace':
    case 'asset.content.stage':
    case 'asset.content.replace-batch':
    case 'asset.content.read':
    case 'asset.restore':
    case 'asset.restore-preview':
    case 'asset.move':
    case 'asset.move-undo':
    case 'asset.trash-undo':
    case 'asset.copy':
    case 'asset.copy-undo':
    case 'asset.rename-file':
    case 'asset.rename-files':
    case 'asset.restore-if-original-vacant':
    case 'asset.palette.aggregate-recent':
    case 'asset.text.read':
    case 'asset.text.save':
    case 'asset.delete-permanent':
    case 'asset.delete-from-disk':
    case 'asset.delete-linked':
    case 'asset.list-trash':
    case 'asset.purge-trash':
    case 'asset.relink':
    case 'asset.recovery-probe':
    case 'asset.relink-batch.preview':
    case 'asset.relink-batch.apply':
    case 'asset.delete-cancel': {
      const result = await executeAssetMutationWorkerCommand(libraryService, request, {
        scheduleThumbnails: (libraryId, scene, assetIds) => {
          scheduleThumbnailScene(libraryId, scene, assetIds);
        },
        recordPermanentDeleteBarrier,
      });
      if (result === undefined) {
        throw new Error(`Unhandled asset mutation command: ${request.command.type}`);
      }
      return result;
    }
    case 'extension.save-from-url':
    case 'extension.save-from-file': {
      const result = await executeExtensionWorkerCommand(libraryService, request, {
        scheduleMutationThumbnails: (libraryId, assetIds) => {
          scheduleThumbnailScene(libraryId, 'mutation', assetIds);
        },
      });
      if (result === undefined) {
        throw new Error(`Unhandled extension command: ${request.command.type}`);
      }
      return result;
    }
    case 'library.export':
    case 'library.export-cancel':
    case 'library.import-folder':
    case 'library.import-zip':
    case 'library.import-cancel':
    case 'library.import-validate': {
      const result = await executeLibraryTransferWorkerCommand(libraryService, request);
      if (result === undefined) {
        throw new Error(`Unhandled library transfer command: ${request.command.type}`);
      }
      return result;
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
            providerConcurrencyLimiter,
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
    case 'media.generate-thumbnail':
    case 'media.retry-artifact': {
      const result = await executeMediaGenerationWorkerCommand(libraryService, request, {
        writePluginMediaArtifact,
        scheduleThumbnails: (libraryId, scene, assetIds) => {
          scheduleThumbnailScene(libraryId, scene, assetIds);
        },
        publishThumbnailReady: (event) => {
          thumbnailCompletionFanout.publishImmediate(event);
        },
        scheduleSecondaryMediaQueue,
      });
      if (result === undefined) {
        throw new Error(`Unhandled media generation command: ${request.command.type}`);
      }
      return result;
    }
    case 'model.convert-fbx':
    case 'media.get-artifact-path':
    case 'media.get-artifact-paths':
    case 'media.get-source-path':
    case 'media.get-thumbnail-artifact':
    case 'media.get-preview-artifact':
    case 'media.get-asset-path':
    case 'model.resolve-companions':
    case 'media.get-asset-paths':
    case 'media.get-asset-drag-infos':
    case 'media.resolve-asset-paths': {
      const result = await executeMediaPathWorkerCommand(libraryService, request, {
        writePluginMediaArtifact,
        scheduleThumbnails: (libraryId, scene, assetIds, maxIds, options) => {
          scheduleThumbnailScene(libraryId, scene, assetIds, maxIds, options);
        },
        mutationPendingFor: (libraryId) => interactiveScheduler.mutationPendingFor(libraryId),
      });
      if (result === undefined) {
        throw new Error(`Unhandled media path command: ${request.command.type}`);
      }
      return result;
    }
    case 'asset.thumbnail.visible-window': {
      const result = executeVisibleWindowWorkerCommand(libraryService, request, {
        startupThumbnailVisibleWindows,
        deferredStartupThumbnailGenerations,
        startDeferredStartupThumbnailScene,
        viewportPriorityOverlay,
        currentLibraryGeneration: (libraryId) => libraryGenerationRegistry.current(libraryId),
        lastVisibleWindowKeyByLibrary,
        lastVisibleWindowAssetIdsByLibrary,
        lastViewportVisibleChangeAtMs,
        lastViewportPreemptAtMs,
        activeThumbnailQueueAssetScopes,
        setImmediateAssetIds: (libraryId, assetIds) => {
          thumbnailCompletionFanout.setImmediateAssetIds(libraryId, assetIds);
        },
        hasIdleForegroundImageSlot,
        scheduleVisibleThumbnails: (libraryId, assetIds, preemptVisible) => {
          scheduleThumbnailScene(
            libraryId,
            'visible',
            assetIds,
            assetIds.length,
            { light: true, preemptVisible },
          );
        },
        enqueueVisibleWindowDimensionProbes,
      });
      if (result === undefined) {
        throw new Error(`Unhandled visible-window command: ${request.command.type}`);
      }
      return result;
    }
    case 'media.enqueue-thumbnail-jobs':
    case 'media.process-thumbnail-queue':
    case 'media.job-summary':
    case 'media.list-jobs':
    case 'media.pause-jobs':
    case 'media.resume-jobs':
    case 'media.cancel-jobs':
    case 'media.retry-jobs': {
      const result = await executeMediaJobWorkerCommand(libraryService, request, {
        scheduleThumbnailQueue,
      });
      if (result === undefined) {
        throw new Error(`Unhandled media job command: ${request.command.type}`);
      }
      return result;
    }
    case 'plugin.jobs.enqueue':
    case 'plugin.jobs.list':
    case 'plugin.jobs.claim-next':
    case 'plugin.jobs.complete':
    case 'plugin.jobs.cancel':
    case 'plugin.jobs.pause':
    case 'plugin.jobs.resume':
    case 'plugin.jobs.retry':
    case 'plugin.jobs.report-progress':
    case 'plugin.jobs.pause-owners':
    case 'plugin.derived-fields.materialize':
    case 'plugin.derived-fields.query': {
      const result = executePluginJobWorkerCommand(libraryService, request);
      if (result === undefined) {
        throw new Error(`Unhandled plugin job command: ${request.command.type}`);
      }
      return result;
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
      const batchAbortController = new AbortController();
      aiProcessBatchAbortControllers.set(request.requestId, batchAbortController);

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
          publishAiProgress(libraryId, { jobId: job.jobId, status: 'running' });
          const controller = aiJobAbortRegistry.register(libraryId, job.jobId);
          const nestedRequestId = `${request.requestId}:${job.jobId}`;
          analysisControls.set(nestedRequestId, {
            jobId: job.jobId,
            signal: controller.signal,
            canWrite: () => safeAiJobState(libraryId, job.jobId) === 'running',
            requestTimeoutMs,
            runExternal: <T>(work: () => Promise<T> | T) =>
              interactiveScheduler.runWithoutAdmission(request.requestId, work),
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
              publishAiProgress(libraryId, {
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
            publishAiProgress(libraryId, { jobId: job.jobId, status: 'succeeded' });
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
            publishAiProgress(libraryId, {
              jobId: job.jobId,
              status: failure.status,
              errorCode: classification.errorCode,
            });
          } finally {
            analysisControls.delete(nestedRequestId);
            aiJobAbortRegistry.unregister(job.jobId);
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
        aiProcessBatchAbortControllers.delete(request.requestId);
      }
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

const handleLibraryWorkerMessage = async (event: { data: unknown }): Promise<void> => {
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
      pending.cleanup();
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
      pendingDocument.cleanup();
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
        ...deferredStartupThumbnailGenerations.keys(),
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
    // Serpent-217028: the renderer already stamps browse commands with a
    // navigation id. Carry it onto the command diagnostic line so the benchmark
    // can join this command's queue / admission / run spans to the click that
    // caused it instead of guessing from time windows. Diagnostics only.
    const cmdNavigationIdRaw = (request.command as { navigationId?: unknown }).navigationId;
    const cmdLogNavigationId = typeof cmdNavigationIdRaw === 'string' ? cmdNavigationIdRaw : undefined;
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
      label: request.command.type,
      ...(performanceEnvelope.deadlineAtEpochMs === undefined
        ? {}
        : { deadlineAtEpochMs: performanceEnvelope.deadlineAtEpochMs }),
      ...(performanceEnvelope.libraryId === undefined
        ? {}
        : { libraryId: performanceEnvelope.libraryId }),
      ...(performanceEnvelope.libraryGeneration === undefined
        ? {}
        : { libraryGeneration: performanceEnvelope.libraryGeneration }),
      ...(performanceEnvelope.consumerId === undefined
        ? {}
        : { consumerId: performanceEnvelope.consumerId }),
      ...(performanceEnvelope.interactionKey === undefined
        ? {}
        : { interactionKey: performanceEnvelope.interactionKey }),
      ...(performanceEnvelope.interactionGeneration === undefined
        ? {}
        : { interactionGeneration: performanceEnvelope.interactionGeneration }),
      ...(request.command.type === 'library.close'
        || request.command.type === 'library.delete-from-disk'
        ? { lifecycleBoundary: true }
        : {}),
      ...(isLibraryTransitionCommand(request.command.type)
        ? { lifecyclePriority: true }
        : {}),
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
      const previousActivity = currentWorkerActivity;
      currentWorkerActivity = `command:${request.command.type}`;
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
            startupResponseGate = scheduleOpenBackgroundReconciliation(
              result.library.libraryId,
              generation,
            );
            deferStartupThumbnailScene(result.library.libraryId, generation);
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
        currentWorkerActivity = previousActivity;
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
            // Attribution across a library switch: a stalled switch is caused by
            // work belonging to the *outgoing* library, which the request type
            // and lane alone cannot show.
            ...(performanceEnvelope.libraryId === undefined
              ? {}
              : { libraryId: performanceEnvelope.libraryId }),
            ...(cmdLogNavigationId === undefined ? {} : { navigationId: cmdLogNavigationId }),
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
      const cancelWhileTransferRuns =
        request.command.type === 'library.import-cancel'
        || request.command.type === 'library.export-cancel'
        || request.command.type === 'asset.delete-cancel';
      const aiProcessLibraryId = request.command.type === 'ai.process-queue'
        ? request.command.libraryId
        : undefined;
      response = {
        requestId: request.requestId,
        result: cancelWhileTransferRuns
          ? await runScheduled()
          : await interactiveScheduler.schedule(scheduledRequest, runScheduled, {
            ...(lifecycleBoundary
              ? { cancelQueuedForLibrary: lifecycleLibraryId! }
              : {}),
            ...(aiProcessLibraryId === undefined
              ? {}
              : {
                cancel: () => {
                  aiProcessBatchAbortControllers.get(request.requestId)?.abort();
                  aiJobAbortRegistry.abort(aiProcessLibraryId);
                },
              }),
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
};

parentPort.on('message', (event) => {
  void handleLibraryWorkerMessage(event);
});

// CI 诊断：UtilityProcess fork 后若模块加载失败/被系统杀，main 只见握手
// 超时且无任何输出。ready 前打印 boot 行（经 stdout 转发到 app-log），
// 可区分「worker 未执行」与「执行但握手慢」。
process.stdout.write(
  `${JSON.stringify({ scope: 'worker.boot', message: 'worker module loaded, sending ready.' })}\n`,
);
parentPort.postMessage({ type: 'worker.ready' });
