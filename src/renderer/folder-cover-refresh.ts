import type { FolderBrowseEntry } from "../shared/asset-types";

/**
 * Serpent-d0nv: the set of cover-candidate asset ids for the current
 * folder-card row. The Worker schedules these at the `cover` thumbnail scene
 * (priority 400) and emits `asset.thumbnail.ready` once each is generated;
 * the Renderer refreshes the folder browse entries when a ready event hits
 * one of these assets so a folder card's cover appears as soon as it exists,
 * without waiting for navigation or the next full load.
 */
export function collectFolderCoverCandidateAssetIds(
  entries: readonly FolderBrowseEntry[],
): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    for (const assetId of entry.coverAssetIds) ids.add(assetId);
  }
  return ids;
}
