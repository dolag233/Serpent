import type { LinkedFolderSummary, ManagedFolderSummary } from "../shared/asset-types";

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
      status: "available" | "offline";
      assetCount: number;
    };

function relativePathDepth(relativePath: string): number {
  return relativePath.split("/").length;
}

/**
 * Merge managed folders (preserving input tree order) with linked folders as
 * flat root-level entries (depth 1). Linked folders do not invent hierarchy.
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

  const linkedEntries: UnifiedDirectoryNavEntry[] = linked.map((folder) => ({
    kind: "linked",
    folderId: folder.folderId,
    name: folder.displayName,
    depth: 1,
    status: folder.status,
    assetCount: folder.assetCount,
  }));

  return [...managedEntries, ...linkedEntries];
}

/** Managed folders that have at least one managed child. */
export function managedFolderIdsWithChildren(
  entries: readonly UnifiedDirectoryNavEntry[],
): Set<string> {
  const parents = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === "managed" && entry.parentFolderId) {
      parents.add(entry.parentFolderId);
    }
  }
  return parents;
}

/**
 * Hide rows whose managed ancestor is collapsed. Linked entries stay visible.
 * When `collapsedFolderIds` is empty, returns the input unchanged.
 */
export function filterCollapsedDirectoryEntries(
  entries: readonly UnifiedDirectoryNavEntry[],
  collapsedFolderIds: ReadonlySet<string>,
): UnifiedDirectoryNavEntry[] {
  if (collapsedFolderIds.size === 0) return [...entries];

  const byId = new Map<string, UnifiedDirectoryNavEntry>();
  for (const entry of entries) {
    if (entry.kind === "managed") byId.set(entry.folderId, entry);
  }

  const isHidden = (entry: UnifiedDirectoryNavEntry): boolean => {
    if (entry.kind !== "managed") return false;
    let parentId = entry.parentFolderId;
    while (parentId) {
      if (collapsedFolderIds.has(parentId)) return true;
      const parent = byId.get(parentId);
      parentId =
        parent && parent.kind === "managed" ? parent.parentFolderId : null;
    }
    return false;
  };

  return entries.filter((entry) => !isHidden(entry));
}
