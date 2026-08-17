import type { LinkedFolderSummary, ManagedFolderSummary } from "../shared/asset-types";
import { linkedFolderDepth } from "../shared/linked-folder-tree";

export type UnifiedDirectoryNavEntry =
  | {
      kind: "managed";
      folderId: string;
      name: string;
      depth: number;
      parentFolderId: string | null;
      /** Direct (non-recursive) managed assets, shown as the row count badge. */
      directAssetCount: number;
    }
  | {
      kind: "linked";
      folderId: string;
      name: string;
      depth: number;
      parentFolderId: string | null;
      status: "available" | "offline";
      assetCount: number;
      linkedFolderId: string;
      relativePath: string;
    };

function relativePathDepth(relativePath: string): number {
  return relativePath.split("/").length;
}

/**
 * Merge managed folders (preserving input tree order) with linked folders,
 * including virtual linked subdirectories derived from asset paths.
 */
export function buildUnifiedDirectoryNavEntries(
  managed: ManagedFolderSummary[],
  linked: LinkedFolderSummary[],
): UnifiedDirectoryNavEntry[] {
  const managedEntries: UnifiedDirectoryNavEntry[] = managed.map((folder) => ({
    kind: "managed",
    folderId: folder.folderId,
    name: folder.name,
    depth: relativePathDepth(folder.relativePath),
    parentFolderId: folder.parentFolderId,
    directAssetCount: folder.directAssetCount,
  }));

  const linkedRootName = new Map(
    linked
      .filter((folder) => (folder.relativePath ?? "") === "")
      .map((folder) => [folder.linkedFolderId ?? folder.folderId, folder.displayName]),
  );
  const linkedEntries: UnifiedDirectoryNavEntry[] = [...linked]
    .sort((left, right) => {
      const leftPath = left.relativePath ?? "";
      const rightPath = right.relativePath ?? "";
      const leftRoot = left.linkedFolderId ?? left.folderId;
      const rightRoot = right.linkedFolderId ?? right.folderId;
      if (leftRoot !== rightRoot) {
        const leftName = linkedRootName.get(leftRoot) ?? left.displayName ?? leftRoot;
        const rightName = linkedRootName.get(rightRoot) ?? right.displayName ?? rightRoot;
        return leftName.localeCompare(rightName);
      }
      return leftPath.localeCompare(rightPath);
    })
    .map((folder) => {
      const relativePath = folder.relativePath ?? "";
      const linkedFolderId = folder.linkedFolderId ?? folder.folderId;
      return {
        kind: "linked" as const,
        folderId: folder.folderId,
        name: folder.displayName,
        depth: linkedFolderDepth(relativePath),
        parentFolderId: folder.parentFolderId ?? null,
        status: folder.status,
        assetCount: folder.assetCount,
        linkedFolderId,
        relativePath,
      };
    });

  return [...managedEntries, ...linkedEntries];
}

/** Folders that have at least one child row in the unified tree. */
export function managedFolderIdsWithChildren(
  entries: readonly UnifiedDirectoryNavEntry[],
): Set<string> {
  const parents = new Set<string>();
  for (const entry of entries) {
    if (entry.parentFolderId) parents.add(entry.parentFolderId);
  }
  return parents;
}

/**
 * Hide rows whose ancestor is collapsed. Applies to both managed and linked
 * virtual children.
 */
export function filterCollapsedDirectoryEntries(
  entries: readonly UnifiedDirectoryNavEntry[],
  collapsedFolderIds: ReadonlySet<string>,
): UnifiedDirectoryNavEntry[] {
  if (collapsedFolderIds.size === 0) return [...entries];

  const byId = new Map<string, UnifiedDirectoryNavEntry>();
  for (const entry of entries) {
    byId.set(entry.folderId, entry);
  }

  const isHidden = (entry: UnifiedDirectoryNavEntry): boolean => {
    let parentId = entry.parentFolderId;
    while (parentId) {
      if (collapsedFolderIds.has(parentId)) return true;
      const parent = byId.get(parentId);
      parentId = parent?.parentFolderId ?? null;
    }
    return false;
  };

  return entries.filter((entry) => !isHidden(entry));
}
