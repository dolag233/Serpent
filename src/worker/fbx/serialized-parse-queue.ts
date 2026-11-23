import { Worker } from 'node:worker_threads';

export const SERPENT_UFBX_PARSE_PROTOCOL = 'serpent-ufbx-parse-v1';

export interface UfbxWorkerPort {
  on(event: 'message', listener: (message: unknown) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'exit', listener: (code: number) => void): this;
  removeListener(event: 'message', listener: (message: unknown) => void): this;
  removeListener(event: 'error', listener: (error: Error) => void): this;
  removeListener(event: 'exit', listener: (code: number) => void): this;
  postMessage(message: unknown, transferList?: readonly ArrayBuffer[]): void;
  terminate(): Promise<number>;
}

export interface SerializedFbxParseInput {
  fbxBytes: Buffer;
  filename: string;
  maxTriangles: number;
  ufbxDir: string;
}

type WorkerFactory = (workerSource: string) => UfbxWorkerPort;

interface ParseRequest {
  protocol: typeof SERPENT_UFBX_PARSE_PROTOCOL;
  id: number;
  fbxBytes: ArrayBuffer;
  filename: string;
  maxTriangles: number;
  ufbxDir: string;
}

interface ParseSuccess {
  protocol: typeof SERPENT_UFBX_PARSE_PROTOCOL;
  id: number;
  status: 'ok';
  buffer: ArrayBuffer;
}

type WorkerErrorField = string | number;

interface PendingParse {
  id: number;
  input: SerializedFbxParseInput;
  signal?: AbortSignal;
  resolve: (buffer: Buffer) => void;
  reject: (error: unknown) => void;
  abortListener?: () => void;
  state: 'queued' | 'active' | 'settled';
}

interface ActiveParse {
  task: PendingParse;
  worker: UfbxWorkerPort;
  messageListener: (message: unknown) => void;
  errorListener: (error: Error) => void;
  exitListener: (code: number) => void;
  response?: ParseSuccess;
  failure?: unknown;
  exitCode?: number;
  terminateRequested: boolean;
  finished: boolean;
}

function defaultWorkerFactory(workerSource: string): UfbxWorkerPort {
  // Worker accepts source text in eval mode, which lets Vite bundle the CJS
  // bootstrap into the owning Library Worker instead of resolving a source file
  // at runtime.
  return new Worker(workerSource, { eval: true }) as unknown as UfbxWorkerPort;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('FBX conversion aborted.');
}

/**
 * Runs one synchronous ufbx/WASM parse at a time. A task is not settled and the
 * next worker is not started until the current worker thread has exited.
 */
export class SerializedFbxParseQueue {
  private readonly queued: PendingParse[] = [];
  private active: ActiveParse | null = null;
  private nextId = 1;

  constructor(
    private readonly workerSource: string,
    private readonly workerFactory: WorkerFactory = defaultWorkerFactory,
  ) {}

  parse(input: SerializedFbxParseInput, signal?: AbortSignal): Promise<Buffer> {
    if (signal?.aborted) return Promise.reject(abortReason(signal));

    return new Promise<Buffer>((resolve, reject) => {
      const task: PendingParse = {
        id: this.nextId++,
        input,
        ...(signal === undefined ? {} : { signal }),
        resolve,
        reject,
        state: 'queued',
      };
      if (signal) {
        task.abortListener = () => this.abort(task);
        signal.addEventListener('abort', task.abortListener, { once: true });
      }
      if (signal?.aborted) {
        this.abort(task);
        return;
      }
      this.queued.push(task);
      this.pump();
    });
  }

  private abort(task: PendingParse): void {
    if (task.state === 'settled') return;
    const reason = task.signal ? abortReason(task.signal) : new Error('FBX conversion aborted.');
    if (task.state === 'queued') {
      const index = this.queued.indexOf(task);
      if (index >= 0) this.queued.splice(index, 1);
      this.settleTask(task, undefined, reason);
      return;
    }
    if (this.active?.task === task) this.stopActive(this.active, reason);
  }

  private pump(): void {
    if (this.active) return;
    const task = this.queued.shift();
    if (!task) return;
    if (task.signal?.aborted) {
      this.settleTask(task, undefined, abortReason(task.signal));
      this.pump();
      return;
    }

    let worker: UfbxWorkerPort;
    try {
      worker = this.workerFactory(this.workerSource);
    } catch (error) {
      this.settleTask(task, undefined, error ?? new Error('Unable to create UFBX parser worker.'));
      this.pump();
      return;
    }

    task.state = 'active';
    const active: ActiveParse = {
      task,
      worker,
      messageListener: () => undefined,
      errorListener: () => undefined,
      exitListener: () => undefined,
      terminateRequested: false,
      finished: false,
    };
    active.messageListener = (message) => this.onMessage(active, message);
    active.errorListener = (error) => this.stopActive(active, error);
    active.exitListener = (code) => this.onExit(active, code);
    this.active = active;
    try {
      worker.on('message', active.messageListener);
      worker.on('error', active.errorListener);
      worker.on('exit', active.exitListener);
    } catch (error) {
      this.stopActive(active, error ?? new Error('Unable to listen to UFBX parser worker.'));
      return;
    }

    if (task.signal?.aborted) {
      this.abort(task);
      return;
    }

    try {
      // Transfer a dedicated copy so the caller's Buffer (which may be a view
      // into a larger slab) remains attached and unchanged.
      const inputBytes = new Uint8Array(task.input.fbxBytes.byteLength);
      inputBytes.set(task.input.fbxBytes);
      const request: ParseRequest = {
        protocol: SERPENT_UFBX_PARSE_PROTOCOL,
        id: task.id,
        fbxBytes: inputBytes.buffer,
        filename: task.input.filename,
        maxTriangles: task.input.maxTriangles,
        ufbxDir: task.input.ufbxDir,
      };
      worker.postMessage(request, [inputBytes.buffer]);
    } catch (error) {
      this.stopActive(active, error ?? new Error('Unable to send UFBX parser request.'));
    }
  }

  private onMessage(active: ActiveParse, value: unknown): void {
    if (this.active !== active || active.finished || active.failure !== undefined) return;
    if (!isRecord(value) || value['protocol'] !== SERPENT_UFBX_PARSE_PROTOCOL ||
      value['id'] !== active.task.id) {
      this.stopActive(active, new Error('UFBX parser worker returned an invalid response envelope.'));
      return;
    }
    if (value['status'] === 'error') {
      const message = value['message'];
      const hasCode = Object.prototype.hasOwnProperty.call(value, 'code');
      const hasErrno = Object.prototype.hasOwnProperty.call(value, 'errno');
      if (
        typeof message !== 'string' ||
        (hasCode && !isWorkerErrorField(value['code'])) ||
        (hasErrno && !isWorkerErrorField(value['errno']))
      ) {
        this.stopActive(active, new Error('UFBX parser worker returned an invalid error response.'));
        return;
      }
      const workerError = new Error(message) as Error & {
        code?: WorkerErrorField;
        errno?: WorkerErrorField;
      };
      if (hasCode) workerError.code = value['code'] as WorkerErrorField;
      if (hasErrno) workerError.errno = value['errno'] as WorkerErrorField;
      this.stopActive(active, workerError);
      return;
    }
    if (value['status'] !== 'ok' || !(value['buffer'] instanceof ArrayBuffer) || value['buffer'].byteLength === 0) {
      this.stopActive(active, new Error('UFBX parser worker returned an invalid result.'));
      return;
    }
    if (active.response) {
      this.stopActive(active, new Error('UFBX parser worker returned duplicate responses.'));
      return;
    }
    active.response = value as unknown as ParseSuccess;
  }

  private stopActive(active: ActiveParse, error: unknown): void {
    if (this.active !== active || active.finished) return;
    active.failure ??= error ?? new Error('UFBX parser worker failed.');
    if (active.terminateRequested) return;
    active.terminateRequested = true;
    try {
      void active.worker.terminate().then(
        (code) => this.onExit(active, code),
        () => {
          // Keep waiting for the exit event: settlement is an exit barrier.
        },
      );
    } catch {
      // Same barrier: the worker's exit event remains authoritative.
    }
  }

  private onExit(active: ActiveParse, code: number): void {
    if (this.active !== active || active.finished) return;
    active.exitCode = code;
    active.finished = true;
    active.worker.removeListener('message', active.messageListener);
    active.worker.removeListener('error', active.errorListener);
    active.worker.removeListener('exit', active.exitListener);
    const { task } = active;
    if (task.signal && task.abortListener) {
      task.signal.removeEventListener('abort', task.abortListener);
    }
    task.state = 'settled';
    this.active = null;

    if (active.failure !== undefined) {
      task.reject(active.failure);
    } else if (code !== 0) {
      task.reject(new Error(`UFBX parser worker exited with code ${code}.`));
    } else if (!active.response) {
      task.reject(new Error('UFBX parser worker exited before returning a result.'));
    } else {
      task.resolve(Buffer.from(active.response.buffer));
    }
    this.pump();
  }

  private settleTask(task: PendingParse, buffer?: Buffer, error?: unknown): void {
    if (task.state === 'settled') return;
    task.state = 'settled';
    if (task.signal && task.abortListener) {
      task.signal.removeEventListener('abort', task.abortListener);
    }
    if (error !== undefined) task.reject(error);
    else task.resolve(buffer ?? Buffer.alloc(0));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWorkerErrorField(value: unknown): value is WorkerErrorField {
  return (typeof value === 'string' && value.length <= 64) ||
    (typeof value === 'number' && Number.isSafeInteger(value));
}
