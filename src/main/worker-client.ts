import { randomUUID } from 'node:crypto';

import { utilityProcess, type UtilityProcess } from 'electron';

import type { WorkerCommand, WorkerHistoryContext } from '../shared/protocol/requests';
import type { performanceLaneForCommand } from '../shared/performance-contract';
import type { AppLogger } from './app-logger';
import { LibraryRequestBroker } from './library-request-broker';
import { mediaBinaryWorkerEnv } from './media-binary-env';
import {
  parseWorkerControlMessage,
  parseAssetChangeEvent,
  parseLibraryChangedEvent,
  parseWorkerReadyMessage,
  parseWorkerResponse,
  parseProgressEvent,
  parseThumbnailEvent,
  parseAiInputReadyEvent,
  parseAiProgressEvent,
  parseAiAnalysisCompletedEvent,
  parseAiContentClearedEvent,
  type WorkerResult,
  type AssetChangeEvent,
  type LibraryChangedEvent,
  type ProgressEvent,
  type ThumbnailEvent,
  type AiInputReadyEvent,
  type AiProgressEvent,
  type AiAnalysisCompletedEvent,
  type AiContentClearedEvent,
} from '../shared/protocol/responses';
import {
  parsePluginMediaProviderRequest,
  type PluginMediaProviderRequest,
  type PluginMediaProviderResult,
} from '../shared/plugin-media-protocol';
import {
  parseModelThumbnailMainRenderRequest,
  type ModelThumbnailSourceAuthorization,
  type ModelThumbnailRenderRequest,
  type ModelThumbnailRenderResult,
} from '../shared/model-thumbnail-protocol';
import {
  parseDocumentThumbnailRenderRequest,
  type DocumentThumbnailRenderRequest,
  type DocumentThumbnailRenderResponse,
} from '../shared/document-thumbnail-protocol';

interface PendingRequest {
  commandType: string;
  lane: ReturnType<typeof performanceLaneForCommand>;
  resolve(result: WorkerResult): void;
  reject(error: Error): void;
  sentAt: number | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
}

// 15s: a cold UtilityProcess spawn under memory pressure (large game/IDE
// processes, AV scanning the fresh bundle) legitimately exceeds 5s before the
// worker module finishes loading; a too-tight handshake fails startup.
const READY_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 15_000;
const SEARCH_REQUEST_TIMEOUT_MS = 60_000;
// Serpent-2cc492：开库宽限窗口——SMB 冷缓存首读单条查询实测 20-35s，窗口内
// 的请求放宽到 120s（仍远小于「无限等待」），窗口 120s 后恢复稳态超时。
const OPEN_STARTUP_GRACE_WINDOW_MS = 120_000;
const OPEN_STARTUP_GRACE_TIMEOUT_MS = 120_000;
const FILE_OPERATION_TIMEOUT_MS = 5 * 60_000;
const AI_QUEUE_TIMEOUT_MS = 10 * 60_000;
const SHUTDOWN_TIMEOUT_MS = 2_000;
const WORKER_CMD_LOG = process.env.SERPENT_WORKER_CMD_LOG === '1';

/**
 * Disk-bound library transfer commands. A slow machine or a large Eagle
 * conversion can run for longer than any honest wall-clock budget; Main
 * must wait until the Worker finishes or the user cancels. Do not put
 * product "you may not use a large library" deadlines here.
 */
const UNBOUNDED_WORKER_COMMANDS = new Set([
  'library.create',
  'library.open',
  'library.inspect-eagle',
  'library.open-eagle',
  'library.inspect-billfish',
  'library.open-billfish',
  'library.export',
  'library.export-cancel',
  'library.import-folder',
  'library.import-zip',
  'library.import-cancel',
  'library.import-validate',
  'asset.import-eagle',
  'asset.import-billfish',
  'asset.refresh',
  'asset.delete-linked',
  'automation.file-import-plan',
  'automation.file-operation-plan',
  // WebDAV sync transfers every changed asset in both directions plus the
  // full remote manifest; a large library legitimately outlives the 15s
  // default, same as the disk-bound transfer commands above. Opening a
  // remote library also downloads the entire library before returning.
  'sync.preview',
  'sync.run',
  'sync.list-remote-libraries',
  'sync.open-remote-library',
]);

export class WorkerRequestTimeoutError extends Error {
  readonly code = 'WORKER_REQUEST_TIMEOUT' as const;

  constructor(
    readonly requestId: string,
    readonly commandType: string,
  ) {
    super(`Library Worker request timed out (${requestId}).`);
    this.name = 'WorkerRequestTimeoutError';
  }
}

export function requestTimeoutForCommand(
  command: WorkerCommand | WorkerCommand['type'],
): number | null {
  const commandType = typeof command === 'string' ? command : command.type;
  if (UNBOUNDED_WORKER_COMMANDS.has(commandType) || commandType.startsWith('asset.import.')) {
    return null;
  }
  if (commandType === 'ai.process-queue') {
    if (typeof command === 'object' && command.type === 'ai.process-queue') {
      const lanes = Math.max(1, Math.min(command.maxJobs, command.concurrencyLimit));
      const waves = Math.ceil(command.maxJobs / lanes);
      return Math.max(
        AI_QUEUE_TIMEOUT_MS,
        (waves * command.requestTimeoutMs) + 60_000,
      );
    }
    return AI_QUEUE_TIMEOUT_MS;
  }
  if (commandType === 'asset.analyze') {
    return AI_QUEUE_TIMEOUT_MS;
  }
  if (commandType === 'asset.search' || commandType === 'smart-collection.execute' || commandType === 'media.get-asset-drag-infos') {
    // Large-library searches, smart-collection pages, and drag-info hydration
    // can wait behind one unavoidable synchronous SQLite call. Superseded
    // searches are discarded by the Worker before they enter SQLite; the
    // remaining request gets a longer deadline instead of failing at the old
    // 15s default.
    return SEARCH_REQUEST_TIMEOUT_MS;
  }
  if (
    commandType === 'extension.save-from-url'
    || commandType === 'extension.save-from-file'
  ) return FILE_OPERATION_TIMEOUT_MS;
  return REQUEST_TIMEOUT_MS;
}

/** True when a Worker message looks like a push event rather than a request/response. */
export function isWorkerEventShapedMessage(message: unknown): boolean {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return false;
  const record = message as Record<string, unknown>;
  if (typeof record.type !== 'string' || record.type.length === 0) return false;
  if ('requestId' in record) return false;
  if ('result' in record) return false;
  return true;
}

export class LibraryWorkerClient {
  readonly #modulePath: string;
  #child: UtilityProcess | undefined;
  #ready = false;
  #pending = new Map<string, PendingRequest>();
  #expiredRequestIds = new Set<string>();
  #requestBroker = new LibraryRequestBroker();
  // Serpent-2cc492（真实 NAS 生产库事故，2026-08-23）：开库后的第一批元数据
  // 查询在 SMB 冷缓存下实测单条 20-35s（assets 表每页一次网络往返），远超
  // 15s 默认超时；响应迟到即被丢弃、UI 呈现「空资源库」且无法自愈。开库
  // 成功后开启一个有界宽限窗口：窗口内的请求按宽限超时计时（取两者较大值），
  // 稳态超时语义不变。窗口本身有硬上限，不会无限拖延失败检测。
  #openGraceUntil = 0;
  #shutdownAck: (() => void) | undefined;
  #shuttingDown = false;
  #assetChangeListeners = new Set<(event: AssetChangeEvent) => void>();
  #libraryChangedListeners = new Set<(event: LibraryChangedEvent) => void>();
  #progressListeners = new Set<(event: ProgressEvent) => void>();
  #thumbnailListeners = new Set<(event: ThumbnailEvent) => void>();
  #aiInputReadyListeners = new Set<(event: AiInputReadyEvent) => void>();
  #aiProgressListeners = new Set<(event: AiProgressEvent) => void>();
  #aiCompletedListeners = new Set<(event: AiAnalysisCompletedEvent) => void>();
  #aiClearedListeners = new Set<(event: AiContentClearedEvent) => void>();
  #pluginMediaProviderListener:
    ((request: PluginMediaProviderRequest) => Promise<PluginMediaProviderResult>) | undefined;
  #modelThumbnailRenderListener:
    ((
      request: ModelThumbnailRenderRequest,
      sourceAuthorizations: readonly ModelThumbnailSourceAuthorization[],
    ) => Promise<ModelThumbnailRenderResult>) | undefined;
  #documentThumbnailRenderListener:
    ((request: DocumentThumbnailRenderRequest) => Promise<DocumentThumbnailRenderResponse["result"]>) | undefined;

  constructor(
    modulePath: string,
    private readonly logger: AppLogger,
    private readonly workerEnvironment: NodeJS.ProcessEnv = process.env,
  ) {
    this.#modulePath = modulePath;
  }

  async start(): Promise<void> {
    if (this.#child) throw new Error('Library Worker has already been started.');

    // A cold UtilityProcess spawn can be transiently slow on loaded machines
    // (memory pressure, antivirus scanning the freshly built bundle): the
    // fixed 5s ready handshake used to fail `npm start` outright (regression
    // observed on Windows under heavy load — worker.boot never logged, the
    // module simply had not finished loading). Retry the spawn once before
    // failing startup so a slow first boot survives.
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await this.#startAttempt(attempt);
        return;
      } catch (error) {
        lastError = error;
        if (attempt === 1) {
          this.logger.info(
            'worker.ready-retry',
            'Library Worker failed to become ready on the first attempt; retrying the spawn.',
          );
        }
      }
    }
    throw lastError;
  }

  async #startAttempt(attempt: number): Promise<void> {
    const child = utilityProcess.fork(this.#modulePath, [], {
      serviceName: 'Serpent Library Worker',
      stdio: 'pipe',
      // GUI / UtilityProcess PATH often omits user-installed ffmpeg; pin
      // absolute bundled/dev media CLIs so video posters match hover preview.
      env: mediaBinaryWorkerEnv(this.workerEnvironment),
    });
    this.#child = child;
    child.stdout?.on('data', (chunk) => this.logger.worker('stdout', chunk));
    child.stdout?.on('error', (error) => this.logger.error('worker.stdout', error));
    child.stderr?.on('data', (chunk) => this.logger.worker('stderr', chunk));
    child.stderr?.on('error', (error) => this.logger.error('worker.stderr', error));
    child.on('error', (type, location, report) => {
      this.logger.error('worker.fatal', new Error(`Library Worker fatal error: ${type}.`), {
        location,
        report,
      });
    });
    child.on('spawn', () => {
      this.logger.info('worker.spawn', 'Library Worker spawned.', {
        pid: child.pid,
        attempt,
      });
    });
    child.on('exit', this.#onExit);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        // CI 诊断：超时是启动慢还是 worker 死，靠 worker.boot / worker.exit
        // 日志区分；此处补一条超时记录（此前 reject 前无日志，main 若随后
        // 崩溃会完全无痕）。
        this.logger.error(
          'worker.ready-timeout',
          new Error('Library Worker ready handshake timed out.'),
          { pid: child.pid, timeoutMs: READY_TIMEOUT_MS, attempt },
        );
        child.kill();
        reject(new Error('Library Worker ready handshake timed out.'));
      }, READY_TIMEOUT_MS);

      const onInitialMessage = (message: unknown) => {
        try {
          parseWorkerReadyMessage(message);
        } catch (error) {
          clearTimeout(timer);
          child.off('message', onInitialMessage);
          child.kill();
          reject(new Error('Library Worker sent a malformed ready handshake.', { cause: error }));
          return;
        }

        clearTimeout(timer);
        child.off('message', onInitialMessage);
        this.#ready = true;
        child.on('message', this.#onMessage);
        resolve();
      };

      child.once('exit', (code) => {
        if (!this.#ready) {
          clearTimeout(timer);
          reject(new Error(`Library Worker exited before ready (${code}).`));
        }
      });
      child.on('message', onInitialMessage);
    });
  }

  request(
    command: WorkerCommand,
    options: { dispatch?: 'automation-readonly'; historyContext?: WorkerHistoryContext } = {},
  ): Promise<WorkerResult> {
    const child = this.#child;
    if (!child || !this.#ready) return Promise.reject(new Error('Library Worker is unavailable.'));

    const requestId = randomUUID();
    const sentAtEpochMs = Date.now();
    if (
      command.type === 'library.open'
      || command.type === 'library.open-eagle'
      || command.type === 'library.open-billfish'
    ) {
      this.#openGraceUntil = Date.now() + OPEN_STARTUP_GRACE_WINDOW_MS;
    }
    return new Promise<WorkerResult>((resolve, reject) => {
      const baseTimeout = requestTimeoutForCommand(command);
      const inOpenGrace = Date.now() < this.#openGraceUntil;
      const timeout = baseTimeout == null
        ? null
        : inOpenGrace && command.type !== 'library.open'
          ? Math.max(baseTimeout, OPEN_STARTUP_GRACE_TIMEOUT_MS)
          : baseTimeout;
      const performanceEnvelope = this.#requestBroker.envelopeFor(command, {
        sentAtEpochMs,
        timeoutMs: timeout,
      });
      const timer = timeout == null
        ? undefined
        : setTimeout(() => {
          this.#pending.delete(requestId);
          this.#expiredRequestIds.add(requestId);
          const cleanupTimer = setTimeout(
            () => this.#expiredRequestIds.delete(requestId),
            10 * 60_000,
          );
          cleanupTimer.unref();
          reject(new WorkerRequestTimeoutError(requestId, command.type));
        }, timeout);

      const sentAt = WORKER_CMD_LOG ? Date.now() : undefined;
      this.#pending.set(requestId, {
        commandType: command.type,
        lane: performanceEnvelope.lane,
        resolve,
        reject,
        sentAt,
        timer,
      });
      child.postMessage({
        requestId,
        command,
        ...(sentAt === undefined ? {} : { sentAt }),
        performance: performanceEnvelope,
        ...(options.dispatch === undefined ? {} : { dispatch: options.dispatch }),
        ...(options.historyContext === undefined ? {} : { historyContext: options.historyContext }),
      });
    });
  }

  onAssetsChanged(listener: (event: AssetChangeEvent) => void): () => void {
    this.#assetChangeListeners.add(listener);
    return () => this.#assetChangeListeners.delete(listener);
  }

  onLibraryChanged(listener: (event: LibraryChangedEvent) => void): () => void {
    this.#libraryChangedListeners.add(listener);
    return () => this.#libraryChangedListeners.delete(listener);
  }

  onProgress(listener: (event: ProgressEvent) => void): () => void {
    this.#progressListeners.add(listener);
    return () => this.#progressListeners.delete(listener);
  }

  onThumbnailEvent(listener: (event: ThumbnailEvent) => void): () => void {
    this.#thumbnailListeners.add(listener);
    return () => this.#thumbnailListeners.delete(listener);
  }

  onAiInputReady(listener: (event: AiInputReadyEvent) => void): () => void {
    this.#aiInputReadyListeners.add(listener);
    return () => this.#aiInputReadyListeners.delete(listener);
  }

  onAiProgress(listener: (event: AiProgressEvent) => void): () => void {
    this.#aiProgressListeners.add(listener);
    return () => this.#aiProgressListeners.delete(listener);
  }

  onAiAnalysisCompleted(listener: (event: AiAnalysisCompletedEvent) => void): () => void {
    this.#aiCompletedListeners.add(listener);
    return () => this.#aiCompletedListeners.delete(listener);
  }

  onAiContentCleared(listener: (event: AiContentClearedEvent) => void): () => void {
    this.#aiClearedListeners.add(listener);
    return () => this.#aiClearedListeners.delete(listener);
  }

  onPluginMediaProviderRequest(
    listener: (request: PluginMediaProviderRequest) => Promise<PluginMediaProviderResult>,
  ): () => void {
    this.#pluginMediaProviderListener = listener;
    return () => {
      if (this.#pluginMediaProviderListener === listener) {
        this.#pluginMediaProviderListener = undefined;
      }
    };
  }

  /** Slice E: worker asks Main to render one model thumbnail offscreen. */
  onModelThumbnailRenderRequest(
    listener: (
      request: ModelThumbnailRenderRequest,
      sourceAuthorizations: readonly ModelThumbnailSourceAuthorization[],
    ) => Promise<ModelThumbnailRenderResult>,
  ): () => void {
    this.#modelThumbnailRenderListener = listener;
    return () => {
      if (this.#modelThumbnailRenderListener === listener) {
        this.#modelThumbnailRenderListener = undefined;
      }
    };
  }

  /** Serpent-8ca259: worker asks Main to capture an HTML document thumbnail. */
  onDocumentThumbnailRenderRequest(
    listener: (request: DocumentThumbnailRenderRequest) => Promise<DocumentThumbnailRenderResponse["result"]>,
  ): () => void {
    this.#documentThumbnailRenderListener = listener;
    return () => {
      if (this.#documentThumbnailRenderListener === listener) {
        this.#documentThumbnailRenderListener = undefined;
      }
    };
  }

  /**
   * Handle a worker `model-thumbnail.render-request` (slice E): hand it to the
   * offscreen renderer listener and post the typed result back to the Worker.
   * Returns true when the message was a render request (consumed).
   */
  #dispatchModelThumbnailRenderRequest(message: unknown): boolean {
    let mainRenderRequest;
    try {
      mainRenderRequest = parseModelThumbnailMainRenderRequest(message);
    } catch (error) {
      if (
        typeof message !== 'object'
        || message === null
        || !('type' in message)
        || message.type !== 'model-thumbnail.render-request'
      ) {
        return false;
      }
      const requestId = 'requestId' in message && typeof message.requestId === 'string'
        ? message.requestId
        : undefined;
      this.logger.error('worker.model-thumbnail.invalid-request', error, {
        hasRequestId: requestId !== undefined,
        companionCount: 'companionMap' in message && Array.isArray(message.companionMap)
          ? message.companionMap.length
          : undefined,
        authorizationCount: 'sourceAuthorizations' in message && Array.isArray(message.sourceAuthorizations)
          ? message.sourceAuthorizations.length
          : undefined,
      });
      const child = this.#child;
      if (child && requestId) {
        child.postMessage({
          type: 'model-thumbnail.render-response',
          requestId,
          result: {
            status: 'failed',
            errorCode: 'MODEL_LOAD_FAILED',
            reason: 'The model thumbnail request was invalid.',
          },
        });
      }
      return true;
    }
    const { sourceAuthorizations, ...renderRequest } = mainRenderRequest;
    const child = this.#child;
    if (!child) {
      this.logger.error(
        'worker.model-thumbnail.render-request',
        new Error('Received a model render request without a live worker.'),
      );
      return true;
    }
    void (this.#modelThumbnailRenderListener
      ? this.#modelThumbnailRenderListener(renderRequest, sourceAuthorizations)
      : Promise.resolve({
          status: 'failed' as const,
          errorCode: 'MODEL_WINDOW_FAILED',
          reason: 'offscreen thumbnail renderer unavailable',
        }))
      .catch(() => ({
        status: 'failed' as const,
        errorCode: 'MODEL_WINDOW_FAILED',
        reason: 'offscreen thumbnail renderer failed',
      }))
      .then((result) => {
        child.postMessage({
          type: 'model-thumbnail.render-response',
          requestId: renderRequest.requestId,
          result,
        });
      });
    return true;
  }

  /**
   * Handle a worker `document-thumbnail.render-request` (Serpent-8ca259):
   * hand it to the offscreen document renderer listener and post the typed
   * result back to the Worker. Returns true when consumed.
   */
  #dispatchDocumentThumbnailRenderRequest(message: unknown): boolean {
    let renderRequest;
    try {
      renderRequest = parseDocumentThumbnailRenderRequest(message);
    } catch {
      if (
        typeof message !== 'object'
        || message === null
        || !('type' in message)
        || message.type !== 'document-thumbnail.render-request'
      ) {
        return false;
      }
      const requestId = 'requestId' in message && typeof message.requestId === 'string'
        ? message.requestId
        : undefined;
      this.logger.error('worker.document-thumbnail.invalid-request', new Error('Malformed document thumbnail render request.'), {
        hasRequestId: requestId !== undefined,
      });
      const child = this.#child;
      if (child && requestId) {
        child.postMessage({
          type: 'document-thumbnail.render-response',
          requestId,
          result: {
            status: 'failed',
            errorCode: 'DOCUMENT_FRAME_INVALID',
            reason: 'The document thumbnail request was invalid.',
          },
        });
      }
      return true;
    }
    const child = this.#child;
    if (!child) {
      this.logger.error(
        'worker.document-thumbnail.render-request',
        new Error('Received a document render request without a live worker.'),
      );
      return true;
    }
    void (this.#documentThumbnailRenderListener
      ? this.#documentThumbnailRenderListener(renderRequest)
      : Promise.resolve({
          status: 'failed' as const,
          errorCode: 'DOCUMENT_WINDOW_FAILED' as const,
          reason: 'document thumbnail renderer unavailable',
        }))
      .catch(() => ({
        status: 'failed' as const,
        errorCode: 'DOCUMENT_WINDOW_FAILED' as const,
        reason: 'document thumbnail renderer failed',
      }))
      .then((result) => {
        child.postMessage({
          type: 'document-thumbnail.render-response',
          requestId: renderRequest.requestId,
          result,
        });
      });
    return true;
  }

  async shutdown(): Promise<void> {
    const child = this.#child;
    if (!child) return;

    this.#shuttingDown = true;
    if (this.#ready) {
      await Promise.race([
        new Promise<void>((resolve) => {
          this.#shutdownAck = resolve;
          child.postMessage({ type: 'worker.shutdown' });
        }),
        new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
      ]);
    }

    this.#shutdownAck = undefined;
    this.#ready = false;
    this.#rejectAll(new Error('Library Worker is shutting down.'));
    child.kill();
    this.#child = undefined;
  }

  readonly #onMessage = (message: unknown) => {
    // Slice E render requests must be handled before the generic event
    // parsers: the request is answered with a typed response, not forwarded.
    if (this.#dispatchModelThumbnailRenderRequest(message)) return;
    // Serpent-8ca259: HTML document thumbnail capture, same request/response
    // pattern as model thumbnails.
    if (this.#dispatchDocumentThumbnailRenderRequest(message)) return;

    try {
      const providerRequest = parsePluginMediaProviderRequest(message);
      const child = this.#child;
      if (!child) return;
      void (this.#pluginMediaProviderListener
        ? this.#pluginMediaProviderListener(providerRequest)
        : Promise.resolve({
          status: 'native-fallback' as const,
          assetId: providerRequest.assetId,
          kind: providerRequest.kind,
          errorCode: 'PLUGIN_PROVIDER_UNAVAILABLE',
        }))
        .catch(() => ({
          status: 'native-fallback' as const,
          assetId: providerRequest.assetId,
          kind: providerRequest.kind,
          errorCode: 'PLUGIN_PROVIDER_FAILED',
        }))
        .then((result) => {
          child.postMessage({
            type: 'plugin-media-provider.response',
            requestId: providerRequest.requestId,
            result,
          });
        });
      return;
    } catch {
      // Not a plugin media provider request; continue with normal Worker events.
    }

    // Progress events take priority over asset-change events.
    try {
      const progress = parseProgressEvent(message);
      for (const listener of this.#progressListeners) listener(progress);
      return;
    } catch {
      // Not a progress event; try thumbnail next.
    }

    try {
      const thumbnail = parseThumbnailEvent(message);
      for (const listener of this.#thumbnailListeners) listener(thumbnail);
      return;
    } catch {
      // Not a thumbnail event; try video AI-input readiness next.
    }

    try {
      const aiInputReady = parseAiInputReadyEvent(message);
      for (const listener of this.#aiInputReadyListeners) listener(aiInputReady);
      return;
    } catch {
      // Not an AI-input event; try AI progress next.
    }

    try {
      const aiProgress = parseAiProgressEvent(message);
      for (const listener of this.#aiProgressListeners) listener(aiProgress);
      return;
    } catch {
      // Not an AI progress event.
    }

    try {
      const aiCompleted = parseAiAnalysisCompletedEvent(message);
      for (const listener of this.#aiCompletedListeners) listener(aiCompleted);
      return;
    } catch {
      // Not an AI completed event.
    }

    try {
      const aiCleared = parseAiContentClearedEvent(message);
      for (const listener of this.#aiClearedListeners) listener(aiCleared);
      return;
    } catch {
      // Not an AI cleared event.
    }

    try {
      const libraryChanged = parseLibraryChangedEvent(message);
      for (const listener of this.#libraryChangedListeners) listener(libraryChanged);
      return;
    } catch {
      // Not a library change event; continue parsing worker messages.
    }

    try {
      const event = parseAssetChangeEvent(message);
      for (const listener of this.#assetChangeListeners) listener(event);
      return;
    } catch {
      // A response or control message is not an asset event; validate it below.
    }

    try {
      const control = parseWorkerControlMessage(message);
      if (control.type === 'worker.shutdown.ack') {
        this.#shutdownAck?.();
        return;
      }
    } catch {
      // A response is not a control message; validate it below.
    }

    let response;
    try {
      response = parseWorkerResponse(message);
    } catch (error) {
      // Event-shaped payloads that fail their dedicated parsers (schema drift,
      // new source enums, etc.) must not take down the Library Worker. Only
      // kill the process when the message cannot be classified as an event.
      if (isWorkerEventShapedMessage(message)) {
        this.logger.error('worker.protocol.ignored-event', error, {
          type: typeof message === 'object' && message !== null && 'type' in message
            ? String((message as { type: unknown }).type)
            : undefined,
        });
        return;
      }
      this.#protocolFailure(new Error('Library Worker sent a malformed response.', { cause: error }));
      return;
    }

    // Lifecycle generations describe Worker state, not request bookkeeping.
    // Observe them even when Main already timed out and discarded the pending
    // promise, otherwise the next request could be sent without the fence.
    this.#requestBroker.observeResult(response.result);

    const pending = this.#pending.get(response.requestId);
    if (!pending) {
      if (this.#expiredRequestIds.delete(response.requestId)) {
        this.logger.info(
          'worker.response.late',
          'Ignored a valid response for a timed-out request.',
          { requestId: response.requestId },
        );
        return;
      }
      this.#protocolFailure(new Error('Library Worker response has no matching request.'));
      return;
    }

    clearTimeout(pending.timer);
    this.#pending.delete(response.requestId);
    if (WORKER_CMD_LOG && pending.sentAt !== undefined) {
      this.logger.info(
        'worker.cmd.roundtrip',
        'Library Worker command roundtrip completed.',
        {
          requestId: response.requestId,
          commandType: pending.commandType,
          lane: pending.lane,
          totalMs: Math.max(0, Date.now() - pending.sentAt),
        },
      );
    }
    pending.resolve(response.result);
  };

  readonly #onExit = (code: number) => {
    const expected = this.#shuttingDown;
    if (expected) {
      this.logger.info('worker.exit', 'Library Worker exited during shutdown.', { code });
    } else {
      this.logger.error('worker.exit', new Error(`Library Worker exited unexpectedly (${code}).`), {
        code,
      });
    }
    this.#ready = false;
    this.#child = undefined;
    this.#shuttingDown = false;
    this.#requestBroker.reset();
    this.#rejectAll(new Error(`Library Worker exited (${code}).`));
  };

  #protocolFailure(error: Error): void {
    this.logger.error('worker.protocol', error);
    this.#ready = false;
    this.#rejectAll(error);
    this.#child?.kill();
  }

  #rejectAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
