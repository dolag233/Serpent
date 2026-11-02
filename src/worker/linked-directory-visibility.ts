import { portablePathIdentity } from './library-rules';

/** Compile explicit folder prefixes once instead of issuing a query per row. */
export function linkedDirectoryIgnored(
  ignoredDirectories: readonly string[],
  matchesIgnoreFile: (relativePath: string) => boolean,
): (relativePath: string) => boolean {
  const rootIgnored = ignoredDirectories.includes('');
  const identities = new Set(ignoredDirectories.filter(Boolean).map(portablePathIdentity));
  return (relativePath) => {
    if (rootIgnored || matchesIgnoreFile(relativePath)) return true;
    let cursor = relativePath ? portablePathIdentity(relativePath) : '';
    while (cursor) {
      if (identities.has(cursor)) return true;
      const slash = cursor.lastIndexOf('/');
      cursor = slash < 0 ? '' : cursor.slice(0, slash);
    }
    return false;
  };
}
