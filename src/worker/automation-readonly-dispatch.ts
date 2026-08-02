import { createPublicError } from '../shared/protocol/errors';
import type { WorkerRequest } from '../shared/protocol/requests';
import type { WorkerResult } from '../shared/protocol/responses';
import { executeAutomationReadOnlyWorkerCommand } from './automation-readonly-command-executor';
import type { LibraryService } from './library-service';

/**
 * Returns undefined only for normal desktop requests. Once a request declares
 * the automation dispatch, it is always handled here and fails closed rather
 * than falling through to the desktop switch in worker/index.ts.
 */
export function dispatchAutomationReadOnlyRequest(
  libraryService: LibraryService,
  request: WorkerRequest,
): WorkerResult | undefined {
  if (request.dispatch !== 'automation-readonly') return undefined;
  return executeAutomationReadOnlyWorkerCommand(libraryService, request.command) ?? {
    ok: false,
    error: createPublicError('INTERNAL_ERROR'),
  };
}
