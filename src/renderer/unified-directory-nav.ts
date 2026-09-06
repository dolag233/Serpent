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
      /** Row creation time (ISO-8601) for sidebar folder sorting (Serpent-db1835). */
      createdAt?: string;
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
    createdAt: folder.createdAt,
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

// ---------------------------------------------------------------------------
// Sidebar folder tree sorting (Serpent-db1835)
// ---------------------------------------------------------------------------

export type FolderTreeSortMode = "name" | "created" | "count";

export type FolderTreeSortOrder = "asc" | "desc";

type ManagedNavEntry = Extract<
  UnifiedDirectoryNavEntry,
  { kind: "managed" }
>;

/**
 * Sibling comparison for the sidebar folder tree. `primary` is computed in
 * "desc" orientation (newest / most / Z first) then flipped for "asc", so a
 * single switch covers both directions with one stable name tie-break.
 */
function compareManagedFolders(
  left: ManagedNavEntry,
  right: ManagedNavEntry,
  mode: FolderTreeSortMode,
  order: FolderTreeSortOrder,
): number {
  let primary: number;
  switch (mode) {
    case "name":
      // localeCompare is ascending by nature; reverse the operands so this
      // switch stays in the shared "desc" orientation like the other modes.
      primary = right.name.localeCompare(left.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      break;
    case "created": {
      const a = left.createdAt ? Date.parse(left.createdAt) : NaN;
      const b = right.createdAt ? Date.parse(right.createdAt) : NaN;
      const aValid = Number.isFinite(a);
      const bValid = Number.isFinite(b);
      if (aValid && bValid) {
        primary = b - a; // newer first
      } else if (aValid !== bValid) {
        // Folders without a creation time always travel to the end.
        return aValid ? -1 : 1;
      } else {
        primary = 0;
      }
      break;
    }
    case "count":
      // Badge shows the displayed descendant total; sort by it, larger first.
      primary = (right.directAssetCount ?? 0) - (left.directAssetCount ?? 0);
      break;
  }
  if (primary !== 0) return order === "asc" ? -primary : primary;
  return left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

/**
 * Reorder managed folders into a depth-first tree with siblings sorted by
 * `mode` + `order` at every level; linked folders keep their existing order
 * appended after the managed tree (their grouping is defined by linked root
 * + path).
 */
export function sortManagedTreeEntries(
  entries: readonly UnifiedDirectoryNavEntry[],
  mode: FolderTreeSortMode,
  order: FolderTreeSortOrder,
): UnifiedDirectoryNavEntry[] {
  const managed = entries.filter((entry): entry is Extract<UnifiedDirectoryNavEntry, { kind: "managed" }> =>
    entry.kind === "managed",
  );
  const linked = entries.filter((entry) => entry.kind === "linked");
  if (managed.length === 0) return [...entries];

  const compare = (a: ManagedNavEntry, b: ManagedNavEntry) =>
    compareManagedFolders(a, b, mode, order);
  const childrenByParent = new Map<string | null, ManagedNavEntry[]>();
  for (const entry of managed) {
    const group = childrenByParent.get(entry.parentFolderId) ?? [];
    group.push(entry);
    childrenByParent.set(entry.parentFolderId, group);
  }
  for (const [, group] of childrenByParent) {
    group.sort(compare);
  }

  const sorted: UnifiedDirectoryNavEntry[] = [];
  const visit = (parentId: string | null) => {
    for (const child of childrenByParent.get(parentId) ?? []) {
      sorted.push(child);
      visit(child.folderId);
    }
  };
  visit(null);

  return [...sorted, ...linked];
}
