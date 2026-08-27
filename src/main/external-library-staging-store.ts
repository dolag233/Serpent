import {
  chmodSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { isManagedExternalLibraryStagingPath } from './disk-free-space';

export type ErrorSink = (error: unknown) => void;

interface ExternalLibraryStagingFileV1 {
  version: 1;
  roots: string[];
}

const MAX_STAGING_ROOTS = 32;

function parseStagingFile(contents: string): ExternalLibraryStagingFileV1 | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Partial<ExternalLibraryStagingFileV1>;
  if (record.version !== 1 || !Array.isArray(record.roots)) return null;
  const roots = record.roots
    .filter((value): value is string => (
      typeof value === 'string'
      && path.isAbsolute(value)
      && isManagedExternalLibraryStagingPath(value)
    ))
    .slice(0, MAX_STAGING_ROOTS);
  return { version: 1, roots: [...new Set(roots)] };
}

function readStagingFile(filePath: string, onError?: ErrorSink): ExternalLibraryStagingFileV1 | null {
  try {
    return parseStagingFile(readFileSync(filePath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') onError?.(error);
    return null;
  }
}

function writeStagingFile(
  filePath: string,
  data: ExternalLibraryStagingFileV1,
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

export function readExternalLibraryStagingRoots(
  filePath: string,
  onError?: ErrorSink,
): string[] {
  return readStagingFile(filePath, onError)?.roots ?? [];
}

export function writeExternalLibraryStagingRoots(
  filePath: string,
  roots: string[],
  onError?: ErrorSink,
): boolean {
  return writeStagingFile(
    filePath,
    {
      version: 1,
      roots: [...new Set(roots)]
        .filter((value) => path.isAbsolute(value) && isManagedExternalLibraryStagingPath(value))
        .slice(0, MAX_STAGING_ROOTS),
    },
    onError,
  );
}
