const WINDOWS_RESERVED_BASE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;

/**
 * Resolve the native save dialog's suggested export name from the library
 * display name. The display name is user-facing metadata, so it may contain
 * characters that are not valid in a destination filename on Windows.
 */
export function libraryExportDefaultName(
  displayName: string,
  format: 'folder' | 'zip',
): string {
  const sanitized = displayName
    .trim()
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, '-')
    .replace(/[ .-]+$/gu, '')
    .slice(0, 180)
    .trim();
  const baseName =
    sanitized && sanitized !== '.' && sanitized !== '..' &&
    !WINDOWS_RESERVED_BASE_NAME.test(sanitized)
      ? sanitized
      : 'serpent-library-export';
  if (format !== 'zip') return baseName;
  const withoutZipSuffix = baseName.replace(/(?:\.zip)+$/iu, '');
  return `${withoutZipSuffix || 'serpent-library-export'}.zip`;
}
