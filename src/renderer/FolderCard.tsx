import { Icon } from "./Icons";
import { coverSrc } from "./asset-card-hover-preview";
import { useT } from "./i18n";
import type { FolderBrowseEntry } from "../shared/asset-types";
import { CardSurface } from "./ui/surfaces";

interface FolderCardProps {
  entry: FolderBrowseEntry;
  libraryId: string;
  selected: boolean;
  /** REQ-DND-006 / Serpent-12mb: external file drop target highlight. */
  dropActive?: boolean;
  onClick: (folderId: string, event: React.MouseEvent) => void;
  onDoubleClick: (folderId: string) => void;
  onContextMenu: (entry: FolderBrowseEntry, event: React.MouseEvent) => void;
  /** Mirrors the asset card's button-guard convention (useAssetSelection). */
  onMouseDown: (event: React.MouseEvent) => void;
  onDragEnter?: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDragLeave?: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDragOver?: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDrop?: (event: React.DragEvent<HTMLButtonElement>) => void;
  draggable?: boolean;
  onDragStart?: (event: React.DragEvent<HTMLButtonElement>) => void;
  /** Trash tombstone card; double-click enters hierarchy (Serpent-6pcd). */
  trashed?: boolean;
}

/**
 * Direct child folder card on the browse canvas (REQ-FOLDER-001/010 / Serpent-l67w).
 * Plain click selects; double-click enters. Chrome matches the reference: rear
 * rounded panel + front pocket with a left tab and soft S-curve shelf. Pocket
 * shows a single cover thumbnail (first child asset), not a stacked deck.
 */
export function FolderCard({
  entry,
  libraryId,
  selected,
  dropActive = false,
  onClick,
  onDoubleClick,
  onContextMenu,
  onMouseDown,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  draggable = false,
  onDragStart,
  trashed = false,
}: FolderCardProps) {
  const t = useT();
  const coverArtifactId = entry.coverArtifactIds[0] ?? null;

  return (
    <CardSurface
      as="button"
      aria-pressed={selected}
      className={`folder-card${selected ? " is-selected" : ""}${dropActive ? " is-drop-target" : ""}${trashed ? " is-trashed-folder" : ""}`}
      data-folder-id={entry.folderId}
      draggable={draggable}
      onClick={(event) => onClick(entry.folderId, event)}
      onContextMenu={(event) => onContextMenu(entry, event)}
      onDoubleClick={() => onDoubleClick(entry.folderId)}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDragStart={onDragStart}
      onDrop={onDrop}
      onMouseDown={onMouseDown}
      title={entry.name}
      type="button"
    >
      <div className="folder-card-cover">
        <div className="folder-card-shell" aria-hidden="true">
          {/* Back panel: full rounded rect; front pocket sits on top. */}
          <div className="folder-card-back" />
          <svg
            className="folder-card-front"
            viewBox="0 0 160 124"
            preserveAspectRatio="none"
          >
            {/*
              Left tab flush with the top edge, soft S-curve into the shelf,
              then a full pocket aligned to the outer rounded corners.
            */}
            <path
              className="folder-card-front-shape"
              d="M8 0.6
                 H45
                 C53.5 0.6 56 5.5 59.5 11
                 C63.2 16.8 67.5 20.4 76 20.4
                 H152
                 A7.4 7.4 0 0 1 159.4 27.8
                 V116
                 A7.4 7.4 0 0 1 152 123.4
                 H8
                 A7.4 7.4 0 0 1 0.6 116
                 V8
                 A7.4 7.4 0 0 1 8 0.6
                 Z"
            />
          </svg>
          <div className="folder-card-pocket">
            {coverArtifactId === null ? (
              <div className="folder-card-cover-empty">
                <Icon name="folder" size={28} />
              </div>
            ) : (
              <div className="folder-card-cover-photo">
                <img
                  alt=""
                  className="folder-card-cover-image"
                  loading="lazy"
                  src={coverSrc(libraryId, coverArtifactId)}
                />
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="folder-card-caption">
        <strong className="folder-card-name" title={entry.name}>
          {entry.name}
        </strong>
        <span className="folder-card-count">
          {t("common.itemCount", { count: entry.recursiveAssetCount })}
        </span>
      </div>
    </CardSurface>
  );
}
