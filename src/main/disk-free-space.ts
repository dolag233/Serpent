import { lstat, mkdir, statfs } from 'node:fs/promises';
import path from 'node:path';

export const EXTERNAL_LIBRARY_STAGING_PREFIX = 'serpent-external-library-';
export const EXTRACT_HEADROOM_RATIO = 0.1;
export const EXTRACT_HEADROOM_MIN_BYTES = 64 * 1024 * 1024;
const NON_ZIP_SIZE_MULTIPLIER = 3;

export function errorHasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === code
  );
}

export function isRetryableDirectoryRemoveError(error: unknown): boolean {
  return (
    errorHasCode(error, 'EBUSY')
    || errorHasCode(error, 'EPERM')
    || errorHasCode(error, 'EACCES')
    || errorHasCode(error, 'ENOTEMPTY')
  );
}

export function isInsufficientSpaceError(error: unknown): boolean {
  return errorHasCode(error, 'ENOSPC') || errorHasCode(error, 'EDQUOT');
}

export function isStagingPermissionError(error: unknown): boolean {
  return (
    errorHasCode(error, 'EACCES')
    || errorHasCode(error, 'EPERM')
    || errorHasCode(error, 'EROFS')
  );
}

export function requiredStagingBytes(estimatedUncompressedBytes: number): number {
  if (!Number.isFinite(estimatedUncompressedBytes) || estimatedUncompressedBytes < 0) {
    return EXTRACT_HEADROOM_MIN_BYTES;
  }
  return estimatedUncompressedBytes + Math.max(
    Math.ceil(estimatedUncompressedBytes * EXTRACT_HEADROOM_RATIO),
    EXTRACT_HEADROOM_MIN_BYTES,
  );
}

export function estimateNonZipExtractBytes(archiveBytes: number): number {
  if (!Number.isFinite(archiveBytes) || archiveBytes < 0) return EXTRACT_HEADROOM_MIN_BYTES;
  return archiveBytes * NON_ZIP_SIZE_MULTIPLIER;
}

export function isManagedExternalLibraryStagingPath(directoryPath: string): boolean {
  return path.basename(directoryPath).startsWith(EXTERNAL_LIBRARY_STAGING_PREFIX);
}

export async function existingAncestor(targetPath: string): Promise<string> {
  let current = path.resolve(targetPath);
  for (;;) {
    try {
      await lstat(current);
      return current;
    } catch (error) {
      if (!errorHasCode(error, 'ENOENT')) throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

export async function probeFreeBytes(directoryPath: string): Promise<number | undefined> {
  try {
    const existing = await existingAncestor(directoryPath);
    const stats = await statfs(existing);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    if (!Number.isFinite(freeBytes) || freeBytes < 0) return undefined;
    return freeBytes;
  } catch {
    return undefined;
  }
}

export async function volumeKey(targetPath: string): Promise<string> {
  const existing = await existingAncestor(targetPath);
  if (process.platform === 'win32') {
    return path.parse(existing).root.replaceAll('/', '\\').toUpperCase();
  }
  const stats = await lstat(existing);
  return `dev:${stats.dev}`;
}

export async function pathsShareVolume(leftPath: string, rightPath: string): Promise<boolean> {
  try {
    return (await volumeKey(leftPath)) === (await volumeKey(rightPath));
  } catch {
    return false;
  }
}

export async function listExternalLibraryStagingParents(input: {
  readonly preferredParent: string;
  readonly fallbackParent?: string;
  readonly requiredBytes: number;
  readonly probeFreeBytes?: (directoryPath: string) => Promise<number | undefined>;
  readonly pathsShareVolume?: (leftPath: string, rightPath: string) => Promise<boolean>;
}): Promise<{
  readonly parents: string[];
  readonly skippedPreferredForSpace: boolean;
}> {
  const probe = input.probeFreeBytes ?? probeFreeBytes;
  const shareVolume = input.pathsShareVolume ?? pathsShareVolume;
  const preferredParent = path.resolve(input.preferredParent);
  const fallbackParent = input.fallbackParent === undefined
    ? undefined
    : path.resolve(input.fallbackParent);

  const preferredFree = await probe(preferredParent);
  const preferredFits = preferredFree === undefined || preferredFree >= input.requiredBytes;
  const parents: string[] = [];
  if (preferredFits) parents.push(preferredParent);

  if (fallbackParent !== undefined && fallbackParent !== preferredParent) {
    const sameVolume = await shareVolume(preferredParent, fallbackParent);
    if (!sameVolume) {
      const fallbackFree = await probe(fallbackParent);
      const fallbackFits = fallbackFree === undefined || fallbackFree >= input.requiredBytes;
      if (fallbackFits) parents.push(fallbackParent);
    }
  }

  return {
    parents,
    skippedPreferredForSpace: !preferredFits,
  };
}

export async function ensureStagingParent(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, { recursive: true });
}
