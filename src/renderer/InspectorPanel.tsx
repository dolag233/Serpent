import {
  useState,
  useMemo,
  useRef,
  useEffect,
} from "react";

import { Icon } from "./Icons";
import { IconActionButton } from "./icon-action-button";
import { iconActionAttrs } from "./icon-action-attrs";
import { formatDuration } from "./App";
import { resolveInspectorPreviewSrc } from "./inspector-preview";
import { resolveAutoGrowHeight } from "./inspector-description-autogrow";
import {
  fitInspectorStackFrame,
  isEditableScalar,
  pickInspectorStackAssets,
  type InspectorMultiEditModel,
} from "./inspector-multi-edit";
import { toOpenableExternalUrl } from "../shared/external-url";
import { shouldShowAutoPaletteSection } from "../shared/palette-visibility";
import { TextAssetPreviewTile } from "./TextAssetPreviewTile";
import {
  buildTagSuggestions,
  moveTagSuggestionIndex,
  type TagSuggestion,
} from "./tag-suggestions";
import { useT } from "./i18n";

import type { AssetSummary, AssetMetadataResult, ExtractedVideoMetadata, TagSummary } from "../shared/asset-types";
import type { PreviewResolution, SerpentLibraryApi } from "../shared/library-api";
import type { RendererLibrarySummary } from "../shared/protocol/responses";
import { formatAudioTechnicalLine, formatVideoTechnicalLine } from "./video-metadata-format";
import { isGifDisplayName } from "./gif-player-controls";
import {
  isCardHoverPreviewable,
  resolveLivePreviewMedia,
} from "./asset-card-hover-preview";
import { useAssetCardHoverPreview } from "./use-asset-card-hover-preview";

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
  rating?: number;
  modelVersion?: string;
}

export interface InspectorPanelProps {
  selectedAsset: AssetSummary | undefined;
  /** Full multi-selection in canvas order; primary is still `selectedAsset`. */
  selectedAssets?: AssetSummary[];
  library: RendererLibrarySummary | null;
  api?: SerpentLibraryApi | null;
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
  editAuthor: string;
  displayedPalette: string[];
  automaticPaletteRatios: Map<string, number>;
  aiContent: AiContent | null;
  /** True while an AI analyze request is in flight for the library. */
  aiAnalyzing?: boolean;
  /** Description field currently shows AI-layer text (human layer empty). */
  descriptionIsAi?: boolean;
  /** Serpent-t8sw: when false, hide AI corner badges (data retained). */
  showAiBadges?: boolean;
  // Metadata editor handlers
  handleMetadataDescriptionSave: () => void;
  handleMetadataDescriptionInput: (
    e: React.ChangeEvent<HTMLTextAreaElement>,
  ) => void;
  handleRatingClick: (star: number) => void;
  handleFavoriteToggle: () => void;
  handleSourceUrlSave: () => void;
  handleSourceUrlInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleAuthorSave: () => void;
  handleAuthorInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
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
  livePreview,
  api,
}: {
  asset: AssetSummary;
  library: RendererLibrarySummary | null;
  /** Ready GIF/video resolution to loop-play (Serpent-a9n); null = static only. */
  livePreview?: PreviewResolution | null;
  api?: SerpentLibraryApi | null;
}) {
  const t = useT();
  const previewSrc = resolveInspectorPreviewSrc(asset, library);
  const [decoded, setDecoded] = useState(false);
  const live = resolveLivePreviewMedia(Boolean(livePreview), livePreview);

  if (asset.mediaType === "text") {
    if (!api || !library) {
      return (
        <div className="inspector-hero-preview inspector-hero-preview-fallback">
          <Icon name="file" size={20} />
        </div>
      );
    }
    return (
      <TextAssetPreviewTile
        api={api}
        assetId={asset.assetId}
        className="inspector-hero-preview inspector-hero-text-preview text-asset-preview"
        libraryId={library.libraryId}
        revisionId={asset.currentRevisionId}
        snippetClassName="inspector-hero-text-snippet text-asset-preview-snippet"
      />
    );
  }

  if (!previewSrc && !live.url) {
    return (
      <div className="inspector-hero-preview inspector-hero-preview-fallback">
        <Icon name="file" size={20} />
      </div>
    );
  }

  if (live.kind === "video" && live.url) {
    return (
      <div className="inspector-hero-preview">
        <video
          autoPlay
          className="inspector-hero-image"
          loop
          muted
          playsInline
          poster={previewSrc ?? undefined}
          preload="metadata"
          src={live.url}
        />
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
        src={live.kind === "gif" && live.url ? live.url : (previewSrc ?? undefined)}
      />
    </div>
  );
}

function InspectorHeroStackLayer({
  asset,
  library,
  depthFromFront,
  zIndex,
  onPrimaryDecoded,
}: {
  asset: AssetSummary;
  library: RendererLibrarySummary | null;
  depthFromFront: number;
  zIndex: number;
  onPrimaryDecoded?: (size: { width: number; height: number }) => void;
}) {
  const previewSrc = resolveInspectorPreviewSrc(asset, library);
  const [decoded, setDecoded] = useState(false);

  return (
    <div
      aria-hidden={depthFromFront > 0 || undefined}
      className="inspector-hero-stack-layer"
      data-depth={depthFromFront}
      style={{ zIndex }}
    >
      {previewSrc ? (
        <img
          alt=""
          className={
            decoded
              ? "inspector-hero-stack-image"
              : "inspector-hero-stack-image is-loading"
          }
          onLoad={(event) => {
            const image = event.currentTarget;
            if (!(image.complete && image.naturalWidth > 0)) return;
            setDecoded(true);
            onPrimaryDecoded?.({
              width: image.naturalWidth,
              height: image.naturalHeight,
            });
          }}
          src={previewSrc}
        />
      ) : (
        <div className="inspector-hero-stack-fallback">
          <Icon name="file" size={20} />
        </div>
      )}
    </div>
  );
}

function InspectorHeroMultiStack({
  primary,
  stackAssets,
  library,
  title,
}: {
  primary: AssetSummary;
  stackAssets: readonly AssetSummary[];
  library: RendererLibrarySummary | null;
  title: string;
}) {
  const stackRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(
    null,
  );
  // Back → front so the primary (first in stackAssets) paints on top.
  const layers = useMemo(() => [...stackAssets].reverse(), [stackAssets]);

  const handlePrimaryDecoded = (natural: {
    width: number;
    height: number;
  }) => {
    const host = stackRef.current;
    if (!host) return;
    const styles = getComputedStyle(host);
    const padX =
      (Number.parseFloat(styles.paddingLeft) || 0) +
      (Number.parseFloat(styles.paddingRight) || 0);
    const maxWidth = Math.max(48, host.clientWidth - padX);
    // Keep stack short so the filename under multi-select never gets covered
    // by tall portrait frames (Serpent-hhy0 / fig2).
    const maxHeight = Math.min(140, Math.round(window.innerHeight * 0.22));
    setFrame(
      fitInspectorStackFrame(
        natural.width,
        natural.height,
        maxWidth,
        maxHeight,
      ),
    );
  };

  return (
    <div
      aria-label={title}
      className="inspector-hero-stack"
      data-layer-count={layers.length}
      ref={stackRef}
    >
      <div
        className="inspector-hero-stack-stage"
        style={
          frame ? { width: frame.width, height: frame.height } : undefined
        }
      >
        {layers.map((layerAsset, index) => {
          const depthFromFront = layers.length - 1 - index;
          const isPrimaryLayer = layerAsset.assetId === primary.assetId;
          return (
            <InspectorHeroStackLayer
              asset={layerAsset}
              depthFromFront={depthFromFront}
              key={layerAsset.assetId}
              library={library}
              onPrimaryDecoded={
                isPrimaryLayer ? handlePrimaryDecoded : undefined
              }
              zIndex={index + 1}
            />
          );
        })}
      </div>
    </div>
  );
}

function InspectorHero({
  asset,
  selectedAssets,
  infoParts,
  library,
  selectionCount,
  livePreview,
  api,
}: {
  asset: AssetSummary;
  selectedAssets: readonly AssetSummary[];
  infoParts: string[];
  library: RendererLibrarySummary | null;
  selectionCount: number;
  /** Serpent-a9n: only ever passed/used for single selection. */
  livePreview?: PreviewResolution | null;
  api?: SerpentLibraryApi | null;
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
  const title = isMulti
    ? t("inspector.multiSelectionTitle", {
        name: asset.displayName,
        count: selectionCount,
      })
    : asset.displayName;

  return (
    <div className={`inspector-hero-compact${isMulti ? " is-multi" : ""}`}>
      {isMulti ? (
        <InspectorHeroMultiStack
          key={`${asset.assetId}:${selectionCount}:${stackAssets
            .map((item) => item.assetId)
            .join(",")}`}
          library={library}
          primary={asset}
          stackAssets={stackAssets}
          title={title}
        />
      ) : (
        <InspectorHeroSinglePreview
          api={api}
          asset={asset}
          library={library}
          livePreview={livePreview}
        />
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
    api = null,
    allAssetCount,
    folderCount,
    loadMetadata,
    assetMetadata: rawAssetMetadata,
    versionConflict,
    editDescription,
    editRating,
    editFavorite,
    editSourceUrl,
    editAuthor,
    displayedPalette,
    automaticPaletteRatios,
    aiContent,
    aiAnalyzing = false,
    descriptionIsAi = false,
    showAiBadges = true,
    handleMetadataDescriptionSave,
    handleMetadataDescriptionInput,
    handleRatingClick,
    handleFavoriteToggle,
    handleSourceUrlSave,
    handleSourceUrlInput,
    handleAuthorSave,
    handleAuthorInput,
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

  // Serpent-a9n: single-selection GIF/video loops in the Inspector hero;
  // multi-selection never plays (isPreviewable is gated on selectionCount < 2,
  // independent of the canvas's own hover-preview so hovering an unrelated
  // card elsewhere never interrupts this asset's Inspector preview).
  const isSingleSelection = selectionCount < 2;
  const heroPreviewTargetId =
    isSingleSelection && selectedAsset ? selectedAsset.assetId : undefined;
  const isHeroPreviewable = (assetId: string) =>
    Boolean(
      isSingleSelection &&
        selectedAsset &&
        selectedAsset.assetId === assetId &&
        isCardHoverPreviewable(selectedAsset),
    );
  const { activePreviewAssetId: heroPreviewAssetId, activeResolution: heroPreview } =
    useAssetCardHoverPreview({
      api,
      libraryId: library?.libraryId,
      primarySelectedAssetId: heroPreviewTargetId,
      isPreviewable: isHeroPreviewable,
    });

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
  const [videoTechCache, setVideoTechCache] = useState<{
    assetId: string;
    metadata: ExtractedVideoMetadata;
  } | null>(null);

  useEffect(() => {
    if (showTagInput && tagInputRef.current) {
      tagInputRef.current.focus();
    }
  }, [showTagInput]);

  // REQ-VIEW-003 / CU-D8 / Serpent-i07: fetch extracted metadata for video /
  // audio tech lines and GIF frames. Display is derived from cache identity
  // so selection changes do not sync-setState.
  useEffect(() => {
    const assetId = selectedAsset?.assetId ?? null;
    const libraryId = library?.libraryId ?? null;
    const isVideo = selectedAsset?.mediaType === "video";
    const isAudio = selectedAsset?.mediaType === "audio";
    const isGif =
      selectedAsset != null && isGifDisplayName(selectedAsset.displayName);
    const shouldFetch =
      Boolean(
        api &&
          libraryId &&
          assetId &&
          (isVideo || isAudio || isGif) &&
          selectionCount < 2,
      );

    if (!shouldFetch || !api || !libraryId || !assetId) {
      return;
    }

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const maxAttempts = 15;

    const load = async () => {
      try {
        const result = await api.getExtractedMetadata({ libraryId, assetId });
        if (cancelled) return;
        if (!result.ok) return;
        if (result.value.status === "ready" && result.value.metadata) {
          setVideoTechCache({
            assetId,
            metadata: result.value.metadata,
          });
          return;
        }
        if (
          (result.value.status === "pending" || result.value.status === "missing")
          && attempts < maxAttempts
        ) {
          attempts += 1;
          pollTimer = setTimeout(() => {
            void load();
          }, 2000);
        }
      } catch {
        // Best-effort; Inspector stays without the tech line.
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [
    api,
    library?.libraryId,
    selectedAsset,
    selectionCount,
  ]);

  const videoTechMetadata =
    selectedAsset?.mediaType === "video"
    && selectionCount < 2
    && videoTechCache?.assetId === selectedAsset.assetId
      ? videoTechCache.metadata
      : null;

  const audioTechMetadata =
    selectedAsset?.mediaType === "audio"
    && selectionCount < 2
    && videoTechCache?.assetId === selectedAsset.assetId
      ? videoTechCache.metadata
      : null;

  const gifExtractedMetadata =
    selectedAsset != null
    && isGifDisplayName(selectedAsset.displayName)
    && selectionCount < 2
    && videoTechCache?.assetId === selectedAsset.assetId
      ? videoTechCache.metadata
      : null;

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

  // 描述输入框高度自动包裹内容（Serpent-qto）：默认单行，受控值变化（输入/
  // 切换资产）后重新量高，超过一行才增高。CSS 侧的 min-height/max-height 是
  // 同一对边界的可视化兜底（resize:none + 超出后内部滚动）；这里的常量与其
  // 保持一致，避免两处漂移。
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const textarea = descriptionRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const minHeight = Number.parseFloat(
      getComputedStyle(textarea).minHeight || "0",
    );
    const maxHeight = Number.parseFloat(
      getComputedStyle(textarea).maxHeight || "0",
    );
    textarea.style.height = `${resolveAutoGrowHeight(
      textarea.scrollHeight,
      minHeight || 0,
      maxHeight || Number.POSITIVE_INFINITY,
    )}px`;
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
    const durationMs =
      selectedAsset.durationMs
      ?? (gifExtractedMetadata?.durationMs != null
        && gifExtractedMetadata.durationMs > 0
        ? gifExtractedMetadata.durationMs
        : null);
    if (durationMs !== null) {
      parts.push(formatDuration(durationMs));
    }
    parts.push(formatDateFull(selectedAsset.modifiedAt ?? "", unknownTime));
    return parts;
  }, [selectedAsset, t, gifExtractedMetadata]);

  // REQ-INSPECT-005 / Serpent-i07: codec tech sits in a bottom bar, not the compact size row.
  const technicalInfoParts = useMemo(() => {
    if (!selectedAsset || selectionCount >= 2) return [];
    const parts: string[] = [];
    if (
      gifExtractedMetadata?.frameCount != null
      && gifExtractedMetadata.frameCount > 0
    ) {
      parts.push(
        t("inspector.gifFrameCount", { count: gifExtractedMetadata.frameCount }),
      );
    }
    if (selectedAsset.mediaType === "video" && videoTechMetadata) {
      const techLine = formatVideoTechnicalLine(videoTechMetadata);
      if (techLine) parts.push(techLine);
    }
    if (selectedAsset.mediaType === "audio" && audioTechMetadata) {
      const techLine = formatAudioTechnicalLine(audioTechMetadata);
      if (techLine) parts.push(techLine);
    }
    return parts;
  }, [
    selectedAsset,
    selectionCount,
    t,
    videoTechMetadata,
    audioTechMetadata,
    gifExtractedMetadata,
  ]);

  return (
    <aside className="inspector-pane">
      {selectedAsset ? (
        <div className="inspector-content">
          <InspectorHero
            api={api}
            asset={selectedAsset}
            infoParts={compactInfoParts}
            key={`${selectedAsset.assetId}:${selectionCount}`}
            library={library}
            livePreview={
              heroPreviewAssetId === selectedAsset.assetId ? heroPreview : null
            }
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
                  {tag.source === "ai" && showAiBadges && (
                    <span
                      aria-label={t("inspector.aiBadge")}
                      className="inspector-ai-badge inspector-ai-badge-inline"
                      title={t("inspector.aiBadge")}
                    >
                      AI
                    </span>
                  )}
                  {tag.source !== "ai" && (
                    <span className="tag-chip-dot" style={{ background: tagColor(tag.id) }} />
                  )}
                  <span className="tag-chip-name">{tag.name}</span>
                  {onRemoveTagFromAsset && (
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
                          tabIndex={-1}
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
                const aiRating =
                  !isMultiEdit && editRating === 0
                    ? aiContent?.rating
                    : undefined;
                const displayRating =
                  editRating > 0 ? editRating : (aiRating ?? 0);
                return (
              <div className="inspector-quick-row">
                <div
                  aria-label={t("inspector.rating")}
                  className={`inspector-rating${ratingMixed ? " is-mixed" : ""}${aiRating != null ? " is-ai" : ""}`}
                  role="group"
                >
                  {ratingMixed ? (
                    <span className="inspector-mixed-value">{t("inspector.mixedValues")}</span>
                  ) : (
                    <>
                      {aiRating != null && showAiBadges && (
                        <span
                          aria-label={t("inspector.ratingAi")}
                          className="inspector-ai-badge inspector-ai-badge-inline"
                          title={t("inspector.ratingAi")}
                        >
                          AI
                        </span>
                      )}
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          aria-pressed={star <= displayRating || undefined}
                          className="rating-star"
                          data-active={star <= displayRating || undefined}
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
                // Serpent-uz1: palette chrome is image/video only — never show
                // pending extract UI for audio/text/other (e.g. waveform covers).
                const paletteMediaTypes = (
                  selectedAssets.length > 0
                    ? selectedAssets
                    : selectedAsset
                      ? [selectedAsset]
                      : []
                ).map((asset) => asset.mediaType);
                if (!shouldShowAutoPaletteSection(paletteMediaTypes)) {
                  return null;
                }
                return (
              <div className="editor-field editor-field-palette">
                {/* Serpent-l79c: no「色卡 · 自动」label — swatches alone. */}
                {displayedPalette.length > 0 ? (
                  <div
                    aria-label={t("inspector.palettePreviewAuto")}
                    className="palette-preview"
                    role="group"
                  >
                    {displayedPalette.map((color, index) => {
                      const ratio = automaticPaletteRatios.get(color);
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
                ) : (
                  <p className="field-help">{t("inspector.palettePendingHelp")}</p>
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
                  {descriptionIsAi && showAiBadges && (
                    <span
                      aria-label={t("inspector.aiBadge")}
                      className="inspector-ai-badge inspector-ai-badge-inline"
                      title={t("inspector.aiBadge")}
                    >
                      AI
                    </span>
                  )}
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
                  className={`text-field inspector-textarea${descriptionIsAi ? " is-ai-sourced" : ""}`}
                  disabled={!descriptionEditable}
                  id="meta-desc"
                  maxLength={10000}
                  onBlur={handleMetadataDescriptionSave}
                  onChange={handleMetadataDescriptionInput}
                  placeholder={
                    aiAnalyzing
                      ? t("toast.aiAnalyzeStarted")
                      : t("inspector.descriptionPlaceholder")
                  }
                  ref={descriptionRef}
                  rows={1}
                  value={editDescription}
                />
                )}
              </div>
                );
              })()}

              {(() => {
                const authorEditable =
                  !isMultiEdit || isEditableScalar(multiEdit?.author);
                const authorMixed =
                  isMultiEdit && multiEdit?.author.kind === "mixed";
                return (
              <div className="editor-field">
                <label className="micro-label" htmlFor="meta-author">
                  {t("inspector.author")}
                </label>
                {authorMixed ? (
                  <div
                    className="text-field inspector-input inspector-mixed-field"
                    id="meta-author"
                  >
                    {t("inspector.mixedValues")}
                  </div>
                ) : (
                <input
                  className="text-field inspector-input"
                  disabled={!authorEditable}
                  id="meta-author"
                  maxLength={255}
                  onBlur={handleAuthorSave}
                  onChange={handleAuthorInput}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAuthorSave();
                  }}
                  placeholder={t("inspector.authorPlaceholder")}
                  value={editAuthor}
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

          {aiAnalyzing && (
            <div className="inspector-ai-analyzing" role="status">
              <span className="activity-pulse" />
              {t("toast.aiAnalyzeStarted")}
            </div>
          )}

          {technicalInfoParts.length > 0 && (
            <div
              aria-label={t("inspector.technicalMetadata")}
              className="inspector-tech-bar"
            >
              {technicalInfoParts.map((part) => (
                <span className="inspector-tech-part" key={part}>
                  {part}
                </span>
              ))}
            </div>
          )}

        </div>
      ) : library ? (
        <div className="inspector-content">
          <div className="inspector-identity">
            <div aria-hidden="true" className="inspector-badge">
              {initials(library.displayName)}
            </div>
            <div>
              <span className="micro-label">{t("inspector.currentLibrary")}</span>
              <strong>
                <span className="inspector-identity-name">
                  {library.displayName}
                </span>
              </strong>
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
