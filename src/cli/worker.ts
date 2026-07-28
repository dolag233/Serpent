import { parseWorkerRequest } from '../shared/protocol/requests';
import type { WorkerResponse } from '../shared/protocol/responses';
import { LibraryService } from '../worker/library-service';
import { publicErrorForWorkerFailure } from '../worker/public-error';
import {
  executeReadOnlyWorkerCommand,
  isReadOnlyWorkerCommand,
} from '../worker/read-only-command-executor';

const service = new LibraryService({
  onDiagnostic: ({ scope, error, context }) => {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      scope: `cli.worker.${scope}`,
      context,
      error: serializeError(error),
    }));
  },
});

function serializeError(error: unknown, depth = 0): unknown {
  if (depth > 5) return { truncated: true };
  if (!(error instanceof Error)) return { value: String(error) };
  return {
    name: error.name,
    message: error.message,
    code: 'code' in error && typeof error.code === 'string' ? error.code : undefined,
    stack: error.stack,
    cause: error.cause === undefined ? undefined : serializeError(error.cause, depth + 1),
  };
}

function requestIdFrom(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null || !('requestId' in input)) {
    return undefined;
  }
  const requestId = input.requestId;
  return typeof requestId === 'string' && requestId.length > 0 && requestId.length <= 255
    ? requestId
    : undefined;
}

process.on('message', async (input: unknown) => {
  if (
    typeof input === 'object'
    && input !== null
    && 'type' in input
    && input.type === 'worker.shutdown'
  ) {
    service.closeAll();
    process.disconnect?.();
    return;
  }

  const requestId = requestIdFrom(input);
  if (!requestId) return;

  let response: WorkerResponse;
  try {
    const request = parseWorkerRequest(input);
    if (!isReadOnlyWorkerCommand(request.command)) {
      throw new Error(`CLI Worker rejected mutating command ${request.command.type}.`);
    }
    const result = await executeReadOnlyWorkerCommand(service, request.command);
    if (!result) throw new Error(`CLI Worker could not dispatch ${request.command.type}.`);
    response = { requestId, result };
  } catch (error) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      scope: 'cli.worker.request',
      requestId,
      error: serializeError(error),
    }));
    response = {
      requestId,
      result: { ok: false, error: publicErrorForWorkerFailure(error) },
    };
  }
  process.send?.(response);
});
