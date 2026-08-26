import {
  chmodSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';

/**
 * Serpent-65d837: UserData store of library roots that were renamed aside
 * (`.del-*`) but could not be deleted while a Windows handle (Chromium
 * `serpent://` stream, Defender scan, Explorer) was still open. Main owns this
 * store; the Library Worker owns the actual file deletion via
 * `system.cleanup-pending-deletions`. Entries are removed again once cleanup
 * succeeds, so a leftover aside is never silently forgotten.
 */

export type ErrorSink = (error: unknown) => void;

interface PendingCleanupFileV1 {
  version: 1;
  asidePaths: string[];
}

const MAX_PENDING_ASIDE_PATHS = 64;

function parsePendingCleanupFile(contents: string): PendingCleanupFileV1 | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Partial<PendingCleanupFileV1>;
  if (record.version !== 1 || !Array.isArray(record.asidePaths)) return null;
  const asidePaths = record.asidePaths
    .filter((value): value is string => typeof value === 'string' && value.includes('.del-'))
    .slice(0, MAX_PENDING_ASIDE_PATHS);
  return { version: 1, asidePaths: [...new Set(asidePaths)] };
}

function readPendingCleanupFile(filePath: string, onError?: ErrorSink): PendingCleanupFileV1 | null {
  try {
    return parsePendingCleanupFile(readFileSync(filePath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') onError?.(error);
    return null;
  }
}

function writePendingCleanupFile(
  filePath: string,
  data: PendingCleanupFileV1,
  onError?: ErrorSink,
): boolean {
  const temporary = `${filePath}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(data), {
      encoding: 'utf8',
      mode: 0o600,
      flush: true,
    });
    renameSync(temporary, filePath);
    chmodSync(filePath, 0o600);
    return true;
  } catch (error) {
    onError?.(error);
    try {
      unlinkSync(temporary);
    } catch {
      // Best-effort cleanup; the original write failure is already reported.
    }
    return false;
  }
}

/** Lists aside paths that still await deferred deletion. */
export function readPendingCleanupAsidePaths(
  filePath: string,
  onError?: ErrorSink,
): string[] {
  return readPendingCleanupFile(filePath, onError)?.asidePaths ?? [];
}

/** Replaces the whole pending set (caller computes added/removed entries). */
export function writePendingCleanupAsidePaths(
  filePath: string,
  asidePaths: string[],
  onError?: ErrorSink,
): boolean {
  return writePendingCleanupFile(
    filePath,
    { version: 1, asidePaths: [...new Set(asidePaths)].slice(0, MAX_PENDING_ASIDE_PATHS) },
    onError,
  );
}
