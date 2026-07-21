import type { SearchScope } from "../shared/asset-types";

export type AssetScopeId = "all" | "root" | (string & {});

/**
 * REQ-FOLDER-009: managed folder browse defaults to direct children only
 * (`recursive: false`). Linked folders currently keep nested relative paths
 * visible in the linked root (Serpent-4l7) until virtual subdir cards land.
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
