import path from 'node:path';

/**
 * Infer a batch-relink root from one manually located file. When the anchor
 * path ends with the asset's recorded relative path, strip that suffix so
 * sibling missing assets can be matched under the same tree.
 */
export function inferRelinkBatchRoot(
  relativeFilePath: string,
  anchorAbsolutePath: string,
): string {
  const relativeSegments = relativeFilePath.split('/').filter(Boolean);
  const resolvedAnchor = path.resolve(anchorAbsolutePath);
  const anchorSegments = resolvedAnchor.split(path.sep).filter(Boolean);

  if (
    relativeSegments.length > 0 &&
    relativeSegments.length <= anchorSegments.length
  ) {
    const tail = anchorSegments.slice(-relativeSegments.length);
    const matches = relativeSegments.every((segment, index) => {
      const anchorSegment = tail[index];
      if (!anchorSegment) return false;
      return process.platform === 'win32'
        ? segment.toLowerCase() === anchorSegment.toLowerCase()
        : segment === anchorSegment;
    });
    if (matches) {
      const rootSegments = anchorSegments.slice(
        0,
        anchorSegments.length - relativeSegments.length,
      );
      if (rootSegments.length === 0) {
        return path.parse(resolvedAnchor).root;
      }
      // Rebuild with the same absolute/relative character as the resolved
      // anchor so POSIX callers keep a leading slash (dropping it would make
      // the root cwd-relative).
      const joined = rootSegments.join(path.sep);
      return path.isAbsolute(resolvedAnchor)
        ? path.parse(resolvedAnchor).root + joined
        : joined;
    }
  }

  return path.dirname(resolvedAnchor);
}
