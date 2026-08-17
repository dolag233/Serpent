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
      {/* Serpent-l2at: 完整 AssetSummary（名称/大小/日期）流式到达前，
          用骨架文字条占位，避免卡片下方一片空白。 */}
      <div className="asset-caption asset-caption-skeleton">
        <span className="asset-caption-skeleton-line is-name" />
        <span className="asset-caption-skeleton-line is-meta" />
      </div>
    </div>
  );
}
