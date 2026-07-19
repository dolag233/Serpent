import { Icon } from "./Icons";
import { coverSrc } from "./asset-card-hover-preview";
import { useT } from "./i18n";
import type { FolderBrowseEntry } from "../shared/asset-types";

interface FolderCardProps {
  entry: FolderBrowseEntry;
  libraryId: string;
  selected: boolean;
  onClick: (folderId: string, event: React.MouseEvent) => void;
  onDoubleClick: (folderId: string) => void;
  onContextMenu: (entry: FolderBrowseEntry, event: React.MouseEvent) => void;
  /** Mirrors the asset card's button-guard convention (useAssetSelection). */
  onMouseDown: (event: React.MouseEvent) => void;
}

/**
 * Windows-style 1–3 cover collage for a direct child folder on the browse
 * canvas (REQ-FOLDER-001/002/003/010). Covers are pre-batched by the Worker
 * (`coverArtifactIds`); the card never fetches per-folder previews itself.
 */
export function FolderCard({
  entry,
  libraryId,
  selected,
  onClick,
  onDoubleClick,
  onContextMenu,
  onMouseDown,
}: FolderCardProps) {
  const t = useT();
  const covers = entry.coverArtifactIds.slice(0, 3);

  return (
    <button
      aria-pressed={selected}
      className={`folder-card${selected ? " is-selected" : ""}`}
      data-folder-id={entry.folderId}
      onClick={(event) => onClick(entry.folderId, event)}
      onContextMenu={(event) => onContextMenu(entry, event)}
      onDoubleClick={() => onDoubleClick(entry.folderId)}
      onMouseDown={onMouseDown}
      title={entry.name}
      type="button"
    >
      <div
        className={`folder-card-cover folder-card-cover-count-${covers.length}`}
      >
        {covers.length === 0 ? (
          <div className="folder-card-cover-tile folder-card-cover-empty">
            <Icon name="folder" size={28} />
          </div>
        ) : (
          covers.map((artifactId) => (
            <div className="folder-card-cover-tile" key={artifactId}>
              <img
                alt=""
                className="folder-card-cover-image"
                loading="lazy"
                src={coverSrc(libraryId, artifactId)}
              />
            </div>
          ))
        )}
      </div>
      <div className="folder-card-caption">
        <strong className="folder-card-name" title={entry.name}>
          {entry.name}
        </strong>
        <span className="folder-card-count">
          {t("common.itemCount", { count: entry.recursiveAssetCount })}
        </span>
      </div>
    </button>
  );
}
