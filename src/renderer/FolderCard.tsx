import { useEffect, useRef, useState } from "react";

import { Icon } from "./Icons";
import { coverSrc } from "./asset-card-hover-preview";
import { folderAutomaticCoverSrc, folderCoverImageSrc } from "./folder-cover";
import { useT } from "./i18n";
import type { FolderBrowseEntry } from "../shared/asset-types";
import { CardSurface } from "./ui/surfaces";

import type { InlineFolderEditState } from './inline-folder-edit';

interface FolderCardProps {
  rename?: Extract<InlineFolderEditState, { kind: 'rename' }> | null;
  onRenameChange?: (value: string) => void;
  onRenameCommit?: () => void;
  onRenameCancel?: () => void;
  entry: FolderBrowseEntry;
  libraryId: string;
  selected: boolean;
  cut?: boolean;
  /** REQ-DND-006 / Serpent-12mb: external file drop target highlight. */
  dropActive?: boolean;
  onClick: (folderId: string, event: React.MouseEvent) => void;
  onDoubleClick: (folderId: string) => void;
  onContextMenu: (entry: FolderBrowseEntry, event: React.MouseEvent) => void;
  /** Mirrors the asset card's button-guard convention (useAssetSelection). */
  onMouseDown: (event: React.MouseEvent) => void;
  onDragEnter?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
  draggable?: boolean;
  onDragStart?: (event: React.DragEvent<HTMLDivElement>) => void;
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
  rename,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  libraryId,
  selected,
  cut = false,
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
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renaming = Boolean(rename);
  useEffect(() => {
    if (!renaming) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renaming]);
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
      as="div"
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      className={`folder-card${cut ? " is-cut" : ""}${selected ? " is-selected" : ""}${dropActive ? " is-drop-target" : ""}${trashed ? " is-trashed-folder" : ""}`}
      data-folder-id={entry.folderId}
      draggable={draggable}
      onClick={(event) => onClick(entry.folderId, event)}
      onContextMenu={(event) => onContextMenu(entry, event)}
      onDoubleClick={() => { if (!rename) onDoubleClick(entry.folderId); }}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDragStart={onDragStart}
      onDrop={onDrop}
      onMouseDown={onMouseDown}
      data-hover-tip={entry.name}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || rename) return;
        if (event.key === 'Enter') { event.preventDefault(); onDoubleClick(entry.folderId); }
        if (event.key === ' ') { event.preventDefault(); event.currentTarget.click(); }
      }}
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
        {rename ? (
          <div className="folder-card-rename" onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}>
            <input
              aria-label={t('command.folder.rename')}
              className="text-field folder-card-rename-input"
              ref={renameInputRef}
              value={rename.value}
              disabled={rename.submitting}
              onChange={event => onRenameChange?.(event.target.value)}
              onBlur={() => { if (!rename.error) onRenameCommit?.(); }}
              onKeyDown={event => {
                event.stopPropagation();
                if (event.nativeEvent.isComposing) return;
                if (event.key === 'Enter') { event.preventDefault(); onRenameCommit?.(); }
                if (event.key === 'Escape') { event.preventDefault(); onRenameCancel?.(); }
              }}
            />
            {rename.error && <span className="asset-inline-rename-error" role="alert">{rename.error}</span>}
          </div>
        ) : <strong className="folder-card-name" data-hover-tip={entry.name}>
          {entry.name}
        </strong>}
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
