export interface DroppedFilePathResolver<T> {
  (file: T): string;
}

/**
 * Resolve only genuine File handles supplied by Chromium's drag-and-drop API.
 * The returned paths stay inside preload and are sent directly over the typed
 * IPC channel; they are never returned to the renderer.
 */
export function resolveDroppedFilePaths<T>(
  files: readonly T[],
  getPathForFile: DroppedFilePathResolver<T>,
): string[] {
  if (files.length === 0 || files.length > 1_000) {
    throw new Error('INVALID_DROP_FILE_COUNT');
  }
  const paths = files.map((file) => getPathForFile(file));
  if (paths.some((candidate) => typeof candidate !== 'string' || candidate.length === 0)) {
    throw new Error('INVALID_DROP_FILE_HANDLE');
  }
  return [...new Set(paths)];
}
