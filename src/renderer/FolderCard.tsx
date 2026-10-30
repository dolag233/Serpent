import { useState } from "react";

import { Icon } from "./Icons";
import { coverSrc } from "./asset-card-hover-preview";
import { folderAutomaticCoverSrc, folderCoverImageSrc } from "./folder-cover";
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
  /** Matches inside this folder while a discovery filter is active. */
  filteredCount?: number;
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
  filteredCount,
}: FolderCardProps) {
  const t = useT();
  const customCover = entry.hasCustomCover ? folderCoverImageSrc(libraryId, entry) : null;
  const [failedSrcs, setFailedSrcs] = useState<ReadonlySet<string>>(() => new Set());
  const [failedFor, setFailedFor] = useState(entry.folderId);
  if (failedFor !== entry.folderId) {
    setFailedFor(entry.folderId);
    setFailedSrcs(new Set());
  }
  const markFailed = (src: string) => {
    setFailedSrcs((current) => {
      if (current.has(src)) return current;
      const next = new Set(current);
      next.add(src);
      return next;
    });
  };
  const customSrc = customCover && !failedSrcs.has(customCover) ? customCover : null;
  const isCollage = !customSrc && entry.directAssetCount === 0 && entry.coverArtifactIds.length > 0;
  const coverArtifactId = entry.coverArtifactIds[0] ?? null;
  const automaticCover = folderAutomaticCoverSrc(libraryId, entry);
  const sequenceSrc = !coverArtifactId && automaticCover && !failedSrcs.has(automaticCover)
    ? automaticCover
    : null;
  const autoSrc = coverArtifactId ? coverSrc(libraryId, coverArtifactId) : null;
  const visibleAutoSrc = autoSrc && !failedSrcs.has(autoSrc) ? autoSrc : null;

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
      data-hover-tip={entry.name}
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
            {customSrc ? (
              <div className="folder-card-cover-photo">
                <img
                  alt=""
                  className="folder-card-cover-image"
                  loading="eager"
                  onError={() => markFailed(customSrc)}
                  src={customSrc}
                />
              </div>
            ) : entry.coverArtifactIds.length === 0 ? (
              sequenceSrc ? (
                <div className="folder-card-cover-photo">
                  <img
                    alt=""
                    className="folder-card-cover-image"
                    loading="eager"
                    onError={() => markFailed(sequenceSrc)}
                    src={sequenceSrc}
                  />
                </div>
              ) : (
                <div className="folder-card-cover-empty">
                  <Icon name="folder" size={28} />
                </div>
              )
            ) : isCollage ? (
              <div className="folder-card-collage" aria-hidden="true">
                {Array.from({ length: 4 }).map((_, index) => {
                  const artifactId = entry.coverArtifactIds[index];
                  return (
                    <div key={index} className="folder-card-collage-cell">
                      {artifactId ? (
                        <img
                          alt=""
                          className="folder-card-collage-image"
                          loading="eager"
                          onError={(event) => {
                            event.currentTarget.hidden = true;
                          }}
                          src={coverSrc(libraryId, artifactId)}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : visibleAutoSrc ? (
              <div className="folder-card-cover-photo">
                <img
                  alt=""
                  className="folder-card-cover-image"
                  // Serpent-d0nv: the folder-card row is a bounded, first-screen
                  // horizontal strip (unlike the virtualized vertical asset
                  // grid) — eager so covers paint as soon as they are ready.
                  loading="eager"
                  onError={() => markFailed(visibleAutoSrc)}
                  src={visibleAutoSrc}
                />
              </div>
            ) : (
              <div className="folder-card-cover-empty">
                <Icon name="folder" size={28} />
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="folder-card-caption">
        <strong className="folder-card-name" data-hover-tip={entry.name}>
          {entry.name}
        </strong>
        <span className="folder-card-count">
          {t("common.itemCount", {
            count: filteredCount === undefined
              ? entry.recursiveAssetCount
              : filteredCount,
          })}
        </span>
      </div>
    </CardSurface>
  );
}
