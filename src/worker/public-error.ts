import {
  createPublicError,
  toPublicError,
  type PublicError,
} from '../shared/protocol/errors';
import { LibraryServiceError } from './library-service';
import { LibraryWriteCoordinatorError } from './library-write-coordinator';

export function publicErrorForWorkerFailure(error: unknown): PublicError {
  if (error instanceof LibraryWriteCoordinatorError) {
    return createPublicError(error.code);
  }
  if (error instanceof LibraryServiceError) {
    try {
      return createPublicError(
        error.code,
        error.reason,
        error.currentEntityVersion,
      );
    } catch {
      // A malformed internal error must never turn failure reporting into a
      // second Worker protocol failure or expose validation diagnostics.
      return toPublicError(error);
    }
  }
  return toPublicError(error);
}
