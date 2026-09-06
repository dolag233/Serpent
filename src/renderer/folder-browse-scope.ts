import type { SearchScope } from "../shared/asset-types";

export type AssetScopeId = "all" | "root" | (string & {});

/**
 * REQ-FOLDER-009: folder browse defaults to direct children only
 * (`recursive: false`). Linked virtual subdirectories use the same switch.
 * Root stays non-recursive; "all assets" has no folder scope.
 */
export function folderBrowseScope(
  scope: AssetScopeId,
  recursive: boolean,
): SearchScope | undefined {
  if (scope === "all") return undefined;
  if (scope === "root") {
    return { kind: "folder", folderId: null, recursive: false };
  }
  return { kind: "folder", folderId: scope, recursive };
}

/**
 * Text search always includes descendants of the selected folder. Keeping
 * this separate from folderBrowseScope means filters and sorting without a
 * search term continue to honour the ordinary browse switch.
 */
export function folderSearchScope(
  scope: AssetScopeId,
): SearchScope | undefined {
  if (scope === "all") return undefined;
  if (scope === "root") {
    return { kind: "folder", folderId: null, recursive: true };
  }
  return { kind: "folder", folderId: scope, recursive: true };
}
