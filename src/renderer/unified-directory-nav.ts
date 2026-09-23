import type {
  CollectionSummary,
  LinkedFolderSummary,
  ManagedFolderSummary,
} from "../shared/asset-types";
import type { EntityAppearance } from "../shared/entity-appearance";
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
      appearance?: EntityAppearance | null;
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
      /** Linked-root creation time; virtual children omit this. */
      createdAt?: string;
      appearance?: EntityAppearance | null;
    };

/**
 * Indentation depth of a managed folder: a root-level folder is depth 0 so it
 * lines up with the fixed root rows (所有资产 / 资源库根目录 / 回收站 / 标签管理),
 * and each nested level adds one. Counting the path segments directly made
 * every managed folder one level too deep.
 */
function relativePathDepth(relativePath: string): number {
  return Math.max(0, relativePath.split("/").length - 1);
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
    ...(folder.createdAt ? { createdAt: folder.createdAt } : {}),
    ...(folder.appearance ? { appearance: folder.appearance } : {}),
  }));
  const managedDepthById = new Map(
    managedEntries.map((entry) => [entry.folderId, entry.depth]),
  );

  const linkedRootName = new Map(
    linked
      .filter((folder) => (folder.relativePath ?? "") === "")
      .map((folder) => [folder.linkedFolderId ?? folder.folderId, folder.displayName]),
  );
  const sortedLinked = [...linked]
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
    });

  /**
   * Serpent-316493: a linked root can hang under a managed folder (folder
   * context menu → 导入链接文件夹). Its depth follows that parent; a parent
   * that is no longer visible (trashed, or deleted from disk) falls back to the
   * library root so the link never disappears from the tree — a restore puts it
   * back under the parent automatically.
   */
  const linkedRootDepthById = new Map<string, number>();
  const linkedEntries: UnifiedDirectoryNavEntry[] = [];
  for (const folder of sortedLinked) {
    const relativePath = folder.relativePath ?? "";
    const linkedFolderId = folder.linkedFolderId ?? folder.folderId;
    const parentFolderId = folder.parentFolderId ?? null;
    const parentDepth =
      parentFolderId === null
        ? undefined
        : managedDepthById.get(parentFolderId);
    const nested = parentFolderId !== null && parentDepth !== undefined;
    // Serpent-81e416: linkedFolderDepth is 0-based like managed relativePathDepth.
    // Children add that depth onto the root's resolved depth (including a
    // managed parent). Do not subtract 1 — that compensated for the old
    // empty-path depth of 1.
    const depth = nested
      ? parentDepth + 1
      : linkedRootDepthById.get(linkedFolderId) !== undefined
        ? linkedRootDepthById.get(linkedFolderId)! + linkedFolderDepth(relativePath)
        : linkedFolderDepth(relativePath);
    if (relativePath === "") linkedRootDepthById.set(linkedFolderId, depth);
    linkedEntries.push({
      kind: "linked" as const,
      folderId: folder.folderId,
      name: folder.displayName,
      depth,
      parentFolderId:
        relativePath === "" ? (nested ? parentFolderId : null) : parentFolderId,
      status: folder.status,
      assetCount: folder.assetCount,
      linkedFolderId,
      relativePath,
      ...(folder.createdAt ? { createdAt: folder.createdAt } : {}),
      ...(relativePath === "" && folder.appearance
        ? { appearance: folder.appearance }
        : {}),
    });
  }

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
 * Folder ids in the subtree of `rootId` (inclusive). `null` / library-root
 * sentinel means every row in the unified tree.
 */
export function folderIdsInSubtree(
  entries: readonly UnifiedDirectoryNavEntry[],
  rootId: string | null,
): string[] {
  if (rootId === null) {
    return entries.map((entry) => entry.folderId);
  }
  const children = new Map<string, string[]>();
  const present = new Set<string>();
  for (const entry of entries) {
    present.add(entry.folderId);
    const parentId = entry.parentFolderId;
    if (!parentId) continue;
    const list = children.get(parentId) ?? [];
    list.push(entry.folderId);
    children.set(parentId, list);
  }
  const result: string[] = [];
  const stack = [rootId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (present.has(id) || id === rootId) result.push(id);
    const nested = children.get(id);
    if (nested) stack.push(...nested);
  }
  return result;
}

export function withFolderSubtreeCollapsed(
  collapsedFolderIds: readonly string[],
  subtreeIds: readonly string[],
  collapse: boolean,
  limit = 2000,
): string[] {
  const next = new Set(collapsedFolderIds);
  if (collapse) {
    for (const id of subtreeIds) next.add(id);
  } else {
    for (const id of subtreeIds) next.delete(id);
  }
  return [...next].slice(0, limit);
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

export type CollectionTreeSortMode = Exclude<FolderTreeSortMode, "created">;

export type FolderTreeSortOrder = "asc" | "desc";

type SortableSidebarEntry = {
  name: string;
  createdAt?: string;
  assetCount: number;
};

/**
 * Sibling comparison for the sidebar folder tree. `primary` is computed in
 * "desc" orientation (newest / most / Z first) then flipped for "asc", so a
 * single switch covers both directions with one stable name tie-break.
 */
function compareSortableSidebarEntries(
  left: SortableSidebarEntry,
  right: SortableSidebarEntry,
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
      // Badge shows the displayed row count; sort by it, larger first.
      primary = (right.assetCount ?? 0) - (left.assetCount ?? 0);
      break;
  }
  if (primary !== 0) return order === "asc" ? -primary : primary;
  return left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function directoryNavSortKey(entry: UnifiedDirectoryNavEntry): SortableSidebarEntry {
  return {
    name: entry.name,
    createdAt: entry.createdAt,
    assetCount: entry.kind === "managed" ? entry.directAssetCount : entry.assetCount,
  };
}

/**
 * Reorder the unified folder tree depth-first. Siblings at every parent —
 * managed folders, linked roots, and virtual linked subdirectories — use the
 * same name / created / count comparator as the folder-pane sort control.
 * Missing parents fall back to the library root so no row is dropped.
 */
export function sortManagedTreeEntries(
  entries: readonly UnifiedDirectoryNavEntry[],
  mode: FolderTreeSortMode,
  order: FolderTreeSortOrder,
): UnifiedDirectoryNavEntry[] {
  const ids = new Set(entries.map((entry) => entry.folderId));
  const childrenByParent = new Map<string | null, UnifiedDirectoryNavEntry[]>();
  for (const entry of entries) {
    const parentId = entry.parentFolderId;
    const key = parentId !== null && ids.has(parentId) ? parentId : null;
    const group = childrenByParent.get(key) ?? [];
    group.push(entry);
    childrenByParent.set(key, group);
  }
  const compare = (left: UnifiedDirectoryNavEntry, right: UnifiedDirectoryNavEntry) =>
    compareSortableSidebarEntries(
      directoryNavSortKey(left),
      directoryNavSortKey(right),
      mode,
      order,
    );
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
  return sorted;
}

/**
 * Sort each collection level with the shared name/count field and direction
 * semantics. Collections do not expose folder creation-time sorting. The tree
 * shape is preserved so collapse and inline-create logic can continue to
 * consume the existing parent map.
 */
export function sortCollectionTree(
  tree: ReadonlyMap<string | null, readonly CollectionSummary[]>,
  mode: CollectionTreeSortMode,
  order: FolderTreeSortOrder,
): Map<string | null, CollectionSummary[]> {
  const sorted = new Map<string | null, CollectionSummary[]>();
  for (const [parentId, children] of tree) {
    sorted.set(
      parentId,
      [...children].sort((left, right) =>
        compareSortableSidebarEntries(
          {
            name: left.name,
            assetCount: left.assetCount,
          },
          {
            name: right.name,
            assetCount: right.assetCount,
          },
          mode,
          order,
        ),
      ),
    );
  }
  return sorted;
}
