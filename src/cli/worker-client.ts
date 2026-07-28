import { randomUUID } from 'node:crypto';
import { fork, type ChildProcess } from 'node:child_process';

import type { AppLogger } from '../main/app-logger';
import type { WorkerCommand } from '../shared/protocol/requests';
import {
  parseWorkerResponse,
  type WorkerResult,
} from '../shared/protocol/responses';

const REQUEST_TIMEOUT_MS = 20_000;

export class CliWorkerClient {
  readonly #child: ChildProcess;
  readonly #logger: AppLogger;

  constructor(workerPath: string, logger: AppLogger) {
    this.#logger = logger;
    this.#child = fork(workerPath, [], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: process.env,
    });
    this.#child.stdout?.on('data', (chunk) => logger.worker('stdout', chunk));
    this.#child.stderr?.on('data', (chunk) => logger.worker('stderr', chunk));
    this.#child.on('error', (error) => logger.error('cli.worker', error));
  }

  request(command: WorkerCommand): Promise<WorkerResult> {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`CLI Worker request timed out (${requestId}).`));
      }, REQUEST_TIMEOUT_MS);
      timer.unref();

      const onMessage = (message: unknown) => {
        let response;
        try {
          response = parseWorkerResponse(message);
        } catch {
          return;
        }
        if (response.requestId !== requestId) return;
        cleanup();
        resolve(response.result);
      };
      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        cleanup();
        reject(new Error(
          `CLI Worker exited before responding (code=${String(code)}, signal=${String(signal)}).`,
        ));
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.#child.off('message', onMessage);
        this.#child.off('exit', onExit);
      };

      this.#child.on('message', onMessage);
      this.#child.once('exit', onExit);
      this.#child.send({ requestId, command }, (error) => {
        if (!error) return;
        cleanup();
        this.#logger.error('cli.worker.send', error, { requestId, commandType: command.type });
        reject(error);
      });
    });
  }

  async close(): Promise<void> {
    if (!this.#child.connected) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.#child.kill();
        resolve();
      }, 2_000);
      timer.unref();
      this.#child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      this.#child.send({ type: 'worker.shutdown' });
    });
  }
}
