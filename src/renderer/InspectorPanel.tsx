import {
  useState,
  useMemo,
  useRef,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";

import { Icon } from "./Icons";
import { IconActionButton } from "./icon-action-button";
import { iconActionAttrs } from "./icon-action-attrs";
import { formatDuration } from "./App";
import { resolveInspectorPreviewSrc } from "./inspector-preview";
import {
  isEditableScalar,
  pickInspectorStackAssets,
  type InspectorMultiEditModel,
} from "./inspector-multi-edit";
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
  /** Full multi-selection in canvas order; primary is still `selectedAsset`. */
  selectedAssets?: AssetSummary[];
  library: RendererLibrarySummary | null;
  allAssetCount: number;
  folderCount: number;
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
  // REQ-MENU-007 / REQ-SELECT-004: multi-select UE edit model (null = single-asset path).
  multiEdit?: InspectorMultiEditModel | null;
  /** 点击色卡分段复制颜色后的反馈（toast 由 App 统一发）。copied=false 表示剪贴板写入失败。 */
  onPaletteColorCopy?: (color: string, copied: boolean) => void;
  /** 在系统浏览器中打开当前源链接（URL 有效性由主进程二次校验）。 */
  onOpenSourceUrl?: () => void;
}

function InspectorHeroSinglePreview({
  asset,
  library,
}: {
  asset: AssetSummary;
  library: RendererLibrarySummary | null;
}) {
  const previewSrc = resolveInspectorPreviewSrc(asset, library);
  const [decoded, setDecoded] = useState(false);

  if (!previewSrc) {
    return (
      <div className="inspector-hero-preview inspector-hero-preview-fallback">
        <Icon name="file" size={20} />
      </div>
    );
  }

  return (
    <div className="inspector-hero-preview">
      {!decoded && <Icon name="file" size={20} />}
      <img
        alt={asset.displayName}
        className={
          decoded ? "inspector-hero-image" : "inspector-hero-image is-loading"
        }
        onLoad={(event) => {
          const image = event.currentTarget;
          if (image.complete && image.naturalWidth > 0) setDecoded(true);
        }}
        src={previewSrc}
      />
    </div>
  );
}

function InspectorHeroStackLayer({
  asset,
  library,
  layerIndex,
  layerCount,
}: {
  asset: AssetSummary;
  library: RendererLibrarySummary | null;
  layerIndex: number;
  layerCount: number;
}) {
  const previewSrc = resolveInspectorPreviewSrc(asset, library);
  const [decoded, setDecoded] = useState(false);
  const depthFromFront = layerCount - 1 - layerIndex;

  return (
    <div
      aria-hidden={depthFromFront > 0 || undefined}
      className="inspector-hero-stack-layer"
      data-depth={depthFromFront}
      style={{ zIndex: layerIndex + 1 }}
    >
      {previewSrc ? (
        <div className="inspector-hero-preview">
          {!decoded && <Icon name="file" size={20} />}
          <img
            alt=""
            className={
              decoded ? "inspector-hero-image" : "inspector-hero-image is-loading"
            }
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
    </div>
  );
}

function InspectorHero({
  asset,
  selectedAssets,
  infoParts,
  library,
  selectionCount,
}: {
  asset: AssetSummary;
  selectedAssets: readonly AssetSummary[];
  infoParts: string[];
  library: RendererLibrarySummary | null;
  selectionCount: number;
}) {
  const t = useT();
  const isMulti = selectionCount >= 2;
  const stackAssets = useMemo(
    () =>
      isMulti
        ? pickInspectorStackAssets(asset, selectedAssets, 3)
        : [asset],
    [asset, isMulti, selectedAssets],
  );
  const layers = useMemo(() => [...stackAssets].reverse(), [stackAssets]);
  const title = isMulti
    ? t("inspector.multiSelectionTitle", {
        name: asset.displayName,
        count: selectionCount,
      })
    : asset.displayName;

  return (
    <div className={`inspector-hero-compact${isMulti ? " is-multi" : ""}`}>
      {isMulti ? (
        <div
          aria-label={title}
          className="inspector-hero-stack"
          data-layer-count={layers.length}
        >
          {layers.map((layerAsset, index) => (
            <InspectorHeroStackLayer
              asset={layerAsset}
              key={layerAsset.assetId}
              layerCount={layers.length}
              layerIndex={index}
              library={library}
            />
          ))}
        </div>
      ) : (
        <InspectorHeroSinglePreview asset={asset} library={library} />
      )}
      <strong className="inspector-hero-title" title={title}>
        {title}
      </strong>
      {!isMulti && (
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
      )}
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
    selectedAssets = [],
    library,
    allAssetCount,
    folderCount,
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
    multiEdit = null,
    onPaletteColorCopy,
    onOpenSourceUrl,
  } = props;

  const t = useT();
  const isMultiEdit = multiEdit !== null && multiEdit.selectionCount >= 2;
  const selectionCount = Math.max(
    multiEdit?.selectionCount ?? 0,
    selectedAssets.length,
    selectedAsset ? 1 : 0,
  );

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

  // Single-asset: that asset's tags. Multi-select: intersection only (REQ-SELECT-004).
  const displayedTags = useMemo(() => {
    if (isMultiEdit && multiEdit) {
      return multiEdit.tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        source: tag.source,
      }));
    }
    if (!assetMetadata?.tags) return [];
    return assetMetadata.tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      source: tag.source as "ai" | "user",
    }));
  }, [assetMetadata, isMultiEdit, multiEdit]);

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
            key={`${selectedAsset.assetId}:${selectionCount}`}
            library={library}
            selectedAssets={
              selectedAssets.length > 0 ? selectedAssets : [selectedAsset]
            }
            selectionCount={selectionCount}
          />
          {!isMultiEdit &&
            selectionCount < 2 &&
            (selectedAsset.deletedAt ||
              selectedAsset.availability !== "available") && (
            <div
              className="inspector-status-row"
              data-tone={selectedAsset.deletedAt ? "trash" : "missing"}
            >
              <span aria-hidden="true" className="inspector-status-dot" />
              <span>
                {selectedAsset.deletedAt
                  ? t("inspector.trashedAutoClean", {
                      days: selectedAsset.remainingDays ?? "?",
                    })
                  : t("inspector.missing")}
              </span>
            </div>
          )}

          {/* Tag chips (REQ-TAG-003) */}
          <section className="inspector-section inspector-tags-section">
            <div className="inspector-tags-header">
              <span className="inspector-section-label">{t("inspector.tags")}</span>
              <IconActionButton
                icon="plus"
                label={t("inspector.addTag")}
                onClick={() => {
                  setShowTagInput(true);
                  setTagInputValue("");
                  setActiveTagSuggestionIndex(-1);
                }}
                size={12}
              />
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
                      className="tag-chip-remove"
                      onClick={() => onRemoveTagFromAsset(tag.id)}
                      type="button"
                      {...iconActionAttrs(t("inspector.removeTag"))}
                    >
                      <Icon name="close" size={9} />
                    </button>
                  )}
                </span>
              ))}
              {displayedTags.length === 0 && !showTagInput && (
                <span className="tag-chip-placeholder">
                  {isMultiEdit
                    ? t("inspector.noSharedTags")
                    : t("inspector.noTags")}
                </span>
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
                      title={t("inspector.addTag")}
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
          </section>

          {/* --- Asset metadata editor (compact) --- */}
          {assetMetadata || isMultiEdit ? (
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

              {/* 高频操作聚拢成一行：评分在左、喜欢在右。多选时不一致字段显示「多个值」并禁用。 */}
              {(() => {
                const ratingEditable =
                  !isMultiEdit || isEditableScalar(multiEdit?.rating);
                const favoriteEditable =
                  !isMultiEdit || isEditableScalar(multiEdit?.favorite);
                const ratingMixed = isMultiEdit && multiEdit?.rating.kind === "mixed";
                const favoriteMixed =
                  isMultiEdit && multiEdit?.favorite.kind === "mixed";
                return (
              <div className="inspector-quick-row">
                <div
                  aria-label={t("inspector.rating")}
                  className={`inspector-rating${ratingMixed ? " is-mixed" : ""}`}
                  role="group"
                >
                  {ratingMixed ? (
                    <span className="inspector-mixed-value">{t("inspector.mixedValues")}</span>
                  ) : (
                    <>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          aria-pressed={star <= editRating || undefined}
                          className="rating-star"
                          data-active={star <= editRating || undefined}
                          disabled={!ratingEditable}
                          key={star}
                          onClick={() => handleRatingClick(star)}
                          type="button"
                          {...iconActionAttrs(t("inspector.starAria", { star }))}
                        >
                          <Icon name="star" size={16} />
                        </button>
                      ))}
                      {editRating > 0 && (
                        <button
                          className="rating-clear"
                          disabled={!ratingEditable}
                          onClick={() => handleRatingClick(0)}
                          type="button"
                          {...iconActionAttrs(t("inspector.clearRating"))}
                        >
                          {t("common.clear")}
                        </button>
                      )}
                    </>
                  )}
                </div>
                {favoriteMixed ? (
                  <span className="inspector-mixed-value" title={t("inspector.favorite")}>
                    {t("inspector.mixedValues")}
                  </span>
                ) : (
                  <button
                    aria-pressed={editFavorite || undefined}
                    className="favorite-toggle"
                    data-active={editFavorite || undefined}
                    disabled={!favoriteEditable}
                    onClick={handleFavoriteToggle}
                    type="button"
                    {...iconActionAttrs(
                      editFavorite
                        ? t("inspector.unfavorite")
                        : t("inspector.markFavorite"),
                    )}
                  >
                    <Icon name="heart" size={17} />
                  </button>
                )}
              </div>
                );
              })()}

              {(() => {
                const paletteEditable =
                  !isMultiEdit || isEditableScalar(multiEdit?.palette);
                const paletteMixed =
                  isMultiEdit && multiEdit?.palette.kind === "mixed";
                const paletteSource = assetMetadata?.paletteSource ?? null;
                return (
              <div className="editor-field">
                <label className="micro-label">
                  {t("inspector.paletteLabel", {
                    source:
                      paletteSource === "manual"
                        ? t("inspector.paletteManual")
                        : paletteSource === "automatic"
                          ? t("inspector.paletteAuto")
                          : t("inspector.palettePending"),
                  })}
                </label>
                {paletteMixed ? (
                  <div className="text-field inspector-input inspector-mixed-field" aria-disabled="true">
                    {t("inspector.mixedValues")}
                  </div>
                ) : (
                  <>
                {displayedPalette.length > 0 && (
                  <div
                    aria-label={t("inspector.palettePreview", {
                      source:
                        paletteSource === "manual"
                          ? t("inspector.paletteManual")
                          : t("inspector.paletteAuto"),
                    })}
                    className="palette-preview"
                    role="group"
                  >
                    {displayedPalette.map((color, index) => {
                      const ratio =
                        paletteSource === "automatic"
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
                  title={t("inspector.manualPalette")}
                  className="text-field inspector-input inspector-palette-input"
                  disabled={!paletteEditable}
                  maxLength={1024}
                  onBlur={handlePaletteSave}
                  onChange={(event) => setEditPalette(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handlePaletteSave();
                  }}
                  placeholder={t("inspector.palettePlaceholder")}
                  value={editPalette}
                />
                {paletteSource === "automatic" && (
                  <p className="field-help">
                    {t("inspector.paletteHelp")}
                  </p>
                )}
                  </>
                )}
              </div>
                );
              })()}

              {(() => {
                const descriptionEditable =
                  !isMultiEdit || isEditableScalar(multiEdit?.description);
                const descriptionMixed =
                  isMultiEdit && multiEdit?.description.kind === "mixed";
                return (
              <div className="editor-field">
                <label className="micro-label" htmlFor="meta-desc">
                  {t("inspector.description")}
                </label>
                {descriptionMixed ? (
                  <div
                    className="text-field inspector-textarea inspector-mixed-field"
                    id="meta-desc"
                  >
                    {t("inspector.mixedValues")}
                  </div>
                ) : (
                <textarea
                  className="text-field inspector-textarea"
                  disabled={!descriptionEditable}
                  id="meta-desc"
                  maxLength={10000}
                  onBlur={handleMetadataDescriptionSave}
                  onChange={handleMetadataDescriptionInput}
                  placeholder={t("inspector.descriptionPlaceholder")}
                  ref={descriptionRef}
                  rows={2}
                  value={editDescription}
                />
                )}
              </div>
                );
              })()}

              {(() => {
                const sourceEditable =
                  !isMultiEdit || isEditableScalar(multiEdit?.sourceUrl);
                const sourceMixed =
                  isMultiEdit && multiEdit?.sourceUrl.kind === "mixed";
                return (
              <div className="editor-field">
                <label className="micro-label" htmlFor="meta-url">
                  {t("inspector.sourceUrl")}
                </label>
                <div className="source-url-field">
                  {sourceMixed ? (
                    <div
                      className="text-field inspector-input inspector-mixed-field"
                      id="meta-url"
                    >
                      {t("inspector.mixedValues")}
                    </div>
                  ) : (
                  <input
                    className="text-field inspector-input"
                    disabled={!sourceEditable}
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
                  )}
                  <button
                    aria-disabled={!canOpenSourceUrl || sourceMixed || undefined}
                    aria-label={
                      canOpenSourceUrl
                        ? t("inspector.openSourceUrl")
                        : t("inspector.sourceUrlInvalidHint")
                    }
                    className="source-url-open"
                    disabled={Boolean(sourceMixed) || !canOpenSourceUrl}
                    onClick={() => {
                      if (canOpenSourceUrl && !sourceMixed) onOpenSourceUrl?.();
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
                );
              })()}

              {assetMetadata && assetMetadata.entityVersion > 0 && (

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
