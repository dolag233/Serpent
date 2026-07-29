import type { AutomationWorkerClient } from '../automation/command-gateway';
import type { WorkerCommand } from '../shared/protocol/requests';
import type { WorkerResult } from '../shared/protocol/responses';

export interface AutomationWorkerRequester {
  request(
    command: WorkerCommand,
    options?: { dispatch?: 'automation-readonly' },
  ): Promise<WorkerResult>;
}

/**
 * The only production bridge from Gateway to the Library Worker. Read commands
 * use the fail-closed automation dispatcher, so list/search cannot trigger
 * desktop thumbnail scheduling or other background writes. Approved metadata
 * writes intentionally enter the normal Worker command path, where their
 * bounded-write lease and transaction fence are already enforced.
 */
export class AutomationLibraryWorkerAdapter implements AutomationWorkerClient {
  constructor(private readonly workerClient: AutomationWorkerRequester) {}

  request(
    command: WorkerCommand,
    options: { signal?: AbortSignal; readonly?: boolean } = {},
  ): Promise<WorkerResult> {
    if (options.signal?.aborted) return Promise.reject(new Error('Automation execution cancelled before Worker dispatch.'));
    const request = options.readonly
      ? this.workerClient.request(command, { dispatch: 'automation-readonly' })
      : this.workerClient.request(command);
    if (options.signal === undefined) return request;

    return new Promise<WorkerResult>((resolve, reject) => {
      const abort = () => reject(new Error('Automation execution cancelled while awaiting Worker response.'));
      options.signal?.addEventListener('abort', abort, { once: true });
      request.then(
        (result) => {
          options.signal?.removeEventListener('abort', abort);
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
