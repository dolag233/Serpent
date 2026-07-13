import { randomUUID } from 'node:crypto';

import { utilityProcess, type UtilityProcess } from 'electron';

import type { WorkerCommand } from '../shared/protocol/requests';
import type { AppLogger } from './app-logger';
import {
  parseWorkerControlMessage,
  parseAssetChangeEvent,
  parseWorkerReadyMessage,
  parseWorkerResponse,
  parseProgressEvent,
  parseThumbnailEvent,
  parseAiProgressEvent,
  parseAiAnalysisCompletedEvent,
  parseAiContentClearedEvent,
  type WorkerResult,
  type AssetChangeEvent,
  type ProgressEvent,
  type ThumbnailEvent,
  type AiProgressEvent,
  type AiAnalysisCompletedEvent,
  type AiContentClearedEvent,
} from '../shared/protocol/responses';

interface PendingRequest {
  resolve(result: WorkerResult): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const READY_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 15_000;
const FILE_OPERATION_TIMEOUT_MS = 5 * 60_000;
const LINKED_DELETE_TIMEOUT_MS = 6 * 60_000;
const EXPORT_IMPORT_TIMEOUT_MS = 30 * 60_000;
const SHUTDOWN_TIMEOUT_MS = 2_000;

const EXPORT_IMPORT_COMMANDS = new Set([
  'library.export',
  'library.export-cancel',
  'library.import-folder',
  'library.import-zip',
  'library.import-cancel',
]);

export class LibraryWorkerClient {
  readonly #modulePath: string;
  #child: UtilityProcess | undefined;
  #ready = false;
  #pending = new Map<string, PendingRequest>();
  #expiredRequestIds = new Set<string>();
  #shutdownAck: (() => void) | undefined;
  #shuttingDown = false;
  #assetChangeListeners = new Set<(event: AssetChangeEvent) => void>();
  #progressListeners = new Set<(event: ProgressEvent) => void>();
  #thumbnailListeners = new Set<(event: ThumbnailEvent) => void>();
  #aiProgressListeners = new Set<(event: AiProgressEvent) => void>();
  #aiCompletedListeners = new Set<(event: AiAnalysisCompletedEvent) => void>();
  #aiClearedListeners = new Set<(event: AiContentClearedEvent) => void>();

  constructor(modulePath: string, private readonly logger: AppLogger) {
    this.#modulePath = modulePath;
  }

  async start(): Promise<void> {
    if (this.#child) throw new Error('Library Worker has already been started.');

    const child = utilityProcess.fork(this.#modulePath, [], {
      serviceName: 'Serpent Library Worker',
      stdio: 'pipe',
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
      this.logger.info('worker.spawn', 'Library Worker spawned.', { pid: child.pid });
    });
    child.on('exit', this.#onExit);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Library Worker ready handshake timed out.'));
        child.kill();
      }, READY_TIMEOUT_MS);

      const onInitialMessage = (message: unknown) => {
        try {
          parseWorkerReadyMessage(message);
        } catch (error) {
          clearTimeout(timer);
          child.off('message', onInitialMessage);
          reject(new Error('Library Worker sent a malformed ready handshake.', { cause: error }));
          child.kill();
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

  request(command: WorkerCommand): Promise<WorkerResult> {
    const child = this.#child;
    if (!child || !this.#ready) return Promise.reject(new Error('Library Worker is unavailable.'));

    const requestId = randomUUID();
    return new Promise<WorkerResult>((resolve, reject) => {
      const timeout = EXPORT_IMPORT_COMMANDS.has(command.type)
        ? EXPORT_IMPORT_TIMEOUT_MS
        : command.type === 'asset.delete-linked'
          ? LINKED_DELETE_TIMEOUT_MS
        : command.type.startsWith('asset.import.')
            || command.type === 'asset.refresh'
          ? FILE_OPERATION_TIMEOUT_MS
          : REQUEST_TIMEOUT_MS;
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        this.#expiredRequestIds.add(requestId);
        const cleanupTimer = setTimeout(
          () => this.#expiredRequestIds.delete(requestId),
          10 * 60_000,
        );
        cleanupTimer.unref();
        reject(new Error(`Library Worker request timed out (${requestId}).`));
      }, timeout);

      this.#pending.set(requestId, { resolve, reject, timer });
      child.postMessage({ requestId, command });
    });
  }

  onAssetsChanged(listener: (event: AssetChangeEvent) => void): () => void {
    this.#assetChangeListeners.add(listener);
    return () => this.#assetChangeListeners.delete(listener);
  }

  onProgress(listener: (event: ProgressEvent) => void): () => void {
    this.#progressListeners.add(listener);
    return () => this.#progressListeners.delete(listener);
  }

  onThumbnailEvent(listener: (event: ThumbnailEvent) => void): () => void {
    this.#thumbnailListeners.add(listener);
    return () => this.#thumbnailListeners.delete(listener);
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
      // Not a thumbnail event; try AI events next.
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
      this.#protocolFailure(new Error('Library Worker sent a malformed response.', { cause: error }));
      return;
    }

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
