import path from 'node:path';

const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const CONTROL_CHARACTER = /[\p{Cc}]/u;
const PATH_SEPARATOR = /[\\/]/u;
const WINDOWS_FORBIDDEN_CHARACTER = /[<>:"|?*]/u;

export class LibraryInputError extends Error {
  constructor(
    readonly code: 'INVALID_LIBRARY_NAME' | 'INVALID_LIBRARY_PATH',
    message: string,
  ) {
    super(message);
    this.name = 'LibraryInputError';
  }
}

export function normalizeLibraryName(input: string): string {
  const displayName = input.trim();
  const codePointLength = [...displayName].length;

  if (
    codePointLength === 0 ||
    codePointLength > 80 ||
    displayName === '.' ||
    displayName === '..' ||
    PATH_SEPARATOR.test(displayName) ||
    WINDOWS_FORBIDDEN_CHARACTER.test(displayName) ||
    CONTROL_CHARACTER.test(displayName) ||
    WINDOWS_DEVICE_NAME.test(displayName) ||
    /[. ]$/u.test(displayName)
  ) {
    throw new LibraryInputError('INVALID_LIBRARY_NAME', 'Invalid library name.');
  }

  return displayName;
}

export function normalizeAbsolutePath(input: string): string {
  if (input.includes('\0') || input.trim() !== input || !path.isAbsolute(input)) {
    throw new LibraryInputError('INVALID_LIBRARY_PATH', 'Invalid library path.');
  }

  return path.normalize(input);
}

export function targetLibraryPath(selectedParentPath: string, displayName: string): string {
  const parentPath = normalizeAbsolutePath(selectedParentPath);
  const safeName = normalizeLibraryName(displayName);
  const targetPath = path.join(parentPath, safeName);

  if (path.dirname(targetPath) !== parentPath) {
    throw new LibraryInputError('INVALID_LIBRARY_PATH', 'Invalid library path.');
  }

  return targetPath;
}
