import { type Dispatch, type SetStateAction } from "react";

import { Icon } from "./Icons";
import { formatDuration } from "./App";

import type { AssetSummary, AssetMetadataResult } from "../shared/asset-types";
import type { RendererLibrarySummary } from "../shared/protocol/responses";

// --- Local utility helpers (extracted from App.tsx) ---

function initials(value: string) {
  return value.trim().slice(0, 2).toUpperCase() || "SP";
}

function isCssColor(value: string) {
  return /^#[0-9a-f]{3,8}$/i.test(value) || /^(rgb|hsl)a?\(/i.test(value);
}

function extension(name: string) {
  const val = name.split(".").pop();
  return val && val !== name ? val.slice(0, 5).toUpperCase() : "FILE";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatDate(value: string) {
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
  label?: string;
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
  metadataLoading: boolean;
  assetMetadata: AssetMetadataResult | null;
  versionConflict: boolean;
  editLabel: string;
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
  handleMetadataLabelSave: () => void;
  handleMetadataLabelInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleMetadataDescriptionSave: () => void;
  handleMetadataDescriptionInput: (
    e: React.ChangeEvent<HTMLTextAreaElement>,
  ) => void;
  handleRatingClick: (star: number) => void;
  handleFavoriteToggle: () => void;
  handleSourceUrlSave: () => void;
  handleSourceUrlInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handlePaletteSave: () => void;
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
    metadataLoading,
    assetMetadata,
    versionConflict,
    editLabel,
    editDescription,
    editRating,
    editFavorite,
    editSourceUrl,
    editPalette,
    setEditPalette,
    displayedPalette,
    automaticPaletteRatios,
    aiContent,
    handleMetadataLabelSave,
    handleMetadataLabelInput,
    handleMetadataDescriptionSave,
    handleMetadataDescriptionInput,
    handleRatingClick,
    handleFavoriteToggle,
    handleSourceUrlSave,
    handleSourceUrlInput,
    handlePaletteSave,
  } = props;

  return (
    <aside className="inspector-pane">
      {selectedAsset ? (
        <div className="inspector-content">
          <div className="selected-file-hero">
            <Icon name="file" size={36} />
            <span>{extension(selectedAsset.displayName)}</span>
          </div>
          <div className="inspector-identity">
            <div>
              <span className="micro-label">当前选择</span>
              <strong>{selectedAsset.displayName}</strong>
            </div>
          </div>
          <dl className="metadata-list">
            <div>
              <dt>状态</dt>
              <dd>
                {selectedAsset.deletedAt
                  ? `回收站（${selectedAsset.remainingDays ?? "?"}天后自动清理）`
                  : selectedAsset.availability === "available"
                    ? "可用"
                    : "文件丢失"}
              </dd>
            </div>
            <div>
              <dt>大小</dt>
              <dd className="mono">{formatBytes(selectedAsset.byteSize)}</dd>
            </div>
            {selectedAsset.width !== null &&
              selectedAsset.height !== null && (
                <div>
                  <dt>分辨率</dt>
                  <dd className="mono">
                    {selectedAsset.width} × {selectedAsset.height}
                  </dd>
                </div>
              )}
            {selectedAsset.durationMs !== null && (
              <div>
                <dt>时长</dt>
                <dd className="mono">
                  {formatDuration(selectedAsset.durationMs)}
                </dd>
              </div>
            )}
            <div>
              <dt>修改</dt>
              <dd>{formatDate(selectedAsset.modifiedAt)}</dd>
            </div>
            {selectedAsset.deletedAt && (
              <div>
                <dt>删除时间</dt>
                <dd>{formatDate(selectedAsset.deletedAt)}</dd>
              </div>
            )}
            {selectedAsset.trashedFromPath && (
              <div>
                <dt>原始位置</dt>
                <dd className="mono" style={{ fontSize: 9 }}>
                  {selectedAsset.trashedFromPath}
                </dd>
              </div>
            )}
          </dl>
          {/* --- Asset metadata editor --- */}
          <section className="inspector-section">
            <h2>元数据</h2>
            {metadataLoading ? (
              <span className="micro-label">加载中…</span>
            ) : assetMetadata ? (
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
                  <label className="micro-label" htmlFor="meta-label">
                    标签 (Label)
                  </label>
                  <input
                    className="text-field"
                    id="meta-label"
                    maxLength={255}
                    onBlur={handleMetadataLabelSave}
                    onChange={handleMetadataLabelInput}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleMetadataLabelSave();
                    }}
                    style={{ height: 28, fontSize: 11 }}
                    value={editLabel}
                  />
                </div>
                <div className="editor-field" style={{ marginTop: 10 }}>
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
                  {formatDate(assetMetadata.updatedAt)}
                </div>
              </>
            ) : (
              <p className="nav-empty" style={{ margin: "4px 0 0" }}>
                选择资产以查看元数据
              </p>
            )}
          </section>
          <section className="inspector-section">
            <h2>资源库路径</h2>
            <p className="path-block">{selectedAsset.relativeFilePath}</p>
          </section>
          {/* --- AI Content --- */}
          {aiContent && (
            <section className="inspector-section">
              <h2 style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
              </h2>
              {aiContent.label && (
                <div className="editor-field" style={{ marginTop: 8 }}>
                  <label className="micro-label">标签 (Label) · AI</label>
                  <p
                    className="path-block"
                    style={{
                      color: "var(--secondary)",
                      fontSize: 11,
                      margin: "2px 0 0",
                    }}
                  >
                    {aiContent.label}
                  </p>
                </div>
              )}
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
            <h2>位置</h2>
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
