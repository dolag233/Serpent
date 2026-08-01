import type { AutomationWorkerClient } from '../automation/command-gateway';
import type { WorkerCommand } from '../shared/protocol/requests';
import type { WorkerResult } from '../shared/protocol/responses';

export interface AutomationWorkerRequester {
  request(
    command: WorkerCommand,
    options?: { dispatch?: 'automation-readonly' },
  ): Promise<WorkerResult>;
}

export interface AutomationLibraryWorkerAdapterOptions {
  /**
   * Main-owned callback for starting the AI queue after a successful enqueue.
   * The callback is deliberately fire-and-forget: a scheduler failure cannot
   * turn an already committed enqueue into a failed automation result.
   */
  readonly onAiEnqueued?: (libraryId: string) => void | Promise<void>;
  readonly onAiEnqueueError?: (error: unknown, libraryId: string) => void;
}

/**
 * The only production bridge from Gateway to the Library Worker. Read commands
 * use the fail-closed automation dispatcher, so list/search cannot trigger
 * desktop thumbnail scheduling or other background writes. Approved metadata
 * writes intentionally enter the normal Worker command path, where their
 * bounded-write lease and transaction fence are already enforced.
 */
export class AutomationLibraryWorkerAdapter implements AutomationWorkerClient {
  constructor(
    private readonly workerClient: AutomationWorkerRequester,
    private readonly options: AutomationLibraryWorkerAdapterOptions = {},
  ) {}

  private reportAiEnqueueError(error: unknown, libraryId: string): void {
    try {
      this.options.onAiEnqueueError?.(error, libraryId);
    } catch {
      // Error reporting must not turn an already committed enqueue into a
      // rejected automation result.
    }
  }

  private observeAiEnqueue(
    command: WorkerCommand,
    result: WorkerResult,
    options: { signal?: AbortSignal; readonly?: boolean },
  ): void {
    if (
      options.readonly
      || options.signal?.aborted
      || command.type !== 'ai.enqueue-analysis'
      || !result.ok
      || result.type !== 'ai.jobs.enqueued'
      || (result.enqueued === 0 && result.alreadyPendingJobIds.length === 0)
      || this.options.onAiEnqueued === undefined
    ) {
      return;
    }
    try {
      const pending = this.options.onAiEnqueued(command.libraryId);
      if (pending !== undefined) {
        void pending.catch((error: unknown) => {
          this.reportAiEnqueueError(error, command.libraryId);
        });
      }
    } catch (error) {
      this.reportAiEnqueueError(error, command.libraryId);
    }
  }

  request(
    command: WorkerCommand,
    options: { signal?: AbortSignal; readonly?: boolean } = {},
  ): Promise<WorkerResult> {
    if (options.signal?.aborted) return Promise.reject(new Error('Automation execution cancelled before Worker dispatch.'));
    const request = options.readonly
      ? this.workerClient.request(command, { dispatch: 'automation-readonly' })
      : this.workerClient.request(command);
    if (options.signal === undefined) {
      return request.then((result) => {
        this.observeAiEnqueue(command, result, options);
        return result;
      });
    }

    return new Promise<WorkerResult>((resolve, reject) => {
      const abort = () => reject(new Error('Automation execution cancelled while awaiting Worker response.'));
      options.signal?.addEventListener('abort', abort, { once: true });
      request.then(
        (result) => {
          options.signal?.removeEventListener('abort', abort);
          this.observeAiEnqueue(command, result, options);
          resolve(result);
        },
        (error: unknown) => {
          options.signal?.removeEventListener('abort', abort);
          reject(error);
        },
      );
    });
  }
}
