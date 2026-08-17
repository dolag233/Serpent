import path from 'node:path';

/**
 * Returns true when `candidatePath` is `rootPath` itself or lives inside it.
 *
 * The `path.isAbsolute(relative)` guard is load-bearing on Windows: for paths
 * on different drive letters (library on E:, export destination under
 * C:\Users\...), `path.relative` cannot express a relative traversal and
 * returns the absolute target instead. Without the guard that absolute result
 * is misread as "inside the root" and legitimate cross-drive destinations are
 * rejected (Serpent-59f).
 */
export function pathIsWithin(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === ''
    || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}
