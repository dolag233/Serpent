import {
  accessSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  constants,
} from 'node:fs';

import type { PublicErrorReason } from '../shared/protocol/errors';
import { LibraryInputError, normalizeAbsolutePath } from './library-rules';
import { pathIsWithin } from './path-utils';

/**
 * Destination-parent failures for create / open-Eagle / open-Billfish.
 * These must stay distinct from the generic INVALID_LIBRARY_PATH copy so a
 * user who picked `E:\设计` is not left with "invalid path" and a stuck
 * validating spinner (Serpent-sq4i). A filesystem root is a valid parent
 * (Serpent-qn6k); unwritable roots fail as PERMISSION_DENIED.
 */
export class LibraryParentError extends Error {
  readonly code = 'INVALID_LIBRARY_PATH' as const;

  constructor(
    readonly reason: PublicErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'LibraryParentError';
  }
}

function isDirectory(directoryPath: string): boolean {
  try {
    return lstatSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Normalize, optionally create, and prove a writable parent folder for a new
 * Serpent library. Trailing separators from Windows folder pickers are stripped
 * by `normalizeAbsolutePath` before the dirname identity check in
 * `targetLibraryPath`.
 */
export function resolveWritableLibraryParent(input: {
  selectedParentPath: string;
  sourceRootPath?: string;
  createIfMissing?: boolean;
}): string {
  let parentPath: string;
  try {
    parentPath = normalizeAbsolutePath(input.selectedParentPath);
  } catch (error) {
    if (error instanceof LibraryInputError) {
      throw new LibraryParentError('LIBRARY_PARENT_MISSING', error.message);
    }
    throw error;
  }

  if (!existsSync(parentPath)) {
    if (input.createIfMissing !== true) {
      throw new LibraryParentError(
        'LIBRARY_PARENT_MISSING',
        'Library parent folder does not exist.',
      );
    }
    try {
      mkdirSync(parentPath, { recursive: true });
    } catch (error) {
      throw new LibraryParentError(
        'LIBRARY_PARENT_MISSING',
        error instanceof Error ? error.message : 'Could not create library parent folder.',
      );
    }
  }

  if (!isDirectory(parentPath)) {
    throw new LibraryParentError(
      'LIBRARY_PARENT_NOT_DIRECTORY',
      'Library parent must be a folder.',
    );
  }

  try {
    accessSync(parentPath, constants.W_OK);
  } catch {
    throw new LibraryParentError(
      'PERMISSION_DENIED',
      'Library parent folder is not writable.',
    );
  }

  let resolvedParent: string;
  try {
    resolvedParent = realpathSync(parentPath);
  } catch (error) {
    throw new LibraryParentError(
      'LIBRARY_PARENT_MISSING',
      error instanceof Error ? error.message : 'Library parent folder is not readable.',
    );
  }

  if (input.sourceRootPath) {
    let sourceRoot: string;
    try {
      sourceRoot = realpathSync(normalizeAbsolutePath(input.sourceRootPath));
    } catch {
      sourceRoot = normalizeAbsolutePath(input.sourceRootPath);
    }
    if (pathIsWithin(sourceRoot, resolvedParent)) {
      throw new LibraryParentError(
        'LIBRARY_PARENT_INSIDE_SOURCE',
        'Cannot save the new library inside the source library.',
      );
    }
  }

  return resolvedParent;
}
