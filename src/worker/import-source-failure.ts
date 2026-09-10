import path from 'node:path';

import type { PublicErrorReason } from '../shared/protocol/errors';
import { publicErrorReasonSchema } from '../shared/protocol/errors';
import type { ImportSourceFailurePlan } from '../shared/protocol/responses';

export type SkippedImportSource = {
  displayName: string;
  reason?: PublicErrorReason;
};

export class ImportSourceFailurePause<T = unknown> {
  readonly kind = 'import-source-failure-pause' as const;
  constructor(
    readonly failed: SkippedImportSource[],
    readonly stagedEntries: T[],
    readonly remainingEntries: T[],
    readonly skipped: SkippedImportSource[],
  ) {}
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function errorReason(error: unknown): PublicErrorReason | undefined {
  if (typeof error !== 'object' || error === null || !('reason' in error)) return undefined;
  const parsed = publicErrorReasonSchema.safeParse(error.reason);
  return parsed.success ? parsed.data : undefined;
}

export function importSourceDisplayName(sourcePath: string): string {
  const base = path.basename(sourcePath).replace(/[/\\]/g, '').trim();
  if (base.length === 0) return 'file';
  return base.length > 255 ? base.slice(0, 255) : base;
}

export function isBatchAbortingImportSourceFailure(error: unknown): boolean {
  const code = errorCode(error);
  const reason = errorReason(error);
  if (code === 'CANCELLED' || code === 'DISK_FULL') return true;
  if (code === 'ENOSPC' || code === 'EDQUOT' || code === 'EROFS' || code === 'ENAMETOOLONG') {
    return true;
  }
  if (code === 'IMPORT_APPLY_FAILED') {
    return reason === 'DISK_FULL'
      || reason === 'PATH_LIMIT_EXCEEDED'
      || reason === 'NAME_NOT_SUPPORTED';
  }
  if (code === 'INVALID_IMPORT_SOURCE') {
    return reason === 'ROOT_NOT_ALLOWED'
      || reason === 'NAME_NOT_SUPPORTED'
      || reason === 'DISK_FULL'
      || reason === 'PATH_LIMIT_EXCEEDED'
      || reason === 'READ_ONLY_FILESYSTEM';
  }
  return false;
}

export function isSkippableImportSourceFailure(error: unknown): boolean {
  if (isBatchAbortingImportSourceFailure(error)) return false;
  const code = errorCode(error);
  if (code === 'INVALID_IMPORT_SOURCE') return true;
  return code === 'ENOENT'
    || code === 'ENOTDIR'
    || code === 'EACCES'
    || code === 'EPERM'
    || code === 'EIO'
    || code === 'EBUSY'
    || code === 'ELOOP';
}

export function skippedImportSourceFromError(
  error: unknown,
  sourcePath: string,
): SkippedImportSource {
  const displayName = importSourceDisplayName(sourcePath);
  const reason = errorReason(error);
  return reason === undefined ? { displayName } : { displayName, reason };
}

export function toImportSourceFailurePlan(input: {
  importId: string;
  failed: readonly SkippedImportSource[];
  remainingCount: number;
}): ImportSourceFailurePlan {
  return {
    importId: input.importId,
    failedCount: Math.max(1, input.failed.length),
    remainingCount: input.remainingCount,
    examples: input.failed.slice(0, 8).map((item) => ({
      displayName: item.displayName,
      ...(item.reason === undefined ? {} : { reason: item.reason }),
    })),
  };
}
