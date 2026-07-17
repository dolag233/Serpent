import {
  useState,
  useMemo,
  useRef,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";

import { Icon } from "./Icons";
import { formatDuration } from "./App";
import { resolveInspectorPreviewSrc } from "./inspector-preview";
import { toOpenableExternalUrl } from "../shared/external-url";
import {
  buildTagSuggestions,
  moveTagSuggestionIndex,
  type TagSuggestion,
} from "./tag-suggestions";
import { useT } from "./i18n";

import type { AssetSummary, AssetMetadataResult, TagSummary } from "../shared/asset-types";
import type { RendererLibrarySummary } from "../shared/protocol/responses";

// --- Local utility helpers (extracted from App.tsx) ---

function initials(value: string) {
  return value.trim().slice(0, 2).toUpperCase() || "SP";
}

function isCssColor(value: string) {
  return /^#[0-9a-f]{3,8}$/i.test(value) || /^(rgb|hsl)a?\(/i.test(value);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatDateFull(value: string, unknownLabel: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? unknownLabel
    : new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date);
}

function formatDateShort(value: string, unknownLabel: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? unknownLabel
    : new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
      }).format(date);
}

// --- Types ---

export interface AiContent {
  assetId: string;
  description?: string;
  tags?: string[];
  structuredMetadata?: Record<string, unknown>;
  modelVersion?: string;
}

export interface InspectorPanelProps {
  selectedAsset: AssetSummary | undefined;
  library: RendererLibrarySummary | null;
  allAssetCount: number;
  folderCount: number;
  closeLibrary: () => void;
  loadMetadata: () => void;
  // Metadata editor state
  assetMetadata: AssetMetadataResult | null;
  versionConflict: boolean;
  editDescription: string;
  editRating: number;
  editFavorite: boolean;
  editSourceUrl: string;
  editPalette: string;
  setEditPalette: Dispatch<SetStateAction<string>>;
  displayedPalette: string[];
  automaticPaletteRatios: Map<string, number>;
  aiContent: AiContent | null;
  // Metadata editor handlers
  handleMetadataDescriptionSave: () => void;
  handleMetadataDescriptionInput: (
    e: React.ChangeEvent<HTMLTextAreaElement>,
  ) => void;
  handleRatingClick: (star: number) => void;
  handleFavoriteToggle: () => void;
  handleSourceUrlSave: () => void;
  handleSourceUrlInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handlePaletteSave: () => void;
  // Tag chip props (REQ-TAG-003)
  allTags: TagSummary[];
  onAssignTagToAsset?: (tagId: string) => void;
  onRemoveTagFromAsset?: (tagId: string) => void;
  onCreateAndAssignTag?: (tagName: string) => void;
  // REQ-MENU-007: total selected assets; tag and rating ops apply to all of them when >= 2.
  selectionCount?: number;
  /** 点击色卡分段复制颜色后的反馈（toast 由 App 统一发）。copied=false 表示剪贴板写入失败。 */
  onPaletteColorCopy?: (color: string, copied: boolean) => void;
  /** 在系统浏览器中打开当前源链接（URL 有效性由主进程二次校验）。 */
  onOpenSourceUrl?: () => void;
}

function InspectorHero({
  asset,
  infoParts,
  library,
}: {
  asset: AssetSummary;
  infoParts: string[];
  library: RendererLibrarySummary | null;
}) {
  const previewSrc = resolveInspectorPreviewSrc(asset, library);
  const [decoded, setDecoded] = useState(false);

  return (
    <div className="inspector-hero-compact">
      {previewSrc ? (
        <div className="inspector-hero-preview">
          {!decoded && <Icon name="file" size={20} />}
          <img
            alt={asset.displayName}
            className={decoded ? "inspector-hero-image" : "inspector-hero-image is-loading"}
            onLoad={(event) => {
              const image = event.currentTarget;
              if (image.complete && image.naturalWidth > 0) setDecoded(true);
            }}
            src={previewSrc}
          />
        </div>
      ) : (
        <div className="inspector-hero-preview inspector-hero-preview-fallback">
          <Icon name="file" size={20} />
        </div>
      )}
      <strong className="inspector-hero-title" title={asset.displayName}>
        {asset.displayName}
      </strong>
      <div className="inspector-compact-info">
        <span className="inspector-compact-meta">
          {infoParts.map((part, index) => (
            <span className="inspector-meta-part" key={part}>
              {index > 0 && <span className="inspector-meta-sep">·</span>}
              {part}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

// --- Tag chip colors ---

const TAG_CHIP_COLORS = [
  "#4a9ec9", "#6db85d", "#c9773e", "#b866b8", "#d99a3e",
  "#5d9b9b", "#c75252", "#7b68b8", "#5aa36b", "#b8734a",
];

function tagColor(tagId: string) {
  let hash = 0;
  for (let i = 0; i < tagId.length; i++) {
    hash = tagId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return TAG_CHIP_COLORS[Math.abs(hash) % TAG_CHIP_COLORS.length];
}

// --- Component ---

export function InspectorPanel(props: InspectorPanelProps) {
  const {
    selectedAsset,
    library,
    allAssetCount,
    folderCount,
    closeLibrary,
    loadMetadata,
    assetMetadata: rawAssetMetadata,
    versionConflict,
    editDescription,
    editRating,
    editFavorite,
    editSourceUrl,
    editPalette,
    setEditPalette,
    displayedPalette,
    automaticPaletteRatios,
    aiContent,
    handleMetadataDescriptionSave,
    handleMetadataDescriptionInput,
    handleRatingClick,
    handleFavoriteToggle,
    handleSourceUrlSave,
    handleSourceUrlInput,
    handlePaletteSave,
    allTags,
    onAssignTagToAsset,
    onRemoveTagFromAsset,
    onCreateAndAssignTag,
    selectionCount,
    onPaletteColorCopy,
    onOpenSourceUrl,
  } = props;

  const t = useT();

  // Selection identity and metadata may resolve in separate async turns. Never
  // render the previous asset's fields beside the newly selected asset.
  const assetMetadata =
    rawAssetMetadata?.assetId === selectedAsset?.assetId
      ? rawAssetMetadata
      : null;

  // Tag input state
  const [tagInputValue, setTagInputValue] = useState("");
  const [showTagInput, setShowTagInput] = useState(false);
  const [activeTagSuggestionIndex, setActiveTagSuggestionIndex] = useState(-1);
  const tagInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showTagInput && tagInputRef.current) {
      tagInputRef.current.focus();
    }
  }, [showTagInput]);

  // Collect all tags to display from asset metadata (both user and AI)
  const displayedTags = useMemo(() => {
    if (!assetMetadata?.tags) return [];
    return assetMetadata.tags.map((t) => ({
      id: t.id,
      name: t.name,
      source: t.source as "ai" | "user",
    }));
  }, [assetMetadata]);

  const displayedTagIds = useMemo(
    () => new Set(displayedTags.map((tag) => tag.id)),
    [displayedTags],
  );

  const tagSuggestions = useMemo(
    () => buildTagSuggestions(allTags, tagInputValue, displayedTagIds),
    [allTags, displayedTagIds, tagInputValue],
  );

  const closeTagInput = () => {
    setTagInputValue("");
    setActiveTagSuggestionIndex(-1);
    setShowTagInput(false);
  };

  const submitTagSuggestion = (suggestion: TagSuggestion) => {
    if (suggestion.kind === "assign") {
      onAssignTagToAsset?.(suggestion.tagId);
    } else {
      onCreateAndAssignTag?.(suggestion.name);
    }
    closeTagInput();
  };

  const copyPaletteColor = (color: string) => {
    void navigator.clipboard.writeText(color).then(
      () => onPaletteColorCopy?.(color, true),
      () => onPaletteColorCopy?.(color, false),
    );
  };

  const canOpenSourceUrl = toOpenableExternalUrl(editSourceUrl) !== null;

  // 描述输入框高度自动包裹内容：受控值变化（输入/切换资产）后重新量高。
  // CSS 侧 resize:none + max-height 兜底，超出后内部滚动。
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const textarea = descriptionRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [editDescription, selectedAsset?.assetId]);

  const handleAddTagKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveTagSuggestionIndex((current) =>
        moveTagSuggestionIndex(
          current,
          event.key === "ArrowDown" ? 1 : -1,
          tagSuggestions.length,
        ),
      );
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const activeSuggestion = tagSuggestions[activeTagSuggestionIndex];
      if (activeSuggestion) {
        submitTagSuggestion(activeSuggestion);
        return;
      }

      const normalizedInput = tagInputValue.trim().toLocaleLowerCase();
      const exactTag = allTags.find(
        (tag) => tag.name.toLocaleLowerCase() === normalizedInput,
      );
      if (exactTag && !displayedTagIds.has(exactTag.tagId)) {
        submitTagSuggestion({
          kind: "assign",
          tagId: exactTag.tagId,
          name: exactTag.name,
          assetCount: exactTag.assetCount,
        });
      } else if (tagInputValue.trim() && !exactTag) {
        submitTagSuggestion({ kind: "create", name: tagInputValue.trim() });
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeTagInput();
    }
  };

  // Compact info parts — memoized to avoid crash when selectedAsset is undefined.
  // 每个片段独立 nowrap，折行只发生在片段之间，分隔符跟随下一段开头，
  // 不会出现行尾挂一个孤立 "·" 的情况。
  const compactInfoParts = useMemo(() => {
    if (!selectedAsset) return [];
    const unknownTime = t("common.unknownTime");
    const parts: string[] = [];
    parts.push(formatBytes(selectedAsset.byteSize ?? 0));
    if (selectedAsset.width !== null && selectedAsset.height !== null) {
      parts.push(`${selectedAsset.width} × ${selectedAsset.height}`);
    }
    if (selectedAsset.durationMs !== null) {
      parts.push(formatDuration(selectedAsset.durationMs));
    }
    parts.push(formatDateFull(selectedAsset.modifiedAt ?? "", unknownTime));
    return parts;
  }, [selectedAsset, t]);

  return (
    <aside className="inspector-pane">
      {selectedAsset ? (
        <div className="inspector-content">
          <InspectorHero
            asset={selectedAsset}
            infoParts={compactInfoParts}
            key={selectedAsset.assetId}
            library={library}
          />
          <div
            className="inspector-status-row"
            data-tone={
              selectedAsset.deletedAt
                ? "trash"
                : selectedAsset.availability === "available"
                  ? "ok"
                  : "missing"
            }
          >
            <span aria-hidden="true" className="inspector-status-dot" />
            <span>
              {selectedAsset.deletedAt
                ? t("inspector.trashedAutoClean", {
                    days: selectedAsset.remainingDays ?? "?",
                  })
                : selectedAsset.availability === "available"
                  ? t("inspector.available")
                  : t("inspector.missing")}
            </span>
          </div>

          {/* Tag chips (REQ-TAG-003) */}
          <section className="inspector-section inspector-tags-section">
            <div className="inspector-tags-header">
              <span className="inspector-section-label">{t("inspector.tags")}</span>
              <button
                className="tiny-action"
                aria-label={t("inspector.addTag")}
                onClick={() => {
                  setShowTagInput(true);
                  setTagInputValue("");
                  setActiveTagSuggestionIndex(-1);
                }}
                type="button"
              >
                <Icon name="plus" size={12} />
              </button>
            </div>
            <div className="tag-chips-container">
              {displayedTags.map((tag) => (
                <span
                  className="tag-chip"
                  data-source={tag.source}
                  key={tag.id}
                  style={{ borderColor: tagColor(tag.id) }}
                >
                  <span className="tag-chip-dot" style={{ background: tagColor(tag.id) }} />
                  <span className="tag-chip-name">{tag.name}</span>
                  {tag.source === "user" && onRemoveTagFromAsset && (
                    <button
                      aria-label={t("inspector.removeTag")}
                      className="tag-chip-remove"
                      onClick={() => onRemoveTagFromAsset(tag.id)}
                      type="button"
                    >
                      <Icon name="close" size={9} />
                    </button>
                  )}
                </span>
              ))}
              {displayedTags.length === 0 && !showTagInput && (
                <span className="tag-chip-placeholder">{t("inspector.noTags")}</span>
              )}
              {showTagInput && (
                <div className="tag-input-wrapper">
                  <div className="tag-input-chip">
                    <Icon name="tag" size={11} />
                    <input
                      aria-activedescendant={
                        activeTagSuggestionIndex >= 0
                          ? `tag-suggestion-${activeTagSuggestionIndex}`
                          : undefined
                      }
                      aria-autocomplete="list"
                      aria-controls="inspector-tag-suggestions"
                      aria-expanded={tagSuggestions.length > 0}
                      aria-label={t("inspector.addTag")}
                      autoComplete="off"
                      autoFocus
                      className="tag-add-input"
                      maxLength={255}
                      onBlur={(event) => {
                        if (!event.currentTarget.parentElement?.parentElement?.contains(event.relatedTarget)) {
                          closeTagInput();
                        }
                      }}
                      onChange={(event) => {
                        setTagInputValue(event.target.value);
                        setActiveTagSuggestionIndex(-1);
                      }}
                      onKeyDown={handleAddTagKeyDown}
                      placeholder={t("inspector.searchOrCreateTag")}
                      ref={tagInputRef}
                      role="combobox"
                      value={tagInputValue}
                    />
                  </div>
                  {tagSuggestions.length > 0 && (
                    <div
                      className="tag-suggestions-dropdown"
                      id="inspector-tag-suggestions"
                      role="listbox"
                    >
                      {tagSuggestions.map((suggestion, index) => (
                        <button
                          aria-selected={index === activeTagSuggestionIndex}
                          className={`tag-suggestion-item${index === activeTagSuggestionIndex ? " is-active" : ""}${suggestion.kind === "create" ? " tag-suggestion-create" : ""}`}
                          id={`tag-suggestion-${index}`}
                          key={suggestion.kind === "assign" ? suggestion.tagId : `create-${suggestion.name}`}
                          onMouseDown={(e) => {
                            e.preventDefault();
                          }}
                          onClick={() => submitTagSuggestion(suggestion)}
                          onMouseEnter={() => setActiveTagSuggestionIndex(index)}
                          role="option"
                          type="button"
                        >
                          <span className="tag-suggestion-name">
                            {suggestion.kind === "assign"
                              ? suggestion.name
                              : t("inspector.createTagNamed", {
                                  name: suggestion.name,
                                })}
                          </span>
                          {suggestion.kind === "assign" && (
                            <span className="tag-suggestion-count">
                              {suggestion.assetCount}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            {selectionCount !== undefined && selectionCount >= 2 && (
              <span className="tag-chip-placeholder">
                {t("inspector.applyToSelection", { count: selectionCount })}
              </span>
            )}
          </section>

          {/* --- Asset metadata editor (compact) --- */}
          {assetMetadata ? (
            <>
              {versionConflict && (
                <div className="inline-error inspector-version-conflict">
                  <Icon name="warning" size={14} />
                  <div>
                    <strong>{t("inspector.versionConflict")}</strong>
                    <p>{t("inspector.versionConflictBody")}</p>
                    <button
                      onClick={() => void loadMetadata()}
                      type="button"
                    >
                      {t("inspector.refreshMetadata")}
                    </button>
                  </div>
                </div>
              )}

              {/* 高频操作聚拢成一行：评分在左、喜欢在右，无需小标题。 */}
              <div className="inspector-quick-row">
                <div aria-label={t("inspector.rating")} className="inspector-rating" role="group">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      aria-label={t("inspector.starAria", { star })}
                      aria-pressed={star <= editRating || undefined}
                      className="rating-star"
                      data-active={star <= editRating || undefined}
                      key={star}
                      onClick={() => handleRatingClick(star)}
                      type="button"
                    >
                      <Icon name="star" size={16} />
                    </button>
                  ))}
                  {editRating > 0 && (
                    <button
                      aria-label={t("inspector.clearRating")}
                      className="rating-clear"
                      onClick={() => handleRatingClick(0)}
                      type="button"
                    >
                      {t("common.clear")}
                    </button>
                  )}
                </div>
                <button
                  aria-label={
                    editFavorite
                      ? t("inspector.unfavorite")
                      : t("inspector.markFavorite")
                  }
                  aria-pressed={editFavorite || undefined}
                  className="favorite-toggle"
                  data-active={editFavorite || undefined}
                  onClick={handleFavoriteToggle}
                  type="button"
                >
                  <Icon name="heart" size={17} />
                </button>
              </div>

              {/* 色卡：等宽分段（顺序即提取重要性，左→右），点击复制色值。 */}
              <div className="editor-field">
                <label className="micro-label">
                  {t("inspector.paletteLabel", {
                    source:
                      assetMetadata.paletteSource === "manual"
                        ? t("inspector.paletteManual")
                        : assetMetadata.paletteSource === "automatic"
                          ? t("inspector.paletteAuto")
                          : t("inspector.palettePending"),
                  })}
                </label>
                {displayedPalette.length > 0 && (
                  <div
                    aria-label={t("inspector.palettePreview", {
                      source:
                        assetMetadata.paletteSource === "manual"
                          ? t("inspector.paletteManual")
                          : t("inspector.paletteAuto"),
                    })}
                    className="palette-preview"
                    role="group"
                  >
                    {displayedPalette.map((color, index) => {
                      const ratio =
                        assetMetadata.paletteSource === "automatic"
                          ? automaticPaletteRatios.get(color)
                          : undefined;
                      return (
                        <span
                          aria-label={t("inspector.copyColor", { color })}
                          key={`${color}-${index}`}
                          onClick={() => copyPaletteColor(color)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              copyPaletteColor(color);
                            }
                          }}
                          role="button"
                          style={{
                            background: isCssColor(color)
                              ? color
                              : "transparent",
                          }}
                          tabIndex={0}
                          title={
                            ratio === undefined
                              ? t("inspector.copyColorTitle", { color })
                              : t("inspector.copyColorTitleRatio", {
                                  color,
                                  ratio: (ratio * 100).toFixed(1),
                                })
                          }
                        />
                      );
                    })}
                  </div>
                )}
                <input
                  aria-label={t("inspector.manualPalette")}
                  className="text-field inspector-input inspector-palette-input"
                  maxLength={1024}
                  onBlur={handlePaletteSave}
                  onChange={(event) => setEditPalette(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handlePaletteSave();
                  }}
                  placeholder={t("inspector.palettePlaceholder")}
                  value={editPalette}
                />
                {assetMetadata.paletteSource === "automatic" && (
                  <p className="field-help">
                    {t("inspector.paletteHelp")}
                  </p>
                )}
              </div>

              <div className="editor-field">
                <label className="micro-label" htmlFor="meta-desc">
                  {t("inspector.description")}
                </label>
                <textarea
                  className="text-field inspector-textarea"
                  id="meta-desc"
                  maxLength={10000}
                  onBlur={handleMetadataDescriptionSave}
                  onChange={handleMetadataDescriptionInput}
                  placeholder={t("inspector.descriptionPlaceholder")}
                  ref={descriptionRef}
                  rows={2}
                  value={editDescription}
                />
              </div>

              <div className="editor-field">
                <label className="micro-label" htmlFor="meta-url">
                  {t("inspector.sourceUrl")}
                </label>
                <div className="source-url-field">
                  <input
                    className="text-field inspector-input"
                    id="meta-url"
                    maxLength={255}
                    onBlur={handleSourceUrlSave}
                    onChange={handleSourceUrlInput}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSourceUrlSave();
                    }}
                    placeholder="https://…"
                    value={editSourceUrl}
                  />
                  <button
                    aria-disabled={!canOpenSourceUrl || undefined}
                    aria-label={
                      canOpenSourceUrl
                        ? t("inspector.openSourceUrl")
                        : t("inspector.sourceUrlInvalidHint")
                    }
                    className="source-url-open"
                    onClick={() => {
                      if (canOpenSourceUrl) onOpenSourceUrl?.();
                    }}
                    title={
                      canOpenSourceUrl
                        ? t("inspector.openInBrowser")
                        : t("inspector.openInBrowserHint")
                    }
                    type="button"
                  >
                    <Icon name="link" size={13} />
                  </button>
                </div>
              </div>

              {assetMetadata.entityVersion > 0 && (
                <div className="inspector-version-line">
                  {t("inspector.versionLine", {
                    version: assetMetadata.entityVersion,
                  })}{" "}
                  ·{" "}
                  {formatDateShort(
                    assetMetadata.updatedAt,
                    t("common.unknownTime"),
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="inspector-metadata-placeholder" aria-hidden="true" />
          )}

          {/* Asset path */}
          <section className="inspector-section">
            <span className="inspector-section-label">{t("inspector.libraryPath")}</span>
            <p className="path-block">{selectedAsset.relativeFilePath}</p>
          </section>

          {/* --- AI Content --- */}
          {aiContent && (
            <section className="inspector-section">
              <div className="inspector-section-label">
                <span className="inspector-ai-badge">AI</span>
                {t("inspector.aiGenerated")}
              </div>
              {aiContent.description && (
                <div className="editor-field">
                  <label className="micro-label">{t("inspector.descriptionAi")}</label>
                  <p className="inspector-ai-text">{aiContent.description}</p>
                </div>
              )}
              {aiContent.tags && aiContent.tags.length > 0 && (
                <div className="editor-field">
                  <label className="micro-label">{t("inspector.tagsAi")}</label>
                  <div className="inspector-ai-tags">
                    {aiContent.tags.map((tag) => (
                      <span className="tag-chip" key={tag}>
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {aiContent.modelVersion && (
                <div className="inspector-version-line">
                  {aiContent.modelVersion}
                </div>
              )}
            </section>
          )}

          <button
            className="secondary-button inspector-close-library"
            onClick={() => void closeLibrary()}
            type="button"
          >
            {t("shell.closeLibrary")}
          </button>
        </div>
      ) : library ? (
        <div className="inspector-content">
          <div className="inspector-identity">
            <div className="inspector-badge">
              {initials(library.displayName)}
            </div>
            <div>
              <span className="micro-label">{t("inspector.currentLibrary")}</span>
              <strong>{library.displayName}</strong>
            </div>
          </div>
          <dl className="metadata-list">
            <div>
              <dt>{t("inspector.status")}</dt>
              <dd>
                <span className="status-dot" data-active="true" />
                {t("inspector.statusOpen")}
              </dd>
            </div>
            <div>
              <dt>{t("inspector.assets")}</dt>
              <dd className="mono">{allAssetCount}</dd>
            </div>
            <div>
              <dt>{t("inspector.folders")}</dt>
              <dd className="mono">{folderCount}</dd>
            </div>
          </dl>
          <section className="inspector-section">
            <span className="inspector-section-label">{t("inspector.location")}</span>
            <p className="path-block">{library.displayPath}</p>
          </section>
          <button
            className="secondary-button inspector-close-library"
            onClick={() => void closeLibrary()}
            type="button"
          >
            {t("shell.closeLibrary")}
          </button>
        </div>
      ) : (
        <div className="inspector-empty">
          <Icon name="info" size={18} />
          <strong>{t("inspector.noActiveLibrary")}</strong>
          <p>{t("inspector.openLibraryHint")}</p>
        </div>
      )}
    </aside>
  );
}
