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
  // Split only the root-relative portion: splitting an absolute path and
  // filtering empties drops the root itself (the leading "/" on POSIX, the
  // UNC host on Windows), so joining the remaining segments back would
  // silently yield a relative path. Keeping `root` apart preserves it.
  const { root } = path.parse(resolvedAnchor);
  const anchorSegments = resolvedAnchor
    .slice(root.length)
    .split(path.sep)
    .filter(Boolean);

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
        return root;
      }
      return root + rootSegments.join(path.sep);
    }
  }

  return path.dirname(resolvedAnchor);
}
