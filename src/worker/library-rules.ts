import path from 'node:path';

const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const CONTROL_CHARACTER = /[\p{Cc}]/u;
const PATH_SEPARATOR = /[\\/]/u;
const WINDOWS_FORBIDDEN_CHARACTER = /[<>:"|?*]/u;

export class LibraryInputError extends Error {
  constructor(
    readonly code: 'INVALID_LIBRARY_NAME' | 'INVALID_LIBRARY_PATH' | 'INVALID_FOLDER_NAME' | 'INVALID_ASSET_FILE_NAME',
    message: string,
  ) {
    super(message);
    this.name = 'LibraryInputError';
  }
}

function normalizePortableName(
  input: string,
  errorCode: 'INVALID_LIBRARY_NAME' | 'INVALID_FOLDER_NAME',
): string {
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
    throw new LibraryInputError(errorCode, 'Invalid portable file-system name.');
  }

  return displayName;
}

export function normalizeLibraryName(input: string): string {
  return normalizePortableName(input, 'INVALID_LIBRARY_NAME');
}

export function normalizeFolderName(input: string): string {
  return normalizePortableName(input, 'INVALID_FOLDER_NAME');
}

/**
 * Validate a user-supplied base name (without extension) for renaming an
 * asset's real file. The extension is preserved by the caller; this gate only
 * judges the base name against the portable rules of the supported macOS and
 * Windows filesystems. Existing asset files may already carry host-specific
 * characters, but a newly chosen name must satisfy the portable character set
 * so the library stays movable to Windows; only the stricter 80-code-point
 * length rule remains creation-only.
 *
 * Returns the trimmed base name. Throws LibraryInputError with a message that
 * names the concrete violation.
 */
export function normalizeAssetFileBaseName(input: string): string {
  const baseName = input.trim();
  if (baseName.length === 0) {
    throw new LibraryInputError('INVALID_ASSET_FILE_NAME', 'File name must not be empty.');
  }
  if (PATH_SEPARATOR.test(baseName)) {
    throw new LibraryInputError('INVALID_ASSET_FILE_NAME', 'File name must not contain path separators.');
  }
  if (WINDOWS_FORBIDDEN_CHARACTER.test(baseName)) {
    throw new LibraryInputError('INVALID_ASSET_FILE_NAME', 'File name must not contain <>:"|?*.');
  }
  if (CONTROL_CHARACTER.test(baseName)) {
    throw new LibraryInputError('INVALID_ASSET_FILE_NAME', 'File name must not contain control characters.');
  }
  if (baseName === '.' || baseName === '..') {
    throw new LibraryInputError('INVALID_ASSET_FILE_NAME', "File name must not be '.' or '..'.");
  }
  if (/[. ]$/u.test(baseName)) {
    throw new LibraryInputError('INVALID_ASSET_FILE_NAME', 'File name must not end with a space or period.');
  }
  if (WINDOWS_DEVICE_NAME.test(baseName)) {
    throw new LibraryInputError('INVALID_ASSET_FILE_NAME', 'File name is reserved by Windows.');
  }
  if (Buffer.byteLength(baseName, 'utf8') > 255) {
    throw new LibraryInputError('INVALID_ASSET_FILE_NAME', 'File name must not exceed 255 bytes.');
  }
  return baseName;
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

export function normalizeRelativeAssetPath(input: string): string {
  if (input.includes('\0') || input.trim() !== input || path.isAbsolute(input)) {
    throw new LibraryInputError('INVALID_LIBRARY_PATH', 'Invalid relative asset path.');
  }

  const portableInput = input.replaceAll('\\', '/');
  const normalized = path.posix.normalize(portableInput);
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.startsWith('/')
  ) {
    throw new LibraryInputError('INVALID_LIBRARY_PATH', 'Invalid relative asset path.');
  }

  return normalized;
}

/**
 * A conservative, locale-independent identity for paths that may move between
 * the currently supported macOS and Windows filesystems. The original path is
 * still persisted for display and disk access; this key is only for identity.
 *
 * JavaScript does not expose Unicode's CaseFolding.txt mapping. The
 * locale-insensitive upper-then-lower conversion is a deterministic practical
 * case-fold: unlike lowercasing alone it also folds common expansions and the
 * two lowercase sigma forms. NFC is applied again after those expansions.
 */
export function portablePathSegmentIdentity(segment: string): string {
  return segment.normalize('NFC').toUpperCase().toLowerCase().normalize('NFC');
}

export function portablePathIdentity(relativePath: string): string {
  const normalized = normalizeRelativeAssetPath(relativePath);
  return normalized.split('/').map(portablePathSegmentIdentity).join('/');
}

export function copyNameForIndex(fileName: string, index: number): string {
  if (!Number.isSafeInteger(index) || index < 2) {
    throw new RangeError('Copy indexes start at 2.');
  }
  const extension = path.posix.extname(fileName);
  const baseName = extension.length === 0 ? fileName : fileName.slice(0, -extension.length);
  return `${baseName} (${index})${extension}`;
}
