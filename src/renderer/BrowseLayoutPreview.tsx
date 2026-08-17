import type { BrowseLayoutEntry } from "../shared/asset-types";

export function BrowseLayoutPreview({
  entry,
  libraryId,
  previewArtifactId,
}: {
  entry: BrowseLayoutEntry;
  libraryId: string;
  previewArtifactId?: string | null;
}) {
  const artifactId = previewArtifactId ?? entry.previewArtifactId;
  if (!artifactId) return null;
  return (
    <div
      aria-hidden="true"
      className="asset-card is-layout-preview"
      data-asset-id={entry.assetId}
    >
      <div className="asset-preview">
        <img
          alt=""
          className="asset-thumbnail"
          decoding="async"
          loading="eager"
          src={`serpent://preview/${libraryId}/${artifactId}`}
        />
      </div>
    </div>
  );
}
