import { randomUUID } from 'node:crypto';

import { utilityProcess, type UtilityProcess } from 'electron';

import type { WorkerCommand } from '../shared/protocol/requests';
import {
  parseWorkerControlMessage,
  parseAssetChangeEvent,
  parseWorkerReadyMessage,
  parseWorkerResponse,
  type WorkerResult,
  type AssetChangeEvent,
} from '../shared/protocol/responses';

interface PendingRequest {
  resolve(result: WorkerResult): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const READY_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 15_000;
const FILE_OPERATION_TIMEOUT_MS = 5 * 60_000;
const SHUTDOWN_TIMEOUT_MS = 2_000;

export class LibraryWorkerClient {
  readonly #modulePath: string;
  #child: UtilityProcess | undefined;
  #ready = false;
  #pending = new Map<string, PendingRequest>();
  #shutdownAck: (() => void) | undefined;
  #assetChangeListeners = new Set<(event: AssetChangeEvent) => void>();

  constructor(modulePath: string) {
    this.#modulePath = modulePath;
  }

  async start(): Promise<void> {
    if (this.#child) throw new Error('Library Worker has already been started.');

    const child = utilityProcess.fork(this.#modulePath, [], {
      serviceName: 'Serpent Library Worker',
      stdio: 'ignore',
    });
    this.#child = child;
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
      const timeout = command.type.startsWith('asset.import.') || command.type === 'asset.refresh'
        ? FILE_OPERATION_TIMEOUT_MS
        : REQUEST_TIMEOUT_MS;
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
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

  async shutdown(): Promise<void> {
    const child = this.#child;
    if (!child) return;

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
      this.#protocolFailure(new Error('Library Worker response has no matching request.'));
      return;
    }

    clearTimeout(pending.timer);
    this.#pending.delete(response.requestId);
    pending.resolve(response.result);
  };

  readonly #onExit = (code: number) => {
    this.#ready = false;
    this.#child = undefined;
    this.#rejectAll(new Error(`Library Worker exited (${code}).`));
  };

  #protocolFailure(error: Error): void {
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
