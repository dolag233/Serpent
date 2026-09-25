import { useEffect, useState } from "react";

import type { EntityAppearance } from "../shared/entity-appearance";
import type { FolderBrowseEntry } from "../shared/asset-types";
import type { SerpentLibraryApi } from "../shared/library-api";
import { coverSrc } from "./asset-card-hover-preview";
import { AppearanceGlyph } from "./AppearanceGlyph";
import { folderCoverImageSrc } from "./folder-cover";
import { splitFilenameForDisplay } from "./filename-display";
import { formatBytes } from "./format-file-meta";
import { Icon } from "./Icons";
import { useT } from "./i18n";

export interface FolderInspectorRef {
  locationKind: "managed" | "linked";
  folderId: string;
}

/** `/根目录/xxx/xxx`. An empty relative path is the library root itself. */
export function folderInspectorPathLabel(
  entries: readonly Pick<FolderBrowseEntry, "relativePath">[],
  rootLabel: string,
): string | null {
  const paths = [...new Set(entries.map((entry) => normalizeFolderRelativePath(entry.relativePath)))];
  if (paths.length !== 1) return null;
  const segments = paths[0]!.split("/").filter((segment) => segment.length > 0);
  return `/${[rootLabel, ...segments].join("/")}`;
}

function normalizeFolderRelativePath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}

export function useFolderInspector(input: {
  api: SerpentLibraryApi | null | undefined;
  libraryId: string | null;
  enabled: boolean;
  cardEntries: readonly FolderBrowseEntry[];
  currentRef: FolderInspectorRef | null;
}): {
  entries: FolderBrowseEntry[];
  byteSize: number | null;
} | null {
  const { api, libraryId, enabled, cardEntries, currentRef } = input;
  const [loadedEntry, setLoadedEntry] = useState<FolderBrowseEntry | null>(null);
  const [byteSize, setByteSize] = useState<number | null>(null);
  const cardKey = cardEntries.map((entry) => entry.folderId).join("\n");
  const currentKey = currentRef ? `${currentRef.locationKind}:${currentRef.folderId}` : "";

  useEffect(() => {
    if (!enabled || !api || !libraryId) {
      setLoadedEntry(null);
      setByteSize(null);
      return;
    }
    let cancelled = false;
    const refs: FolderInspectorRef[] = cardEntries.length > 0
      ? cardEntries.map((entry) => ({
        locationKind: entry.locationKind,
        folderId: entry.folderId,
      }))
      : currentRef
        ? [currentRef]
        : [];
    if (refs.length === 0) {
      setLoadedEntry(null);
      setByteSize(null);
      return;
    }
    setByteSize(null);
    if (cardEntries.length === 0 && currentRef) {
      setLoadedEntry(null);
      void api.listFolderEntriesByRefs({ libraryId, refs: [currentRef] }).then((result) => {
        if (cancelled || !result.ok) return;
        setLoadedEntry(result.value[0] ?? null);
      });
    }
    void api.folderIndexedByteSizes({ libraryId, refs }).then((result) => {
      if (cancelled || !result.ok) return;
      const total = result.value.reduce((sum, row) => sum + row.byteSize, 0);
      setByteSize(total);
    });
    return () => {
      cancelled = true;
    };
  }, [api, libraryId, enabled, cardKey, currentKey, cardEntries, currentRef]);

  if (!enabled) return null;
  const entries = cardEntries.length > 0
    ? [...cardEntries]
    : loadedEntry
      ? [loadedEntry]
      : [];
  if (entries.length === 0) return null;
  return { entries, byteSize };
}

export function FolderInspectorBody({
  entries,
  appearance,
  byteSize,
  libraryId,
}: {
  entries: readonly FolderBrowseEntry[];
  appearance?: EntityAppearance | null;
  byteSize: number | null;
  libraryId: string;
}) {
  const t = useT();
  const single = entries.length === 1 ? entries[0] : null;
  const path = folderInspectorPathLabel(entries, t("menu.libraryRoot"));
  const assetCount = entries.reduce((sum, entry) => sum + entry.recursiveAssetCount, 0);
  const childFolderCount = entries.reduce((sum, entry) => sum + entry.childFolderCount, 0);
  const covers = entries.flatMap((entry) => entry.coverArtifactIds).slice(0, 4);
  const sequenceCover = covers.length === 0 && single
    ? folderCoverImageSrc(libraryId, single)
    : null;
  const title = single
    ? single.name
    : t("inspector.folderSelection", { count: entries.length });
  const filenameParts = single ? splitFilenameForDisplay(single.name) : null;
  const sizeLabel = byteSize === null ? "…" : formatBytes(byteSize);
  const detailRows = [
    ...(path ? [{ label: t("inspector.path"), value: path }] : []),
    { label: t("inspector.assets"), value: String(assetCount) },
    { label: t("inspector.childFolders"), value: String(childFolderCount) },
    { label: t("inspector.size"), value: sizeLabel },
  ];

  return (
    <div className="inspector-content">
      <div className={`inspector-hero-compact${single ? "" : " is-multi"}`}>
        <div className="inspector-hero-preview inspector-folder-hero">
          {covers.length === 0 ? (
            sequenceCover ? (
              <img alt="" className="inspector-hero-image" src={sequenceCover} />
            ) : (
              <div className="inspector-hero-preview-fallback">
                <Icon name="folder" size={28} />
              </div>
            )
          ) : covers.length === 1 ? (
            <img alt="" className="inspector-hero-image" src={coverSrc(libraryId, covers[0]!)} />
          ) : (
            <div className="folder-card-collage" aria-hidden="true">
              {Array.from({ length: 4 }).map((_, index) => {
                const artifactId = covers[index];
                return (
                  <div className="folder-card-collage-cell" key={index}>
                    {artifactId ? (
                      <img alt="" className="folder-card-collage-image" src={coverSrc(libraryId, artifactId)} />
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="inspector-folder-heading">
          <AppearanceGlyph appearance={single ? appearance : null} fallback="folder" size={15} />
          <strong className="inspector-hero-title" title={title}>
            {filenameParts ? (
              <>
                <span className="asset-filename-prefix">{filenameParts.prefix}</span>
                {filenameParts.tail ? (
                  <span className="asset-filename-tail">{filenameParts.tail}</span>
                ) : null}
                {filenameParts.extension ? (
                  <span className="asset-filename-extension">{filenameParts.extension}</span>
                ) : null}
              </>
            ) : (
              title
            )}
          </strong>
        </div>
      </div>
      <div className="inspector-folder-details">
        {detailRows.map((row) => (
          <div
            className="inspector-tech-part inspector-raw-tech-row"
            data-hover-tip={`${row.label}: ${row.value}`}
            key={row.label}
          >
            <span className="inspector-raw-tech-label">{row.label}</span>
            <span className="inspector-raw-tech-value">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
