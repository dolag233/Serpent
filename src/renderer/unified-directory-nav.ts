import type { LinkedFolderSummary, ManagedFolderSummary } from "../shared/asset-types";

export type UnifiedDirectoryNavEntry =
  | {
      kind: "managed";
      folderId: string;
      name: string;
      depth: number;
      parentFolderId: string | null;
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
