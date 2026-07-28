import type {
  LinkedFolderSummary,
  ManagedFolderSummary,
} from './asset-types';
import { PUBLIC_ERROR_MESSAGES } from './protocol/errors';

type ResourceReferenceErrorCode =
  | 'RESOURCE_NOT_FOUND'
  | 'RESOURCE_PATH_CONFLICT';

export class ResourceReferenceError extends Error {
  constructor(readonly code: ResourceReferenceErrorCode) {
    super(PUBLIC_ERROR_MESSAGES[code]);
    this.name = 'ResourceReferenceError';
  }
}

/**
 * Folder references are never display-name guesses. Stable IDs address both
 * managed and linked folders; canonical `/relative/path` references address
 * managed folders, whose path is part of the portable library namespace.
 */
export function resolveFolderReference(
  reference: string,
  managedFolders: readonly ManagedFolderSummary[],
  linkedFolders: readonly LinkedFolderSummary[],
): string {
  if (!reference.startsWith('/')) {
    const matches = [
      ...managedFolders.filter((folder) => folder.folderId === reference),
      ...linkedFolders.filter((folder) => folder.folderId === reference),
    ];
    if (matches.length === 0) throw new ResourceReferenceError('RESOURCE_NOT_FOUND');
    if (matches.length > 1) throw new ResourceReferenceError('RESOURCE_PATH_CONFLICT');
    return matches[0]!.folderId;
  }

  const canonicalPath = reference.slice(1);
  if (
    canonicalPath.length === 0
    || canonicalPath.endsWith('/')
    || canonicalPath.includes('\\')
    || canonicalPath.split('/').some((segment) =>
      segment === '' || segment === '.' || segment === '..',
    )
  ) {
    throw new ResourceReferenceError('RESOURCE_NOT_FOUND');
  }
  const matches = managedFolders.filter(
    (folder) => folder.relativePath === canonicalPath,
  );
  if (matches.length === 0) throw new ResourceReferenceError('RESOURCE_NOT_FOUND');
  if (matches.length > 1) throw new ResourceReferenceError('RESOURCE_PATH_CONFLICT');
  return matches[0]!.folderId;
}
