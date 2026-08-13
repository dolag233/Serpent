import { renameSync, rmSync } from 'node:fs';

/**
 * Bounded synchronous retries for Windows directory operations.
 *
 * On Windows directory renames and removals fail with EPERM/EBUSY/ENOTEMPTY
 * while the tree (or anything inside it) is held open — Explorer showing the
 * folder, Windows Defender scanning just-moved files, a thumbnail pass, a
 * player. Many of those locks clear within a few hundred milliseconds, but
 * the folder-trash core is synchronous, so the bare fs calls have no retry
 * of their own.
 *
 * The retries are deliberately synchronous (Atomics.wait) to keep the
 * folder-trash transaction a single blocking operation; the Library Worker
 * event loop is already blocked for the whole synchronous trash, and the
 * lock holder is an external process, so pending in-worker work is not what
 * needs to run between attempts.
 */

const DEFAULT_RETRY_LIMIT = 4;
const DEFAULT_RETRY_DELAY_MS = 150;

export function isRetryableRenameError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  return error.code === 'EBUSY' || error.code === 'EPERM' || error.code === 'EACCES';
}

/** Recursive removals also fail ENOTEMPTY while a child handle lingers. */
function isRetryableRemoveError(error: unknown): boolean {
  return (
    isRetryableRenameError(error) ||
    (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOTEMPTY')
  );
}

function blockingWait(milliseconds: number): void {
  const buffer = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buffer, 0, 0, milliseconds);
}

export interface RenameWithRetryOptions {
  renameFn?: (from: string, to: string) => void;
  waitFn?: (milliseconds: number) => void;
  retryLimit?: number;
  retryDelayMs?: number;
}

/**
 * Rename `source` to `target`, retrying transient Windows locks with a short
 * backoff. Non-retryable errors (ENOENT, …) propagate immediately; the final
 * retryable failure propagates as-is so the caller's error mapping
 * (serviceError / publicReasonFromError) still sees the original code.
 */
export function renamePathWithRetry(
  sourcePath: string,
  targetPath: string,
  options: RenameWithRetryOptions = {},
): void {
  const renameFn = options.renameFn ?? renameSync;
  const waitFn = options.waitFn ?? blockingWait;
  const retryLimit = options.retryLimit ?? DEFAULT_RETRY_LIMIT;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  for (let attempt = 0; ; attempt += 1) {
    try {
      renameFn(sourcePath, targetPath);
      return;
    } catch (error) {
      if (!isRetryableRenameError(error) || attempt >= retryLimit) {
        throw error;
      }
      waitFn(retryDelayMs * (attempt + 1));
    }
  }
}

export interface RemoveWithRetryOptions {
  rmFn?: (path: string, options: { force: boolean; recursive: boolean }) => void;
  waitFn?: (milliseconds: number) => void;
  retryLimit?: number;
  retryDelayMs?: number;
}

/**
 * Recursively remove `targetPath`, retrying transient Windows locks. Used by
 * operation-directory cleanup: a Defender scan of just-moved staged files
 * makes `rmSync(..., { recursive: true })` throw ENOTEMPTY for a moment, and
 * the caller should treat that as retryable rather than a permanent failure.
 */
export function removePathWithSyncRetry(
  targetPath: string,
  options: RemoveWithRetryOptions = {},
): void {
  const rmFn = options.rmFn ?? ((path, rmOptions) => rmSync(path, rmOptions));
  const waitFn = options.waitFn ?? blockingWait;
  const retryLimit = options.retryLimit ?? DEFAULT_RETRY_LIMIT;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  for (let attempt = 0; ; attempt += 1) {
    try {
      rmFn(targetPath, { force: true, recursive: true });
      return;
    } catch (error) {
      if (!isRetryableRemoveError(error) || attempt >= retryLimit) {
        throw error;
      }
      waitFn(retryDelayMs * (attempt + 1));
    }
  }
}
