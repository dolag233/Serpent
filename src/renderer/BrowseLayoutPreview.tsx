import type { BrowseLayoutEntry } from "../shared/asset-types";
import { formatBytes, formatShortDate } from "./format-file-meta";
import { splitFilenameForDisplay } from "./filename-display";
import { shouldShowGridDimensions } from "./canvas-preferences";
import { Icon } from "./Icons";
import { useLocale, useT, type AppLocale } from "./i18n";
import { sourceSrc } from "./asset-card-hover-preview";

export type LayoutPreviewCaptionFields = {
  name: boolean;
  size: boolean;
  date: boolean;
  dimensions: boolean;
};

const DEFAULT_CAPTION_FIELDS: LayoutPreviewCaptionFields = {
  name: true,
  size: true,
  date: true,
  dimensions: true,
};

function formatLayoutMeta(
  entry: BrowseLayoutEntry,
  fields: LayoutPreviewCaptionFields,
  locale: AppLocale,
  unknownTime: string,
): string | null {
  const parts: string[] = [];
  if (fields.size && entry.byteSize != null) parts.push(formatBytes(entry.byteSize));
  if (fields.date && entry.modifiedAt) {
    parts.push(formatShortDate(entry.modifiedAt, locale, unknownTime));
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function LayoutPreviewFilename({ name }: { name: string }) {
  const parts = splitFilenameForDisplay(name);
  return (
    <strong className="asset-caption-filename" title={name}>
      <span className="asset-filename-prefix">{parts.prefix}</span>
      {parts.tail ? <span className="asset-filename-tail">{parts.tail}</span> : null}
      {parts.extension ? (
        <span className="asset-filename-extension">{parts.extension}</span>
      ) : null}
    </strong>
  );
}

export function BrowseLayoutPreview({
  entry,
  libraryId,
  previewArtifactId,
  viewMode = "masonry",
  fields = DEFAULT_CAPTION_FIELDS,
  loadImmediately = true,
  deferUntilVisible = false,
}: {
  entry: BrowseLayoutEntry;
  libraryId: string;
  previewArtifactId?: string | null;
  viewMode?: "grid" | "masonry";
  fields?: LayoutPreviewCaptionFields;
  /** High priority is reserved for layout slots intersecting the viewport. */
  loadImmediately?: boolean;
  /** Keep source/artifact URLs off the virtual overscan runway. */
  deferUntilVisible?: boolean;
}) {
  const { locale } = useLocale();
  const t = useT();
  const artifactId = previewArtifactId ?? entry.previewArtifactId;
  const previewSrc = artifactId
    ? `serpent://preview/${libraryId}/${artifactId}`
    : entry.previewKind === "source" && entry.previewRevisionId
      ? sourceSrc(libraryId, entry.assetId, entry.previewRevisionId)
      : undefined;
  const showDimensions = shouldShowGridDimensions(
    fields,
    viewMode,
    entry.width,
    entry.height,
    { sourceName: entry.relativeFilePath ?? entry.displayName },
  );
  const showName = fields.name;
  const showMeta = fields.size || fields.date;
  const displayName = entry.displayName?.trim() || "";
  const metaText = formatLayoutMeta(entry, fields, locale, t("common.unknownTime"));
  const hasCaption = showDimensions || showName || showMeta;
  const shouldLoadPreview = !deferUntilVisible || loadImmediately;

  return (
    <div
      aria-hidden="true"
      className="asset-card is-layout-preview"
      data-asset-id={entry.assetId}
    >
      <div className="asset-preview">
        {previewSrc && shouldLoadPreview ? (
          <img
            alt=""
            className="asset-thumbnail"
            decoding="async"
            fetchPriority={loadImmediately ? "high" : "auto"}
            loading={loadImmediately ? "eager" : "lazy"}
            src={previewSrc}
          />
        ) : (
          <Icon name="file" size={28} />
        )}
      </div>
      {hasCaption ? (
        <div className="asset-caption">
          {showDimensions ? (
            <span className="asset-dimensions">
              {entry.width} × {entry.height}
            </span>
          ) : null}
          {showName ? (
            displayName ? (
              <LayoutPreviewFilename name={displayName} />
            ) : (
              <span className="asset-caption-skeleton-line is-name" />
            )
          ) : null}
          {showMeta ? (
            metaText ? (
              <span>{metaText}</span>
            ) : (
              <span className="asset-caption-skeleton-line is-meta" />
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
