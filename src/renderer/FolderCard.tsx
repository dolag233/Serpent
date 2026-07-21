import { Icon } from "./Icons";
import { coverSrc } from "./asset-card-hover-preview";
import {
  folderCoverStackSlots,
  folderCoverStackStyle,
} from "./folder-card-cover-stack";
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
 * Direct child folder card on the browse canvas (REQ-FOLDER-001/010 / Serpent-7ms).
 * Plain click selects; double-click enters. Cover photos are stacked inside a
 * physical folder shell (not a Windows mosaic grid).
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
  const stackSlots = folderCoverStackSlots(covers.length);

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
        <div className="folder-card-shell" aria-hidden="true">
          <div className="folder-card-tab" />
          <div className="folder-card-body">
            {covers.length === 0 ? (
              <div className="folder-card-cover-empty">
                <Icon name="folder" size={28} />
              </div>
            ) : (
              <div className="folder-card-stack">
                {covers.map((artifactId, index) => {
                  const slot = stackSlots[index];
                  if (!slot) return null;
                  return (
                    <div
                      className="folder-card-stack-photo"
                      key={artifactId}
                      style={folderCoverStackStyle(slot)}
                    >
                      <img
                        alt=""
                        className="folder-card-cover-image"
                        loading="lazy"
                        src={coverSrc(libraryId, artifactId)}
                      />
                    </div>
                  );
                })}
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
    </button>
  );
}
