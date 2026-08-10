import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const WINDOWS_REPLACE_ERROR_CODES = new Set(['EEXIST', 'EPERM', 'ENOTEMPTY']);

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined;
}

function backupFilename(filename: string): string {
  return `${filename}.bak`;
}

function temporaryFilename(filename: string): string {
  return `${filename}.${process.pid}.${randomUUID()}.tmp`;
}

/**
 * Repairs the only crash window that cannot be handled by rename alone on
 * Windows: the destination may have been moved aside immediately before the
 * process stopped. The writer is Main-owned, so a stable backup is safe here.
 */
export function recoverAtomicJsonFile(filename: string): void {
  const backup = backupFilename(filename);
  if (!existsSync(filename) && existsSync(backup)) {
    renameSync(backup, filename);
    return;
  }
  if (existsSync(filename) && existsSync(backup)) {
    unlinkSync(backup);
  }
}

export function readAtomicJsonFile(filename: string): string | undefined {
  recoverAtomicJsonFile(filename);
  if (!existsSync(filename)) return undefined;
  return readFileSync(filename, 'utf8');
}

/**
 * Persist a small Main-owned JSON document without an unlink-before-rename
 * gap. POSIX replaces the destination atomically. Windows may reject a
 * replacement rename, so the destination is first moved to a recoverable
 * backup and restored if the second rename fails.
 */
export function writeAtomicJsonFile(filename: string, contents: string): void {
  const directory = path.dirname(filename);
  const backup = backupFilename(filename);
  const temporary = temporaryFilename(filename);
  mkdirSync(directory, { recursive: true });
  recoverAtomicJsonFile(filename);

  try {
    writeFileSync(temporary, contents, {
      encoding: 'utf8',
      mode: 0o600,
      flush: true,
    });
    try {
      renameSync(temporary, filename);
    } catch (error) {
      if (!WINDOWS_REPLACE_ERROR_CODES.has(String(errorCode(error))) || !existsSync(filename)) {
        throw error;
      }
      renameSync(filename, backup);
      try {
        renameSync(temporary, filename);
      } catch (replaceError) {
        try {
          renameSync(backup, filename);
        } catch (restoreError) {
          throw new Error('The JSON file could not be restored after replacement failed.', {
            cause: restoreError,
          });
        }
        throw replaceError;
      }
      try {
        unlinkSync(backup);
      } catch {
        // The next read/write recovers the stale backup after a successful replace.
      }
    }
    chmodSync(filename, 0o600);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // Preserve the original persistence error.
    }
    throw error;
  }
}
