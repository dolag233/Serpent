import type { ImageSequenceSummary } from "../shared/asset-types";
import { coverSrc, sourceSrc } from "./asset-card-hover-preview";

type SequenceFrame = ImageSequenceSummary["frames"][number];

/** Resolve one sequence frame without falling back to another frame's URL. */
export function resolveSequenceFrameUrl(
  libraryId: string,
  frame: Pick<SequenceFrame, "assetId" | "thumbnailArtifactId" | "previewKind" | "previewRevisionId">,
): string | null {
  if (frame.thumbnailArtifactId) {
    return coverSrc(libraryId, frame.thumbnailArtifactId);
  }
  if (frame.previewKind === "source" && frame.previewRevisionId) {
    return sourceSrc(libraryId, frame.assetId, frame.previewRevisionId);
  }
  return null;
}
