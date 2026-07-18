import type { SearchScope } from "../shared/asset-types";

export type AssetScopeId = "all" | "root" | (string & {});

/**
 * REQ-FOLDER-009: managed/linked folder browse defaults to direct children only
 * (`recursive: false`). Root stays non-recursive; "all assets" has no folder scope.
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
