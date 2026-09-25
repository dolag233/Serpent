import type { FolderBrowseEntry } from "../shared/asset-types";
import { coverSrc, sourceSrc } from "./asset-card-hover-preview";

/** First paintable folder cover: a thumbnail artifact, or a sequence frame file. */
export function folderCoverImageSrc(
  libraryId: string,
  entry: Pick<FolderBrowseEntry, "coverArtifactIds" | "coverSourcePreviews">,
): string | null {
  const artifactId = entry.coverArtifactIds[0];
  if (artifactId) return coverSrc(libraryId, artifactId);
  const source = entry.coverSourcePreviews?.[0];
  if (!source) return null;
  return sourceSrc(libraryId, source.assetId, source.revisionId);
}
