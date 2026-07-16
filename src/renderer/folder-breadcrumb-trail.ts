import type { ManagedFolderSummary } from "../shared/asset-types";

export type ManagedFolderBreadcrumbEntry = {
  folderId: string;
  name: string;
};

/**
 * Build a root-first breadcrumb trail for a managed folder by walking
 * `parentFolderId`. Unknown ids and parent cycles yield an empty trail.
 */
export function buildManagedFolderBreadcrumbTrail(
  folders: ManagedFolderSummary[],
  folderId: string,
): ManagedFolderBreadcrumbEntry[] {
  const byId = new Map(folders.map((folder) => [folder.folderId, folder]));
  const trail: ManagedFolderBreadcrumbEntry[] = [];
  const visited = new Set<string>();

  let currentId: string | null = folderId;
  while (currentId !== null) {
    if (visited.has(currentId)) {
      return [];
    }
    visited.add(currentId);

    const folder = byId.get(currentId);
    if (!folder) {
      return [];
    }

    trail.push({ folderId: folder.folderId, name: folder.name });
    currentId = folder.parentFolderId;
  }

  trail.reverse();
  return trail;
}
