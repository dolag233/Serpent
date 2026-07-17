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
import {
  buildTagSuggestions,
  moveTagSuggestionIndex,
  type TagSuggestion,
} from "./tag-suggestions";

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

function formatDateFull(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "未知时间"
    : new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date);
}

function formatDateShort(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "未知时间"
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
  // REQ-MENU-007: total selected assets; tag ops apply to all of them when >= 2.
  selectionCount?: number;
}

function InspectorHero({
  asset,
  infoLine,
  library,
}: {
  asset: AssetSummary;
  infoLine: string;
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
        <span className="inspector-compact-meta">{infoLine}</span>
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
  } = props;

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

  // Compact info line builder — memoized to avoid crash when selectedAsset is undefined
  const compactInfoLine = useMemo(() => {
    if (!selectedAsset) return "";
    const parts: string[] = [];
    parts.push(formatBytes(selectedAsset.byteSize ?? 0));
    if (selectedAsset.width !== null && selectedAsset.height !== null) {
      parts.push(`${selectedAsset.width} × ${selectedAsset.height}`);
    }
    if (selectedAsset.durationMs !== null) {
      parts.push(formatDuration(selectedAsset.durationMs));
    }
    parts.push(formatDateFull(selectedAsset.modifiedAt ?? ""));
    return parts.join("  |  ");
  }, [selectedAsset]);

  return (
    <aside className="inspector-pane">
      {selectedAsset ? (
        <div className="inspector-content">
          <InspectorHero
            asset={selectedAsset}
            infoLine={compactInfoLine}
            key={selectedAsset.assetId}
            library={library}
          />
          <div className="inspector-compact-status">
            {selectedAsset.deletedAt
              ? `回收站（${selectedAsset.remainingDays ?? "?"}天后自动清理）`
              : selectedAsset.availability === "available"
                ? "可用"
                : "文件丢失"}
          </div>

          {/* Tag chips (REQ-TAG-003) */}
          <section className="inspector-section inspector-tags-section">
            <div className="inspector-tags-header">
              <span className="inspector-section-label">标签</span>
              <button
                className="tiny-action"
                aria-label="添加标签"
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
                      aria-label="移除此标签"
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
                <span className="tag-chip-placeholder">尚未添加标签</span>
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
                      aria-label="添加标签"
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
                      placeholder="搜索或创建标签…"
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
                              : `创建标签 “${suggestion.name}”`}
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
                标签操作将应用于 {selectionCount} 项资产
              </span>
            )}
          </section>

          {/* --- Asset metadata editor (compact) --- */}
          <section className="inspector-section">
            <span className="inspector-section-label">元数据</span>
            {assetMetadata ? (
              <>
                {versionConflict && (
                  <div className="inline-error">
                    <Icon name="warning" size={14} />
                    <div>
                      <strong>版本冲突</strong>
                      <p>元数据已被其他操作修改。请刷新以获取最新版本。</p>
                      <button
                        onClick={() => void loadMetadata()}
                        type="button"
                      >
                        刷新元数据
                      </button>
                    </div>
                  </div>
                )}
                <div className="editor-field">
                  <label className="micro-label" htmlFor="meta-desc">
                    描述
                  </label>
                  <textarea
                    className="text-field"
                    id="meta-desc"
                    maxLength={10000}
                    onBlur={handleMetadataDescriptionSave}
                    onChange={handleMetadataDescriptionInput}
                    rows={3}
                    style={{
                      height: "auto",
                      resize: "vertical",
                      fontSize: 11,
                      paddingTop: 6,
                    }}
                    value={editDescription}
                  />
                </div>
                <div className="editor-field" style={{ marginTop: 10 }}>
                  <label className="micro-label">评分</label>
                  <div style={{ display: "flex", gap: 2, marginTop: 3 }}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        aria-label={`${star} 星`}
                        onClick={() => handleRatingClick(star)}
                        style={{
                          padding: 0,
                          border: 0,
                          background: "transparent",
                          cursor: "pointer",
                          color:
                            star <= editRating
                              ? "#d99a3e"
                              : "var(--tertiary)",
                        }}
                        type="button"
                      >
                        <Icon name="star" size={16} />
                      </button>
                    ))}
                    {editRating > 0 && (
                      <button
                        aria-label="清除评分"
                        onClick={() => handleRatingClick(0)}
                        style={{
                          padding: "0 0 0 4px",
                          border: 0,
                          background: "transparent",
                          color: "var(--tertiary)",
                          cursor: "pointer",
                          fontSize: 10,
                        }}
                        type="button"
                      >
                        清除
                      </button>
                    )}
                  </div>
                </div>
                <div
                  className="editor-field"
                  style={{
                    marginTop: 10,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <label className="micro-label" style={{ flex: 1 }}>
                    喜欢
                  </label>
                  <button
                    aria-label={editFavorite ? "取消喜欢" : "标记喜欢"}
                    onClick={handleFavoriteToggle}
                    style={{
                      padding: 2,
                      border: 0,
                      background: "transparent",
                      cursor: "pointer",
                      color: editFavorite ? "#e76b7a" : "var(--tertiary)",
                    }}
                    type="button"
                  >
                    <Icon name="heart" size={18} />
                  </button>
                </div>
                <div className="editor-field" style={{ marginTop: 10 }}>
                  <label className="micro-label" htmlFor="meta-url">
                    源链接 (URL)
                  </label>
                  <input
                    className="text-field"
                    id="meta-url"
                    maxLength={255}
                    onBlur={handleSourceUrlSave}
                    onChange={handleSourceUrlInput}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSourceUrlSave();
                    }}
                    placeholder="https://…"
                    style={{ height: 28, fontSize: 11 }}
                    value={editSourceUrl}
                  />
                </div>
                <div className="editor-field" style={{ marginTop: 10 }}>
                  <label className="micro-label">
                    色卡 (Palette) ·{" "}
                    {assetMetadata.paletteSource === "manual"
                      ? "人工"
                      : assetMetadata.paletteSource === "automatic"
                        ? "自动"
                        : "待提取"}
                  </label>
                  <input
                    aria-label="人工色卡"
                    className="text-field"
                    maxLength={1024}
                    onBlur={handlePaletteSave}
                    onChange={(event) => setEditPalette(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") handlePaletteSave();
                    }}
                    placeholder="#C84C4C, #203040（最多 20 色）"
                    style={{ height: 28, fontSize: 10, marginTop: 3 }}
                    value={editPalette}
                  />
                  {displayedPalette.length > 0 && (
                    <div
                      className="palette-preview"
                      aria-label={`${assetMetadata.paletteSource === "manual" ? "人工" : "自动"}色卡预览`}
                    >
                      {displayedPalette.map((color, index) => {
                        const ratio =
                          assetMetadata.paletteSource === "automatic"
                            ? automaticPaletteRatios.get(color)
                            : undefined;
                        return (
                          <span
                            key={`${color}-${index}`}
                            style={{
                              background: isCssColor(color)
                                ? color
                                : "transparent",
                            }}
                            title={
                              ratio === undefined
                                ? color
                                : `${color} · ${(ratio * 100).toFixed(1)}%`
                            }
                          />
                        );
                      })}
                    </div>
                  )}
                  {assetMetadata.paletteSource === "automatic" && (
                    <p className="field-help" style={{ margin: "4px 0 0" }}>
                      本地算法从当前修订提取；填写上方颜色后将以人工色卡优先。
                    </p>
                  )}
                </div>
                <div
                  style={{
                    marginTop: 8,
                    color: "var(--tertiary)",
                    fontSize: 9,
                    fontFamily: "'IBM Plex Mono', monospace",
                  }}
                >
                  版本 {assetMetadata.entityVersion} ·{" "}
                  {formatDateShort(assetMetadata.updatedAt)}
                </div>
              </>
            ) : (
              <div className="inspector-metadata-placeholder" aria-hidden="true" />
            )}
          </section>

          {/* Asset path */}
          <section className="inspector-section">
            <span className="inspector-section-label">资源库路径</span>
            <p className="path-block">{selectedAsset.relativeFilePath}</p>
          </section>

          {/* --- AI Content --- */}
          {aiContent && (
            <section className="inspector-section">
              <div className="inspector-section-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    display: "inline-block",
                    padding: "1px 6px",
                    borderRadius: 3,
                    background: "var(--accent, #6c8ee0)",
                    color: "#fff",
                    fontSize: 9,
                    fontWeight: 700,
                    lineHeight: "16px",
                  }}
                >
                  AI
                </span>
                AI 生成内容
              </div>
              {aiContent.description && (
                <div className="editor-field" style={{ marginTop: 8 }}>
                  <label className="micro-label">描述 · AI</label>
                  <p
                    className="path-block"
                    style={{
                      color: "var(--secondary)",
                      fontSize: 11,
                      margin: "2px 0 0",
                    }}
                  >
                    {aiContent.description}
                  </p>
                </div>
              )}
              {aiContent.tags && aiContent.tags.length > 0 && (
                <div className="editor-field" style={{ marginTop: 8 }}>
                  <label className="micro-label">标签 · AI</label>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 4,
                      marginTop: 3,
                    }}
                  >
                    {aiContent.tags.map((tag) => (
                      <span className="tag-chip" key={tag}>
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {aiContent.modelVersion && (
                <div
                  style={{
                    marginTop: 8,
                    color: "var(--tertiary)",
                    fontSize: 9,
                    fontFamily: "'IBM Plex Mono', monospace",
                  }}
                >
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
            关闭资源库
          </button>
        </div>
      ) : library ? (
        <div className="inspector-content">
          <div className="inspector-identity">
            <div className="inspector-badge">
              {initials(library.displayName)}
            </div>
            <div>
              <span className="micro-label">当前资源库</span>
              <strong>{library.displayName}</strong>
            </div>
          </div>
          <dl className="metadata-list">
            <div>
              <dt>状态</dt>
              <dd>
                <span className="status-dot" data-active="true" />
                已打开
              </dd>
            </div>
            <div>
              <dt>资产</dt>
              <dd className="mono">{allAssetCount}</dd>
            </div>
            <div>
              <dt>文件夹</dt>
              <dd className="mono">{folderCount}</dd>
            </div>
          </dl>
          <section className="inspector-section">
            <span className="inspector-section-label">位置</span>
            <p className="path-block">{library.displayPath}</p>
          </section>
          <button
            className="secondary-button inspector-close-library"
            onClick={() => void closeLibrary()}
            type="button"
          >
            关闭资源库
          </button>
        </div>
      ) : (
        <div className="inspector-empty">
          <Icon name="info" size={18} />
          <strong>没有活动资源库</strong>
          <p>打开资源库后查看当前范围与资产详情。</p>
        </div>
      )}
    </aside>
  );
}
