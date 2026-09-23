/**
 * Virtual linked-folder hierarchy derived from asset relative paths.
 *
 * Linked assets keep a single `linked_folder_id` (the import root). Subfolders
 * are display-only nodes: `lfv:{rootId}/{relativePath}`. Browse and search
 * treat those ids as a path prefix under the same linked root.
 */

export const LINKED_VIRTUAL_FOLDER_PREFIX = "lfv:";

export interface LinkedVirtualFolderRef {
  linkedFolderId: string;
  relativePath: string;
}

export function encodeLinkedVirtualFolderId(
  linkedFolderId: string,
  relativePath: string,
): string {
  if (relativePath === "") return linkedFolderId;
  return `${LINKED_VIRTUAL_FOLDER_PREFIX}${linkedFolderId}/${relativePath}`;
}

export function parseLinkedVirtualFolderId(
  folderId: string,
): LinkedVirtualFolderRef | null {
  if (!folderId.startsWith(LINKED_VIRTUAL_FOLDER_PREFIX)) return null;
  const rest = folderId.slice(LINKED_VIRTUAL_FOLDER_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  return {
    linkedFolderId: rest.slice(0, slash),
    relativePath: rest.slice(slash + 1),
  };
}

export function parentLinkedRelativePath(relativePath: string): string | null {
  if (relativePath === "") return null;
  const slash = relativePath.lastIndexOf("/");
  return slash === -1 ? "" : relativePath.slice(0, slash);
}

/** Sidebar indent: 0 at the linked root, then one per path segment — same as managed folders. */
export function linkedFolderDepth(relativePath: string): number {
  if (relativePath === "") return 0;
  return relativePath.split("/").length;
}

export function linkedAssetDirectory(relativeFilePath: string): string {
  const slash = relativeFilePath.lastIndexOf("/");
  return slash === -1 ? "" : relativeFilePath.slice(0, slash);
}

export function linkedAssetIsDirectChild(
  relativeFilePath: string,
  directory: string,
): boolean {
  return linkedAssetDirectory(relativeFilePath) === directory;
}

export function linkedAssetIsUnderDirectory(
  relativeFilePath: string,
  directory: string,
): boolean {
  if (directory === "") return true;
  return (
    relativeFilePath === directory ||
    relativeFilePath.startsWith(`${directory}/`)
  );
}

export function collectLinkedDirectoryPrefixes(
  relativeFilePaths: readonly string[],
): string[] {
  const prefixes = new Set<string>();
  for (const filePath of relativeFilePaths) {
    let directory = linkedAssetDirectory(filePath);
    while (directory !== "") {
      prefixes.add(directory);
      const parent = parentLinkedRelativePath(directory);
      directory = parent ?? "";
    }
  }
  return [...prefixes].sort();
}

export interface LinkedDirectoryAssetCounts {
  direct: number;
  recursive: number;
}

/**
 * Count assets for every virtual directory in one pass over each asset's
 * ancestors. Recursive counts were previously computed by filtering the full
 * asset list once per directory, which becomes O(assets × directories).
 */
export function countLinkedDirectoryAssets(
  relativeFilePaths: readonly string[],
): Map<string, LinkedDirectoryAssetCounts> {
  const counts = new Map<string, LinkedDirectoryAssetCounts>();
  const ensure = (directory: string): LinkedDirectoryAssetCounts => {
    let count = counts.get(directory);
    if (!count) {
      count = { direct: 0, recursive: 0 };
      counts.set(directory, count);
    }
    return count;
  };

  for (const filePath of relativeFilePaths) {
    const directory = linkedAssetDirectory(filePath);
    ensure(directory).direct += 1;

    let ancestor = directory;
    while (ancestor !== "") {
      ensure(ancestor).recursive += 1;
      ancestor = parentLinkedRelativePath(ancestor) ?? "";
    }
    ensure("").recursive += 1;
  }

  return counts;
}

/** Number of direct virtual subdirectories under each virtual directory. */
export function countLinkedDirectoryChildren(
  relativeDirectoryPaths: readonly string[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const directory of relativeDirectoryPaths) {
    const parent = parentLinkedRelativePath(directory) ?? "";
    counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }
  return counts;
}

export function directChildLinkedDirectories(
  prefixes: readonly string[],
  parentRelativePath: string,
): string[] {
  return prefixes.filter((prefix) => parentLinkedRelativePath(prefix) === parentRelativePath);
}

export function linkedDirectoryName(relativePath: string): string {
  const slash = relativePath.lastIndexOf("/");
  return slash === -1 ? relativePath : relativePath.slice(slash + 1);
}

/** Reveal / copy-path id: virtual child id when a linked subdirectory is in scope. */
export function linkedRevealFolderId(
  rootFolderId: string,
  relativePath: string | undefined,
): string {
  if (!relativePath) return rootFolderId;
  return encodeLinkedVirtualFolderId(rootFolderId, relativePath);
}
