import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";

import {
  ContextMenu,
  ContextMenuBackdrop,
  ContextMenuItem,
  ContextMenuProvider,
  useContextMenu,
} from "./context-menu";

import type {
  AiSearchPlan,
  AssetSummary,
  AssetMetadataResult,
  CollectionSummary,
  FilterClause,
  LinkedFolderRule,
  LinkedFolderSummary,
  ManagedFolderSummary,
  SearchScope,
  SmartCollectionSummary,
  SortDefinition,
  TagSummary,
} from "../shared/asset-types";
import type {
  SerpentLibraryApi,
  RelinkBatchPreviewResult,
  ImportValidatedResult,
  MediaJobStatus,
  AiJobStatus,
} from "../shared/library-api";
import type { SerpentExtensionPairingApi } from "../shared/extension-pairing";
import type {
  PublicError,
  PublicErrorCode,
  PublicErrorReason,
} from "../shared/protocol/errors";
import type {
  ImportConflictPlan,
  RendererLibrarySummary,
  ExportProgressEvent,
  ImportProgressEvent,
} from "../shared/protocol/responses";
import { AssetPreviewModal } from "./AssetPreviewModal";
import {
  CARD_SIZE_MAX,
  CARD_SIZE_MIN,
  loadCanvasPreferences,
  saveCanvasPreferences,
  type CanvasPreferences,
} from "./canvas-preferences";

type RendererWindow = Window & {
  serpent?: {
    library?: SerpentLibraryApi;
    extensionPairing?: SerpentExtensionPairingApi;
  };
};
type UiState =
  | "booting"
  | "idle"
  | "creating"
  | "opening"
  | "closing"
  | "loading"
  | "importing"
  | "ready";
type DialogKind = "library" | "folder" | "tag" | "collection" | null;
type AssetScope = "all" | "root" | string;
type OrganizationKind = "tag" | "collection" | "smart";
type OrganizationRenameTarget = {
  kind: OrganizationKind;
  id: string;
  name: string;
};
type SearchDefinition = {
  search?: {
    clauses: Array<{
      field: string | null;
      values: string[];
      exclude: boolean;
    }>;
  };
  filters?: FilterClause[];
  sort?: SortDefinition;
};
type StoredBrowserSession = {
  version: 1;
  scope:
    | { kind: "all" | "root" | "trash" }
    | {
        kind: "folder" | "tag" | "collection" | "smart";
        id: string;
        name?: string;
      };
  selectedAssetId: string;
  selectedAssetName: string;
};
const ASSET_PAGE_SIZE = 50;

function browserSessionKey(libraryId: string): string {
  return `serpent.browser-session.v1.${libraryId}`;
}

function readBrowserSession(libraryId: string): StoredBrowserSession | null {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(browserSessionKey(libraryId)) ?? "null",
    ) as unknown;
    if (!value || typeof value !== "object") return null;
    const session = value as Partial<StoredBrowserSession>;
    if (
      session.version !== 1 ||
      typeof session.selectedAssetId !== "string" ||
      typeof session.selectedAssetName !== "string" ||
      !session.scope ||
      typeof session.scope !== "object" ||
      ![
        "all",
        "root",
        "trash",
        "folder",
        "tag",
        "collection",
        "smart",
      ].includes(session.scope.kind)
    )
      return null;
    if (
      ["folder", "tag", "collection", "smart"].includes(session.scope.kind) &&
      !("id" in session.scope && typeof session.scope.id === "string")
    )
      return null;
    return session as StoredBrowserSession;
  } catch {
    return null;
  }
}
type IconName =
  | "archive"
  | "chevron"
  | "close"
  | "collection"
  | "collapse-left"
  | "collapse-right"
  | "file"
  | "folder"
  | "grid"
  | "heart"
  | "info"
  | "link"
  | "menu"
  | "plus"
  | "refresh"
  | "search"
  | "smart"
  | "star"
  | "tag"
  | "trash"
  | "upload"
  | "warning";

const iconPaths: Record<IconName, ReactNode> = {
  archive: (
    <>
      <path d="M4 7h16v12H4z" />
      <path d="M3 4h18v3H3zM9 11h6" />
    </>
  ),
  chevron: <path d="m9 18 6-6-6-6" />,
  close: <path d="m7 7 10 10M17 7 7 17" />,
  collection: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="1.5" />
      <path d="m8 14 3-3 5 5 2-2 2 2" />
    </>
  ),
  "collapse-left": (
    <>
      <path d="M5 4h14v16H5zM10 4v16" />
      <path d="m15 9-3 3 3 3" />
    </>
  ),
  "collapse-right": (
    <>
      <path d="M5 4h14v16H5zM14 4v16" />
      <path d="m9 9 3 3-3 3" />
    </>
  ),
  file: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v5h5" />
    </>
  ),
  folder: <path d="M3 6.5h7l2 2h9v10H3z" />,
  grid: (
    <>
      <rect x="4" y="4" width="6" height="6" />
      <rect x="14" y="4" width="6" height="6" />
      <rect x="4" y="14" width="6" height="6" />
      <rect x="14" y="14" width="6" height="6" />
    </>
  ),
  heart: (
    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.8 1.1-1.1a5.5 5.5 0 0 0 0-7.8Z" />
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7h.01" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: (
    <>
      <path d="M20 7v5h-5" />
      <path d="M18.4 16a8 8 0 1 1 1.3-8.5L20 12" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  smart: (
    <path d="m12 3 1.7 5.3H19l-4.3 3.2 1.6 5.2-4.3-3.2-4.3 3.2 1.6-5.2L5 8.3h5.3z" />
  ),
  star: (
    <path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.9-6.2-3.3-6.2 3.3 1.2-6.9-5-4.9 6.9-1z" />
  ),
  tag: <path d="M4 5h7l9 9-6 6-9-9zM8 8h.01" />,
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4m0 0L7 9m5-5 5 5" />
      <path d="M4 14v6h16v-6" />
    </>
  ),
  warning: (
    <>
      <path d="M12 3 2.8 20h18.4z" />
      <path d="M12 9v5m0 3h.01" />
    </>
  ),
};

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
    >
      {iconPaths[name]}
    </svg>
  );
}
function ToolButton({
  label,
  icon,
  onClick,
  pressed,
  disabled,
}: {
  label: string;
  icon: IconName;
  onClick?: () => void;
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={pressed}
      className="tool-button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon name={icon} />
    </button>
  );
}
function NavRow({
  icon,
  label,
  count,
  active,
  onClick,
  onContextMenu,
  onDragOver,
  onDrop,
  depth = 0,
  disabled,
}: {
  icon: IconName;
  label: string;
  count?: number;
  active?: boolean;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDragOver?: (e: React.DragEvent<HTMLButtonElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLButtonElement>) => void;
  depth?: number;
  disabled?: boolean;
}) {
  return (
    <button
      className={`nav-row${active ? " is-active" : ""}`}
      disabled={disabled}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{ paddingLeft: 7 + depth * 14 }}
      type="button"
    >
      <Icon name={icon} size={15} />
      <span>{label}</span>
      {count !== undefined && <span className="nav-count">{count}</span>}
    </button>
  );
}
function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: () => void;
  children: ReactNode;
}) {
  return (
    <section className="nav-section">
      <div className="nav-section-heading">
        <span>{title}</span>
        {action && (
          <button
            aria-label={`添加${title}`}
            className="tiny-action"
            onClick={action}
            type="button"
          >
            <Icon name="plus" size={13} />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

type TechnicalRangeInput = { min: string; max: string; exclude: boolean };
function TechnicalRangeFilter({
  label,
  range,
  setRange,
  step = "1",
}: {
  label: string;
  range: TechnicalRangeInput;
  setRange: Dispatch<SetStateAction<TechnicalRangeInput>>;
  step?: string;
}) {
  return (
    <label>
      {label}
      <div className="numeric-filter-range">
        <input
          aria-label={`${label}最小值`}
          className="text-field"
          min="0"
          onChange={(event) =>
            setRange((current) => ({ ...current, min: event.target.value }))
          }
          placeholder="最小"
          step={step}
          type="number"
          value={range.min}
        />
        <span>–</span>
        <input
          aria-label={`${label}最大值`}
          className="text-field"
          min="0"
          onChange={(event) =>
            setRange((current) => ({ ...current, max: event.target.value }))
          }
          placeholder="最大"
          step={step}
          type="number"
          value={range.max}
        />
      </div>
      <span>
        <input
          aria-label={`排除${label}范围`}
          checked={range.exclude}
          disabled={!range.min && !range.max}
          onChange={(event) =>
            setRange((current) => ({
              ...current,
              exclude: event.target.checked,
            }))
          }
          type="checkbox"
        />
        排除
      </span>
    </label>
  );
}

function AppInner() {
  const api = (window as RendererWindow).serpent?.library;
  const extensionPairingApi = (window as RendererWindow).serpent
    ?.extensionPairing;
  // Library / folder / assets (existing)
  const [library, setLibrary] = useState<RendererLibrarySummary | null>(null);
  const [folders, setFolders] = useState<ManagedFolderSummary[]>([]);
  const [linkedFolders, setLinkedFolders] = useState<LinkedFolderSummary[]>([]);
  const [copyLinkedTargetId, setCopyLinkedTargetId] = useState("");
  const [linkedRulesEditor, setLinkedRulesEditor] = useState<{
    folderId: string;
    name: string;
    rules: LinkedFolderRule[];
  } | null>(null);
  const [convertLinkedDialog, setConvertLinkedDialog] = useState<{
    folderId: string;
    name: string;
    targetFolderId: string;
  }>({ folderId: "", name: "", targetFolderId: "" });
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [assetScope, setAssetScope] = useState<AssetScope>("all");
  const managedImportTargetFolderIdRef = useRef<string | undefined>(undefined);
  const [allAssetCount, setAllAssetCount] = useState(0);
  const [selectedAssetId, setSelectedAssetId] = useState<string | undefined>();
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const selectionAnchorRef = useRef<string | null>(null);
  const [uiState, setUiState] = useState<UiState>("booting");
  const busy = [
    "booting",
    "creating",
    "opening",
    "closing",
    "loading",
    "importing",
  ].includes(uiState);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [dialogValue, setDialogValue] = useState("我的资源库");
  const [conflicts, setConflicts] = useState<ImportConflictPlan | null>(null);
  const [duplicateDecision, setDuplicateDecision] = useState<
    "skip" | "merge" | "create-copy"
  >("skip");
  const [nameDecision, setNameDecision] = useState<
    "keep-both" | "replace" | "skip"
  >("keep-both");
  const [externalDropActive, setExternalDropActive] = useState(false);
  const externalDragDepth = useRef(0);
  const [leftOpen, setLeftOpen] = useState(() => window.innerWidth > 800);
  const [rightOpen, setRightOpen] = useState(() => window.innerWidth > 1020);

  // Tags
  const [tags, setTags] = useState<TagSummary[]>([]);
  const [activeTagId, setActiveTagId] = useState<string | null>(null);

  // Collections
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(
    null,
  );
  const [collectionRecursive, setCollectionRecursive] = useState(true);
  const collectionRecursiveRef = useRef(collectionRecursive);
  const [collectionEditor, setCollectionEditor] = useState<{
    collectionId: string;
    description: string;
    coverAssetId: string;
  } | null>(null);
  const [draggedCollectionId, setDraggedCollectionId] = useState<string | null>(
    null,
  );
  const [draggedMemberId, setDraggedMemberId] = useState<string | null>(null);
  const [batchTagId, setBatchTagId] = useState("");
  const [batchCollectionId, setBatchCollectionId] = useState("");

  // Smart collections
  const [smartCollections, setSmartCollections] = useState<
    SmartCollectionSummary[]
  >([]);
  const [activeSmartCollectionId, setActiveSmartCollectionId] = useState<
    string | null
  >(null);
  const [searchValue, setSearchValue] = useState("");
  const [formatFilter, setFormatFilter] = useState("");
  const [excludeFormatFilter, setExcludeFormatFilter] = useState(false);
  const [tagFilter, setTagFilter] = useState("");
  const [excludeTagFilter, setExcludeTagFilter] = useState(false);
  const [ratingFilter, setRatingFilter] = useState("");
  const [excludeRatingFilter, setExcludeRatingFilter] = useState(false);
  const [favoriteFilter, setFavoriteFilter] = useState<"any" | "yes" | "no">(
    "any",
  );
  const [sourceUrlFilter, setSourceUrlFilter] = useState<"any" | "yes" | "no">(
    "any",
  );
  const [availabilityFilter, setAvailabilityFilter] = useState<
    "any" | "available" | "missing"
  >("any");
  const [excludeAvailabilityFilter, setExcludeAvailabilityFilter] =
    useState(false);
  const [widthRange, setWidthRange] = useState({
    min: "",
    max: "",
    exclude: false,
  });
  const [heightRange, setHeightRange] = useState({
    min: "",
    max: "",
    exclude: false,
  });
  const [aspectRatioRange, setAspectRatioRange] = useState({
    min: "",
    max: "",
    exclude: false,
  });
  const [durationRange, setDurationRange] = useState({
    min: "",
    max: "",
    exclude: false,
  });
  const [sortField, setSortField] = useState<
    "relevance" | SortDefinition["field"]
  >("relevance");
  const [sortOrder, setSortOrder] = useState<SortDefinition["order"]>("asc");
  const [, setSearchOffset] = useState(0);
  const [searchTotal, setSearchTotal] = useState<number | null>(null);
  const [searchSnippets, setSearchSnippets] = useState<Map<string, string>>(
    new Map(),
  );
  const [aiSearchEnabled, setAiSearchEnabled] = useState(false);
  const [aiSearchLoading, setAiSearchLoading] = useState(false);
  const [activeAiSearchDefinition, setActiveAiSearchDefinition] =
    useState<SearchDefinition | null>(null);
  const [aiSearchPlanSummary, setAiSearchPlanSummary] = useState<string | null>(
    null,
  );
  const [smartCollectionName, setSmartCollectionName] = useState("");
  const { open: openContextMenu, close: closeContextMenu, active: activeContextMenu } =
    useContextMenu();
  const hadDiscoveryInput = useRef(false);
  const reloadCurrentContentRef = useRef<() => Promise<void>>(
    async () => undefined,
  );

  // Metadata editor
  const [assetMetadata, setAssetMetadata] =
    useState<AssetMetadataResult | null>(null);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [versionConflict, setVersionConflict] = useState(false);
  const selectedAssetIdRef = useRef(selectedAssetId);
  useEffect(() => {
    selectedAssetIdRef.current = selectedAssetId;
  }, [selectedAssetId]);
  const metadataByAssetRef = useRef(new Map<string, AssetMetadataResult>());
  const metadataConflictAssetIdsRef = useRef(new Set<string>());
  const metadataSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  // Pending edit values
  const [editLabel, setEditLabel] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editRating, setEditRating] = useState(0);
  const [editFavorite, setEditFavorite] = useState(false);
  const [editSourceUrl, setEditSourceUrl] = useState("");
  const [editPalette, setEditPalette] = useState("");

  // Inline tag/collection editors
  const [showTagInput, setShowTagInput] = useState(false);
  const [tagInputValue, setTagInputValue] = useState("");
  const [showCollectionInput, setShowCollectionInput] = useState(false);
  const [collectionInputValue, setCollectionInputValue] = useState("");
  const [newCollectionParentId, setNewCollectionParentId] = useState<
    string | null
  >(null);
  const [renameTarget, setRenameTarget] =
    useState<OrganizationRenameTarget | null>(null);

  // Trash / Delete / Relink state
  const [showTrash, setShowTrash] = useState(false);
  const [trashedAssets, setTrashedAssets] = useState<AssetSummary[]>([]);
  const [deleteLinkedDialog, setDeleteLinkedDialog] = useState<{
    assetIds: string[];
    displayNames: string;
    deleteSourceFile: boolean;
    canDeleteSourceFile: boolean;
  } | null>(null);
  const [permanentDeleteDialog, setPermanentDeleteDialog] = useState<
    string[] | null
  >(null);
  const [restoreDialog, setRestoreDialog] = useState<{
    assetIds: string[];
    target: "original" | "root" | string;
    conflictStrategy: "keep-both" | "replace" | "skip";
  } | null>(null);
  const [moveDialog, setMoveDialog] = useState<{
    assetIds: string[];
    targetFolderId: string | null;
    conflictStrategy: "keep-both" | "replace" | "skip";
  } | null>(null);
  const [lastMoveOperationId, setLastMoveOperationId] = useState<string | null>(
    null,
  );
  const [undoMoveDialog, setUndoMoveDialog] = useState<{
    operationId: string;
    conflictStrategy: "keep-both" | "replace" | "skip";
  } | null>(null);
  const [batchRelinkPreview, setBatchRelinkPreview] =
    useState<RelinkBatchPreviewResult | null>(null);
  const [batchRelinkKeepMetadata, setBatchRelinkKeepMetadata] = useState(true);

  // Export / Import state
  const [exportProgress, setExportProgress] =
    useState<ExportProgressEvent | null>(null);
  const [importProgress, setImportProgress] =
    useState<ImportProgressEvent | null>(null);

  // AI analysis state
  const [aiConfigOpen, setAiConfigOpen] = useState(false);
  const [aiProvider, setAiProvider] = useState<
    "openai" | "gemini" | "anthropic"
  >("openai");
  const [aiModel, setAiModel] = useState("gpt-4o-mini");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiHasKey, setAiHasKey] = useState(false);
  const [aiLabelEnabled, setAiLabelEnabled] = useState(true);
  const [aiDescriptionEnabled, setAiDescriptionEnabled] = useState(true);
  const [aiTagsEnabled, setAiTagsEnabled] = useState(true);
  const [aiStructuredEnabled, setAiStructuredEnabled] = useState(false);
  const [aiLanguage, setAiLanguage] = useState("auto");
  const [aiAutoAnalyzeEnabled, setAiAutoAnalyzeEnabled] = useState(false);
  const [aiDisclaimerAccepted, setAiDisclaimerAccepted] = useState(false);
  const [extensionPairingOpen, setExtensionPairingOpen] = useState(false);
  const [extensionPairingToken, setExtensionPairingToken] = useState("");
  const [extensionPairingError, setExtensionPairingError] = useState<
    string | null
  >(null);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiContent, setAiContent] = useState<{
    label?: string;
    description?: string;
    tags?: string[];
    structuredMetadata?: Record<string, unknown>;
    modelVersion?: string;
  } | null>(null);
  const [importValidated, setImportValidated] =
    useState<ImportValidatedResult | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [includeLinkedContent, setIncludeLinkedContent] = useState(false);
  const [exportFormat, setExportFormat] = useState<"folder" | "zip">("folder");

  // Thumbnail / Preview state
  const [previewAsset, setPreviewAsset] = useState<AssetSummary | null>(null);
  const [canvasPrefs, setCanvasPrefs] = useState<CanvasPreferences>(() =>
    loadCanvasPreferences(),
  );
  const assetViewMode = canvasPrefs.viewMode;
  const assetCardSize = canvasPrefs.cardSize;
  const [loadingMoreAssets, setLoadingMoreAssets] = useState(false);
  const workspaceCanvasRef = useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreAssetsRef = useRef<() => Promise<void>>(async () => undefined);
  const pendingRestoredFocusRef = useRef<string | null>(null);
  const previewFocusReturnRef = useRef<string | null>(null);
  const closingPreviewRef = useRef<string | null>(null);
  const [thumbnailFailures, setThumbnailFailures] = useState<
    Map<string, string>
  >(new Map());
  const [mediaJobsOpen, setMediaJobsOpen] = useState(false);
  const [mediaJobs, setMediaJobs] = useState<MediaJobStatus | null>(null);
  const [aiJobs, setAiJobs] = useState<AiJobStatus | null>(null);
  const [mediaJobsLoading, setMediaJobsLoading] = useState(false);

  const selectedFolderId =
    assetScope === "all" || assetScope === "root" ? undefined : assetScope;
  const selectedFolder = folders.find(
    (folder) => folder.folderId === selectedFolderId,
  );
  const selectedAsset = showTrash
    ? trashedAssets.find((a) => a.assetId === selectedAssetId)
    : assets.find((asset) => asset.assetId === selectedAssetId);
  const displayedPalette = assetMetadata?.effectivePalette ?? [];
  const automaticPaletteRatios = new Map(
    (assetMetadata?.automaticPalette ?? []).map((color) => [
      color.hex,
      color.ratio,
    ]),
  );

  const visibleAssets = useMemo(() => {
    if (showTrash) return trashedAssets;
    return assets;
  }, [assets, trashedAssets, showTrash]);
  const previewIndex = previewAsset
    ? visibleAssets.findIndex((asset) => asset.assetId === previewAsset.assetId)
    : -1;
  const selectedIdSet = useMemo(
    () => new Set(selectedAssetIds),
    [selectedAssetIds],
  );
  const selectedAssets = useMemo(
    () => visibleAssets.filter((asset) => selectedIdSet.has(asset.assetId)),
    [selectedIdSet, visibleAssets],
  );

  const resizeAssetCards = useCallback(
    (requestedSize: number, clientX?: number, clientY?: number) => {
      const root = workspaceCanvasRef.current;
      const nextSize = Math.min(
        CARD_SIZE_MAX,
        Math.max(CARD_SIZE_MIN, Math.round(requestedSize)),
      );
      if (!root || nextSize === assetCardSize) return;

      const rootRect = root.getBoundingClientRect();
      const anchorX = clientX ?? rootRect.left + rootRect.width / 2;
      const anchorY = clientY ?? rootRect.top + rootRect.height / 2;
      const cards = Array.from(
        root.querySelectorAll<HTMLElement>("[data-asset-id]"),
      );
      const pointed = document
        .elementFromPoint(anchorX, anchorY)
        ?.closest<HTMLElement>("[data-asset-id]");
      const anchor =
        (pointed && root.contains(pointed) ? pointed : null) ??
        cards
          .filter((card) => {
            const rect = card.getBoundingClientRect();
            return rect.bottom > rootRect.top && rect.top < rootRect.bottom;
          })
          .sort((left, right) => {
            const a = left.getBoundingClientRect();
            const b = right.getBoundingClientRect();
            const ad = Math.hypot(
              a.left + a.width / 2 - anchorX,
              a.top + a.height / 2 - anchorY,
            );
            const bd = Math.hypot(
              b.left + b.width / 2 - anchorX,
              b.top + b.height / 2 - anchorY,
            );
            return ad - bd;
          })[0];
      const anchorRect = anchor?.getBoundingClientRect();
      const anchorState =
        anchor && anchorRect
          ? {
              assetId: anchor.dataset.assetId!,
              ratioX: anchorRect.width
                ? (anchorX - anchorRect.left) / anchorRect.width
                : 0.5,
              ratioY: anchorRect.height
                ? (anchorY - anchorRect.top) / anchorRect.height
                : 0.5,
              clientX: anchorX,
              clientY: anchorY,
            }
          : null;

      setCanvasPrefs((p) => ({ ...p, cardSize: nextSize }));
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (!anchorState || !workspaceCanvasRef.current) return;
          const restored = Array.from(
            workspaceCanvasRef.current.querySelectorAll<HTMLElement>(
              "[data-asset-id]",
            ),
          ).find((card) => card.dataset.assetId === anchorState.assetId);
          if (!restored) return;
          const rect = restored.getBoundingClientRect();
          workspaceCanvasRef.current.scrollLeft +=
            rect.left + rect.width * anchorState.ratioX - anchorState.clientX;
          workspaceCanvasRef.current.scrollTop +=
            rect.top + rect.height * anchorState.ratioY - anchorState.clientY;
        });
      });
    },
    [assetCardSize],
  );

  useEffect(() => {
    saveCanvasPreferences(canvasPrefs);
  }, [canvasPrefs]);

  useEffect(() => {
    const canvas = workspaceCanvasRef.current;
    if (!canvas) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || previewAsset) return;
      event.preventDefault();
      const delta =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? event.deltaY * 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? event.deltaY * canvas.clientHeight
            : event.deltaY;
      resizeAssetCards(
        assetCardSize * Math.exp(-delta * 0.002),
        event.clientX,
        event.clientY,
      );
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [assetCardSize, previewAsset, resizeAssetCards]);

  function clearAssetSelection() {
    setSelectedAssetId(undefined);
    setSelectedAssetIds([]);
    selectionAnchorRef.current = null;
  }

  function selectAsset(event: React.MouseEvent, assetId: string) {
    const visibleIds = visibleAssets.map((asset) => asset.assetId);
    if (event.shiftKey && selectionAnchorRef.current) {
      const anchorIndex = visibleIds.indexOf(selectionAnchorRef.current);
      const targetIndex = visibleIds.indexOf(assetId);
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const range = visibleIds.slice(
          Math.min(anchorIndex, targetIndex),
          Math.max(anchorIndex, targetIndex) + 1,
        );
        setSelectedAssetIds(
          event.metaKey || event.ctrlKey
            ? (current) => [...new Set([...current, ...range])]
            : range,
        );
        setSelectedAssetId(assetId);
        return;
      }
    }
    if (event.metaKey || event.ctrlKey) {
      setSelectedAssetIds((current) => {
        if (current.includes(assetId)) {
          const next = current.filter((id) => id !== assetId);
          setSelectedAssetId(next.at(-1));
          if (next.length === 0) selectionAnchorRef.current = null;
          return next;
        }
        setSelectedAssetId(assetId);
        return [...current, assetId];
      });
      selectionAnchorRef.current = assetId;
      return;
    }
    setSelectedAssetIds([assetId]);
    setSelectedAssetId(assetId);
    selectionAnchorRef.current = assetId;
  }

  function openAssetPreview(asset: AssetSummary) {
    if (asset.availability !== "available" || asset.deletedAt) return;
    previewFocusReturnRef.current = asset.assetId;
    setSelectedAssetIds([asset.assetId]);
    setSelectedAssetId(asset.assetId);
    selectionAnchorRef.current = asset.assetId;
    setPreviewAsset(asset);
  }

  function navigateAssetPreview(asset: AssetSummary) {
    setSelectedAssetIds([asset.assetId]);
    setSelectedAssetId(asset.assetId);
    selectionAnchorRef.current = asset.assetId;
    previewFocusReturnRef.current = asset.assetId;
    setPreviewAsset(asset);
  }

  const closeAssetPreview = useCallback(async () => {
    const closingAsset = previewAsset;
    if (!closingAsset) return;
    if (closingPreviewRef.current === closingAsset.assetId) return;
    closingPreviewRef.current = closingAsset.assetId;
    setPreviewAsset(null);
    const assetId = previewFocusReturnRef.current;
    previewFocusReturnRef.current = null;
    window.requestAnimationFrame(() => {
      workspaceCanvasRef.current
        ?.querySelector<HTMLElement>(`[data-asset-id="${assetId ?? ""}"]`)
        ?.focus({ preventScroll: true });
    });
    try {
      if (api && library) {
        await api.closePreview({
          libraryId: library.libraryId,
          assetId: closingAsset.assetId,
        });
      }
    } catch {
      // Closing the local viewer must still work while Main is shutting down.
    } finally {
      if (closingPreviewRef.current === closingAsset.assetId) {
        closingPreviewRef.current = null;
      }
    }
  }, [api, library, previewAsset]);

  // Collection tree helper
  const collectionTree = useMemo(() => {
    const byParent = new Map<string | null, CollectionSummary[]>();
    for (const c of collections) {
      const key = c.parentId;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(c);
    }
    for (const children of byParent.values())
      children.sort((a, b) => a.position - b.position);
    return byParent;
  }, [collections]);

  function renderCollectionNodes(
    parentId: string | null,
    depth: number,
  ): ReactNode {
    const children = collectionTree.get(parentId) ?? [];
    return children.map((c) => (
      <div
        className="collection-drop-target"
        draggable
        key={c.collectionId}
        onDragEnd={() => setDraggedCollectionId(null)}
        onDragOver={(event) => {
          if (
            draggedCollectionId ||
            supportsExternalImportTransfer(event.dataTransfer)
          )
            event.preventDefault();
        }}
        onDragStart={(event) => {
          event.stopPropagation();
          setDraggedCollectionId(c.collectionId);
          event.dataTransfer.effectAllowed = "move";
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (draggedCollectionId) {
            void reorderCollectionSibling(draggedCollectionId, c.collectionId);
          } else if (supportsExternalImportTransfer(event.dataTransfer)) {
            const payload = externalImportPayload(event.dataTransfer);
            void importDroppedFiles(
              payload.files,
              undefined,
              c.collectionId,
              payload,
            );
          }
        }}
      >
        <NavRow
          icon="collection"
          label={c.name}
          count={c.assetCount}
          active={activeCollectionId === c.collectionId && !activeTagId}
          depth={depth}
          onContextMenu={(e) => {
            e.preventDefault();
            openContextMenu(
              { type: "organization", orgKind: "collection", id: c.collectionId, name: c.name },
              { x: e.clientX, y: e.clientY },
            );
          }}
          onClick={() => void chooseCollection(c.collectionId)}
        />
        {renderCollectionNodes(c.collectionId, depth + 1)}
      </div>
    ));
  }

  const loadContent = useCallback(
    async (
      activeLibrary: RendererLibrarySummary,
      scope: AssetScope,
      opts?: {
        trashMode?: boolean;
        discovery?: SearchDefinition;
        searchScope?: SearchScope;
      },
    ) => {
      if (!api) return;
      const trashMode = opts?.trashMode ?? false;
      const browseScope: SearchScope | undefined =
        opts?.searchScope ??
        (trashMode
          ? { kind: "trash" }
          : scope === "all"
            ? undefined
            : scope === "root"
              ? { kind: "folder", folderId: null, recursive: false }
              : { kind: "folder", folderId: scope, recursive: false });
      const libId = { libraryId: activeLibrary.libraryId };
      const [
        folderResult,
        assetResult,
        allResult,
        linkedResult,
        tagResult,
        collectionResult,
        smartResult,
      ] = await Promise.all([
        api.listFolders(libId),
        api.searchAssets({
          ...libId,
          query: opts?.discovery?.search ?? null,
          filters: opts?.discovery?.filters,
          scope: browseScope,
          sort: opts?.discovery?.sort,
          limit: ASSET_PAGE_SIZE,
          offset: 0,
        }),
        trashMode || scope === "all"
          ? Promise.resolve(undefined)
          : api.searchAssets({ ...libId, query: null, limit: 1, offset: 0 }),
        api.listLinkedFolders(libId),
        api.listTags(libId),
        api.listCollections(libId),
        api.listSmartCollections(libId),
      ]);
      if (!folderResult.ok) throw new LibraryOperationError(folderResult.error);
      if (!assetResult.ok) throw new LibraryOperationError(assetResult.error);
      if (allResult && !allResult.ok)
        throw new LibraryOperationError(allResult.error);
      if (!linkedResult.ok) throw new LibraryOperationError(linkedResult.error);
      if (!tagResult.ok) throw new LibraryOperationError(tagResult.error);
      if (!collectionResult.ok)
        throw new LibraryOperationError(collectionResult.error);
      if (!smartResult.ok) throw new LibraryOperationError(smartResult.error);
      setFolders(folderResult.value);
      if (trashMode) {
        setTrashedAssets(assetResult.value.items);
      } else {
        setAssets(assetResult.value.items);
      }
      if (!trashMode) {
        setAllAssetCount(allResult?.value.total ?? assetResult.value.total);
      }
      setSearchTotal(assetResult.value.total);
      setSearchOffset(assetResult.value.offset);
      setSearchSnippets(new Map());
      setLinkedFolders(linkedResult.value);
      setTags(tagResult.value);
      setCollections(collectionResult.value);
      setSmartCollections(smartResult.value);
      return assetResult.value.items;
    },
    [api],
  );

  const restore = useCallback(async () => {
    if (!api) {
      setError("无法连接到 Serpent 桌面服务。请重新启动应用。");
      setUiState("idle");
      return;
    }
    let activeLibrary: RendererLibrarySummary | null = null;
    try {
      const result = await api.listOpen();
      if (!result.ok) throw new LibraryOperationError(result.error);
      activeLibrary = result.value[0] ?? null;
      setLibrary(activeLibrary);
      setShowTrash(false);
      setTrashedAssets([]);
      if (activeLibrary) {
        let restoredItems = (await loadContent(activeLibrary, "all")) ?? [];
        const session = readBrowserSession(activeLibrary.libraryId);
        if (session) {
          try {
            let searchScope: SearchScope | undefined;
            let searchFilters: FilterClause[] | undefined;
            if (session.scope.kind === "trash") {
              setShowTrash(true);
              setAssetScope("all");
              restoredItems =
                (await loadContent(activeLibrary, "all", {
                  trashMode: true,
                })) ?? [];
              searchScope = { kind: "trash" };
            } else if (session.scope.kind === "root") {
              setAssetScope("root");
              restoredItems = (await loadContent(activeLibrary, "root")) ?? [];
              searchScope = {
                kind: "folder",
                folderId: null,
                recursive: false,
              };
            } else if (session.scope.kind === "folder") {
              setAssetScope(session.scope.id);
              restoredItems =
                (await loadContent(activeLibrary, session.scope.id)) ?? [];
              searchScope = {
                kind: "folder",
                folderId: session.scope.id,
                recursive: false,
              };
            } else if (session.scope.kind === "tag" && session.scope.name) {
              searchFilters = [
                { field: "tag", values: [session.scope.name], exclude: false },
              ];
              const result = await api.searchAssets({
                libraryId: activeLibrary.libraryId,
                query: null,
                filters: searchFilters,
                limit: ASSET_PAGE_SIZE,
                offset: 0,
              });
              if (!result.ok) throw new LibraryOperationError(result.error);
              setActiveTagId(session.scope.id);
              setTagFilter(session.scope.name);
              setAssets(result.value.items);
              setSearchTotal(result.value.total);
              restoredItems = result.value.items;
            } else if (session.scope.kind === "collection") {
              searchScope = {
                kind: "collection",
                collectionId: session.scope.id,
                recursive: collectionRecursiveRef.current,
              };
              const result = await api.searchAssets({
                libraryId: activeLibrary.libraryId,
                query: null,
                scope: searchScope,
                limit: ASSET_PAGE_SIZE,
                offset: 0,
              });
              if (!result.ok) throw new LibraryOperationError(result.error);
              setActiveCollectionId(session.scope.id);
              setAssets(result.value.items);
              setSearchTotal(result.value.total);
              restoredItems = result.value.items;
            } else if (session.scope.kind === "smart") {
              const result = await api.executeSmartCollection({
                libraryId: activeLibrary.libraryId,
                collectionId: session.scope.id,
                limit: ASSET_PAGE_SIZE,
                offset: 0,
              });
              if (!result.ok) throw new LibraryOperationError(result.error);
              setActiveSmartCollectionId(session.scope.id);
              setAssets(result.value.items);
              setSearchTotal(result.value.total);
              restoredItems = result.value.items;
            }

            let restoredAsset = restoredItems.find(
              (asset) => asset.assetId === session.selectedAssetId,
            );
            if (!restoredAsset && session.scope.kind === "smart") {
              for (
                let offset = ASSET_PAGE_SIZE;
                !restoredAsset;
                offset += ASSET_PAGE_SIZE
              ) {
                const result = await api.executeSmartCollection({
                  libraryId: activeLibrary.libraryId,
                  collectionId: session.scope.id,
                  limit: ASSET_PAGE_SIZE,
                  offset,
                });
                if (!result.ok || result.value.items.length === 0) break;
                restoredAsset = result.value.items.find(
                  (asset) => asset.assetId === session.selectedAssetId,
                );
                if (offset + result.value.items.length >= result.value.total)
                  break;
              }
            } else if (!restoredAsset) {
              for (let offset = 0; !restoredAsset; offset += 200) {
                const result = await api.searchAssets({
                  libraryId: activeLibrary.libraryId,
                  query: {
                    clauses: [
                      {
                        field: "filename",
                        values: [session.selectedAssetName],
                        exclude: false,
                      },
                    ],
                  },
                  filters: searchFilters,
                  scope: searchScope,
                  limit: 200,
                  offset,
                });
                if (!result.ok || result.value.items.length === 0) break;
                restoredAsset = result.value.items.find(
                  (asset) => asset.assetId === session.selectedAssetId,
                );
                if (offset + result.value.items.length >= result.value.total)
                  break;
              }
            }
            if (restoredAsset) {
              if (session.scope.kind === "trash") {
                setTrashedAssets((current) =>
                  current.some(
                    (asset) => asset.assetId === restoredAsset!.assetId,
                  )
                    ? current
                    : [...current, restoredAsset!],
                );
              } else {
                setAssets((current) =>
                  current.some(
                    (asset) => asset.assetId === restoredAsset!.assetId,
                  )
                    ? current
                    : [...current, restoredAsset!],
                );
              }
              setSelectedAssetId(restoredAsset.assetId);
              setSelectedAssetIds([restoredAsset.assetId]);
              selectionAnchorRef.current = restoredAsset.assetId;
              pendingRestoredFocusRef.current = restoredAsset.assetId;
            }
          } catch (sessionError) {
            console.warn(
              "Saved browser session could not be restored.",
              sessionError,
            );
            setShowTrash(false);
            setAssetScope("all");
            setActiveTagId(null);
            setActiveCollectionId(null);
            setActiveSmartCollectionId(null);
            await loadContent(activeLibrary, "all");
          }
        }
      }
      setUiState(activeLibrary ? "ready" : "idle");
    } catch (caught) {
      setError(toMessage(caught, "无法恢复工作区。"));
      setUiState(activeLibrary ? "ready" : "idle");
    }
  }, [api, loadContent, setError]);
  useEffect(() => {
    void Promise.resolve().then(restore);
  }, [restore]);
  useEffect(() => {
    if (!library || !selectedAsset) return;
    const scope: StoredBrowserSession["scope"] = showTrash
      ? { kind: "trash" }
      : activeTagId
        ? {
            kind: "tag",
            id: activeTagId,
            name: tags.find((tag) => tag.tagId === activeTagId)?.name,
          }
        : activeCollectionId
          ? { kind: "collection", id: activeCollectionId }
          : activeSmartCollectionId
            ? { kind: "smart", id: activeSmartCollectionId }
            : assetScope === "all" || assetScope === "root"
              ? { kind: assetScope }
              : { kind: "folder", id: assetScope };
    const session: StoredBrowserSession = {
      version: 1,
      scope,
      selectedAssetId: selectedAsset.assetId,
      selectedAssetName: selectedAsset.displayName,
    };
    window.localStorage.setItem(
      browserSessionKey(library.libraryId),
      JSON.stringify(session),
    );
  }, [
    activeCollectionId,
    activeSmartCollectionId,
    activeTagId,
    assetScope,
    library,
    selectedAsset,
    showTrash,
    tags,
  ]);
  useEffect(() => {
    const assetId = pendingRestoredFocusRef.current;
    if (!assetId) return;
    const frame = window.requestAnimationFrame(() => {
      const card = Array.from(
        workspaceCanvasRef.current?.querySelectorAll<HTMLElement>(
          "[data-asset-id]",
        ) ?? [],
      ).find((candidate) => candidate.dataset.assetId === assetId);
      if (!card) return;
      card.scrollIntoView({ block: "center", inline: "center" });
      card.focus({ preventScroll: true });
      pendingRestoredFocusRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [assets, trashedAssets, selectedAssetId]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5_000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [error]);
  useEffect(() => {
    if (!api) return;
    return api.onThumbnailEvent((event) => {
      if (event.libraryId !== library?.libraryId) return;
      setThumbnailFailures((current) => {
        const next = new Map(current);
        if (event.type === "asset.thumbnail.failed") {
          next.set(
            event.assetId,
            event.reason ?? "缩略图生成失败。请检查源文件后重试。",
          );
        } else next.delete(event.assetId);
        return next;
      });
      setAssets((current) =>
        current.map((asset) => {
          if (asset.assetId !== event.assetId) return asset;
          if (event.type === "asset.thumbnail.ready" && event.artifactId) {
            return {
              ...asset,
              thumbnailStatus: "ready",
              thumbnailArtifactId: event.artifactId,
            };
          }
          return {
            ...asset,
            thumbnailStatus: "failed",
            thumbnailArtifactId: null,
          };
        }),
      );
    });
  }, [api, library?.libraryId]);
  useEffect(() => {
    if (!api || !library) return;
    const unsubscribeProgress = api.onAiProgress((event) => {
      if (event.libraryId !== library.libraryId) return;
      setAiJobs((current) =>
        current
          ? {
              ...current,
              queued: event.queued,
              running: event.running,
              succeeded: event.succeeded,
              failed: event.failed,
            }
          : current,
      );
    });
    const unsubscribeCompleted = api.onAiCompleted((event) => {
      if (event.libraryId !== library.libraryId) return;
      setNotice(
        `AI 分析完成：写入 ${event.fieldCount} 个字段、${event.tagCount} 个标签。`,
      );
      void reloadCurrentContentRef.current();
    });
    const unsubscribeCleared = api.onAiCleared((event) => {
      if (event.libraryId !== library.libraryId) return;
      setNotice(`已清除 ${event.affectedAssetCount} 项资产的 AI 内容。`);
      void reloadCurrentContentRef.current();
    });
    return () => {
      unsubscribeProgress();
      unsubscribeCompleted();
      unsubscribeCleared();
    };
  }, [api, library]);

  async function runLibraryOperation(kind: "create" | "open") {
    if (!api) return;
    setError(null);
    setUiState(kind === "create" ? "creating" : "opening");
    let opened = false;
    try {
      const result =
        kind === "create"
          ? await api.create({ displayName: dialogValue.trim() })
          : await api.open();
      if (!result.ok) {
        if (result.error.code === "CANCELLED") return;
        throw new LibraryOperationError(result.error);
      }
      opened = true;
      setLibrary(result.value);
      setAssetScope("all");
      setActiveTagId(null);
      setActiveCollectionId(null);
      setActiveSmartCollectionId(null);
      api?.setActiveContext(result.value.libraryId);
      await loadContent(result.value, "all");
    } catch (caught) {
      setError(toMessage(caught, "资源库操作失败。"));
    } finally {
      setUiState(opened ? "ready" : "idle");
    }
  }

  function clearDiscoveryControls() {
    setSearchValue("");
    setActiveAiSearchDefinition(null);
    setAiSearchPlanSummary(null);
    setFormatFilter("");
    setExcludeFormatFilter(false);
    setTagFilter("");
    setExcludeTagFilter(false);
    setRatingFilter("");
    setExcludeRatingFilter(false);
    setFavoriteFilter("any");
    setSourceUrlFilter("any");
    setAvailabilityFilter("any");
    setExcludeAvailabilityFilter(false);
    setWidthRange({ min: "", max: "", exclude: false });
    setHeightRange({ min: "", max: "", exclude: false });
    setAspectRatioRange({ min: "", max: "", exclude: false });
    setDurationRange({ min: "", max: "", exclude: false });
    setSortField("relevance");
    setSortOrder("asc");
    hadDiscoveryInput.current = false;
  }

  async function chooseFolder(scope: AssetScope) {
    if (!library) return;
    closeContextMenu();
    workspaceCanvasRef.current?.scrollTo({ top: 0, left: 0 });
    setShowTrash(false);
    setAssetScope(scope);
    clearAssetSelection();
    setActiveTagId(null);
    setActiveCollectionId(null);
    setActiveSmartCollectionId(null);
    clearDiscoveryControls();
    setSearchTotal(null);
    setSearchSnippets(new Map());
    const folderId = scope === "all" || scope === "root" ? undefined : scope;
    managedImportTargetFolderIdRef.current =
      folderId && folders.some((folder) => folder.folderId === folderId)
        ? folderId
        : undefined;
    api?.setActiveContext(library.libraryId, folderId);
    setUiState("loading");
    try {
      await loadContent(library, scope);
    } catch (caught) {
      setError(toMessage(caught, "无法读取资产。"));
    } finally {
      setUiState("ready");
    }
  }

  async function enterTrash() {
    if (!library) return;
    workspaceCanvasRef.current?.scrollTo({ top: 0, left: 0 });
    setShowTrash(true);
    setActiveTagId(null);
    setActiveCollectionId(null);
    setActiveSmartCollectionId(null);
    setSearchTotal(null);
    setSearchSnippets(new Map());
    clearAssetSelection();
    setAssetScope("all");
    clearDiscoveryControls();
    api?.setActiveContext(library.libraryId);
    setUiState("loading");
    try {
      await loadContent(library, "all", { trashMode: true });
    } catch (caught) {
      setError(toMessage(caught, "无法读取回收站。"));
    } finally {
      setUiState("ready");
    }
  }

  // --- Tag CRUD ---

  async function createTag() {
    if (!api || !library || !tagInputValue.trim()) return;
    setUiState("loading");
    try {
      const result = await api.createTag({
        libraryId: library.libraryId,
        name: tagInputValue.trim(),
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setShowTagInput(false);
      setTagInputValue("");
      await reloadCurrentContent();
    } catch (caught) {
      setError(toOrganizationMessage(caught, "tag", "创建"));
    } finally {
      setUiState("ready");
    }
  }

  async function deleteTag(tagId: string) {
    if (!api || !library) return;
    setUiState("loading");
    try {
      const result = await api.deleteTag({
        libraryId: library.libraryId,
        tagId,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      if (activeTagId === tagId) {
        setActiveTagId(null);
        clearDiscoveryControls();
        await loadContent(library, assetScope);
      } else {
        // Refresh tag list only
        const tagResult = await api.listTags({ libraryId: library.libraryId });
        if (!tagResult.ok) throw new LibraryOperationError(tagResult.error);
        setTags(tagResult.value);
      }
      setError(null);
      setNotice("标签已删除。");
    } catch (caught) {
      setError(toOrganizationMessage(caught, "tag", "删除"));
    } finally {
      setUiState("ready");
    }
  }

  async function renameTag() {
    if (
      !api ||
      !library ||
      !renameTarget ||
      renameTarget.kind !== "tag" ||
      !renameTarget.name.trim()
    )
      return;
    setUiState("loading");
    try {
      const result = await api.renameTag({
        libraryId: library.libraryId,
        tagId: renameTarget.id,
        name: renameTarget.name.trim(),
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setTags((current) =>
        current.map((tag) =>
          tag.tagId === result.value.tagId ? result.value : tag,
        ),
      );
      setRenameTarget(null);
      setError(null);
      setNotice("标签已重命名。");
    } catch (caught) {
      setError(toOrganizationMessage(caught, "tag", "重命名"));
    } finally {
      setUiState("ready");
    }
  }

  async function chooseTag(tagId: string) {
    if (!api || !library) return;
    closeContextMenu();
    const tag = tags.find((candidate) => candidate.tagId === tagId);
    if (!tag) return;
    workspaceCanvasRef.current?.scrollTo({ top: 0, left: 0 });
    setShowTrash(false);
    setActiveTagId(tagId);
    setActiveCollectionId(null);
    setActiveSmartCollectionId(null);
    setAssetScope("all");
    clearAssetSelection();
    setTagFilter(tag.name);
    setSearchOffset(0);
    api.setActiveContext(library.libraryId);
    setUiState("loading");
    try {
      const definition = activeAiSearchDefinition
        ? {
            ...activeAiSearchDefinition,
            filters: [
              ...(activeAiSearchDefinition.filters ?? []),
              { field: "tag" as const, values: [tag.name], exclude: false },
            ],
          }
        : currentQueryDefinition({ tagFilter: tag.name });
      if (activeAiSearchDefinition) setActiveAiSearchDefinition(definition);
      const result = await api.searchAssets({
        libraryId: library.libraryId,
        query: definition.search ?? null,
        filters: definition.filters,
        sort: definition.sort,
        limit: ASSET_PAGE_SIZE,
        offset: 0,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      applySearchResult(result.value);
    } catch (caught) {
      setError(toMessage(caught, "无法读取标签资产。"));
    } finally {
      setUiState("ready");
    }
  }

  async function assignAssetToTag(assetId: string, tagId: string) {
    if (!api || !library) return;
    try {
      const result = await api.assignTags({
        libraryId: library.libraryId,
        assetIds: [assetId],
        tagIds: [tagId],
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      const tagResult = await api.listTags({ libraryId: library.libraryId });
      if (tagResult.ok) setTags(tagResult.value);
      setNotice("标签已添加。");
    } catch (caught) {
      setError(toMessage(caught, "添加标签失败。"));
    }
  }

  async function updateSelectionTags(remove: boolean) {
    if (!api || !library || !batchTagId || selectedAssetIds.length === 0)
      return;
    setUiState("loading");
    try {
      const result = remove
        ? await api.removeTags({
            libraryId: library.libraryId,
            assetIds: selectedAssetIds,
            tagIds: [batchTagId],
          })
        : await api.assignTags({
            libraryId: library.libraryId,
            assetIds: selectedAssetIds,
            tagIds: [batchTagId],
          });
      if (!result.ok) throw new LibraryOperationError(result.error);
      const tagResult = await api.listTags({ libraryId: library.libraryId });
      if (tagResult.ok) setTags(tagResult.value);
      if (remove && activeTagId === batchTagId) {
        await chooseTag(batchTagId);
      }
      setNotice(
        `已为 ${selectedAssetIds.length} 项资产${remove ? "移除" : "添加"}标签。`,
      );
    } catch (caught) {
      setError(
        toMessage(caught, remove ? "批量移除标签失败。" : "批量添加标签失败。"),
      );
    } finally {
      setUiState("ready");
    }
  }

  // --- Collection CRUD ---

  async function createCollection() {
    if (!api || !library || !collectionInputValue.trim()) return;
    setUiState("loading");
    try {
      const result = await api.createCollection({
        libraryId: library.libraryId,
        parentId: newCollectionParentId ?? undefined,
        name: collectionInputValue.trim(),
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setShowCollectionInput(false);
      setCollectionInputValue("");
      setNewCollectionParentId(null);
      await reloadCurrentContent();
    } catch (caught) {
      setError(toOrganizationMessage(caught, "collection", "创建"));
    } finally {
      setUiState("ready");
    }
  }

  async function deleteCollection(collectionId: string) {
    if (!api || !library) return;
    const deletedCollectionIds = new Set([collectionId]);
    let foundDescendant = true;
    while (foundDescendant) {
      foundDescendant = false;
      for (const collection of collections) {
        if (
          collection.parentId &&
          deletedCollectionIds.has(collection.parentId) &&
          !deletedCollectionIds.has(collection.collectionId)
        ) {
          deletedCollectionIds.add(collection.collectionId);
          foundDescendant = true;
        }
      }
    }
    setUiState("loading");
    try {
      const result = await api.deleteCollection({
        libraryId: library.libraryId,
        collectionId,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      if (activeCollectionId && deletedCollectionIds.has(activeCollectionId)) {
        setActiveCollectionId(null);
        await loadContent(library, assetScope);
      } else {
        const colResult = await api.listCollections({
          libraryId: library.libraryId,
        });
        if (!colResult.ok) throw new LibraryOperationError(colResult.error);
        setCollections(colResult.value);
      }
      setError(null);
      setNotice("合集已删除。");
    } catch (caught) {
      setError(toOrganizationMessage(caught, "collection", "删除"));
    } finally {
      setUiState("ready");
    }
  }

  async function renameCollection() {
    if (
      !api ||
      !library ||
      !renameTarget ||
      renameTarget.kind !== "collection" ||
      !renameTarget.name.trim()
    )
      return;
    setUiState("loading");
    try {
      const result = await api.updateCollection({
        libraryId: library.libraryId,
        collectionId: renameTarget.id,
        name: renameTarget.name.trim(),
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setCollections((current) =>
        current.map((collection) =>
          collection.collectionId === result.value.collectionId
            ? result.value
            : collection,
        ),
      );
      setRenameTarget(null);
      setError(null);
      setNotice("合集已重命名。");
    } catch (caught) {
      setError(toOrganizationMessage(caught, "collection", "重命名"));
    } finally {
      setUiState("ready");
    }
  }

  async function saveCollectionDetails() {
    if (!api || !library || !collectionEditor) return;
    const existing = collections.find(
      (collection) => collection.collectionId === collectionEditor.collectionId,
    );
    if (!existing) return;
    setUiState("loading");
    try {
      const result = await api.updateCollection({
        libraryId: library.libraryId,
        collectionId: collectionEditor.collectionId,
        ...(collectionEditor.description.trim() !== (existing.description ?? "")
          ? { description: collectionEditor.description.trim() || null }
          : {}),
        ...(collectionEditor.coverAssetId !== (existing.coverAssetId ?? "")
          ? { coverAssetId: collectionEditor.coverAssetId || null }
          : {}),
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setCollections((current) =>
        current.map((collection) =>
          collection.collectionId === result.value.collectionId
            ? result.value
            : collection,
        ),
      );
      setCollectionEditor(null);
      setNotice("合集详情已更新。");
    } catch (caught) {
      setError(toOrganizationMessage(caught, "collection", "重命名"));
    } finally {
      setUiState("ready");
    }
  }

  async function reorderCollectionSibling(sourceId: string, targetId: string) {
    if (!api || !library || sourceId === targetId) return;
    const source = collections.find(
      (collection) => collection.collectionId === sourceId,
    );
    const target = collections.find(
      (collection) => collection.collectionId === targetId,
    );
    setDraggedCollectionId(null);
    if (!source || !target || source.parentId !== target.parentId) {
      setError("当前版本仅支持在同一层级内拖拽排序合集。");
      return;
    }
    const siblings = [...(collectionTree.get(source.parentId) ?? [])];
    const sourceIndex = siblings.findIndex(
      (collection) => collection.collectionId === sourceId,
    );
    const targetIndex = siblings.findIndex(
      (collection) => collection.collectionId === targetId,
    );
    const [moved] = siblings.splice(sourceIndex, 1);
    if (!moved) return;
    siblings.splice(targetIndex, 0, moved);
    setUiState("loading");
    try {
      const reordered = await api.reorderCollections({
        libraryId: library.libraryId,
        orderedCollectionIds: siblings.map(
          (collection) => collection.collectionId,
        ),
      });
      if (!reordered.ok) throw new LibraryOperationError(reordered.error);
      const result = await api.listCollections({
        libraryId: library.libraryId,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setCollections(result.value);
      setNotice("合集顺序已更新。");
    } catch (caught) {
      setError(toMessage(caught, "合集排序失败。"));
    } finally {
      setUiState("ready");
    }
  }

  async function reorderCollectionMember(sourceId: string, targetId: string) {
    if (!api || !library || !activeCollectionId || sourceId === targetId)
      return;
    setDraggedMemberId(null);
    setUiState("loading");
    try {
      const members = await api.listCollectionAssets({
        libraryId: library.libraryId,
        collectionId: activeCollectionId,
        recursive: false,
      });
      if (!members.ok) throw new LibraryOperationError(members.error);
      const orderedIds = members.value.map((asset) => asset.assetId);
      const sourceIndex = orderedIds.indexOf(sourceId);
      const targetIndex = orderedIds.indexOf(targetId);
      if (sourceIndex < 0 || targetIndex < 0)
        throw new Error("只能对当前合集的直接成员排序。");
      const [moved] = orderedIds.splice(sourceIndex, 1);
      if (!moved) return;
      orderedIds.splice(targetIndex, 0, moved);
      const result = await api.reorderCollectionAssets({
        libraryId: library.libraryId,
        collectionId: activeCollectionId,
        orderedAssetIds: orderedIds,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setAssets((current) => {
        const next = [...current];
        const currentSourceIndex = next.findIndex(
          (asset) => asset.assetId === sourceId,
        );
        const currentTargetIndex = next.findIndex(
          (asset) => asset.assetId === targetId,
        );
        if (currentSourceIndex < 0 || currentTargetIndex < 0) return current;
        const [currentMoved] = next.splice(currentSourceIndex, 1);
        if (!currentMoved) return current;
        next.splice(currentTargetIndex, 0, currentMoved);
        return next;
      });
      setNotice("合集成员顺序已更新。");
    } catch (caught) {
      setError(toMessage(caught, "合集成员排序失败。"));
    } finally {
      setUiState("ready");
    }
  }

  async function chooseCollection(
    collectionId: string,
    recursive = collectionRecursive,
  ) {
    if (!api || !library) return;
    closeContextMenu();
    workspaceCanvasRef.current?.scrollTo({ top: 0, left: 0 });
    setShowTrash(false);
    setActiveCollectionId(collectionId);
    setActiveTagId(null);
    setActiveSmartCollectionId(null);
    setAssetScope("all");
    clearAssetSelection();
    clearDiscoveryControls();
    api?.setActiveContext(library.libraryId);
    setUiState("loading");
    try {
      const result = await api.searchAssets({
        libraryId: library.libraryId,
        query: null,
        scope: {
          kind: "collection",
          collectionId,
          recursive,
        },
        limit: ASSET_PAGE_SIZE,
        offset: 0,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      applySearchResult(result.value);
      // Also refresh sidebar metadata
      const [tagResult, collectionResult, smartResult] = await Promise.all([
        api.listTags({ libraryId: library.libraryId }),
        api.listCollections({ libraryId: library.libraryId }),
        api.listSmartCollections({ libraryId: library.libraryId }),
      ]);
      if (tagResult.ok) setTags(tagResult.value);
      if (collectionResult.ok) setCollections(collectionResult.value);
      if (smartResult.ok) setSmartCollections(smartResult.value);
    } catch (caught) {
      setError(toMessage(caught, "无法读取合集内容。"));
    } finally {
      setUiState("ready");
    }
  }

  async function addAssetToCollection(assetId: string, collectionId: string) {
    if (!api || !library) return;
    try {
      const result = await api.addCollectionAssets({
        libraryId: library.libraryId,
        collectionId,
        assetIds: [assetId],
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      const collectionResult = await api.listCollections({
        libraryId: library.libraryId,
      });
      if (collectionResult.ok) setCollections(collectionResult.value);
      setNotice("资产已加入合集。");
    } catch (caught) {
      setError(toMessage(caught, "加入合集失败。"));
    }
  }

  async function updateSelectionCollection(remove: boolean) {
    if (!api || !library || !batchCollectionId || selectedAssetIds.length === 0)
      return;
    setUiState("loading");
    try {
      let affectedAssetIds = selectedAssetIds;
      if (remove) {
        const directMembers = await api.listCollectionAssets({
          libraryId: library.libraryId,
          collectionId: batchCollectionId,
          recursive: false,
        });
        if (!directMembers.ok)
          throw new LibraryOperationError(directMembers.error);
        const directMemberIds = new Set(
          directMembers.value.map((asset) => asset.assetId),
        );
        affectedAssetIds = selectedAssetIds.filter((assetId) =>
          directMemberIds.has(assetId),
        );
        if (affectedAssetIds.length === 0) {
          setError(
            "无需从目标合集移除：所选资产都不是该合集的直接成员。",
          );
          return;
        }
      }
      const result = remove
        ? await api.removeCollectionAssets({
            libraryId: library.libraryId,
            collectionId: batchCollectionId,
            assetIds: affectedAssetIds,
          })
        : await api.addCollectionAssets({
            libraryId: library.libraryId,
            collectionId: batchCollectionId,
            assetIds: affectedAssetIds,
          });
      if (!result.ok) throw new LibraryOperationError(result.error);
      const collectionResult = await api.listCollections({
        libraryId: library.libraryId,
      });
      if (collectionResult.ok) setCollections(collectionResult.value);
      if (remove && activeCollectionId === batchCollectionId)
        await chooseCollection(
          batchCollectionId,
          collectionRecursiveRef.current,
        );
      const skippedCount = selectedAssetIds.length - affectedAssetIds.length;
      setNotice(
        remove && skippedCount > 0
          ? `已将 ${affectedAssetIds.length} 项直接成员移出合集；${skippedCount} 项不是该合集的直接成员，未改动。`
          : `已将 ${affectedAssetIds.length} 项资产${remove ? "移出" : "加入"}合集。`,
      );
    } catch (caught) {
      setError(
        toMessage(caught, remove ? "批量移出合集失败。" : "批量加入合集失败。"),
      );
    } finally {
      setUiState("ready");
    }
  }

  async function removeAssetFromCollection(
    assetId: string,
    collectionId: string,
  ) {
    if (!api || !library) return;
    setUiState("loading");
    try {
      const directMembers = await api.listCollectionAssets({
        libraryId: library.libraryId,
        collectionId,
        recursive: false,
      });
      if (!directMembers.ok)
        throw new LibraryOperationError(directMembers.error);
      if (!directMembers.value.some((asset) => asset.assetId === assetId)) {
        setError(
          "无法从当前合集移除：该资产属于子合集，请进入对应子合集后再移除。",
        );
        return;
      }
      const result = await api.removeCollectionAssets({
        libraryId: library.libraryId,
        collectionId,
        assetIds: [assetId],
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      const [assetResult, collectionResult] = await Promise.all([
        api.searchAssets({
          libraryId: library.libraryId,
          query: null,
          scope: {
            kind: "collection",
            collectionId,
            recursive: collectionRecursive,
          },
          limit: ASSET_PAGE_SIZE,
          offset: 0,
        }),
        api.listCollections({ libraryId: library.libraryId }),
      ]);
      if (!assetResult.ok) throw new LibraryOperationError(assetResult.error);
      if (!collectionResult.ok)
        throw new LibraryOperationError(collectionResult.error);
      applySearchResult(assetResult.value);
      setCollections(collectionResult.value);
      clearAssetSelection();
      setError(null);
      setNotice("资产已从合集移除。");
    } catch (caught) {
      setError(toOrganizationMessage(caught, "collection", "移除资产"));
    } finally {
      setUiState("ready");
    }
  }

  function currentQueryDefinition(
    overrides: { tagFilter?: string; includeTextSearch?: boolean } = {},
  ): SearchDefinition {
    const filters: FilterClause[] = [];
    const formats = formatFilter
      .split(",")
      .map((value) => value.trim().replace(/^\./, ""))
      .filter(Boolean);
    const selectedTags = (overrides.tagFilter ?? tagFilter)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const ratings = ratingFilter
      .split(",")
      .map((value) => value.trim())
      .filter((value) => /^[0-5]$/.test(value));
    if (formats.length > 0)
      filters.push({
        field: "format",
        values: formats,
        exclude: excludeFormatFilter,
      });
    if (selectedTags.length > 0)
      filters.push({
        field: "tag",
        values: selectedTags,
        exclude: excludeTagFilter,
      });
    if (ratings.length > 0)
      filters.push({
        field: "rating",
        values: ratings,
        exclude: excludeRatingFilter,
      });
    if (favoriteFilter !== "any")
      filters.push({
        field: "favorite",
        values: [],
        exclude: favoriteFilter === "no",
      });
    if (sourceUrlFilter !== "any")
      filters.push({
        field: "source_url",
        values: [],
        exclude: sourceUrlFilter === "no",
      });
    if (availabilityFilter !== "any")
      filters.push({
        field: "availability",
        values: [availabilityFilter],
        exclude: excludeAvailabilityFilter,
      });
    const technicalRanges: Array<{
      field: "width" | "height" | "aspect_ratio" | "duration_ms";
      input: { min: string; max: string; exclude: boolean };
      scale?: number;
      integer?: boolean;
    }> = [
      { field: "width", input: widthRange },
      { field: "height", input: heightRange },
      { field: "aspect_ratio", input: aspectRatioRange, integer: false },
      { field: "duration_ms", input: durationRange, scale: 1_000 },
    ];
    for (const { field, input, scale = 1, integer = true } of technicalRanges) {
      const range = parseNumericRange(input.min, input.max, scale, integer);
      if (range)
        filters.push({ field, ranges: [range], exclude: input.exclude });
    }
    return {
      ...(overrides.includeTextSearch !== false && searchValue.trim()
        ? {
            search: { clauses: parseSearchExpression(searchValue) },
          }
        : {}),
      ...(filters.length > 0 ? { filters } : {}),
      ...(sortField !== "relevance"
        ? { sort: { field: sortField, order: sortOrder } }
        : {}),
    };
  }

  function applySearchResult(
    result: {
      items: AssetSummary[];
      total: number;
      offset: number;
      snippets?: Array<{ assetId: string; text: string }>;
    },
    append = false,
  ) {
    setAssets((current) =>
      append
        ? [
            ...current,
            ...result.items.filter(
              (item) =>
                !current.some((existing) => existing.assetId === item.assetId),
            ),
          ]
        : result.items,
    );
    setSearchTotal(result.total);
    setSearchOffset(result.offset + result.items.length);
    setSearchSnippets(
      (current) =>
        new Map([
          ...(append ? current.entries() : []),
          ...(result.snippets ?? []).map(
            (snippet) => [snippet.assetId, snippet.text] as const,
          ),
        ]),
    );
  }

  function currentSearchScope(): SearchScope | undefined {
    if (activeCollectionId)
      return {
        kind: "collection",
        collectionId: activeCollectionId,
        recursive: collectionRecursive,
      };
    if (assetScope === "root")
      return { kind: "folder", folderId: null, recursive: false };
    if (assetScope !== "all")
      return { kind: "folder", folderId: assetScope, recursive: false };
    return undefined;
  }

  async function reloadCurrentContent() {
    if (!library) return;
    if (activeSmartCollectionId) {
      await chooseSmartCollection(activeSmartCollectionId, 0);
      return;
    }
    if (showTrash) {
      await loadContent(library, "all", {
        trashMode: true,
        searchScope: { kind: "trash" },
      });
      return;
    }
    const activeTagName = activeTagId
      ? tags.find((tag) => tag.tagId === activeTagId)?.name
      : undefined;
    const discovery = activeTagName
      ? currentQueryDefinition({ tagFilter: activeTagName })
      : currentQueryDefinition();
    await loadContent(library, assetScope, {
      discovery,
      searchScope: currentSearchScope(),
    });
  }
  useEffect(() => {
    reloadCurrentContentRef.current = reloadCurrentContent;
  });

  async function executeSearchDefinition(
    definition: SearchDefinition,
    offset = 0,
  ) {
    if (!api || !library) return;
    const result = await api.searchAssets({
      libraryId: library.libraryId,
      query: definition.search ?? null,
      filters: definition.filters,
      scope: currentSearchScope(),
      sort: definition.sort,
      limit: ASSET_PAGE_SIZE,
      offset,
    });
    if (!result.ok) throw new LibraryOperationError(result.error);
    setShowTrash(false);
    if (!tagFilter.trim()) setActiveTagId(null);
    setActiveSmartCollectionId(null);
    if (offset === 0) clearAssetSelection();
    applySearchResult(result.value, offset > 0);
    return result.value;
  }

  async function runSearch(event?: FormEvent, offset = 0) {
    event?.preventDefault();
    if (!api || !library) return;
    try {
      const definition = currentQueryDefinition();
      setActiveAiSearchDefinition(null);
      setAiSearchPlanSummary(null);
      const result = await executeSearchDefinition(definition, offset);
      if (result) setNotice(`搜索完成：找到 ${result.total} 项。`);
    } catch (caught) {
      setError(toMessage(caught, "搜索失败。"));
    }
  }

  async function runAiSearch(event?: FormEvent, offset = 0) {
    event?.preventDefault();
    if (!api || !library || !searchValue.trim() || aiSearchLoading) return;
    setAiSearchLoading(true);
    setError(null);
    try {
      const planned = await api.planAiSearch({
        naturalQuery: searchValue.trim(),
      });
      if (!planned.ok) throw new LibraryOperationError(planned.error);
      const aiDefinition = aiSearchPlanToDefinition(planned.value.plan);
      const manualDefinition = currentQueryDefinition({
        includeTextSearch: false,
      });
      const definition: SearchDefinition = {
        ...(aiDefinition.search ? { search: aiDefinition.search } : {}),
        ...(aiDefinition.filters?.length || manualDefinition.filters?.length
          ? {
              filters: [
                ...(aiDefinition.filters ?? []),
                ...(manualDefinition.filters ?? []),
              ],
            }
          : {}),
        ...((manualDefinition.sort ?? aiDefinition.sort)
          ? { sort: (manualDefinition.sort ?? aiDefinition.sort)! }
          : {}),
      };
      setActiveAiSearchDefinition(definition);
      setAiSearchPlanSummary(describeAiSearchPlan(planned.value.plan));
      const result = await executeSearchDefinition(definition, offset);
      if (result)
        setNotice(`AI 已转换为普通搜索条件：找到 ${result.total} 项。`);
    } catch (caught) {
      const explanation = toMessage(caught, "AI 无法转换这次搜索。");
      setAiSearchEnabled(false);
      setActiveAiSearchDefinition(null);
      setAiSearchPlanSummary(null);
      try {
        const fallback = await executeSearchDefinition(
          currentQueryDefinition(),
          0,
        );
        setError(
          `${explanation} 已自动改用普通关键词搜索${fallback ? `，找到 ${fallback.total} 项` : ""}。`,
        );
      } catch (fallbackError) {
        setError(
          `${explanation} 普通关键词搜索也失败：${toMessage(fallbackError, "桌面服务没有响应。")}`,
        );
      }
    } finally {
      setAiSearchLoading(false);
    }
  }

  useEffect(() => {
    const hasDiscoveryInput = Boolean(
      searchValue.trim() ||
      formatFilter.trim() ||
      tagFilter.trim() ||
      ratingFilter.trim() ||
      favoriteFilter !== "any" ||
      sourceUrlFilter !== "any" ||
      availabilityFilter !== "any" ||
      widthRange.min ||
      widthRange.max ||
      heightRange.min ||
      heightRange.max ||
      aspectRatioRange.min ||
      aspectRatioRange.max ||
      durationRange.min ||
      durationRange.max ||
      sortField !== "relevance" ||
      sortOrder !== "asc",
    );
    const shouldClearPreviousResults =
      hadDiscoveryInput.current && !hasDiscoveryInput;
    hadDiscoveryInput.current = hasDiscoveryInput;
    if (
      !library ||
      showTrash ||
      aiSearchEnabled ||
      (!hasDiscoveryInput && !shouldClearPreviousResults)
    )
      return;
    const timer = window.setTimeout(() => {
      void runSearch(undefined, 0);
    }, 250);
    return () => window.clearTimeout(timer);
    // Search execution reads the current scope and API from the same render;
    // only discovery controls should restart the debounce timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    library,
    showTrash,
    aiSearchEnabled,
    searchValue,
    formatFilter,
    excludeFormatFilter,
    tagFilter,
    excludeTagFilter,
    ratingFilter,
    excludeRatingFilter,
    favoriteFilter,
    sourceUrlFilter,
    availabilityFilter,
    excludeAvailabilityFilter,
    widthRange,
    heightRange,
    aspectRatioRange,
    durationRange,
    sortField,
    sortOrder,
  ]);

  async function saveSmartCollection() {
    if (!api || !library || !smartCollectionName.trim()) return;
    try {
      const result = await api.createSmartCollection({
        libraryId: library.libraryId,
        name: smartCollectionName.trim(),
        queryDefinitionJson: JSON.stringify(
          activeAiSearchDefinition ?? currentQueryDefinition(),
        ),
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      const listResult = await api.listSmartCollections({
        libraryId: library.libraryId,
      });
      if (listResult.ok) setSmartCollections(listResult.value);
      setSmartCollectionName("");
      setNotice("智能合集已保存。");
    } catch (caught) {
      setError(toMessage(caught, "保存智能合集失败。"));
    }
  }

  async function chooseSmartCollection(collectionId: string, offset = 0) {
    if (!api || !library) return;
    closeContextMenu();
    if (offset === 0) workspaceCanvasRef.current?.scrollTo({ top: 0, left: 0 });
    try {
      const result = await api.executeSmartCollection({
        libraryId: library.libraryId,
        collectionId,
        limit: ASSET_PAGE_SIZE,
        offset,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setShowTrash(false);
      setActiveTagId(null);
      setActiveCollectionId(null);
      setActiveSmartCollectionId(collectionId);
      if (offset === 0) clearAssetSelection();
      applySearchResult(result.value, offset > 0);
    } catch (caught) {
      setError(toMessage(caught, "执行智能合集失败。"));
    }
  }

  async function loadMoreAssets() {
    if (
      loadingMoreAssets ||
      searchTotal === null ||
      visibleAssets.length >= searchTotal
    )
      return;
    setLoadingMoreAssets(true);
    const offset = visibleAssets.length;
    try {
      if (showTrash) {
        if (!api || !library) return;
        const result = await api.searchAssets({
          libraryId: library.libraryId,
          query: null,
          scope: { kind: "trash" },
          limit: ASSET_PAGE_SIZE,
          offset,
        });
        if (!result.ok) throw new LibraryOperationError(result.error);
        setTrashedAssets((current) => [
          ...current,
          ...result.value.items.filter(
            (item) =>
              !current.some((existing) => existing.assetId === item.assetId),
          ),
        ]);
        setSearchTotal(result.value.total);
        setSearchOffset(result.value.offset + result.value.items.length);
      } else if (activeSmartCollectionId)
        await chooseSmartCollection(activeSmartCollectionId, offset);
      else if (activeAiSearchDefinition)
        await executeSearchDefinition(activeAiSearchDefinition, offset);
      else await runSearch(undefined, offset);
    } catch (caught) {
      setError(toMessage(caught, "继续加载资产失败。"));
    } finally {
      setLoadingMoreAssets(false);
    }
  }

  useEffect(() => {
    loadMoreAssetsRef.current = loadMoreAssets;
  });

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (
      !sentinel ||
      searchTotal === null ||
      visibleAssets.length >= searchTotal
    )
      return;
    const root =
      assetViewMode === "grid"
        ? sentinel.closest(".asset-grid")
        : sentinel.closest(".workspace-canvas");
    if (!(root instanceof HTMLElement)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting))
          void loadMoreAssetsRef.current();
      },
      { root, rootMargin: "600px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [assetViewMode, loadingMoreAssets, searchTotal, visibleAssets.length]);

  async function renameSmartCollection(collectionId: string, name: string) {
    if (!api || !library || !name.trim()) return;
    try {
      const result = await api.updateSmartCollection({
        libraryId: library.libraryId,
        collectionId,
        name: name.trim(),
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setSmartCollections((current) =>
        current.map((collection) =>
          collection.collectionId === collectionId ? result.value : collection,
        ),
      );
      setNotice("智能合集已重命名。");
    } catch (caught) {
      setError(toMessage(caught, "重命名智能合集失败。"));
    }
  }

  async function updateSmartCollectionQuery(collectionId: string) {
    if (!api || !library) return;
    try {
      const result = await api.updateSmartCollection({
        libraryId: library.libraryId,
        collectionId,
        queryDefinitionJson: JSON.stringify(
          activeAiSearchDefinition ?? currentQueryDefinition(),
        ),
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setSmartCollections((current) =>
        current.map((collection) =>
          collection.collectionId === collectionId ? result.value : collection,
        ),
      );
      setNotice("智能合集条件已更新。");
    } catch (caught) {
      setError(toMessage(caught, "更新智能合集失败。"));
    }
  }

  async function deleteSmartCollection(collectionId: string) {
    if (!api || !library) return;
    try {
      const result = await api.deleteSmartCollection({
        libraryId: library.libraryId,
        collectionId,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setSmartCollections((current) =>
        current.filter(
          (collection) => collection.collectionId !== collectionId,
        ),
      );
      if (activeSmartCollectionId === collectionId) {
        setActiveSmartCollectionId(null);
        await loadContent(library, "all");
      }
      setNotice("智能合集已删除。");
    } catch (caught) {
      setError(toMessage(caught, "删除智能合集失败。"));
    }
  }

  // --- Asset metadata ---

  async function loadMetadata() {
    if (!api || !library || !selectedAssetId) return;
    const targetAssetId = selectedAssetId;
    setMetadataLoading(true);
    setVersionConflict(false);
    try {
      const result = await api.getAssetMetadata({
        libraryId: library.libraryId,
        assetId: targetAssetId,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      metadataByAssetRef.current.set(targetAssetId, result.value);
      metadataConflictAssetIdsRef.current.delete(targetAssetId);
      if (selectedAssetIdRef.current !== targetAssetId) return;
      setAssetMetadata(result.value);
      setEditLabel(result.value.label ?? "");
      setEditDescription(result.value.description ?? "");
      setEditRating(result.value.rating);
      setEditFavorite(result.value.favorite);
      setEditSourceUrl(result.value.sourcePageUrl ?? "");
      setEditPalette(parseStoredPalette(result.value.palette).join(", "));
    } catch (caught) {
      setError(toMessage(caught, "无法读取元数据。"));
    } finally {
      setMetadataLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    if (selectedAssetId) {
      void Promise.resolve().then(async () => {
        if (!api || !library) return;
        setMetadataLoading(true);
        setVersionConflict(false);
        try {
          const result = await api.getAssetMetadata({
            libraryId: library.libraryId,
            assetId: selectedAssetId,
          });
          if (!cancelled && result.ok) {
            metadataByAssetRef.current.set(selectedAssetId, result.value);
            metadataConflictAssetIdsRef.current.delete(selectedAssetId);
            setAssetMetadata(result.value);
            setEditLabel(result.value.label ?? "");
            setEditDescription(result.value.description ?? "");
            setEditRating(result.value.rating);
            setEditFavorite(result.value.favorite);
            setEditSourceUrl(result.value.sourcePageUrl ?? "");
            setEditPalette(parseStoredPalette(result.value.palette).join(", "));
          } else if (!cancelled && !result.ok) {
            throw new LibraryOperationError(result.error);
          }
        } catch (caught) {
          if (!cancelled) setError(toMessage(caught, "无法读取元数据。"));
        } finally {
          if (!cancelled) setMetadataLoading(false);
        }
      });
    } else {
      queueMicrotask(() => {
        setAssetMetadata(null);
        setVersionConflict(false);
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAssetId]);

  function saveMetadata(fields: {
    label?: string;
    description?: string;
    rating?: number;
    favorite?: boolean;
    palette?: string[];
    sourcePageUrl?: string;
  }): Promise<void> {
    if (!api || !library || !selectedAssetId || !assetMetadata)
      return Promise.resolve();
    const targetApi = api;
    const targetLibraryId = library.libraryId;
    const targetAssetId = selectedAssetId;
    if (metadataConflictAssetIdsRef.current.has(targetAssetId))
      return Promise.resolve();
    if (!metadataByAssetRef.current.has(targetAssetId)) {
      metadataByAssetRef.current.set(targetAssetId, assetMetadata);
    }
    setVersionConflict(false);
    setError(null);

    const operation = metadataSaveQueueRef.current.then(async () => {
      if (metadataConflictAssetIdsRef.current.has(targetAssetId)) return;
      const currentMetadata = metadataByAssetRef.current.get(targetAssetId);
      if (!currentMetadata) return;
      try {
        const result = await targetApi.setAssetMetadata({
          libraryId: targetLibraryId,
          assetId: targetAssetId,
          expectedVersion: currentMetadata.entityVersion,
          ...fields,
        });
        if (!result.ok) {
          if (result.error.code === "VERSION_CONFLICT") {
            metadataConflictAssetIdsRef.current.add(targetAssetId);
            if (selectedAssetIdRef.current === targetAssetId) {
              setVersionConflict(true);
            }
            setNotice(
              "元数据版本冲突——另一个操作已修改了这些字段。请刷新后重新编辑。",
            );
            return;
          }
          throw new LibraryOperationError(result.error);
        }

        metadataByAssetRef.current.set(targetAssetId, result.value);
        const updateSummary = (asset: AssetSummary): AssetSummary =>
          asset.assetId === targetAssetId
            ? {
                ...asset,
                label: result.value.label,
                rating: result.value.rating,
                favorite: result.value.favorite,
              }
            : asset;
        setAssets((current) => current.map(updateSummary));
        setTrashedAssets((current) => current.map(updateSummary));
        if (selectedAssetIdRef.current === targetAssetId) {
          setAssetMetadata(result.value);
        }
        setNotice("元数据已保存。");
      } catch (caught) {
        setError(toMessage(caught, "保存元数据失败。"));
      }
    });
    metadataSaveQueueRef.current = operation;
    return operation;
  }

  async function handleOpenExternal(assetId: string) {
    if (!api || !library) return;
    try {
      const result = await api.openExternal({
        libraryId: library.libraryId,
        assetId,
      });
      if (!result.ok) {
        setError(toMessage(result.error, "无法打开外部应用。"));
      }
    } catch (caught) {
      setError(toMessage(caught, "打开外部应用失败。"));
    }
  }

  // --- Existing operations ---

  async function createFolder() {
    if (!api || !library) return;
    setUiState("loading");
    try {
      const result = await api.createFolder({
        libraryId: library.libraryId,
        parentFolderId: selectedFolderId,
        name: dialogValue.trim(),
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setDialog(null);
      setNotice(`已创建文件夹"${result.value.name}"。`);
      await reloadCurrentContent();
    } catch (caught) {
      setError(toMessage(caught, "创建文件夹失败。"));
    } finally {
      setUiState("ready");
    }
  }

  async function importAssets(kind: "files" | "folder") {
    if (!api || !library) return;
    setUiState("importing");
    setError(null);
    setNotice(null);
    try {
      const result =
        kind === "files"
          ? await api.importFiles({
              libraryId: library.libraryId,
              targetFolderId: selectedFolderId,
            })
          : await api.importFolder({
              libraryId: library.libraryId,
              targetFolderId: selectedFolderId,
            });
      if (!result.ok) {
        if (result.error.code === "CANCELLED") return;
        throw new LibraryOperationError(result.error);
      }
      if ("importId" in result.value) {
        setConflicts(result.value);
        return;
      }
      setNotice(importSummary(result.value));
      await reloadCurrentContent();
    } catch (caught) {
      setError(toMessage(caught, "导入失败。"));
    } finally {
      setUiState("ready");
    }
  }

  function currentManagedTargetFolderId(): string | undefined {
    return managedImportTargetFolderIdRef.current;
  }

  async function applyDesktopImportResult(
    result: Awaited<ReturnType<SerpentLibraryApi["importDropped"]>>,
  ): Promise<void> {
    if (!result.ok) {
      // Collection assignment is deliberately a post-import relation. Make
      // the durable partial success visible instead of leaving a stale grid.
      if (result.error.code === "IMPORT_COLLECTION_ASSIGN_FAILED") {
        await reloadCurrentContent();
      }
      throw new LibraryOperationError(result.error);
    }
    if ("importId" in result.value) {
      setConflicts(result.value);
      return;
    }
    setNotice(importSummary(result.value));
    await reloadCurrentContent();
  }

  async function importDroppedFiles(
    files: File[],
    targetFolderId: string | null | undefined = currentManagedTargetFolderId(),
    targetCollectionId = activeCollectionId ?? undefined,
    webPayload?: { html: string; uriList: string },
  ) {
    if (!api || !library || (files.length === 0 && !webPayload) || busy) return;
    setUiState("importing");
    setError(null);
    setNotice(null);
    try {
      const result = await api.importDropped({
        libraryId: library.libraryId,
        targetFolderId: targetFolderId ?? undefined,
        targetCollectionId,
        files,
        html: webPayload?.html,
        uriList: webPayload?.uriList,
      });
      await applyDesktopImportResult(result);
    } catch (caught) {
      setError(toMessage(caught, "拖放导入失败。"));
    } finally {
      setUiState("ready");
      setExternalDropActive(false);
      externalDragDepth.current = 0;
    }
  }

  const pasteClipboardImage = useCallback(async () => {
    if (!api || !library || busy) return;
    setUiState("importing");
    setError(null);
    setNotice(null);
    try {
      const result = await api.pasteClipboardImage({
        libraryId: library.libraryId,
        targetFolderId: managedImportTargetFolderIdRef.current,
        targetCollectionId: activeCollectionId ?? undefined,
      });
      if (!result.ok) {
        if (result.error.code === "IMPORT_COLLECTION_ASSIGN_FAILED") {
          await reloadCurrentContentRef.current();
        }
        throw new LibraryOperationError(result.error);
      }
      if ("importId" in result.value) {
        setConflicts(result.value);
      } else {
        setNotice(importSummary(result.value));
        await reloadCurrentContentRef.current();
      }
    } catch (caught) {
      setError(toMessage(caught, "从剪贴板导入失败。"));
    } finally {
      setUiState("ready");
    }
  }, [activeCollectionId, api, busy, library]);

  function handleExternalDragEnter(event: React.DragEvent<HTMLElement>) {
    if (previewAsset) {
      event.preventDefault();
      setExternalDropActive(false);
      return;
    }
    if (!library || !supportsExternalImportTransfer(event.dataTransfer)) return;
    event.preventDefault();
    externalDragDepth.current += 1;
    setExternalDropActive(true);
  }

  function handleExternalDragLeave(event: React.DragEvent<HTMLElement>) {
    if (!supportsExternalImportTransfer(event.dataTransfer)) return;
    externalDragDepth.current = Math.max(0, externalDragDepth.current - 1);
    if (externalDragDepth.current === 0) setExternalDropActive(false);
  }

  function handleExternalDragOver(event: React.DragEvent<HTMLElement>) {
    if (previewAsset) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "none";
      return;
    }
    if (!library || !supportsExternalImportTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleExternalDrop(event: React.DragEvent<HTMLElement>) {
    if (previewAsset) {
      event.preventDefault();
      externalDragDepth.current = 0;
      setExternalDropActive(false);
      return;
    }
    if (!supportsExternalImportTransfer(event.dataTransfer)) return;
    event.preventDefault();
    externalDragDepth.current = 0;
    setExternalDropActive(false);
    const payload = externalImportPayload(event.dataTransfer);
    void importDroppedFiles(payload.files, undefined, undefined, payload);
  }

  function handleTargetExternalDragOver(event: React.DragEvent<HTMLElement>) {
    if (previewAsset) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "none";
      return;
    }
    if (!library || !supportsExternalImportTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleTargetExternalDrop(
    event: React.DragEvent<HTMLElement>,
    targetFolderId: string | null | undefined,
    targetCollectionId: string | undefined,
  ) {
    if (previewAsset) {
      event.preventDefault();
      externalDragDepth.current = 0;
      setExternalDropActive(false);
      return;
    }
    if (!supportsExternalImportTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const payload = externalImportPayload(event.dataTransfer);
    void importDroppedFiles(
      payload.files,
      targetFolderId,
      targetCollectionId,
      payload,
    );
  }

  async function resolveConflicts() {
    if (!api || !library || !conflicts) return;
    setUiState("importing");
    try {
      const result = await api.resolveImport({
        importId: conflicts.importId,
        suspectedDuplicate: duplicateDecision,
        nameConflict: nameDecision,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setConflicts(null);
      setNotice(importSummary(result.value));
      await reloadCurrentContent();
    } catch (caught) {
      setError(toMessage(caught, "无法继续导入。"));
    } finally {
      setUiState("ready");
    }
  }

  async function abandonConflicts() {
    if (!api || !conflicts) return;
    const plan = conflicts;
    setConflicts(null);
    try {
      const result = await api.abandonImport({ importId: plan.importId });
      if (!result.ok) throw new LibraryOperationError(result.error);
    } catch (caught) {
      setError(toMessage(caught, "无法取消待处理导入。"));
    }
  }

  async function refreshAssets() {
    if (!api || !library) return;
    setUiState("loading");
    try {
      const result = await api.refreshAssets({ libraryId: library.libraryId });
      if (!result.ok) throw new LibraryOperationError(result.error);
      await reloadCurrentContent();
      setNotice(
        result.value.changedCount
          ? `已同步 ${result.value.changedCount} 项外部变化。`
          : "磁盘内容已是最新状态。",
      );
    } catch (caught) {
      setError(toMessage(caught, "刷新失败。"));
    } finally {
      setUiState("ready");
    }
  }

  async function importFolderAsLinked() {
    if (!api || !library) return;
    setUiState("importing");
    setError(null);
    setNotice(null);
    try {
      const result = await api.importFolderAsLinked({
        libraryId: library.libraryId,
        displayName: undefined,
      });
      if (!result.ok) {
        if (result.error.code === "CANCELLED") return;
        throw new LibraryOperationError(result.error);
      }
      setNotice(`已链接文件夹"${result.value.displayName}"。`);
      await reloadCurrentContent();
    } catch (caught) {
      setError(toMessage(caught, "链接文件夹失败。"));
    } finally {
      setUiState("ready");
    }
  }

  async function relinkFolder(folderId: string) {
    if (!api || !library) return;
    setUiState("loading");
    try {
      const result = await api.relinkMissingFolder({
        libraryId: library.libraryId,
        folderId,
      });
      if (!result.ok) {
        if (result.error.code === "CANCELLED") return;
        throw new LibraryOperationError(result.error);
      }
      setNotice(`已重新定位链接文件夹"${result.value.displayName}"。`);
      await reloadCurrentContent();
    } catch (caught) {
      setError(toMessage(caught, "重新定位失败。"));
    } finally {
      setUiState("ready");
    }
  }

  async function openLinkedRules(folder: LinkedFolderSummary) {
    if (!api || !library) return;
    try {
      const result = await api.getLinkedFolderRules({
        libraryId: library.libraryId,
        folderId: folder.folderId,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setLinkedRulesEditor({
        folderId: folder.folderId,
        name: folder.displayName,
        rules: result.value,
      });
    } catch (caught) {
      setError(toMessage(caught, "无法读取链接文件夹过滤规则。"));
    }
  }

  async function saveLinkedRules() {
    if (!api || !library || !linkedRulesEditor) return;
    setUiState("loading");
    try {
      const result = await api.setLinkedFolderRules({
        libraryId: library.libraryId,
        folderId: linkedRulesEditor.folderId,
        rules: linkedRulesEditor.rules,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setNotice(
        `过滤规则已保存：隐藏 ${result.value.hiddenCount} 项，恢复 ${result.value.restoredCount} 项。`,
      );
      setLinkedRulesEditor(null);
      await reloadCurrentContent();
    } catch (caught) {
      setError(toMessage(caught, "保存过滤规则失败。"));
    } finally {
      setUiState("ready");
    }
  }

  async function copyManagedSelectionToLinked(
    folder: LinkedFolderSummary,
    assetIds: string[],
  ) {
    if (!api || !library || assetIds.length === 0) return;
    if (
      !confirm(
        `将 ${assetIds.length} 项托管资产复制到外部目录"${folder.displayName}"？源托管文件不会移动。`,
      )
    )
      return;
    setUiState("importing");
    try {
      const result = await api.copyAssetsToLinkedFolder({
        libraryId: library.libraryId,
        folderId: folder.folderId,
        assetIds,
        conflictStrategy: "keep-both",
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setNotice(
        `已复制 ${result.value.copiedCount} 项到链接文件夹，跳过 ${result.value.skippedCount} 项。`,
      );
      await reloadCurrentContent();
    } catch (caught) {
      setError(toMessage(caught, "复制到链接文件夹失败。"));
    } finally {
      setUiState("ready");
    }
  }

  async function convertLinkedToManaged() {
    if (!api || !library || !convertLinkedDialog.folderId) return;
    const dialogState = convertLinkedDialog;
    if (
      !confirm(
        `将"${dialogState.name}"复制进资源库并移除链接关系？外部源目录不会被删除。`,
      )
    )
      return;
    setUiState("importing");
    try {
      const result = await api.convertLinkedFolderToManaged({
        libraryId: library.libraryId,
        folderId: dialogState.folderId,
        targetFolderId: dialogState.targetFolderId || undefined,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setConvertLinkedDialog({ folderId: "", name: "", targetFolderId: "" });
      setNotice(
        `已转换 ${result.value.convertedCount} 项；外部源目录保持不变。`,
      );
      await reloadCurrentContent();
    } catch (caught) {
      setError(toMessage(caught, "转换链接文件夹失败。"));
    } finally {
      setUiState("ready");
    }
  }

  async function closeLibrary() {
    if (!api || !library) return;
    setUiState("closing");
    let closed = false;
    try {
      if (previewAsset) await closeAssetPreview();
      const result = await api.close({ libraryId: library.libraryId });
      if (!result.ok) throw new LibraryOperationError(result.error);
      closed = true;
      setLibrary(null);
      setFolders([]);
      setLinkedFolders([]);
      setAssets([]);
      setAllAssetCount(0);
      setAssetScope("all");
      setShowTrash(false);
      setTrashedAssets([]);
      setTags([]);
      setCollections([]);
      setSmartCollections([]);
      setActiveTagId(null);
      setActiveCollectionId(null);
      setActiveSmartCollectionId(null);
      setSearchTotal(null);
      setSearchSnippets(new Map());
      setMoveDialog(null);
      setUndoMoveDialog(null);
      setLastMoveOperationId(null);
      api?.setActiveContext(null);
    } catch (caught) {
      setError(toMessage(caught, "关闭失败。"));
    } finally {
      setUiState(closed ? "idle" : "ready");
    }
  }

  // --- Trash operations ---

  async function trashManagedAssets(assetIds: string[]) {
    if (!api || !library) return;
    setUiState("loading");
    try {
      const result = await api.trashAssets({
        libraryId: library.libraryId,
        assetIds,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setNotice(`${result.value.trashedCount} 项资产已移入回收站。`);
      clearAssetSelection();
      await reloadCurrentContent();
    } catch (caught) {
      setError(toMessage(caught, "删除失败。"));
    } finally {
      setUiState("ready");
    }
  }

  async function restoreTrashedAssets() {
    if (!api || !library || !restoreDialog) return;
    const { assetIds, target, conflictStrategy } = restoreDialog;
    setRestoreDialog(null);
    setUiState("loading");
    try {
      const result = await api.restoreAssets({
        libraryId: library.libraryId,
        assetIds,
        ...(target === "original"
          ? {}
          : { targetFolderId: target === "root" ? null : target }),
        conflictStrategy,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      const skippedCount = assetIds.length - result.value.restoredCount;
      setNotice(
        `已恢复 ${result.value.restoredCount} 项资产${skippedCount ? `，跳过 ${skippedCount} 项冲突资产` : ""}。`,
      );
      clearAssetSelection();
      await loadContent(library, "all", { trashMode: true });
    } catch (caught) {
      setError(toMessage(caught, "恢复失败。"));
    } finally {
      setUiState("ready");
    }
  }

  async function moveManagedAssets() {
    if (!api || !library || !moveDialog) return;
    const { assetIds, targetFolderId, conflictStrategy } = moveDialog;
    setMoveDialog(null);
    setUiState("loading");
    try {
      const result = await api.moveAssets({
        libraryId: library.libraryId,
        assetIds,
        targetFolderId,
        conflictStrategy,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setLastMoveOperationId(result.value.operationId);
      setNotice(
        `已移动 ${result.value.movedCount} 项资产${result.value.skippedCount ? `，跳过 ${result.value.skippedCount} 项` : ""}。`,
      );
      clearAssetSelection();
      await reloadCurrentContent();
    } catch (caught) {
      setError(toMessage(caught, "移动资产失败。"));
    } finally {
      setUiState("ready");
    }
  }

  async function undoManagedMove(
    operationId: string,
    conflictStrategy: "error" | "keep-both" | "replace" | "skip" = "error",
  ) {
    if (!api || !library) return;
    setUndoMoveDialog(null);
    setUiState("loading");
    try {
      const result = await api.undoMoveAssets({
        libraryId: library.libraryId,
        operationId,
        conflictStrategy,
      });
      if (!result.ok) {
        if (
          result.error.code === "ASSET_MOVE_CONFLICT" &&
          conflictStrategy === "error"
        ) {
          setUndoMoveDialog({ operationId, conflictStrategy: "keep-both" });
        }
        throw new LibraryOperationError(result.error);
      }
      setLastMoveOperationId(null);
      setNotice(
        `已撤销移动 ${result.value.undoneCount} 项资产${result.value.skippedCount ? `，跳过 ${result.value.skippedCount} 项冲突资产` : ""}。`,
      );
      await reloadCurrentContent();
    } catch (caught) {
      setError(toMessage(caught, "撤销移动失败。"));
    } finally {
      setUiState("ready");
    }
  }

  async function deletePermanentFromTrash() {
    if (!api || !library || !permanentDeleteDialog) return;
    const assetIds = permanentDeleteDialog;
    setPermanentDeleteDialog(null);
    setUiState("loading");
    try {
      const result = await api.deleteAssetsPermanent({
        libraryId: library.libraryId,
        assetIds,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      let msg = `已永久删除 ${result.value.deletedCount} 项。`;
      if (result.value.skippedCount > 0) {
        const skippedNames = new Map(
          trashedAssets.map((asset) => [asset.assetId, asset.displayName]),
        );
        msg += ` ${result.value.skippedCount} 项未删除：${result.value.skippedReasons
          .map(
            ({ assetId, reason }) =>
              `${skippedNames.get(assetId) ?? "所选资产"}（${PUBLIC_ERROR_REASONS_ZH[reason]}）`,
          )
          .join("；")}`;
      }
      setNotice(msg);
      clearAssetSelection();
      await loadContent(library, "all", { trashMode: true });
    } catch (caught) {
      setError(toMessage(caught, "永久删除失败。"));
    } finally {
      setUiState("ready");
    }
  }

  async function purgeTrash() {
    if (!api || !library) return;
    setUiState("loading");
    try {
      const result = await api.purgeTrash({ libraryId: library.libraryId });
      if (!result.ok) throw new LibraryOperationError(result.error);
      const failureReasons = [
        ...new Set(
          result.value.failures.map(({ reason }) => PUBLIC_ERROR_REASONS_ZH[reason]),
        ),
      ];
      setNotice(
        `已清理 ${result.value.purgedCount} 项到期资产${result.value.skippedCount > 0
          ? `，${result.value.skippedCount} 项未清理：${failureReasons.join("；")}`
          : ""}。`,
      );
      await loadContent(library, "all", { trashMode: true });
    } catch (caught) {
      setError(toMessage(caught, "清空回收站失败。"));
    } finally {
      setUiState("ready");
    }
  }

  // --- Linked asset delete ---

  async function executeDeleteLinked() {
    if (!api || !library || !deleteLinkedDialog) return;
    const { assetIds, deleteSourceFile } = deleteLinkedDialog;
    setDeleteLinkedDialog(null);
    setUiState("loading");
    try {
      const result = await api.deleteLinkedAssets({
        libraryId: library.libraryId,
        assetIds,
        deleteSourceFile,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      let outcomeError: string | null = null;
      if (result.value.failedCount > 0) {
        const reasons = [
          ...new Set(
            result.value.failures.map(
              ({ reason }) => PUBLIC_ERROR_REASONS_ZH[reason],
            ),
          ),
        ];
        outcomeError = `删除链接资产未全部完成：已删除 ${result.value.deletedCount} 项，另有 ${result.value.failedCount} 项保留。原因：${reasons.join("；")}`;
        setError(outcomeError);
      } else {
        setError(null);
        setNotice(
          deleteSourceFile
            ? `已将 ${result.value.deletedCount} 个源文件移入系统回收站，并移除链接资产记录。`
            : `已移除 ${result.value.deletedCount} 项链接资产记录，磁盘源文件保持不变。`,
        );
      }
      if (result.value.deletedCount > 0) clearAssetSelection();
      try {
        await reloadCurrentContent();
      } catch (refreshError) {
        const refreshReason = toMessage(refreshError, "请手动刷新资产列表。");
        setError(
          outcomeError
            ? `${outcomeError} 另外，界面刷新失败：${refreshReason}`
            : `删除已完成，但界面刷新失败：${refreshReason}`,
        );
      }
    } catch (caught) {
      setError(toMessage(caught, "删除链接资产失败。"));
    } finally {
      setUiState("ready");
    }
  }

  // --- Relink operations ---

  async function relinkMissingAsset() {
    if (!api || !library || !selectedAssetId) return;
    setUiState("loading");
    try {
      const result = await api.relinkAsset({
        libraryId: library.libraryId,
        assetId: selectedAssetId,
      });
      if (!result.ok) {
        if (result.error.code === "CANCELLED") return;
        throw new LibraryOperationError(result.error);
      }
      setNotice("资产已成功找回。");
      await reloadCurrentContent();
    } catch (caught) {
      setError(toMessage(caught, "找回资产失败。"));
    } finally {
      setUiState("ready");
    }
  }

  async function startBatchRelink() {
    if (!api || !library) return;
    setUiState("loading");
    try {
      const result = await api.relinkBatchPreview({
        libraryId: library.libraryId,
        keepMetadata: batchRelinkKeepMetadata,
      });
      if (!result.ok) {
        if (result.error.code === "CANCELLED") return;
        throw new LibraryOperationError(result.error);
      }
      setBatchRelinkPreview(result.value);
    } catch (caught) {
      setError(toMessage(caught, "批量重新定位预览失败。"));
    } finally {
      setUiState("ready");
    }
  }

  async function applyBatchRelink() {
    if (!api || !library || !batchRelinkPreview) return;
    setUiState("loading");
    try {
      const result = await api.relinkBatchApply({
        libraryId: library.libraryId,
        previewId: batchRelinkPreview.previewId,
        keepMetadata: batchRelinkKeepMetadata,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setBatchRelinkPreview(null);
      setNotice(
        `批量重新定位完成：恢复 ${result.value.restoredCount} 项，${result.value.unchangedMissingCount} 项仍丢失。`,
      );
      await reloadCurrentContent();
    } catch (caught) {
      setBatchRelinkPreview(null);
      setError(toMessage(caught, "批量重新定位失败。"));
    } finally {
      setUiState("ready");
    }
  }

  const cancelBatchRelink = useCallback(async () => {
    if (!api || !library || !batchRelinkPreview) return;
    const previewId = batchRelinkPreview.previewId;
    setBatchRelinkPreview(null);
    try {
      const result = await api.cancelRelinkBatch({
        libraryId: library.libraryId,
        previewId,
      });
      if (!result.ok && result.error.code !== "CANCELLED") {
        throw new LibraryOperationError(result.error);
      }
    } catch (caught) {
      setError(toMessage(caught, "取消批量重新定位失败。"));
    }
  }, [api, batchRelinkPreview, library]);

  // --- Export / Import operations ---

  async function exportLibrary() {
    if (!api || !library) return;
    setExportDialogOpen(false);
    setExportProgress({
      type: "export.progress",
      exportId: "",
      libraryId: library.libraryId,
      phase: "snapshot-db",
      filesProcessed: 0,
      totalFiles: 0,
      bytesProcessed: 0,
      totalBytes: 0,
    });
    try {
      const result = await api.exportLibrary({
        libraryId: library.libraryId,
        includeLinkedContent,
        format: exportFormat,
      });
      if (!result.ok) {
        if (result.error.code === "CANCELLED") {
          setNotice("导出已取消。");
        } else {
          throw new LibraryOperationError(result.error);
        }
      }
    } catch (caught) {
      setError(toMessage(caught, "导出失败。"));
    } finally {
      setTimeout(() => {
        setExportProgress((prev) => {
          if (prev?.phase === "complete" || prev?.phase === "cancelled")
            return null;
          return prev;
        });
      }, 4000);
    }
  }

  async function cancelExport() {
    if (!api || !exportProgress?.exportId) return;
    try {
      const result = await api.cancelLibraryExport({
        exportId: exportProgress.exportId,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setNotice("正在取消导出并清理本次导出内容…");
    } catch (caught) {
      setError(toMessage(caught, "无法取消导出。"));
    }
  }

  async function cancelImport() {
    if (!api || !importProgress?.importId) return;
    try {
      const result = await api.cancelLibraryImport({
        importId: importProgress.importId,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setNotice("正在取消导入并清理本次导入内容…");
    } catch (caught) {
      setError(toMessage(caught, "无法取消导入。"));
    }
  }

  async function startImport() {
    if (!api) return;
    setImportProgress({
      type: "import.progress",
      importId: "",
      phase: "validate",
      filesProcessed: 0,
      totalFiles: 0,
      bytesProcessed: 0,
      totalBytes: 0,
    });
    try {
      const result = await api.importLibrary();
      if (!result.ok) {
        if (result.error.code === "CANCELLED") {
          setImportProgress(null);
          return;
        }
        throw new LibraryOperationError(result.error);
      }
      setImportValidated(result.value);
      setImportProgress(null);
    } catch (caught) {
      setError(toMessage(caught, "导入验证失败。"));
      setImportProgress(null);
    }
  }

  async function startImportZip() {
    if (!api) return;
    setImportProgress({
      type: "import.progress",
      importId: "",
      phase: "validate",
      filesProcessed: 0,
      totalFiles: 0,
      bytesProcessed: 0,
      totalBytes: 0,
    });
    try {
      const result = await api.importLibraryZip();
      if (!result.ok) {
        if (result.error.code === "CANCELLED") {
          setImportProgress(null);
          setNotice("导入已取消。");
          return;
        }
        throw new LibraryOperationError(result.error);
      }
      setImportProgress(null);
    } catch (caught) {
      setError(toMessage(caught, "ZIP 导入失败。"));
      setImportProgress(null);
    }
  }

  async function completeImportCopy() {
    if (!api || !importValidated) return;
    setImportProgress({
      type: "import.progress",
      importId: importValidated.importId,
      phase: "copy",
      filesProcessed: 0,
      totalFiles: 0,
      bytesProcessed: 0,
      totalBytes: 0,
    });
    try {
      const result = await api.importLibraryCopy({
        importId: importValidated.importId,
      });
      if (!result.ok) {
        if (result.error.code === "CANCELLED") {
          setNotice("导入已取消。");
        } else {
          throw new LibraryOperationError(result.error);
        }
      }
      setImportValidated(null);
    } catch (caught) {
      setError(toMessage(caught, "导入失败。"));
      setImportProgress(null);
    }
  }

  async function completeImportInPlace() {
    if (!api || !importValidated) return;
    setImportProgress({
      type: "import.progress",
      importId: importValidated.importId,
      phase: "open",
      filesProcessed: 0,
      totalFiles: 0,
      bytesProcessed: 0,
      totalBytes: 0,
    });
    try {
      const result = await api.importLibraryOpenInPlace({
        importId: importValidated.importId,
      });
      if (!result.ok) {
        if (result.error.code === "CANCELLED") {
          setNotice("导入已取消。");
        } else {
          throw new LibraryOperationError(result.error);
        }
      }
      setImportValidated(null);
    } catch (caught) {
      setError(toMessage(caught, "导入失败。"));
      setImportProgress(null);
    }
  }

  useEffect(() => {
    if (!api || !library) return;
    return api.onAssetsChanged((event) => {
      if (event.libraryId !== library.libraryId) return;
      void Promise.resolve().then(async () => {
        try {
          await reloadCurrentContentRef.current();
          if (selectedAssetId) {
            const metadata = await api.getAssetMetadata({
              libraryId: library.libraryId,
              assetId: selectedAssetId,
            });
            if (metadata.ok) {
              metadataByAssetRef.current.set(selectedAssetId, metadata.value);
              metadataConflictAssetIdsRef.current.delete(selectedAssetId);
              if (selectedAssetIdRef.current === selectedAssetId)
                setAssetMetadata(metadata.value);
            }
          }
          const missing = event.missingCount
            ? `，其中 ${event.missingCount} 项丢失`
            : "";
          setNotice(`已自动同步 ${event.changedCount} 项磁盘变化${missing}。`);
        } catch (caught) {
          setError(toMessage(caught, "磁盘内容已变化，但界面刷新失败。"));
        }
      });
    });
  }, [api, library, selectedAssetId]);

  useEffect(() => {
    if (!api) return;
    return api.onProgress((event) => {
      if (event.type === "export.progress") {
        setExportProgress(event);
        if (event.phase === "complete") {
          setNotice(
            `导出完成：${event.totalFiles} 文件，${formatBytes(event.totalBytes)}。`,
          );
        }
      } else if (event.type === "import.progress") {
        setImportProgress(event);
        if (event.phase === "complete") {
          setImportProgress(null);
        }
      }
    });
  }, [api]);

  useEffect(() => {
    if (
      !dialog &&
      !conflicts &&
      !permanentDeleteDialog &&
      !deleteLinkedDialog &&
      !batchRelinkPreview &&
      !restoreDialog &&
      !moveDialog &&
      !undoMoveDialog &&
      !collectionEditor
    )
      return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        const modal = document.querySelector<HTMLElement>(
          '[role="dialog"][aria-modal="true"]',
        );
        const focusable = modal?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
        return;
      }
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (permanentDeleteDialog) {
        setPermanentDeleteDialog(null);
        return;
      }
      if (deleteLinkedDialog) {
        setDeleteLinkedDialog(null);
        return;
      }
      if (batchRelinkPreview) {
        void cancelBatchRelink();
        return;
      }
      if (restoreDialog) {
        setRestoreDialog(null);
        return;
      }
      if (moveDialog) {
        setMoveDialog(null);
        return;
      }
      if (undoMoveDialog) {
        setUndoMoveDialog(null);
        return;
      }
      if (collectionEditor) {
        setCollectionEditor(null);
        return;
      }
      if (dialog) {
        setDialog(null);
        setShowTagInput(false);
        setShowCollectionInput(false);
        return;
      }
      if (!api || !conflicts) return;
      const importId = conflicts.importId;
      setConflicts(null);
      void Promise.resolve().then(async () => {
        try {
          const result = await api.abandonImport({ importId });
          if (!result.ok) throw new LibraryOperationError(result.error);
        } catch (caught) {
          setError(toMessage(caught, "无法取消待处理导入。"));
        }
      });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [
    api,
    conflicts,
    dialog,
    permanentDeleteDialog,
    deleteLinkedDialog,
    batchRelinkPreview,
    cancelBatchRelink,
    restoreDialog,
    moveDialog,
    undoMoveDialog,
    collectionEditor,
  ]);

  useEffect(() => {
    const onSelectionKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      )
        return;
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "a" &&
        library &&
        visibleAssets.length > 0
      ) {
        event.preventDefault();
        const ids = visibleAssets.map((asset) => asset.assetId);
        setSelectedAssetIds(ids);
        setSelectedAssetId(ids.at(-1));
        selectionAnchorRef.current = ids[0] ?? null;
      } else if (
        event.key === "Escape" &&
        selectedAssetIds.length > 0 &&
        !previewAsset &&
        !document.querySelector('[role="dialog"][aria-modal="true"]')
      ) {
        event.preventDefault();
        clearAssetSelection();
      }
    };
    document.addEventListener("keydown", onSelectionKeyDown);
    return () => document.removeEventListener("keydown", onSelectionKeyDown);
  }, [library, previewAsset, selectedAssetIds.length, visibleAssets]);

  useEffect(() => {
    managedImportTargetFolderIdRef.current = undefined;
  }, [library?.libraryId]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target;
      if (
        !library ||
        busy ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      )
        return;
      if (
        event.clipboardData &&
        !Array.from(event.clipboardData.items).some((item) =>
          item.type.startsWith("image/"),
        )
      )
        return;
      event.preventDefault();
      void pasteClipboardImage();
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [library, busy, pasteClipboardImage]);

  useEffect(() => {
    if (
      dialog ||
      conflicts ||
      permanentDeleteDialog ||
      deleteLinkedDialog ||
      batchRelinkPreview ||
      restoreDialog ||
      collectionEditor
    )
      return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement &&
          (target.isContentEditable || target.closest('[role="dialog"]')))
      )
        return;
      if (previewAsset) {
        if (event.key === "Escape" && !document.fullscreenElement) {
          event.preventDefault();
          void closeAssetPreview();
          return;
        }
        if (event.key === "ArrowLeft" && previewIndex > 0) {
          event.preventDefault();
          navigateAssetPreview(visibleAssets[previewIndex - 1]!);
          return;
        }
        if (
          event.key === "ArrowRight" &&
          previewIndex >= 0 &&
          previewIndex < visibleAssets.length - 1
        ) {
          event.preventDefault();
          navigateAssetPreview(visibleAssets[previewIndex + 1]!);
        }
        return;
      }
      if (
        target instanceof HTMLElement &&
        target.closest(
          'button:not(.asset-card), a, [role="button"]:not(.asset-card), [role="menuitem"]',
        )
      )
        return;
      if ((event.key !== "Enter" && event.key !== " ") || event.repeat) return;
      if (
        !selectedAsset ||
        selectedAsset.availability !== "available" ||
        selectedAsset.deletedAt
      )
        return;
      event.preventDefault();
      openAssetPreview(selectedAsset);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [
    batchRelinkPreview,
    closeAssetPreview,
    collectionEditor,
    conflicts,
    deleteLinkedDialog,
    dialog,
    permanentDeleteDialog,
    previewAsset,
    previewIndex,
    restoreDialog,
    selectedAsset,
    visibleAssets,
  ]);

  function workspaceTitle() {
    if (!library) return "工作区";
    if (showTrash) return "回收站";
    if (activeTagId) {
      const t = tags.find((x) => x.tagId === activeTagId);
      return t ? `标签：${t.name}` : "标签筛选";
    }
    if (activeCollectionId) {
      const c = collections.find((x) => x.collectionId === activeCollectionId);
      return c ? `合集：${c.name}` : "合集视图";
    }
    if (assetScope === "all") return "所有资产";
    if (assetScope === "root") return "资源库根目录";
    return selectedFolder?.name ?? "工作区";
  }

  function scopeChipLabel() {
    if (showTrash) return "回收站";
    if (activeTagId) {
      const t = tags.find((x) => x.tagId === activeTagId);
      return t ? `标签 · ${t.name}` : "标签";
    }
    if (activeCollectionId) {
      const c = collections.find((x) => x.collectionId === activeCollectionId);
      return c ? `合集 · ${c.name}` : "合集";
    }
    if (activeSmartCollectionId) {
      const c = smartCollections.find(
        (x) => x.collectionId === activeSmartCollectionId,
      );
      return c ? `智能合集 · ${c.name}` : "智能合集";
    }
    if (assetScope === "all") return "所有资产";
    if (assetScope === "root") return "资源库根目录";
    return selectedFolder?.name;
  }

  // --- Metadata editor helpers ---
  function handleMetadataLabelInput(event: FormEvent<HTMLInputElement>) {
    const value = (event.target as HTMLInputElement).value;
    setEditLabel(value);
  }

  function handleMetadataLabelSave() {
    if (!assetMetadata || editLabel === (assetMetadata.label ?? "")) return;
    void saveMetadata({ label: editLabel });
  }

  function handleMetadataDescriptionInput(
    event: FormEvent<HTMLTextAreaElement>,
  ) {
    const value = (event.target as HTMLTextAreaElement).value;
    setEditDescription(value);
  }

  function handleMetadataDescriptionSave() {
    if (!assetMetadata || editDescription === (assetMetadata.description ?? ""))
      return;
    void saveMetadata({ description: editDescription });
  }

  function handlePaletteSave() {
    if (!assetMetadata) return;
    const values = editPalette
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (values.length > 20) {
      setError("保存色卡失败。原因：人工色卡最多包含 20 个颜色值。");
      return;
    }
    if (values.some((value) => !/^#[0-9A-Fa-f]{6}$/u.test(value))) {
      setError("保存色卡失败。原因：颜色必须使用 #RRGGBB 格式。");
      return;
    }
    const current = parseStoredPalette(assetMetadata.palette);
    if (JSON.stringify(values) === JSON.stringify(current)) return;
    void saveMetadata({ palette: values });
  }

  function handleRatingClick(rating: number) {
    if (!assetMetadata) return;
    setEditRating(rating);
    void saveMetadata({ rating });
  }

  function handleFavoriteToggle() {
    if (!assetMetadata) return;
    const next = !editFavorite;
    setEditFavorite(next);
    void saveMetadata({ favorite: next });
  }

  function handleSourceUrlInput(event: FormEvent<HTMLInputElement>) {
    const value = (event.target as HTMLInputElement).value;
    setEditSourceUrl(value);
  }

  function handleSourceUrlSave() {
    if (!assetMetadata || editSourceUrl === (assetMetadata.sourcePageUrl ?? ""))
      return;
    if (editSourceUrl !== "") {
      try {
        const parsed = new URL(editSourceUrl);
        if (
          editSourceUrl !== editSourceUrl.trim() ||
          (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
          parsed.username !== "" ||
          parsed.password !== ""
        ) {
          throw new Error("invalid source URL");
        }
      } catch {
        setError(
          "保存源链接失败。原因：请输入不含账号密码的 HTTP(S) 完整链接。",
        );
        return;
      }
    }
    void saveMetadata({ sourcePageUrl: editSourceUrl });
  }

  // ── AI Analysis ────────────────────────────────────────────────────

  async function openExtensionPairing() {
    setExtensionPairingOpen(true);
    setExtensionPairingToken("");
    setExtensionPairingError(null);
    if (!extensionPairingApi) {
      setExtensionPairingError("当前桌面桥接不支持浏览器扩展配对。");
      return;
    }
    const result = await extensionPairingApi.getToken();
    if (result.ok) setExtensionPairingToken(result.token);
    else setExtensionPairingError(result.message);
  }

  async function rotateExtensionPairing() {
    if (!extensionPairingApi) return;
    if (!confirm("轮换后，浏览器扩展中保存的旧配对码会立即失效。确定继续吗？"))
      return;
    const result = await extensionPairingApi.rotateToken();
    if (result.ok) {
      setExtensionPairingToken(result.token);
      setExtensionPairingError(null);
      setNotice("浏览器扩展配对码已轮换，请在扩展选项中更新。");
    } else {
      setExtensionPairingError(result.message);
    }
  }

  async function copyExtensionPairingToken() {
    if (!extensionPairingToken) return;
    try {
      await navigator.clipboard.writeText(extensionPairingToken);
      setNotice("浏览器扩展配对码已复制。");
    } catch {
      setExtensionPairingError("复制失败，请手动选择配对码。");
    }
  }

  async function loadAiConfig() {
    if (!api) return;
    const result = await api.getAiConfig();
    if (!result.ok) return;
    setAiProvider(
      (result.value.provider as "openai" | "gemini" | "anthropic") ?? "openai",
    );
    setAiModel(result.value.model ?? "gpt-4o-mini");
    setAiHasKey(result.value.hasKey);
    setAiLabelEnabled(result.value.enabledFields.label);
    setAiDescriptionEnabled(result.value.enabledFields.description);
    setAiTagsEnabled(result.value.enabledFields.tags);
    setAiStructuredEnabled(result.value.enabledFields.structuredMetadata);
    setAiLanguage(result.value.language);
    setAiAutoAnalyzeEnabled(result.value.autoAnalyzeEnabled);
    setAiDisclaimerAccepted(result.value.disclaimerAccepted);
  }

  async function saveAiConfig() {
    if (!api || (!aiApiKey.trim() && !aiHasKey)) return;
    const result = await api.setAiConfig({
      provider: aiProvider,
      model: aiModel,
      ...(aiApiKey.trim() ? { apiKey: aiApiKey.trim() } : {}),
      enabledFields: {
        label: aiLabelEnabled,
        description: aiDescriptionEnabled,
        tags: aiTagsEnabled,
        structuredMetadata: aiStructuredEnabled,
      },
      language: aiLanguage,
      autoAnalyzeEnabled: aiAutoAnalyzeEnabled,
      disclaimerAccepted: aiDisclaimerAccepted,
    });
    if (!result.ok) {
      setError(toMessage(result.error, "AI 配置保存失败。"));
      return;
    }
    setAiHasKey(aiHasKey || Boolean(aiApiKey.trim()));
    setAiApiKey("");
    setAiConfigOpen(false);
    setNotice("AI 配置已保存。");
  }

  async function handleAnalyzeClick() {
    if (!api || !library || !selectedAssetId) return;
    setAiAnalyzing(true);
    setAiContent(null);
    try {
      const result = await api.analyzeAsset({
        libraryId: library.libraryId,
        assetId: selectedAssetId,
      });
      if (!result.ok) {
        setError(toMessage(result.error, "AI 分析失败。"));
        return;
      }
      if ("reason" in result.value) {
        setNotice(`AI 分析暂不可用：${result.value.reason}`);
        return;
      }
      setAiContent({
        label: result.value.generatedFields.label,
        description: result.value.generatedFields.description,
        tags: result.value.generatedFields.tags,
        structuredMetadata: result.value.generatedFields.structuredMetadata,
        modelVersion: result.value.modelVersion,
      });
      setNotice("AI 分析完成。");
      // Refresh metadata to show updated tags
      if (selectedAssetId) void loadMetadata();
    } finally {
      setAiAnalyzing(false);
    }
  }

  async function loadMediaJobs(quiet = false) {
    if (!api || !library) return;
    if (!quiet) setMediaJobsLoading(true);
    try {
      const result = await api.listMediaJobs({ libraryId: library.libraryId });
      if (!result.ok) {
        if (!quiet) setError(toMessage(result.error, "后台媒体任务加载失败。"));
        return;
      }
      setMediaJobs(result.value);
    } catch {
      if (!quiet) setError("后台媒体任务加载失败：桌面服务没有响应。");
    } finally {
      if (!quiet) setMediaJobsLoading(false);
    }
  }

  async function loadAiJobs(quiet = false) {
    if (!api || !library) return;
    if (!quiet) setMediaJobsLoading(true);
    try {
      const result = await api.getAiJobStatus({ libraryId: library.libraryId });
      if (!result.ok) {
        if (!quiet) setError(toMessage(result.error, "AI 任务加载失败。"));
        return;
      }
      setAiJobs(result.value);
    } catch {
      if (!quiet) setError("AI 任务加载失败：桌面服务没有响应。");
    } finally {
      if (!quiet) setMediaJobsLoading(false);
    }
  }

  useEffect(() => {
    if (!mediaJobsOpen || !library || !api) return;
    let active = true;
    const poll = async () => {
      try {
        const [mediaResult, aiResult] = await Promise.all([
          api.listMediaJobs({ libraryId: library.libraryId }),
          api.getAiJobStatus({ libraryId: library.libraryId }),
        ]);
        if (active && mediaResult.ok) setMediaJobs(mediaResult.value);
        if (active && aiResult.ok) setAiJobs(aiResult.value);
      } catch {
        // Keep the last known task state during a transient Worker restart.
      } finally {
        if (active) setMediaJobsLoading(false);
      }
    };
    const initial = window.setTimeout(() => {
      if (active) setMediaJobsLoading(true);
      void poll();
    }, 0);
    const timer = window.setInterval(() => void poll(), 1_000);
    return () => {
      active = false;
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [api, library, mediaJobsOpen]);

  async function controlMediaJobs(
    action: "pause" | "resume" | "cancel" | "retry",
    jobIds?: string[],
  ) {
    if (!api || !library) return;
    try {
      const result =
        action === "pause"
          ? await api.pauseMediaJobs({ libraryId: library.libraryId, jobIds })
          : action === "resume"
            ? await api.resumeMediaJobs({
                libraryId: library.libraryId,
                jobIds,
              })
            : action === "cancel"
              ? await api.cancelMediaJobs({
                  libraryId: library.libraryId,
                  jobIds,
                })
              : await api.retryMediaJobs({
                  libraryId: library.libraryId,
                  jobIds: jobIds ?? [],
                });
      if (!result.ok) {
        setError(toMessage(result.error, "后台媒体任务操作失败。"));
        return;
      }
      await loadMediaJobs(true);
    } catch {
      setError("后台媒体任务操作失败：桌面服务没有响应。");
    }
  }

  async function controlAiJobs(
    action: "pause" | "resume" | "cancel" | "retry",
    jobIds?: string[],
  ) {
    if (!api || !library) return;
    try {
      const result =
        action === "pause"
          ? await api.pauseAiJobs({ libraryId: library.libraryId, jobIds })
          : action === "resume"
            ? await api.resumeAiJobs({ libraryId: library.libraryId, jobIds })
            : action === "cancel"
              ? await api.cancelAiJobs({ libraryId: library.libraryId, jobIds })
              : await api.retryAiJobs({
                  libraryId: library.libraryId,
                  jobIds: jobIds ?? [],
                });
      if (!result.ok) {
        setError(toMessage(result.error, "AI 任务操作失败。"));
        return;
      }
      await loadAiJobs(true);
    } catch {
      setError("AI 任务操作失败：桌面服务没有响应。");
    }
  }

  // Handle inline input keydown for tag/collection creation
  function handleTagInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void createTag();
    } else if (e.key === "Escape") {
      setShowTagInput(false);
      setTagInputValue("");
    }
  }

  function handleCollectionInputKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
  ) {
    if (e.key === "Enter") {
      e.preventDefault();
      void createCollection();
    } else if (e.key === "Escape") {
      setShowCollectionInput(false);
      setCollectionInputValue("");
    }
  }

  return (
    <main
      className={`app-shell${leftOpen ? "" : " left-collapsed"}${rightOpen ? "" : " right-collapsed"}`}
    >
      <header className="app-toolbar">
        <div className="toolbar-cluster toolbar-leading">
          <ToolButton
            icon="menu"
            label={leftOpen ? "收起导航" : "展开导航"}
            onClick={() => setLeftOpen((v) => !v)}
            pressed={leftOpen}
          />
          <div className="brand-mark">
            <span className="brand-glyph">S</span>
            <span>Serpent</span>
          </div>
        </div>
        <div className="scope-trace">
          <span className="scope-root">资源库</span>
          <Icon name="chevron" size={12} />
          <span className="scope-chip">
            {library?.displayName ?? "尚未打开"}
          </span>
          {library && (
            <span className="scope-chip scope-chip-muted">
              {scopeChipLabel()}
            </span>
          )}
        </div>
        <form
          className="toolbar-cluster toolbar-actions"
          onSubmit={(event) => {
            if (aiSearchEnabled) void runAiSearch(event);
            else void runSearch(event);
          }}
        >
          <button
            aria-pressed={aiSearchEnabled}
            className="compact-action ai-search-toggle"
            disabled={!library || aiSearchLoading}
            onClick={() => {
              setAiSearchEnabled((enabled) => !enabled);
              setActiveAiSearchDefinition(null);
              setAiSearchPlanSummary(null);
            }}
            title="点亮后仅在提交时调用已配置的 AI，把自然语言转换为普通搜索条件"
            type="button"
          >
            <Icon name="smart" size={14} />
            AI 搜索
          </button>
          <input
            aria-label="搜索资源库"
            className="search-control"
            disabled={!library}
            onChange={(event) => {
              setSearchValue(event.target.value);
              setActiveAiSearchDefinition(null);
              setAiSearchPlanSummary(null);
            }}
            placeholder={
              aiSearchEnabled
                ? "自然语言，例如：横版科幻城市概念图，不要草图"
                : '搜索；支持 label:"短语"、NOT tags:草图、OR'
            }
            title={
              aiSearchEnabled
                ? "提交后由已配置的云端模型生成受限搜索条件"
                : '示例：label:"hero concept" NOT tags:草图'
            }
            value={searchValue}
          />
          <details className="discovery-filters">
            <summary>筛选与排序</summary>
            <div className="discovery-filter-panel">
              <label>
                格式
                <input
                  aria-label="格式过滤"
                  className="text-field"
                  disabled={!library}
                  onChange={(event) => setFormatFilter(event.target.value)}
                  placeholder="png, jpg"
                  value={formatFilter}
                />
                <span>
                  <input
                    aria-label="排除这些格式"
                    checked={excludeFormatFilter}
                    onChange={(event) =>
                      setExcludeFormatFilter(event.target.checked)
                    }
                    type="checkbox"
                  />
                  排除
                </span>
              </label>
              <label>
                标签
                <input
                  aria-label="标签过滤"
                  className="text-field"
                  disabled={!library}
                  list="tag-filter-options"
                  onChange={(event) => {
                    setTagFilter(event.target.value);
                    setActiveTagId(
                      tags.find((tag) => tag.name === event.target.value)
                        ?.tagId ?? null,
                    );
                  }}
                  placeholder="角色, 道具"
                  value={tagFilter}
                />
                <datalist id="tag-filter-options">
                  {tags.map((tag) => (
                    <option key={tag.tagId} value={tag.name} />
                  ))}
                </datalist>
                <span>
                  <input
                    aria-label="排除这些标签"
                    checked={excludeTagFilter}
                    onChange={(event) =>
                      setExcludeTagFilter(event.target.checked)
                    }
                    type="checkbox"
                  />
                  排除
                </span>
              </label>
              <label>
                评分
                <input
                  aria-label="评分过滤"
                  className="text-field"
                  disabled={!library}
                  inputMode="numeric"
                  onChange={(event) => setRatingFilter(event.target.value)}
                  placeholder="4, 5"
                  value={ratingFilter}
                />
                <span>
                  <input
                    aria-label="排除这些评分"
                    checked={excludeRatingFilter}
                    onChange={(event) =>
                      setExcludeRatingFilter(event.target.checked)
                    }
                    type="checkbox"
                  />
                  排除
                </span>
              </label>
              <label>
                喜欢
                <select
                  aria-label="喜欢过滤"
                  className="text-field"
                  disabled={!library}
                  onChange={(event) =>
                    setFavoriteFilter(
                      event.target.value as typeof favoriteFilter,
                    )
                  }
                  value={favoriteFilter}
                >
                  <option value="any">不限</option>
                  <option value="yes">仅喜欢</option>
                  <option value="no">未喜欢</option>
                </select>
              </label>
              <label>
                源链接
                <select
                  aria-label="源链接过滤"
                  className="text-field"
                  disabled={!library}
                  onChange={(event) =>
                    setSourceUrlFilter(
                      event.target.value as typeof sourceUrlFilter,
                    )
                  }
                  value={sourceUrlFilter}
                >
                  <option value="any">不限</option>
                  <option value="yes">有源链接</option>
                  <option value="no">无源链接</option>
                </select>
              </label>
              <label>
                可用性
                <select
                  aria-label="可用性过滤"
                  className="text-field"
                  disabled={!library}
                  onChange={(event) =>
                    setAvailabilityFilter(
                      event.target.value as typeof availabilityFilter,
                    )
                  }
                  value={availabilityFilter}
                >
                  <option value="any">全部</option>
                  <option value="available">可用</option>
                  <option value="missing">文件丢失</option>
                </select>
                <span>
                  <input
                    aria-label="排除该可用性"
                    checked={excludeAvailabilityFilter}
                    disabled={availabilityFilter === "any"}
                    onChange={(event) =>
                      setExcludeAvailabilityFilter(event.target.checked)
                    }
                    type="checkbox"
                  />
                  排除
                </span>
              </label>
              <TechnicalRangeFilter
                label="宽度 (px)"
                range={widthRange}
                setRange={setWidthRange}
              />
              <TechnicalRangeFilter
                label="高度 (px)"
                range={heightRange}
                setRange={setHeightRange}
              />
              <TechnicalRangeFilter
                label="宽高比"
                range={aspectRatioRange}
                setRange={setAspectRatioRange}
                step="0.01"
              />
              <TechnicalRangeFilter
                label="时长 (秒)"
                range={durationRange}
                setRange={setDurationRange}
                step="0.1"
              />
              <label>
                排序字段
                <select
                  aria-label="排序字段"
                  className="text-field"
                  disabled={!library}
                  onChange={(event) =>
                    setSortField(event.target.value as typeof sortField)
                  }
                  value={sortField}
                >
                  <option value="relevance">相关性（默认）</option>
                  <option value="name">名称</option>
                  <option value="modified_at">修改时间</option>
                  <option value="created_at">创建时间</option>
                  <option value="byte_size">文件大小</option>
                  <option value="duration">时长</option>
                  <option value="rating">评分</option>
                  <option value="color">颜色</option>
                </select>
              </label>
              <label>
                排序方向
                <select
                  aria-label="排序方向"
                  className="text-field"
                  disabled={!library}
                  onChange={(event) =>
                    setSortOrder(event.target.value as SortDefinition["order"])
                  }
                  value={sortOrder}
                >
                  <option value="asc">升序</option>
                  <option value="desc">降序</option>
                </select>
              </label>
            </div>
          </details>
          <button
            className="compact-action"
            disabled={
              !library ||
              aiSearchLoading ||
              (aiSearchEnabled && !searchValue.trim())
            }
            type="submit"
          >
            <Icon name="search" size={14} />
            {aiSearchLoading ? "转换中…" : "搜索"}
          </button>
          {aiSearchPlanSummary && (
            <span
              className="ai-search-plan-summary"
              title={aiSearchPlanSummary}
            >
              {aiSearchPlanSummary}
            </span>
          )}
          <input
            aria-label="智能合集标题"
            className="text-field"
            disabled={!library}
            onChange={(event) => setSmartCollectionName(event.target.value)}
            placeholder="智能合集名称"
            style={{ height: 28, width: 110 }}
            value={smartCollectionName}
          />
          <button
            className="compact-action"
            disabled={!library || !smartCollectionName.trim()}
            onClick={() => void saveSmartCollection()}
            type="button"
          >
            <Icon name="smart" size={14} />
            保存
          </button>
          <ToolButton
            icon="collapse-right"
            label={rightOpen ? "收起检查器" : "展开检查器"}
            onClick={() => setRightOpen((v) => !v)}
            pressed={rightOpen}
          />
        </form>
      </header>
      <aside className="navigation-pane">
        <div className="pane-header">
          <span>资源导航</span>
          <span className="status-dot" data-active={Boolean(library)} />
        </div>
        <nav className="navigation-scroll">
          <NavRow
            active={
              library
                ? assetScope === "all" &&
                  !activeTagId &&
                  !activeCollectionId &&
                  !showTrash
                : true
            }
            count={library ? allAssetCount : undefined}
            icon="grid"
            label="所有资产"
            onClick={() => void chooseFolder("all")}
            disabled={!library}
            onDragOver={handleTargetExternalDragOver}
            onDrop={(event) => handleTargetExternalDrop(event, null, undefined)}
          />
          <NavRow
            active={Boolean(
              library && showTrash && !activeTagId && !activeCollectionId,
            )}
            count={trashedAssets.length || undefined}
            disabled={!library}
            icon="trash"
            label="回收站"
            onClick={() => void enterTrash()}
          />
          <NavRow icon="archive" label="最近使用" disabled />
          <Section
            title="文件夹"
            action={
              library
                ? () => {
                    setDialogValue("新建文件夹");
                    setDialog("folder");
                  }
                : undefined
            }
          >
            {library ? (
              <>
                <NavRow
                  active={
                    assetScope === "root" && !activeTagId && !activeCollectionId
                  }
                  icon="folder"
                  label="资源库根目录"
                  onClick={() => void chooseFolder("root")}
                  onDragOver={handleTargetExternalDragOver}
                  onDrop={(event) =>
                    handleTargetExternalDrop(event, null, undefined)
                  }
                />
                {folders.map((folder) => (
                  <NavRow
                    active={
                      assetScope === folder.folderId &&
                      !activeTagId &&
                      !activeCollectionId
                    }
                    depth={folder.relativePath.split("/").length}
                    icon="folder"
                    key={folder.folderId}
                    label={folder.name}
                    onClick={() => void chooseFolder(folder.folderId)}
                    onDragOver={handleTargetExternalDragOver}
                    onDrop={(event) =>
                      handleTargetExternalDrop(
                        event,
                        folder.folderId,
                        undefined,
                      )
                    }
                  />
                ))}
              </>
            ) : (
              <p className="nav-empty">打开资源库后显示目录</p>
            )}
          </Section>
          <Section
            title="标签"
            action={
              library
                ? () => {
                    setShowTagInput(true);
                    setTagInputValue("");
                  }
                : undefined
            }
          >
            {library ? (
              <>
                {showTagInput && (
                  <div className="nav-section">
                    <input
                      autoFocus
                      className="text-field"
                      maxLength={255}
                      onBlur={() => {
                        setShowTagInput(false);
                        setTagInputValue("");
                      }}
                      onChange={(e) => setTagInputValue(e.target.value)}
                      onKeyDown={handleTagInputKeyDown}
                      placeholder="输入标签名称，回车创建"
                      style={{
                        height: 27,
                        margin: "2px 0 4px 0",
                        fontSize: 11,
                      }}
                      value={tagInputValue}
                    />
                  </div>
                )}
                {tags.length ? (
                  tags.map((tag) => (
                    <NavRow
                      active={activeTagId === tag.tagId}
                      icon="tag"
                      key={tag.tagId}
                      label={tag.name}
                      count={tag.assetCount}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        openContextMenu(
                          { type: "organization", orgKind: "tag", id: tag.tagId, name: tag.name },
                          { x: e.clientX, y: e.clientY },
                        );
                      }}
                      onClick={() => void chooseTag(tag.tagId)}
                    />
                  ))
                ) : (
                  <p className="nav-empty">尚无标签</p>
                )}
              </>
            ) : (
              <p className="nav-empty">打开资源库后显示标签</p>
            )}
          </Section>
          <Section
            title="合集"
            action={
              library
                ? () => {
                    setShowCollectionInput(true);
                    setCollectionInputValue("");
                    setNewCollectionParentId(activeCollectionId);
                  }
                : undefined
            }
          >
            {library ? (
              <>
                {showCollectionInput && (
                  <div className="nav-section">
                    <input
                      autoFocus
                      className="text-field"
                      maxLength={255}
                      onBlur={() => {
                        setShowCollectionInput(false);
                        setCollectionInputValue("");
                        setNewCollectionParentId(null);
                      }}
                      onChange={(e) => setCollectionInputValue(e.target.value)}
                      onKeyDown={handleCollectionInputKeyDown}
                      placeholder={
                        newCollectionParentId
                          ? "输入子合集名称，回车创建"
                          : "输入合集名称，回车创建"
                      }
                      style={{
                        height: 27,
                        margin: "2px 0 4px 0",
                        fontSize: 11,
                      }}
                      value={collectionInputValue}
                    />
                  </div>
                )}
                {activeCollectionId && (
                  <div style={{ padding: "0 5px 2px" }}>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        fontSize: 10,
                        color: "var(--tertiary)",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        checked={collectionRecursive}
                        onChange={(e) => {
                          const recursive = e.target.checked;
                          collectionRecursiveRef.current = recursive;
                          setCollectionRecursive(recursive);
                          if (activeCollectionId)
                            void chooseCollection(activeCollectionId, recursive);
                        }}
                        type="checkbox"
                      />
                      包含子合集
                    </label>
                  </div>
                )}
                {collections.length ? (
                  renderCollectionNodes(null, 0)
                ) : (
                  <p className="nav-empty">尚无合集</p>
                )}
              </>
            ) : (
              <p className="nav-empty">打开资源库后显示合集</p>
            )}
          </Section>
          <Section title="智能合集">
            {library ? (
              smartCollections.length ? (
                smartCollections.map((sc) => (
                  <NavRow
                    active={activeSmartCollectionId === sc.collectionId}
                    icon="smart"
                    key={sc.collectionId}
                    label={sc.name}
                    onClick={() => void chooseSmartCollection(sc.collectionId)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      openContextMenu(
                        { type: "smart-collection", id: sc.collectionId, name: sc.name },
                        { x: event.clientX, y: event.clientY },
                      );
                    }}
                  />
                ))
              ) : (
                <p className="nav-empty">尚无智能合集</p>
              )
            ) : (
              <p className="nav-empty">打开资源库后显示智能合集</p>
            )}
          </Section>
          <Section
            title="链接文件夹"
            action={library ? () => void importFolderAsLinked() : undefined}
          >
            {library ? (
              linkedFolders.length ? (
                linkedFolders.map((lf) => (
                  <NavRow
                    active={
                      assetScope === lf.folderId &&
                      !activeTagId &&
                      !activeCollectionId
                    }
                    icon={lf.status === "offline" ? "warning" : "link"}
                    key={lf.folderId}
                    label={lf.displayName}
                    count={lf.assetCount}
                    onClick={
                      lf.status === "offline"
                        ? () => void relinkFolder(lf.folderId)
                        : () => void chooseFolder(lf.folderId)
                    }
                    onContextMenu={(event) => {
                      event.preventDefault();
                      if (event.shiftKey)
                        setConvertLinkedDialog({
                          folderId: lf.folderId,
                          name: lf.displayName,
                          targetFolderId: "",
                        });
                      else void openLinkedRules(lf);
                    }}
                    onDragOver={(event) => {
                      if (
                        event.dataTransfer.types.includes(
                          "application/x-serpent-managed-assets",
                        )
                      )
                        event.preventDefault();
                    }}
                    onDrop={(event) => {
                      const serialized = event.dataTransfer.getData(
                        "application/x-serpent-managed-assets",
                      );
                      if (!serialized) return;
                      event.preventDefault();
                      try {
                        const ids = JSON.parse(serialized) as string[];
                        void copyManagedSelectionToLinked(lf, ids);
                      } catch {
                        setError("拖放资产数据无效，未写入外部目录。");
                      }
                    }}
                  />
                ))
              ) : (
                <p className="nav-empty">链接外部文件夹作为资产来源</p>
              )
            ) : (
              <p className="nav-empty">打开资源库后显示链接文件夹</p>
            )}
            {library && linkedFolders.length > 0 && (
              <p className="nav-empty">
                右键编辑规则；Shift+右键转换为托管。可拖入所选托管资产。
              </p>
            )}
          </Section>
        </nav>
        <div className="pane-footer">
          <span className="storage-pulse" />
          <span>{library ? "本地资源库 · 已连接" : "本地优先 · 未连接"}</span>
        </div>
      </aside>
      <section className="workspace">
        <div
          className={`workspace-bar${previewAsset ? " is-viewing" : ""}`}
        >
          <div className="workspace-title">
            <span>{workspaceTitle()}</span>
            <span className="item-count">
              {library ? `${visibleAssets.length} 项` : "未载入"}
            </span>
          </div>
          <div className="workspace-tools">
            {library && showTrash ? (
              <>
                <button
                  className="compact-action"
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        "确定要清理所有到期项吗？这将永久删除所有超过 30 天的资产。",
                      )
                    )
                      void purgeTrash();
                  }}
                  type="button"
                >
                  <Icon name="trash" size={14} />
                  清理到期项目
                </button>
                {selectedAssetIds.length > 0 && (
                  <>
                    <span className="tool-separator" />
                    <button
                      className="compact-action"
                      disabled={busy}
                      onClick={() =>
                        setRestoreDialog({
                          assetIds: selectedAssetIds,
                          target: "original",
                          conflictStrategy: "keep-both",
                        })
                      }
                      type="button"
                    >
                      <Icon name="upload" size={14} />
                      恢复所选（{selectedAssetIds.length}）
                    </button>
                  </>
                )}
                {selectedAsset && (
                  <button
                    className="compact-action"
                    disabled={busy}
                    onClick={() => {
                      setPermanentDeleteDialog(
                        selectedAssetIds.length > 0
                          ? selectedAssetIds
                          : [selectedAsset.assetId],
                      );
                    }}
                    type="button"
                  >
                    <Icon name="close" size={14} />
                    永久删除
                  </button>
                )}
              </>
            ) : (
              <>
                {library &&
                  selectedAsset &&
                  selectedAsset.availability === "missing" &&
                  !selectedAsset.deletedAt && (
                    <>
                      <button
                        className="compact-action"
                        disabled={busy}
                        onClick={() => void relinkMissingAsset()}
                        type="button"
                      >
                        <Icon name="search" size={14} />
                        找回
                      </button>
                      <span className="tool-separator" />
                    </>
                  )}
                {library &&
                  !showTrash &&
                  selectedAsset &&
                  !selectedAsset.deletedAt &&
                  selectedAsset.locationKind === "managed" && (
                    <>
                      <button
                        className="compact-action"
                        disabled={busy}
                        onClick={() => {
                          void trashManagedAssets([selectedAssetId!]);
                        }}
                        type="button"
                      >
                        <Icon name="trash" size={14} />
                        删除
                      </button>
                    </>
                  )}
                {library &&
                  !showTrash &&
                  selectedAsset &&
                  !selectedAsset.deletedAt &&
                  selectedAsset.locationKind === "linked" && (
                    <>
                      <span className="tool-separator" />
                      <button
                        className="compact-action"
                        disabled={busy}
                        onClick={() => {
                          setDeleteLinkedDialog({
                            assetIds: [selectedAssetId!],
                            displayNames: selectedAsset.displayName,
                            deleteSourceFile: false,
                            canDeleteSourceFile:
                              selectedAsset.availability === "available",
                          });
                        }}
                        type="button"
                      >
                        <Icon name="link" size={14} />
                        删除（链接）
                      </button>
                    </>
                  )}
                {library &&
                  !showTrash &&
                  visibleAssets.some(
                    (a) => a.availability === "missing" && !a.deletedAt,
                  ) && (
                    <>
                      <span className="tool-separator" />
                      <button
                        className="compact-action"
                        disabled={busy}
                        onClick={() => void startBatchRelink()}
                        type="button"
                      >
                        <Icon name="folder" size={14} />
                        批量重新定位
                      </button>
                    </>
                  )}
              </>
            )}
            <span className="tool-separator" />
            <button
              className="compact-action"
              disabled={!library || busy}
              onClick={() => void importAssets("files")}
              type="button"
            >
              <Icon name="upload" size={14} />
              导入文件
            </button>
            <button
              className="compact-action"
              disabled={!library || busy}
              onClick={() => void importAssets("folder")}
              type="button"
            >
              <Icon name="folder" size={14} />
              导入文件夹
            </button>
            <button
              className="compact-action"
              disabled={!library || busy}
              onClick={() => void pasteClipboardImage()}
              type="button"
            >
              <Icon name="file" size={14} />
              粘贴图片
            </button>
            <button
              className="compact-action"
              disabled={!library || busy}
              onClick={() => void importFolderAsLinked()}
              type="button"
            >
              <Icon name="link" size={14} />
              导入链接文件夹
            </button>
            <span className="tool-separator" />
            <button
              className="compact-action"
              disabled={!library || busy}
              onClick={() => setExportDialogOpen(true)}
              type="button"
            >
              <Icon name="archive" size={14} />
              导出资源库
            </button>
            <button
              className="compact-action"
              disabled={busy}
              onClick={() => void startImport()}
              type="button"
            >
              <Icon name="folder" size={14} />
              导入资源库
            </button>
            <button
              className="compact-action"
              disabled={busy}
              onClick={() => void startImportZip()}
              type="button"
            >
              <Icon name="archive" size={14} />
              导入 ZIP
            </button>
            <ToolButton
              disabled={!library || busy}
              icon="refresh"
              label="刷新磁盘变化"
              onClick={() => void refreshAssets()}
            />
            <div className="canvas-controls">
              <span className="tool-separator" />
              <ToolButton
                icon="grid"
                label="平铺视图"
                onClick={() =>
                  setCanvasPrefs((p) => ({ ...p, viewMode: "grid" }))
                }
                pressed={assetViewMode === "grid"}
              />
              <ToolButton
                icon="menu"
                label="瀑布流视图"
                onClick={() =>
                  setCanvasPrefs((p) => ({ ...p, viewMode: "masonry" }))
                }
                pressed={assetViewMode === "masonry"}
              />
              <label className="asset-size-control">
                <span>缩略图大小</span>
                <input
                  aria-label="资产缩略图大小"
                  max={CARD_SIZE_MAX}
                  min={CARD_SIZE_MIN}
                  onChange={(event) => {
                    const size = Number(event.target.value);
                    resizeAssetCards(size);
                  }}
                  step="8"
                  type="range"
                  value={assetCardSize}
                />
              </label>
              <span className="tool-separator" />
              {([
                {
                  field: "name" as const,
                  icon: "tag" as const,
                  label: "文件名",
                },
                {
                  field: "size" as const,
                  icon: "info" as const,
                  label: "文件大小",
                },
                {
                  field: "date" as const,
                  icon: "star" as const,
                  label: "修改日期",
                },
              ]).map(({ field, icon, label }) => (
                <ToolButton
                  key={field}
                  icon={icon}
                  label={label}
                  onClick={() =>
                    setCanvasPrefs((p) => {
                      const updatedFields = {
                        ...p.fields,
                        [field]: !p.fields[field],
                      };
                      return { ...p, fields: updatedFields };
                    })
                  }
                  pressed={canvasPrefs.fields[field]}
                />
              ))}
            </div>
            {library &&
              selectedAsset &&
              !showTrash &&
              !selectedAsset.deletedAt && (
                <>
                  <span className="tool-separator" />
                  <button
                    className="compact-action"
                    disabled={aiAnalyzing || !aiHasKey}
                    onClick={() => void handleAnalyzeClick()}
                    type="button"
                  >
                    <Icon name="smart" size={14} />
                    {aiAnalyzing ? "分析中…" : "AI 分析"}
                  </button>
                </>
              )}
            <span className="tool-separator" />
            <button
              className="compact-action"
              onClick={() => void openExtensionPairing()}
              type="button"
            >
              <Icon name="link" size={14} />
              浏览器扩展
            </button>
            {library && (
              <>
                <button
                  className="compact-action"
                  onClick={() => setMediaJobsOpen(true)}
                  type="button"
                >
                  <Icon name="refresh" size={14} />
                  后台任务
                </button>
                <button
                  className="compact-action"
                  onClick={() => {
                    void loadAiConfig();
                    setAiConfigOpen(true);
                  }}
                  type="button"
                >
                  <Icon name="info" size={14} />
                  AI 设置
                </button>
              </>
            )}
          </div>
        </div>
        <div
          className={`workspace-canvas${previewAsset ? " is-viewing" : ""}${externalDropActive ? " is-external-drop" : ""}`}
          onDragEnter={handleExternalDragEnter}
          onDragLeave={handleExternalDragLeave}
          onDragOver={handleExternalDragOver}
          onDrop={handleExternalDrop}
          onScroll={(event) => {
            const target = event.currentTarget;
            if (
              target.scrollHeight - target.scrollTop - target.clientHeight <
              480
            ) {
              void loadMoreAssets();
            }
          }}
          ref={workspaceCanvasRef}
        >
          {externalDropActive && (
            <div className="external-drop-overlay" role="status">
              <Icon name="upload" size={28} />
              <strong>松开以导入</strong>
              <span>
                {activeCollectionId
                  ? "导入本地文件或下载网页媒体，并加入当前合集"
                  : "导入本地文件或下载网页图片/视频"}
              </span>
            </div>
          )}
          {previewAsset && library && api && (
            <AssetPreviewModal
              api={api}
              asset={previewAsset}
              key={previewAsset.assetId}
              libraryId={library.libraryId}
              onClose={() => void closeAssetPreview()}
              onNext={
                previewIndex >= 0 && previewIndex < visibleAssets.length - 1
                  ? () =>
                      navigateAssetPreview(visibleAssets[previewIndex + 1]!)
                  : undefined
              }
              onPrevious={
                previewIndex > 0
                  ? () =>
                      navigateAssetPreview(visibleAssets[previewIndex - 1]!)
                  : undefined
              }
            />
          )}
          {library && selectedAssetIds.length > 0 && !showTrash && (
            <div
              className="batch-action-strip"
              role="region"
              aria-label="批量资产操作"
            >
              <strong>已选择 {selectedAssetIds.length} 项</strong>
              <select
                aria-label="批量标签"
                onChange={(event) => setBatchTagId(event.target.value)}
                value={batchTagId}
              >
                <option value="">选择标签…</option>
                {tags.map((tag) => (
                  <option key={tag.tagId} value={tag.tagId}>
                    {tag.name}
                  </option>
                ))}
              </select>
              <button
                disabled={busy || !batchTagId}
                onClick={() => void updateSelectionTags(false)}
                type="button"
              >
                添加标签
              </button>
              <button
                disabled={busy || !batchTagId}
                onClick={() => void updateSelectionTags(true)}
                type="button"
              >
                移除标签
              </button>
              <select
                aria-label="批量合集"
                onChange={(event) => setBatchCollectionId(event.target.value)}
                value={batchCollectionId}
              >
                <option value="">选择合集…</option>
                {collections.map((collection) => (
                  <option
                    key={collection.collectionId}
                    value={collection.collectionId}
                  >
                    {collection.name}
                  </option>
                ))}
              </select>
              <button
                disabled={busy || !batchCollectionId}
                onClick={() => void updateSelectionCollection(false)}
                type="button"
              >
                加入合集
              </button>
              <button
                disabled={busy || !batchCollectionId}
                onClick={() => void updateSelectionCollection(true)}
                type="button"
              >
                移出合集
              </button>
              <button
                disabled={
                  busy ||
                  !selectedAssets.some(
                    (asset) =>
                      asset.locationKind === "managed" &&
                      asset.availability === "available",
                  )
                }
                onClick={() =>
                  setMoveDialog({
                    assetIds: selectedAssets
                      .filter(
                        (asset) =>
                          asset.locationKind === "managed" &&
                          asset.availability === "available",
                      )
                      .map((asset) => asset.assetId),
                    targetFolderId: null,
                    conflictStrategy: "keep-both",
                  })
                }
                type="button"
              >
                <Icon name="folder" size={13} />
                移动到文件夹
              </button>
              <button
                disabled={
                  busy ||
                  !selectedAssets.some(
                    (asset) => asset.locationKind === "managed",
                  )
                }
                onClick={() =>
                  void trashManagedAssets(
                    selectedAssets
                      .filter((asset) => asset.locationKind === "managed")
                      .map((asset) => asset.assetId),
                  )
                }
                type="button"
              >
                <Icon name="trash" size={13} />
                移入回收站
              </button>
              {linkedFolders.length > 0 && (
                <>
                  <select
                    aria-label="复制到链接文件夹"
                    onChange={(event) =>
                      setCopyLinkedTargetId(event.target.value)
                    }
                    value={copyLinkedTargetId}
                  >
                    <option value="">选择链接文件夹…</option>
                    {linkedFolders
                      .filter((folder) => folder.status === "available")
                      .map((folder) => (
                        <option key={folder.folderId} value={folder.folderId}>
                          {folder.displayName}
                        </option>
                      ))}
                  </select>
                  <button
                    disabled={
                      busy ||
                      !copyLinkedTargetId ||
                      !selectedAssets.some(
                        (asset) =>
                          asset.locationKind === "managed" &&
                          asset.availability === "available",
                      )
                    }
                    onClick={() => {
                      const folder = linkedFolders.find(
                        (item) => item.folderId === copyLinkedTargetId,
                      );
                      if (folder)
                        void copyManagedSelectionToLinked(
                          folder,
                          selectedAssets
                            .filter(
                              (asset) =>
                                asset.locationKind === "managed" &&
                                asset.availability === "available",
                            )
                            .map((asset) => asset.assetId),
                        );
                    }}
                    type="button"
                  >
                    <Icon name="link" size={13} />
                    复制到外部目录
                  </button>
                </>
              )}
              <button
                aria-label="清除选择"
                onClick={clearAssetSelection}
                type="button"
              >
                <Icon name="close" size={13} />
              </button>
            </div>
          )}
          {busy && (
            <div className="activity-strip" role="status">
              <span className="activity-pulse" />
              {uiState === "importing"
                ? "正在安全复制与登记资产…"
                : "正在同步资源库…"}
            </div>
          )}
          {exportProgress &&
            !["complete", "cancelled", "failed"].includes(
              exportProgress.phase,
            ) && (
              <div className="activity-strip" role="status">
                <span className="activity-pulse" />
                正在导出资源库：
                {exportProgress.phase === "snapshot-db"
                  ? "快照数据库…"
                  : exportProgress.phase === "enumerate"
                    ? "枚举文件…"
                    : exportProgress.phase === "compress"
                      ? "压缩中"
                      : `复制中 ${exportProgress.filesProcessed}/${exportProgress.totalFiles} · ${formatBytes(exportProgress.bytesProcessed)}/${formatBytes(exportProgress.totalBytes)}`}
                <button
                  className="secondary-button"
                  disabled={!exportProgress.exportId}
                  onClick={() => void cancelExport()}
                  type="button"
                >
                  取消导出
                </button>
              </div>
            )}
          {importProgress &&
            !["complete", "cancelled", "failed"].includes(
              importProgress.phase,
            ) && (
              <div className="activity-strip" role="status">
                <span className="activity-pulse" />
                导入资源库：
                {importProgress.phase === "validate"
                  ? "验证中…"
                  : importProgress.phase === "copy"
                    ? "复制中…"
                    : "打开中…"}
                <button
                  className="secondary-button"
                  disabled={!importProgress.importId}
                  onClick={() => void cancelImport()}
                  type="button"
                >
                  取消导入
                </button>
              </div>
            )}
          {library ? (
            visibleAssets.length ? (
              <>
                <div
                  className={`asset-grid is-${assetViewMode}`}
                  style={
                    assetViewMode === "masonry"
                      ? { columnWidth: assetCardSize }
                      : {
                          gridTemplateColumns: `repeat(auto-fill, ${assetCardSize}px)`,
                        }
                  }
                >
                  {visibleAssets.map((asset) => (
                    <button
                      aria-label={canvasPrefs.fields.name ? undefined : asset.displayName}
                      aria-pressed={selectedIdSet.has(asset.assetId)}
                      className={`asset-card${selectedIdSet.has(asset.assetId) ? " is-selected" : ""}${asset.availability === "missing" ? " is-missing" : ""}${asset.deletedAt ? " is-trashed" : ""}`}
                      data-asset-id={asset.assetId}
                      title={asset.displayName}
                      draggable={Boolean(
                        activeCollectionId && !collectionRecursive,
                      )}
                      key={asset.assetId}
                      onClick={(event) => selectAsset(event, asset.assetId)}
                      onDoubleClick={() => {
                        openAssetPreview(asset);
                      }}
                      onDragEnd={() => setDraggedMemberId(null)}
                      onDragOver={(event) => {
                        if (draggedMemberId) event.preventDefault();
                      }}
                      onDragStart={(event) => {
                        if (!activeCollectionId || collectionRecursive) return;
                        setDraggedMemberId(asset.assetId);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onDrop={(event) => {
                        if (!draggedMemberId) return;
                        event.preventDefault();
                        void reorderCollectionMember(
                          draggedMemberId,
                          asset.assetId,
                        );
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (!selectedIdSet.has(asset.assetId)) {
                          setSelectedAssetIds([asset.assetId]);
                          setSelectedAssetId(asset.assetId);
                        }
                        if (library && !asset.deletedAt)
                          openContextMenu(
                            {
                              type: "asset",
                              assetId: asset.assetId,
                              displayName: asset.displayName,
                            },
                            { x: e.clientX, y: e.clientY },
                          );
                      }}
                      type="button"
                    >
                      <div
                        className="asset-preview"
                        style={
                          assetViewMode === "masonry" &&
                          asset.width &&
                          asset.height
                            ? {
                                aspectRatio: `${asset.width} / ${asset.height}`,
                              }
                            : undefined
                        }
                        title={thumbnailFailures.get(asset.assetId)}
                      >
                        {asset.thumbnailStatus === "ready" &&
                        asset.thumbnailArtifactId &&
                        library ? (
                          <img
                            alt={asset.displayName}
                            className="asset-thumbnail"
                            loading="lazy"
                            src={`serpent://preview/${library.libraryId}/${asset.thumbnailArtifactId}`}
                          />
                        ) : (
                          <>
                            <span className="asset-extension">
                              {extension(asset.displayName)}
                            </span>
                            <Icon name="file" size={28} />
                          </>
                        )}
                        {thumbnailFailures.has(asset.assetId) && (
                          <span className="missing-banner">
                            <Icon name="warning" size={12} />
                            缩略图失败
                          </span>
                        )}
                        {asset.availability === "missing" && (
                          <span className="missing-banner">
                            <Icon name="warning" size={12} />
                            文件丢失
                          </span>
                        )}
                        {asset.deletedAt && (
                          <span
                            className="missing-banner"
                            style={{
                              background: "var(--raised-2)",
                              color: "var(--secondary)",
                              bottom: 6,
                              right: 6,
                            }}
                          >
                            <Icon name="trash" size={12} />
                            回收站
                            {asset.remainingDays !== null &&
                              ` · ${asset.remainingDays}天`}
                          </span>
                        )}
                      </div>
                      {(canvasPrefs.fields.name ||
                        canvasPrefs.fields.size ||
                        canvasPrefs.fields.date ||
                        searchSnippets.has(asset.assetId) ||
                        (asset.deletedAt && asset.trashedFromPath)) && (
                        <div className="asset-caption">
                          {canvasPrefs.fields.name && (
                            <>
                              <strong title={asset.label ?? asset.displayName}>
                                {asset.label ?? asset.displayName}
                              </strong>
                              {asset.label && (
                                <span title={asset.displayName}>
                                  {asset.displayName}
                                </span>
                              )}
                            </>
                          )}
                          {searchSnippets.has(asset.assetId) ? (
                            <span className="search-snippet">
                              {highlightSnippet(
                                searchSnippets.get(asset.assetId)!,
                              )}
                            </span>
                          ) : asset.deletedAt && asset.trashedFromPath ? (
                            <span
                              style={{
                                color: "var(--tertiary)",
                                fontSize: 8,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                              title={asset.trashedFromPath}
                            >
                              {asset.trashedFromPath}
                            </span>
                          ) : (canvasPrefs.fields.size ||
                              canvasPrefs.fields.date) ? (
                            <span>
                              {canvasPrefs.fields.size &&
                                formatBytes(asset.byteSize)}
                              {canvasPrefs.fields.size &&
                                canvasPrefs.fields.date &&
                                " · "}
                              {canvasPrefs.fields.date &&
                                formatDate(asset.modifiedAt)}
                            </span>
                          ) : null}
                        </div>
                      )}
                    </button>
                  ))}
                  <div
                    className="asset-loading-more"
                    ref={loadMoreSentinelRef}
                    role="status"
                  >
                    {loadingMoreAssets && (
                      <>
                        <span className="activity-pulse" />
                        继续加载资产…
                      </>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-library">
                <div className="empty-orbit">
                  <Icon name="upload" size={24} />
                </div>
                <span className="eyebrow">MANAGED ASSETS</span>
                <h1>
                  {selectedFolder ? "这个文件夹还是空的" : "把第一批素材放进来"}
                </h1>
                <p>
                  文件将复制到清晰可读的 Assets 目录，同时建立稳定的资产身份。
                </p>
                <div className="empty-actions">
                  <button
                    className="primary-button"
                    onClick={() => void importAssets("files")}
                    type="button"
                  >
                    导入文件
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => void importAssets("folder")}
                    type="button"
                  >
                    导入文件夹
                  </button>
                </div>
              </div>
            )
          ) : (
            <div className="empty-state">
              <div className="empty-index">01</div>
              <div className="empty-copy">
                <span className="eyebrow">LOCAL ASSET WORKSPACE</span>
                <h1>从一个本地资源库开始</h1>
                <p>文件、目录与元数据都保留在你掌控的位置。</p>
                <div className="empty-actions">
                  <button
                    className="primary-button"
                    onClick={() => {
                      setDialogValue("我的资源库");
                      setDialog("library");
                    }}
                    type="button"
                  >
                    <Icon name="plus" size={15} />
                    创建资源库
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => void runLibraryOperation("open")}
                    type="button"
                  >
                    <Icon name="folder" size={15} />
                    打开资源库
                  </button>
                </div>
              </div>
            </div>
          )}
          {(error || notice) && (
            <div
              className={`toast${error ? " is-error" : ""}`}
              role={error ? "alert" : "status"}
            >
              <Icon name={error ? "warning" : "info"} size={15} />
              <span>{error ?? notice}</span>
              {!error && lastMoveOperationId && (
                <button
                  className="secondary-button"
                  onClick={() => void undoManagedMove(lastMoveOperationId)}
                  type="button"
                >
                  撤销移动
                </button>
              )}
              <button
                aria-label="关闭提示"
                onClick={() => {
                  setError(null);
                  setNotice(null);
                }}
                type="button"
              >
                <Icon name="close" size={13} />
              </button>
            </div>
          )}
        </div>
      </section>
      <aside className="inspector-pane">
        <div className="pane-header">
          <span>检查器</span>
          <ToolButton icon="info" label="检查器信息" />
        </div>
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
                <dd className="mono">{folders.length}</dd>
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
      {!leftOpen && (
        <button
          className="pane-reveal pane-reveal-left"
          onClick={() => setLeftOpen(true)}
          type="button"
        >
          <Icon name="collapse-left" size={15} />
        </button>
      )}
      {!rightOpen && (
        <button
          className="pane-reveal pane-reveal-right"
          onClick={() => setRightOpen(true)}
          type="button"
        >
          <Icon name="collapse-right" size={15} />
        </button>
      )}
      {linkedRulesEditor && (
        <div className="dialog-backdrop" role="presentation">
          <div
            aria-modal="true"
            className="create-dialog"
            role="dialog"
            style={{ maxWidth: 700 }}
          >
            <div className="dialog-heading">
              <div>
                <span className="eyebrow">LINKED FOLDER FILTER</span>
                <h2>{linkedRulesEditor.name} · 过滤规则</h2>
              </div>
              <button
                aria-label="取消"
                className="dialog-close"
                onClick={() => setLinkedRulesEditor(null)}
                type="button"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <p className="field-help">
              从上到下执行，最后一个匹配项生效；仅支持受约束的路径、文件名、扩展名和文件夹规则。
            </p>
            {linkedRulesEditor.rules.map((rule, index) => (
              <div
                key={rule.ruleId}
                style={{
                  display: "grid",
                  gridTemplateColumns: "22px 82px 82px 1fr 28px",
                  gap: 6,
                  marginTop: 6,
                }}
              >
                <input
                  aria-label={`启用规则 ${index + 1}`}
                  checked={rule.enabled}
                  onChange={(event) =>
                    setLinkedRulesEditor((current) =>
                      current
                        ? {
                            ...current,
                            rules: current.rules.map((item, i) =>
                              i === index
                                ? { ...item, enabled: event.target.checked }
                                : item,
                            ),
                          }
                        : current,
                    )
                  }
                  type="checkbox"
                />
                <select
                  className="text-field"
                  onChange={(event) =>
                    setLinkedRulesEditor((current) =>
                      current
                        ? {
                            ...current,
                            rules: current.rules.map((item, i) =>
                              i === index
                                ? {
                                    ...item,
                                    action: event.target
                                      .value as LinkedFolderRule["action"],
                                  }
                                : item,
                            ),
                          }
                        : current,
                    )
                  }
                  value={rule.action}
                >
                  <option value="exclude">排除</option>
                  <option value="include">包含</option>
                </select>
                <select
                  className="text-field"
                  onChange={(event) =>
                    setLinkedRulesEditor((current) =>
                      current
                        ? {
                            ...current,
                            rules: current.rules.map((item, i) =>
                              i === index
                                ? {
                                    ...item,
                                    target: event.target
                                      .value as LinkedFolderRule["target"],
                                  }
                                : item,
                            ),
                          }
                        : current,
                    )
                  }
                  value={rule.target}
                >
                  <option value="folder">文件夹</option>
                  <option value="filename">文件名</option>
                  <option value="extension">扩展名</option>
                  <option value="path">路径</option>
                </select>
                <input
                  className="text-field"
                  maxLength={512}
                  onChange={(event) =>
                    setLinkedRulesEditor((current) =>
                      current
                        ? {
                            ...current,
                            rules: current.rules.map((item, i) =>
                              i === index
                                ? { ...item, pattern: event.target.value }
                                : item,
                            ),
                          }
                        : current,
                    )
                  }
                  value={rule.pattern}
                />
                <button
                  aria-label={`删除规则 ${index + 1}`}
                  className="dialog-close"
                  onClick={() =>
                    setLinkedRulesEditor((current) =>
                      current
                        ? {
                            ...current,
                            rules: current.rules.filter((_, i) => i !== index),
                          }
                        : current,
                    )
                  }
                  type="button"
                >
                  <Icon name="close" size={13} />
                </button>
              </div>
            ))}
            <div className="dialog-actions">
              <button
                className="secondary-button"
                onClick={() =>
                  setLinkedRulesEditor((current) =>
                    current
                      ? {
                          ...current,
                          rules: [
                            ...current.rules,
                            {
                              ruleId: crypto.randomUUID(),
                              action: "exclude",
                              target: "extension",
                              pattern: "tmp",
                              enabled: true,
                            },
                          ],
                        }
                      : current,
                  )
                }
                type="button"
              >
                添加规则
              </button>
              <button
                className="secondary-button"
                onClick={() => setLinkedRulesEditor(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="primary-button"
                disabled={linkedRulesEditor.rules.some(
                  (rule) => !rule.pattern.trim(),
                )}
                onClick={() => void saveLinkedRules()}
                type="button"
              >
                保存并刷新
              </button>
            </div>
          </div>
        </div>
      )}
      {convertLinkedDialog.folderId && (
        <div className="dialog-backdrop" role="presentation">
          <div aria-modal="true" className="create-dialog" role="dialog">
            <div className="dialog-heading">
              <div>
                <span className="eyebrow">CONVERT LINKED FOLDER</span>
                <h2>转换"{convertLinkedDialog.name}"</h2>
              </div>
              <button
                aria-label="取消转换"
                className="dialog-close"
                onClick={() =>
                  setConvertLinkedDialog({
                    folderId: "",
                    name: "",
                    targetFolderId: "",
                  })
                }
                type="button"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <p className="field-help">
              复制过滤后的内容并保留资产信息；外部源目录不会删除或移动。
            </p>
            <select
              className="text-field"
              onChange={(event) =>
                setConvertLinkedDialog((current) => ({
                  ...current,
                  targetFolderId: event.target.value,
                }))
              }
              value={convertLinkedDialog.targetFolderId}
            >
              <option value="">资源库根目录</option>
              {folders.map((folder) => (
                <option key={folder.folderId} value={folder.folderId}>
                  {folder.relativePath}
                </option>
              ))}
            </select>
            <div className="dialog-actions">
              <button
                className="secondary-button"
                onClick={() =>
                  setConvertLinkedDialog({
                    folderId: "",
                    name: "",
                    targetFolderId: "",
                  })
                }
                type="button"
              >
                取消
              </button>
              <button
                className="primary-button"
                onClick={() => void convertLinkedToManaged()}
                type="button"
              >
                确认复制并转换
              </button>
            </div>
          </div>
        </div>
      )}
      {restoreDialog && (
        <div className="dialog-backdrop" role="presentation">
          <div
            aria-labelledby="restore-dialog-title"
            aria-modal="true"
            className="create-dialog"
            role="dialog"
          >
            <div className="dialog-heading">
              <div>
                <span className="eyebrow">RESTORE ASSETS</span>
                <h2 id="restore-dialog-title">
                  恢复 {restoreDialog.assetIds.length} 项资产
                </h2>
              </div>
              <button
                aria-label="取消"
                className="dialog-close"
                onClick={() => setRestoreDialog(null)}
                type="button"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <label className="field-label" htmlFor="restore-target">
              恢复位置
            </label>
            <select
              className="text-field"
              id="restore-target"
              onChange={(event) =>
                setRestoreDialog((current) =>
                  current
                    ? {
                        ...current,
                        target: event.target.value as typeof current.target,
                      }
                    : current,
                )
              }
              value={restoreDialog.target}
            >
              <option value="original">
                原位置（原文件夹不存在时使用根目录）
              </option>
              <option value="root">资源库根目录</option>
              {folders.map((folder) => (
                <option key={folder.folderId} value={folder.folderId}>
                  {folder.relativePath}
                </option>
              ))}
            </select>
            <label
              className="field-label"
              htmlFor="restore-conflict"
              style={{ marginTop: 12 }}
            >
              同名冲突
            </label>
            <select
              className="text-field"
              id="restore-conflict"
              onChange={(event) =>
                setRestoreDialog((current) =>
                  current
                    ? {
                        ...current,
                        conflictStrategy: event.target
                          .value as typeof current.conflictStrategy,
                      }
                    : current,
                )
              }
              value={restoreDialog.conflictStrategy}
            >
              <option value="keep-both">保留两者（自动编号）</option>
              <option value="replace">用回收站资产替换现有资产</option>
              <option value="skip">跳过冲突资产</option>
            </select>
            {restoreDialog.conflictStrategy === "replace" && (
              <p className="field-help">
                替换会删除冲突资产的 Serpent
                记录及其托管文件，恢复资产会保留原有 ID 和元数据。
              </p>
            )}
            <div className="dialog-actions">
              <button
                className="secondary-button"
                onClick={() => setRestoreDialog(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="primary-button"
                onClick={() => void restoreTrashedAssets()}
                type="button"
              >
                确认恢复
              </button>
            </div>
          </div>
        </div>
      )}
      {moveDialog && (
        <div className="dialog-backdrop" role="presentation">
          <div
            aria-labelledby="move-dialog-title"
            aria-modal="true"
            className="create-dialog"
            role="dialog"
          >
            <div className="dialog-heading">
              <div>
                <span className="eyebrow">MOVE MANAGED ASSETS</span>
                <h2 id="move-dialog-title">
                  移动 {moveDialog.assetIds.length} 项托管资产
                </h2>
              </div>
              <button
                aria-label="取消移动"
                className="dialog-close"
                onClick={() => setMoveDialog(null)}
                type="button"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <label className="field-label" htmlFor="move-target">
              目标文件夹
            </label>
            <select
              className="text-field"
              id="move-target"
              onChange={(event) =>
                setMoveDialog((current) =>
                  current
                    ? { ...current, targetFolderId: event.target.value || null }
                    : current,
                )
              }
              value={moveDialog.targetFolderId ?? ""}
            >
              <option value="">资源库根目录</option>
              {folders.map((folder) => (
                <option key={folder.folderId} value={folder.folderId}>
                  {folder.relativePath}
                </option>
              ))}
            </select>
            <label
              className="field-label"
              htmlFor="move-conflict"
              style={{ marginTop: 12 }}
            >
              同名冲突
            </label>
            <select
              className="text-field"
              id="move-conflict"
              onChange={(event) =>
                setMoveDialog((current) =>
                  current
                    ? {
                        ...current,
                        conflictStrategy: event.target
                          .value as typeof current.conflictStrategy,
                      }
                    : current,
                )
              }
              value={moveDialog.conflictStrategy}
            >
              <option value="keep-both">保留两者（自动编号）</option>
              <option value="replace">替换目标资产</option>
              <option value="skip">跳过冲突资产</option>
            </select>
            <p className="field-help">
              移动不会改变资产 ID、标签、合集、人工元数据、AI
              内容或源链接；完成后可撤销一次。
            </p>
            <div className="dialog-actions">
              <button
                className="secondary-button"
                onClick={() => setMoveDialog(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="primary-button"
                onClick={() => void moveManagedAssets()}
                type="button"
              >
                确认移动
              </button>
            </div>
          </div>
        </div>
      )}
      {undoMoveDialog && (
        <div className="dialog-backdrop" role="presentation">
          <div
            aria-labelledby="undo-move-dialog-title"
            aria-modal="true"
            className="create-dialog"
            role="dialog"
          >
            <div className="dialog-heading">
              <div>
                <span className="eyebrow">UNDO MOVE CONFLICT</span>
                <h2 id="undo-move-dialog-title">原位置已有新内容</h2>
              </div>
              <button
                aria-label="取消撤销"
                className="dialog-close"
                onClick={() => setUndoMoveDialog(null)}
                type="button"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <p className="field-help">
              Serpent 没有覆盖原位置。请选择明确的冲突处理方式后再撤销。
            </p>
            <label className="field-label" htmlFor="undo-move-conflict">
              冲突处理
            </label>
            <select
              className="text-field"
              id="undo-move-conflict"
              onChange={(event) =>
                setUndoMoveDialog((current) =>
                  current
                    ? {
                        ...current,
                        conflictStrategy: event.target
                          .value as typeof current.conflictStrategy,
                      }
                    : current,
                )
              }
              value={undoMoveDialog.conflictStrategy}
            >
              <option value="keep-both">保留两者（撤回资产自动编号）</option>
              <option value="replace">替换原位置的新内容</option>
              <option value="skip">跳过冲突资产</option>
            </select>
            <div className="dialog-actions">
              <button
                className="secondary-button"
                onClick={() => setUndoMoveDialog(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="primary-button"
                onClick={() =>
                  void undoManagedMove(
                    undoMoveDialog.operationId,
                    undoMoveDialog.conflictStrategy,
                  )
                }
                type="button"
              >
                按所选策略撤销
              </button>
            </div>
          </div>
        </div>
      )}
      {collectionEditor && (
        <div className="dialog-backdrop" role="presentation">
          <div
            aria-labelledby="collection-editor-title"
            aria-modal="true"
            className="create-dialog"
            role="dialog"
          >
            <div className="dialog-heading">
              <div>
                <span className="eyebrow">COLLECTION DETAILS</span>
                <h2 id="collection-editor-title">编辑合集详情</h2>
              </div>
              <button
                aria-label="取消"
                className="dialog-close"
                onClick={() => setCollectionEditor(null)}
                type="button"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <label className="field-label" htmlFor="collection-description">
              描述
            </label>
            <textarea
              className="text-field"
              id="collection-description"
              maxLength={10000}
              onChange={(event) =>
                setCollectionEditor((current) =>
                  current
                    ? { ...current, description: event.target.value }
                    : current,
                )
              }
              rows={4}
              value={collectionEditor.description}
            />
            <label
              className="field-label"
              htmlFor="collection-cover"
              style={{ marginTop: 12 }}
            >
              封面资产
            </label>
            <select
              className="text-field"
              id="collection-cover"
              onChange={(event) =>
                setCollectionEditor((current) =>
                  current
                    ? { ...current, coverAssetId: event.target.value }
                    : current,
                )
              }
              value={collectionEditor.coverAssetId}
            >
              <option value="">无封面</option>
              {collectionEditor.coverAssetId &&
                !visibleAssets.some(
                  (asset) => asset.assetId === collectionEditor.coverAssetId,
                ) && (
                  <option value={collectionEditor.coverAssetId}>
                    当前封面（不在本页）
                  </option>
                )}
              {visibleAssets.map((asset) => (
                <option key={asset.assetId} value={asset.assetId}>
                  {asset.label ?? asset.displayName}
                </option>
              ))}
            </select>
            <p className="field-help">
              可从当前页面资产中选择封面；合集树支持同级拖拽排序。
            </p>
            <div className="dialog-actions">
              <button
                className="secondary-button"
                onClick={() => setCollectionEditor(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="primary-button"
                onClick={() => void saveCollectionDetails()}
                type="button"
              >
                保存详情
              </button>
            </div>
          </div>
        </div>
      )}
      {renameTarget && (
        <div className="dialog-backdrop" role="presentation">
          <form
            aria-labelledby="rename-organization-title"
            aria-modal="true"
            className="create-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              if (renameTarget.kind === "tag") void renameTag();
              else if (renameTarget.kind === "collection")
                void renameCollection();
              else {
                const target = renameTarget;
                setRenameTarget(null);
                void renameSmartCollection(target.id, target.name);
              }
            }}
            role="dialog"
          >
            <div className="dialog-heading">
              <div>
                <span className="eyebrow">ORGANIZE LIBRARY</span>
                <h2 id="rename-organization-title">
                  重命名{organizationNoun(renameTarget.kind)}
                </h2>
              </div>
              <button
                aria-label="取消"
                className="dialog-close"
                onClick={() => setRenameTarget(null)}
                type="button"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <label className="field-label" htmlFor="rename-organization-name">
              {organizationNoun(renameTarget.kind)}名称
            </label>
            <input
              autoFocus
              className="text-field"
              id="rename-organization-name"
              onChange={(event) =>
                setRenameTarget((current) =>
                  current ? { ...current, name: event.target.value } : current,
                )
              }
              value={renameTarget.name}
            />
            <p className="field-help">
              名称仅影响资源库中的组织方式，不会修改资产文件。
            </p>
            <div className="dialog-actions">
              <button
                className="secondary-button"
                onClick={() => setRenameTarget(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="primary-button"
                disabled={!renameTarget.name.trim()}
                type="submit"
              >
                保存名称
              </button>
            </div>
          </form>
        </div>
      )}
      {dialog && (
        <div className="dialog-backdrop" role="presentation">
          <form
            aria-labelledby="create-dialog-title"
            aria-modal="true"
            className="create-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              if (!dialogValue.trim()) return;
              if (dialog === "library") {
                setDialog(null);
                void runLibraryOperation("create");
              } else void createFolder();
            }}
            role="dialog"
          >
            <div className="dialog-heading">
              <div>
                <span className="eyebrow">
                  {dialog === "library"
                    ? "NEW LOCAL LIBRARY"
                    : "MANAGED FOLDER"}
                </span>
                <h2 id="create-dialog-title">
                  {dialog === "library" ? "创建资源库" : "新建文件夹"}
                </h2>
              </div>
              <button
                aria-label="取消"
                className="dialog-close"
                onClick={() => setDialog(null)}
                type="button"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <label className="field-label" htmlFor="dialog-name">
              名称
            </label>
            <input
              autoFocus
              className="text-field"
              id="dialog-name"
              maxLength={255}
              onChange={(event) => setDialogValue(event.target.value)}
              value={dialogValue}
            />
            <p className="field-help">
              {dialog === "library"
                ? "下一步由系统选择本地保存位置。"
                : `将在"${selectedFolder?.name ?? "资源库根目录"}"内创建真实目录。`}
            </p>
            <div className="dialog-actions">
              <button
                className="secondary-button"
                onClick={() => setDialog(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="primary-button"
                disabled={!dialogValue.trim()}
                type="submit"
              >
                创建
              </button>
            </div>
          </form>
        </div>
      )}
      {conflicts && (
        <div className="dialog-backdrop" role="presentation">
          <div
            aria-labelledby="conflict-dialog-title"
            aria-modal="true"
            className="conflict-dialog"
            role="dialog"
          >
            <div className="dialog-heading">
              <div>
                <span className="eyebrow">IMPORT REVIEW</span>
                <h2 id="conflict-dialog-title">处理导入冲突</h2>
              </div>
            </div>
            <div className="conflict-summary">
              <div>
                <strong>{conflicts.fileCount}</strong>
                <span>待导入文件</span>
              </div>
              <div>
                <strong>{conflicts.suspectedDuplicateCount}</strong>
                <span>疑似重复</span>
              </div>
              <div>
                <strong>{conflicts.nameConflictCount}</strong>
                <span>同名冲突</span>
              </div>
            </div>
            <label className="decision-field">
              <span>疑似重复</span>
              <select
                autoFocus
                value={duplicateDecision}
                onChange={(event) =>
                  setDuplicateDecision(
                    event.target.value as typeof duplicateDecision,
                  )
                }
              >
                <option value="skip">跳过</option>
                <option value="merge">合并到已有资产</option>
                <option value="create-copy">创建副本</option>
              </select>
            </label>
            <label className="decision-field">
              <span>同名冲突</span>
              <select
                value={nameDecision}
                onChange={(event) =>
                  setNameDecision(event.target.value as typeof nameDecision)
                }
              >
                <option value="keep-both">保留两者</option>
                <option value="replace">替换现有资产</option>
                <option value="skip">跳过</option>
              </select>
            </label>
            {conflicts.examples.length > 0 && (
              <div className="conflict-examples">
                {conflicts.examples.map((item, index) => (
                  <span key={`${item.displayName}-${index}`}>
                    <Icon name="file" size={13} />
                    {item.displayName}
                  </span>
                ))}
              </div>
            )}
            <div className="dialog-actions">
              <button
                className="secondary-button"
                onClick={() => void abandonConflicts()}
                type="button"
              >
                取消
              </button>
              <button
                className="primary-button"
                onClick={() => void resolveConflicts()}
                type="button"
              >
                应用并导入
              </button>
            </div>
          </div>
        </div>
      )}
      {exportDialogOpen && (
        <div className="dialog-backdrop" role="presentation">
          <div aria-modal="true" className="create-dialog" role="dialog">
            <div className="dialog-heading">
              <div>
                <span className="eyebrow">EXPORT LIBRARY</span>
                <h2>导出资源库</h2>
              </div>
              <button
                aria-label="取消"
                className="dialog-close"
                onClick={() => setExportDialogOpen(false)}
                type="button"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <p
              style={{
                color: "var(--secondary)",
                fontSize: 12,
                lineHeight: 1.6,
              }}
            >
              将资源库导出为完整文件夹或标准
              ZIP。导出内容包括所有托管资产、数据库、修订记录和回收站文件。
            </p>
            <fieldset
              style={{
                border: "none",
                padding: 0,
                marginTop: 14,
                display: "flex",
                gap: 16,
              }}
            >
              <legend
                style={{ fontSize: 11, color: "#6c6f6c", marginBottom: 6 }}
              >
                导出格式
              </legend>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  color: "#c7cac7",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                <input
                  checked={exportFormat === "folder"}
                  onChange={() => setExportFormat("folder")}
                  type="radio"
                  name="export-format"
                />
                文件夹
              </label>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  color: "#c7cac7",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                <input
                  checked={exportFormat === "zip"}
                  onChange={() => setExportFormat("zip")}
                  type="radio"
                  name="export-format"
                />
                标准 ZIP
                {exportFormat === "zip" && (
                  <span style={{ fontSize: 10, color: "#6c6f6c" }}>
                    （4&nbsp;GiB / 65534 条目以内）
                  </span>
                )}
              </label>
            </fieldset>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 10,
                color: "#c7cac7",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              <input
                checked={includeLinkedContent}
                onChange={(e) => setIncludeLinkedContent(e.target.checked)}
                type="checkbox"
              />
              包含链接文件夹源内容
            </label>
            <div className="dialog-actions">
              <button
                className="secondary-button"
                onClick={() => setExportDialogOpen(false)}
                type="button"
              >
                取消
              </button>
              <button
                className="primary-button"
                onClick={() => void exportLibrary()}
                type="button"
              >
                {exportFormat === "zip"
                  ? "选择保存位置并导出 ZIP"
                  : "选择目标文件夹并导出"}
              </button>
            </div>
          </div>
        </div>
      )}
      {importValidated && (
        <div className="dialog-backdrop" role="presentation">
          <div aria-modal="true" className="create-dialog" role="dialog">
            <div className="dialog-heading">
              <div>
                <span className="eyebrow">IMPORT LIBRARY</span>
                <h2>导入资源库</h2>
              </div>
              <button
                aria-label="取消"
                className="dialog-close"
                onClick={() => setImportValidated(null)}
                type="button"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <p
              style={{
                color: "var(--secondary)",
                fontSize: 12,
                lineHeight: 1.6,
              }}
            >
              资源库 <strong>{importValidated.displayName}</strong>{" "}
              验证通过。请选择导入方式：
            </p>
            <div className="dialog-actions">
              <button
                className="secondary-button"
                onClick={() => setImportValidated(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="secondary-button"
                onClick={() => void completeImportInPlace()}
                type="button"
              >
                原地打开（不复制）
              </button>
              <button
                className="primary-button"
                onClick={() => void completeImportCopy()}
                type="button"
              >
                复制到新位置
              </button>
            </div>
          </div>
        </div>
      )}
      {permanentDeleteDialog && (
        <div className="dialog-backdrop" role="presentation">
          <div aria-modal="true" className="create-dialog" role="dialog">
            <div className="dialog-heading">
              <div>
                <span className="eyebrow">PERMANENT DELETE</span>
                <h2>永久删除确认</h2>
              </div>
              <button
                aria-label="取消"
                className="dialog-close"
                onClick={() => setPermanentDeleteDialog(null)}
                type="button"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <p
              style={{
                color: "var(--secondary)",
                fontSize: 12,
                lineHeight: 1.6,
              }}
            >
              确定要永久删除所选 {permanentDeleteDialog.length} 项资产吗？文件将从回收站彻底移除，此操作不可撤销。
            </p>
            <div className="dialog-actions">
              <button
                className="secondary-button"
                onClick={() => setPermanentDeleteDialog(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="primary-button"
                onClick={() => void deletePermanentFromTrash()}
                type="button"
              >
                永久删除 {permanentDeleteDialog.length} 项
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteLinkedDialog && (
        <div className="dialog-backdrop" role="presentation">
          <div aria-modal="true" className="create-dialog" role="dialog">
            <div className="dialog-heading">
              <div>
                <span className="eyebrow">DELETE LINKED ASSET</span>
                <h2>删除链接资产</h2>
              </div>
              <button
                aria-label="取消"
                className="dialog-close"
                onClick={() => setDeleteLinkedDialog(null)}
                type="button"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <p
              style={{
                color: "var(--secondary)",
                fontSize: 12,
                lineHeight: 1.6,
              }}
            >
              确定要从 Serpent 中移除链接资产"{deleteLinkedDialog.displayNames}
              "吗？默认只移除索引记录，磁盘源文件保持不变。
            </p>
            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                marginTop: 12,
                color: "#c7cac7",
                fontSize: 12,
                cursor: deleteLinkedDialog.canDeleteSourceFile
                  ? "pointer"
                  : "not-allowed",
                lineHeight: 1.5,
              }}
            >
              <input
                aria-label="同时删除磁盘源文件"
                checked={deleteLinkedDialog.deleteSourceFile}
                disabled={!deleteLinkedDialog.canDeleteSourceFile}
                onChange={(event) =>
                  setDeleteLinkedDialog((current) =>
                    current
                      ? { ...current, deleteSourceFile: event.target.checked }
                      : current,
                  )
                }
                type="checkbox"
              />
              <span>
                {deleteLinkedDialog.canDeleteSourceFile
                  ? "同时将磁盘源文件移入系统回收站。系统拒绝操作时，该项源文件和 Serpent 记录都会保留，并显示具体原因。"
                  : "源文件当前不可用，只能移除 Serpent 中的链接记录。"}
              </span>
            </label>
            <div className="dialog-actions">
              <button
                className="secondary-button"
                onClick={() => setDeleteLinkedDialog(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="primary-button"
                onClick={() => void executeDeleteLinked()}
                type="button"
              >
                {deleteLinkedDialog.deleteSourceFile
                  ? "移入系统回收站并移除"
                  : "仅移除记录"}
              </button>
            </div>
          </div>
        </div>
      )}
      {batchRelinkPreview && (
        <div className="dialog-backdrop" role="presentation">
          <div
            aria-labelledby="batch-relink-dialog-title"
            aria-modal="true"
            className="conflict-dialog"
            role="dialog"
          >
            <div className="dialog-heading">
              <div>
                <span className="eyebrow">BATCH RELINK</span>
                <h2 id="batch-relink-dialog-title">批量重新定位预览</h2>
              </div>
              <button
                aria-label="取消"
                className="dialog-close"
                onClick={() => void cancelBatchRelink()}
                type="button"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <div
              className="conflict-summary"
              style={{ gridTemplateColumns: "repeat(3, 1fr)" }}
            >
              <div>
                <strong>{batchRelinkPreview.totalCount}</strong>
                <span>总计丢失</span>
              </div>
              <div>
                <strong>{batchRelinkPreview.matchedCount}</strong>
                <span>新位置匹配</span>
              </div>
              <div>
                <strong>{batchRelinkPreview.unmatchedCount}</strong>
                <span>未找到</span>
              </div>
            </div>
            {batchRelinkPreview.examples.length > 0 && (
              <div className="conflict-examples">
                {batchRelinkPreview.examples.map((item, index) => (
                  <span
                    key={`${item.relativeFilePath}-${index}`}
                    style={{
                      color: item.matched ? "var(--accent)" : "var(--warning)",
                    }}
                  >
                    <Icon name={item.matched ? "file" : "warning"} size={13} />
                    {item.relativeFilePath}
                  </span>
                ))}
              </div>
            )}
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 14,
                color: "#c7cac7",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              <input
                checked={batchRelinkKeepMetadata}
                onChange={(e) => setBatchRelinkKeepMetadata(e.target.checked)}
                type="checkbox"
              />
              沿用原资产信息（保留标签、描述、评分、合集等人工元数据）
            </label>
            <div className="dialog-actions">
              <button
                className="secondary-button"
                onClick={() => void cancelBatchRelink()}
                type="button"
              >
                取消
              </button>
              <button
                className="primary-button"
                disabled={batchRelinkPreview.matchedCount === 0}
                onClick={() => void applyBatchRelink()}
                type="button"
              >
                应用批量重新定位
              </button>
            </div>
          </div>
        </div>
      )}
      {extensionPairingOpen && (
        <div className="dialog-backdrop" role="presentation">
          <div
            aria-labelledby="extension-pairing-title"
            aria-modal="true"
            className="create-dialog"
            role="dialog"
          >
            <div className="dialog-heading">
              <div>
                <span className="eyebrow">BROWSER EXTENSION PAIRING</span>
                <h2 id="extension-pairing-title">浏览器扩展配对</h2>
              </div>
              <button
                aria-label="关闭浏览器扩展配对"
                className="dialog-close"
                onClick={() => {
                  setExtensionPairingOpen(false);
                  setExtensionPairingToken("");
                  setExtensionPairingError(null);
                }}
                type="button"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <p
              style={{
                color: "var(--secondary)",
                fontSize: 12,
                lineHeight: 1.6,
              }}
            >
              将配对码粘贴到 Chrome 或 Edge 的 Serpent
              扩展选项中。配对码由操作系统安全存储加密保存；此窗口关闭后不会在界面中保留明文。
            </p>
            {extensionPairingError ? (
              <p role="alert" style={{ color: "var(--warning)", fontSize: 12 }}>
                {extensionPairingError}
              </p>
            ) : (
              <>
                <label
                  className="field-label"
                  htmlFor="extension-pairing-token"
                >
                  配对码
                </label>
                <input
                  className="text-field"
                  id="extension-pairing-token"
                  onFocus={(event) => event.currentTarget.select()}
                  readOnly
                  spellCheck={false}
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11,
                  }}
                  value={extensionPairingToken || "正在读取…"}
                />
                <p className="field-help">
                  轮换会使所有浏览器中保存的旧配对码立即失效。
                </p>
              </>
            )}
            <div className="dialog-actions">
              <button
                className="secondary-button"
                disabled={!extensionPairingToken}
                onClick={() => void rotateExtensionPairing()}
                type="button"
              >
                轮换配对码
              </button>
              <button
                className="primary-button"
                disabled={!extensionPairingToken}
                onClick={() => void copyExtensionPairingToken()}
                type="button"
              >
                复制配对码
              </button>
            </div>
          </div>
        </div>
      )}
      {aiConfigOpen && (
        <div className="dialog-backdrop" role="presentation">
          <div aria-modal="true" className="create-dialog" role="dialog">
            <div className="dialog-heading">
              <div>
                <span className="eyebrow">AI CONFIGURATION</span>
                <h2>AI 配置 (BYOK)</h2>
              </div>
              <button
                aria-label="取消"
                className="dialog-close"
                onClick={() => {
                  setAiConfigOpen(false);
                  setAiApiKey("");
                }}
                type="button"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <p
              style={{
                color: "var(--secondary)",
                fontSize: 12,
                lineHeight: 1.6,
              }}
            >
              配置第三方云端视觉模型 API Key。Key
              将加密存储于本地操作系统安全凭据中，Serpent
              不代理、不计费、不追踪额度。
            </p>
            <div className="editor-field" style={{ marginTop: 12 }}>
              <label className="micro-label">供应商</label>
              <select
                className="text-field"
                onChange={(e) =>
                  setAiProvider(
                    e.target.value as "openai" | "gemini" | "anthropic",
                  )
                }
                style={{ height: 30, fontSize: 12, marginTop: 3 }}
                value={aiProvider}
              >
                <option value="openai">OpenAI (GPT-4o / GPT-4o-mini)</option>
                <option value="gemini">Google Gemini</option>
                <option value="anthropic">Anthropic Claude</option>
              </select>
            </div>
            <div className="editor-field" style={{ marginTop: 10 }}>
              <label className="micro-label">模型</label>
              <input
                className="text-field"
                maxLength={255}
                onChange={(e) => setAiModel(e.target.value)}
                placeholder="gpt-4o-mini"
                style={{ height: 28, fontSize: 11, marginTop: 3 }}
                value={aiModel}
              />
            </div>
            <div className="editor-field" style={{ marginTop: 10 }}>
              <label className="micro-label">API Key</label>
              <input
                className="text-field"
                maxLength={512}
                onChange={(e) => setAiApiKey(e.target.value)}
                placeholder={aiHasKey ? "（已配置，重新输入可覆盖）" : "sk-…"}
                style={{ height: 28, fontSize: 11, marginTop: 3 }}
                type="password"
                value={aiApiKey}
              />
            </div>
            <div className="editor-field" style={{ marginTop: 10 }}>
              <label className="micro-label">语言</label>
              <input
                className="text-field"
                maxLength={35}
                onChange={(e) => setAiLanguage(e.target.value)}
                placeholder="auto (跟随系统)"
                style={{ height: 28, fontSize: 11, marginTop: 3 }}
                value={aiLanguage}
              />
            </div>
            <div style={{ marginTop: 14 }}>
              <label
                className="micro-label"
                style={{ marginBottom: 5, display: "block" }}
              >
                AI 写入开关（按字段）
              </label>
              {(
                [
                  {
                    key: "label",
                    label: "标签 (Label)",
                    state: aiLabelEnabled,
                    setter: setAiLabelEnabled,
                  },
                  {
                    key: "description",
                    label: "描述",
                    state: aiDescriptionEnabled,
                    setter: setAiDescriptionEnabled,
                  },
                  {
                    key: "tags",
                    label: "标签 (Tags)",
                    state: aiTagsEnabled,
                    setter: setAiTagsEnabled,
                  },
                  {
                    key: "structured",
                    label: "结构化元信息",
                    state: aiStructuredEnabled,
                    setter: setAiStructuredEnabled,
                  },
                ] as const
              ).map((field) => (
                <label
                  key={field.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "3px 0",
                    color: "#c7cac7",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  <input
                    checked={field.state}
                    onChange={(e) => field.setter(e.target.checked)}
                    type="checkbox"
                  />
                  {field.label}
                </label>
              ))}
            </div>
            <div
              style={{
                marginTop: 14,
                borderTop: "1px solid var(--border)",
                paddingTop: 12,
              }}
            >
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  color: "#c7cac7",
                  fontSize: 12,
                  cursor: "pointer",
                  lineHeight: 1.5,
                }}
              >
                <input
                  checked={aiDisclaimerAccepted}
                  onChange={(e) => {
                    setAiDisclaimerAccepted(e.target.checked);
                    if (!e.target.checked) setAiAutoAnalyzeEnabled(false);
                  }}
                  type="checkbox"
                />
                <span>
                  我了解启用 AI
                  分析会将选中资产的图像或视频联系表上传给所选第三方供应商，并可能产生费用。
                </span>
              </label>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 9,
                  color: aiDisclaimerAccepted ? "#c7cac7" : "var(--tertiary)",
                  fontSize: 12,
                  cursor: aiDisclaimerAccepted ? "pointer" : "not-allowed",
                }}
              >
                <input
                  checked={aiAutoAnalyzeEnabled}
                  disabled={!aiDisclaimerAccepted}
                  onChange={(e) => setAiAutoAnalyzeEnabled(e.target.checked)}
                  type="checkbox"
                />
                导入后自动上传并分析支持的资产
              </label>
            </div>
            <div className="dialog-actions" style={{ marginTop: 14 }}>
              <button
                className="secondary-button"
                onClick={() => {
                  setAiConfigOpen(false);
                  setAiApiKey("");
                }}
                type="button"
              >
                取消
              </button>
              <button
                className="primary-button"
                disabled={!aiApiKey.trim() && !aiHasKey}
                onClick={() => void saveAiConfig()}
                type="button"
              >
                保存配置
              </button>
            </div>
          </div>
        </div>
      )}
      {mediaJobsOpen && library && (
        <div className="dialog-backdrop" role="presentation">
          <div
            aria-labelledby="media-jobs-title"
            aria-modal="true"
            className="create-dialog"
            role="dialog"
            style={{ maxWidth: 680 }}
          >
            <div className="dialog-heading">
              <div>
                <span className="eyebrow">BACKGROUND MEDIA JOBS</span>
                <h2 id="media-jobs-title">后台媒体任务</h2>
              </div>
              <button
                aria-label="关闭后台任务"
                className="dialog-close"
                onClick={() => setMediaJobsOpen(false)}
                type="button"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            {mediaJobsLoading && !mediaJobs ? (
              <p className="field-help">正在读取任务状态…</p>
            ) : mediaJobs ? (
              <>
                <p className="field-help">
                  排队 {mediaJobs.queued} · 运行 {mediaJobs.running} · 暂停{" "}
                  {mediaJobs.paused} · 失败 {mediaJobs.failed} · 已完成{" "}
                  {mediaJobs.succeeded}
                </p>
                <div
                  className="dialog-actions"
                  style={{ justifyContent: "flex-start", marginBottom: 12 }}
                >
                  <button
                    className="secondary-button"
                    disabled={mediaJobs.queued + mediaJobs.running === 0}
                    onClick={() => void controlMediaJobs("pause")}
                    type="button"
                  >
                    全部暂停
                  </button>
                  <button
                    className="secondary-button"
                    disabled={mediaJobs.paused === 0}
                    onClick={() => void controlMediaJobs("resume")}
                    type="button"
                  >
                    继续暂停项
                  </button>
                  <button
                    className="secondary-button"
                    disabled={
                      mediaJobs.queued +
                        mediaJobs.running +
                        mediaJobs.paused ===
                      0
                    }
                    onClick={() => void controlMediaJobs("cancel")}
                    type="button"
                  >
                    取消未完成项
                  </button>
                  <button
                    className="secondary-button"
                    disabled={mediaJobs.failed === 0}
                    onClick={() =>
                      void controlMediaJobs(
                        "retry",
                        mediaJobs.jobs
                          .filter((job) => job.status === "failed")
                          .map((job) => job.jobId),
                      )
                    }
                    type="button"
                  >
                    重试失败项
                  </button>
                </div>
                <div
                  style={{
                    maxHeight: 330,
                    overflow: "auto",
                    borderTop: "1px solid var(--border)",
                  }}
                >
                  {mediaJobs.jobs.length ? (
                    mediaJobs.jobs.map((job) => (
                      <div
                        key={job.jobId}
                        style={{
                          borderBottom: "1px solid var(--border)",
                          display: "grid",
                          gap: 8,
                          gridTemplateColumns:
                            "minmax(140px, 1fr) 90px minmax(180px, 2fr)",
                          padding: "9px 2px",
                          fontSize: 11,
                        }}
                      >
                        <span>
                          {job.kind
                            .replace("generate_", "")
                            .replaceAll("_", " ")}
                        </span>
                        <strong>{job.status}</strong>
                        <span title={job.errorCode ?? undefined}>
                          {job.errorDetail ??
                            job.errorCode ??
                            `${Math.round(job.progress * 100)}%`}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="field-help">当前没有媒体任务。</p>
                  )}
                </div>
                {aiJobs && (
                  <section
                    style={{
                      borderTop: "1px solid var(--border)",
                      marginTop: 16,
                      paddingTop: 12,
                    }}
                  >
                    <h3 style={{ fontSize: 13, margin: "0 0 5px" }}>
                      AI 分析任务
                    </h3>
                    <p className="field-help">
                      排队 {aiJobs.queued} · 运行 {aiJobs.running} · 暂停{" "}
                      {aiJobs.paused} · 失败 {aiJobs.failed} · 已完成{" "}
                      {aiJobs.succeeded}
                    </p>
                    <div
                      className="dialog-actions"
                      style={{ justifyContent: "flex-start", marginBottom: 10 }}
                    >
                      <button
                        className="secondary-button"
                        disabled={aiJobs.queued + aiJobs.running === 0}
                        onClick={() => void controlAiJobs("pause")}
                        type="button"
                      >
                        暂停 AI
                      </button>
                      <button
                        className="secondary-button"
                        disabled={aiJobs.paused === 0}
                        onClick={() => void controlAiJobs("resume")}
                        type="button"
                      >
                        继续 AI
                      </button>
                      <button
                        className="secondary-button"
                        disabled={
                          aiJobs.queued + aiJobs.running + aiJobs.paused === 0
                        }
                        onClick={() => void controlAiJobs("cancel")}
                        type="button"
                      >
                        取消 AI
                      </button>
                      <button
                        className="secondary-button"
                        disabled={aiJobs.failed === 0}
                        onClick={() =>
                          void controlAiJobs(
                            "retry",
                            aiJobs.jobs
                              .filter((job) => job.status === "failed")
                              .map((job) => job.jobId),
                          )
                        }
                        type="button"
                      >
                        重试 AI 失败项
                      </button>
                    </div>
                    <div style={{ maxHeight: 180, overflow: "auto" }}>
                      {aiJobs.jobs.map((job) => (
                        <div
                          key={job.jobId}
                          style={{
                            display: "grid",
                            gap: 8,
                            gridTemplateColumns:
                              "minmax(150px, 1fr) 90px minmax(180px, 2fr)",
                            padding: "7px 2px",
                            fontSize: 11,
                          }}
                        >
                          <span>{job.kind}</span>
                          <strong>{job.status}</strong>
                          <span title={job.errorCode ?? undefined}>
                            {job.errorDetail ?? job.errorCode ?? "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            ) : (
              <p className="field-help">暂时无法读取任务状态，请关闭后重试。</p>
            )}
          </div>
        </div>
      )}
      {/* Unified context menu */}
      {activeContextMenu && (
        <ContextMenuBackdrop>
          <ContextMenu
            ariaLabel={
              activeContextMenu.descriptor.type === "asset"
                ? `资产操作：${activeContextMenu.descriptor.displayName}`
                : activeContextMenu.descriptor.type === "organization"
                  ? `${activeContextMenu.descriptor.orgKind === "tag" ? "标签" : "合集"}操作：${activeContextMenu.descriptor.name}`
                  : `智能合集操作：${activeContextMenu.descriptor.name}`
            }
            position={activeContextMenu.position}
          >
            {activeContextMenu.descriptor.type === "smart-collection" && (
              <>
                <ContextMenuItem
                  icon={<Icon name="smart" size={14} />}
                  label="重命名智能合集"
                  onAction={() => {
                    const desc = activeContextMenu.descriptor;
                    if (desc.type !== "smart-collection") return;
                    setRenameTarget({ kind: "smart", id: desc.id, name: desc.name });
                  }}
                />
                <ContextMenuItem
                  icon={<Icon name="refresh" size={14} />}
                  label="用当前条件更新"
                  onAction={() => {
                    const desc = activeContextMenu.descriptor;
                    if (desc.type !== "smart-collection") return;
                    void updateSmartCollectionQuery(desc.id);
                  }}
                />
                <ContextMenuItem
                  icon={<Icon name="trash" size={14} />}
                  label="删除智能合集"
                  danger
                  onAction={() => {
                    const desc = activeContextMenu.descriptor;
                    if (desc.type !== "smart-collection") return;
                    if (confirm(`删除智能合集"${desc.name}"？`))
                      void deleteSmartCollection(desc.id);
                  }}
                />
              </>
            )}
            {activeContextMenu.descriptor.type === "organization" && (
              <>
                <ContextMenuItem
                  icon={
                    <Icon
                      name={activeContextMenu.descriptor.orgKind === "tag" ? "tag" : "collection"}
                      size={14}
                    />
                  }
                  label={`重命名${activeContextMenu.descriptor.orgKind === "tag" ? "标签" : "合集"}`}
                  onAction={() => {
                    const desc = activeContextMenu.descriptor;
                    if (desc.type !== "organization") return;
                    setRenameTarget({ kind: desc.orgKind, id: desc.id, name: desc.name });
                  }}
                />
                {activeContextMenu.descriptor.orgKind === "collection" && (
                  <ContextMenuItem
                    icon={<Icon name="info" size={14} />}
                    label="编辑合集详情"
                    onAction={() => {
                      const desc = activeContextMenu.descriptor;
                      if (desc.type !== "organization") return;
                      const collection = collections.find(
                        (candidate) => candidate.collectionId === desc.id,
                      );
                      if (collection)
                        setCollectionEditor({
                          collectionId: collection.collectionId,
                          description: collection.description ?? "",
                          coverAssetId: collection.coverAssetId ?? "",
                        });
                    }}
                  />
                )}
                <ContextMenuItem
                  icon={<Icon name="trash" size={14} />}
                  label={`删除${activeContextMenu.descriptor.orgKind === "tag" ? "标签" : "合集"}`}
                  danger
                  onAction={() => {
                    const desc = activeContextMenu.descriptor;
                    if (desc.type !== "organization") return;
                    const confirmed = confirm(
                      desc.orgKind === "tag"
                        ? `删除标签"${desc.name}"？`
                        : `删除合集"${desc.name}"？\n（仅删除合集结构，不删除资产）`,
                    );
                    if (confirmed) {
                      if (desc.orgKind === "tag") void deleteTag(desc.id);
                      else void deleteCollection(desc.id);
                    }
                  }}
                />
              </>
            )}
            {activeContextMenu.descriptor.type === "asset" &&
              (() => {
                const { assetId } = activeContextMenu.descriptor;
                return (
                  <>
                    <ContextMenuItem
                      icon={<Icon name="upload" size={14} />}
                      label="使用外部应用打开"
                      onAction={() => {
                        void handleOpenExternal(assetId);
                      }}
                    />
                    {activeCollectionId && (
                      <ContextMenuItem
                        icon={<Icon name="close" size={14} />}
                        label="从当前合集移除"
                        onAction={() => {
                          void removeAssetFromCollection(assetId, activeCollectionId);
                        }}
                      />
                    )}
                    {tags.map((tag) => (
                      <ContextMenuItem
                        key={`tag-${tag.tagId}`}
                        icon={<Icon name="tag" size={14} />}
                        label={`添加标签：${tag.name}`}
                        onAction={() => {
                          void assignAssetToTag(assetId, tag.tagId);
                        }}
                      />
                    ))}
                    {collections.map((collection) => (
                      <ContextMenuItem
                        key={`collection-${collection.collectionId}`}
                        icon={<Icon name="collection" size={14} />}
                        label={`加入合集：${collection.name}`}
                        onAction={() => {
                          void addAssetToCollection(assetId, collection.collectionId);
                        }}
                      />
                    ))}
                  </>
                );
              })()}
          </ContextMenu>
        </ContextMenuBackdrop>
      )}
    </main>
  );
}

export function App() {
  return (
    <ContextMenuProvider>
      <AppInner />
    </ContextMenuProvider>
  );
}

function initials(value: string) {
  return value.trim().slice(0, 2).toUpperCase() || "SP";
}
function organizationNoun(kind: OrganizationKind) {
  return kind === "tag" ? "标签" : kind === "collection" ? "合集" : "智能合集";
}
function parseStoredPalette(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}
function isCssColor(value: string) {
  return /^#[0-9a-f]{3,8}$/i.test(value) || /^(rgb|hsl)a?\(/i.test(value);
}
export function parseSearchExpression(
  value: string,
): Array<{ field: string | null; values: string[]; exclude: boolean }> {
  const allowedFields = new Set([
    "label",
    "filename",
    "tags",
    "description",
    "source_url",
    "folder_path",
    "metadata_text",
  ]);
  const tokens = value.match(/-?[a-z_]+:"[^"]*"|"[^"]*"|\S+/gi) ?? [];
  const clauses: Array<{
    field: string | null;
    values: string[];
    exclude: boolean;
  }> = [];
  let excludeNext = false;
  let mergeWithPrevious = false;
  for (const rawToken of tokens) {
    if (rawToken.toUpperCase() === "NOT") {
      excludeNext = true;
      continue;
    }
    if (rawToken.toUpperCase() === "OR") {
      mergeWithPrevious = true;
      continue;
    }
    let token = rawToken;
    const exclude = excludeNext || token.startsWith("-");
    excludeNext = false;
    if (token.startsWith("-")) token = token.slice(1);
    const separator = token.indexOf(":");
    const candidateField = separator > 0 ? token.slice(0, separator) : null;
    const field =
      candidateField && allowedFields.has(candidateField)
        ? candidateField
        : null;
    const rawValues = (field ? token.slice(separator + 1) : token).replace(
      /^"|"$/g,
      "",
    );
    const values = rawValues
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (values.length === 0) continue;
    const previous = clauses.at(-1);
    if (
      mergeWithPrevious &&
      previous &&
      previous.field === field &&
      previous.exclude === exclude
    ) {
      previous.values.push(...values);
    } else {
      clauses.push({ field, values, exclude });
    }
    mergeWithPrevious = false;
  }
  return clauses;
}
export function aiSearchPlanToDefinition(plan: AiSearchPlan): SearchDefinition {
  const positiveTerms = [...new Set([...plan.keywords, ...plan.synonyms])];
  const clauses: Array<{
    field: string | null;
    values: string[];
    exclude: boolean;
  }> = [];
  if (positiveTerms.length > 0)
    clauses.push({ field: null, values: positiveTerms, exclude: false });
  // LibraryService executes exclude-only clauses through a parameterized
  // NOT-IN subquery, so a model exclusion is never silently discarded.
  if (plan.exclusions.length > 0) {
    clauses.push({
      field: null,
      values: [...new Set(plan.exclusions)],
      exclude: true,
    });
  }
  return {
    ...(clauses.length > 0 ? { search: { clauses } } : {}),
    ...(plan.filters.length > 0 ? { filters: plan.filters } : {}),
    ...(plan.sort ? { sort: plan.sort } : {}),
  };
}
function describeAiSearchPlan(plan: AiSearchPlan): string {
  const parts = [
    plan.keywords.length + plan.synonyms.length > 0
      ? `${plan.keywords.length + plan.synonyms.length} 个词`
      : undefined,
    plan.exclusions.length > 0
      ? `排除 ${plan.exclusions.length} 项`
      : undefined,
    plan.filters.length > 0 ? `${plan.filters.length} 个筛选` : undefined,
    plan.sort ? "含排序" : undefined,
  ].filter((part): part is string => Boolean(part));
  return `AI 计划：${parts.join(" · ")}`;
}
function extension(name: string) {
  const value = name.split(".").pop();
  return value && value !== name ? value.slice(0, 5).toUpperCase() : "FILE";
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
export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function parseNumericRange(
  minInput: string,
  maxInput: string,
  scale = 1,
  integer = true,
): { min?: number; max?: number } | null {
  const minValue =
    minInput.trim() === "" ? undefined : Number(minInput) * scale;
  const maxValue =
    maxInput.trim() === "" ? undefined : Number(maxInput) * scale;
  if (minValue === undefined && maxValue === undefined) return null;
  if (
    (minValue !== undefined && (!Number.isFinite(minValue) || minValue < 0)) ||
    (maxValue !== undefined && (!Number.isFinite(maxValue) || maxValue < 0)) ||
    (minValue !== undefined && maxValue !== undefined && minValue > maxValue)
  ) {
    return null;
  }
  return {
    ...(minValue !== undefined
      ? { min: integer ? Math.round(minValue) : minValue }
      : {}),
    ...(maxValue !== undefined
      ? { max: integer ? Math.round(maxValue) : maxValue }
      : {}),
  };
}
function highlightSnippet(value: string): ReactNode {
  const segments = value.split(/(<\/?b>)/i);
  let highlighted = false;
  return segments.map((segment, index) => {
    if (/^<b>$/i.test(segment)) {
      highlighted = true;
      return null;
    }
    if (/^<\/b>$/i.test(segment)) {
      highlighted = false;
      return null;
    }
    return highlighted ? (
      <mark key={index}>{segment}</mark>
    ) : (
      <span key={index}>{segment}</span>
    );
  });
}
function importSummary(value: {
  importedCount: number;
  skippedCount: number;
  replacedCount: number;
}) {
  return `导入完成：新增 ${value.importedCount} 项${value.replacedCount ? `，替换 ${value.replacedCount} 项` : ""}${value.skippedCount ? `，跳过 ${value.skippedCount} 项` : ""}。`;
}
export function supportsExternalImportTypes(types: readonly string[]): boolean {
  return (
    types.includes("Files") ||
    types.includes("text/html") ||
    types.includes("text/uri-list")
  );
}
function supportsExternalImportTransfer(transfer: DataTransfer): boolean {
  return supportsExternalImportTypes(Array.from(transfer.types));
}
function externalImportPayload(transfer: DataTransfer): {
  files: File[];
  html: string;
  uriList: string;
} {
  // Renderer reads browser-provided drag metadata only. Fetching and staging
  // remain inside Main/Worker and URLs never become filesystem paths.
  const read = (type: string): string => {
    try {
      return transfer.getData(type);
    } catch {
      return "";
    }
  };
  return {
    files: Array.from(transfer.files),
    html: read("text/html"),
    uriList: read("text/uri-list"),
  };
}
function toOrganizationMessage(
  error: unknown,
  kind: OrganizationKind,
  operation: "创建" | "重命名" | "删除" | "移除资产",
) {
  const noun = organizationNoun(kind);
  const action =
    operation === "移除资产" ? "从合集移除资产" : `${operation}${noun}`;
  if (error instanceof LibraryOperationError) {
    const reason = error.reason
      ? PUBLIC_ERROR_REASONS_ZH[error.reason]
      : undefined;
    const detail = (() => {
      switch (error.code) {
        case "INVALID_FOLDER_NAME":
          return `${noun}名称为空，或名称不受当前平台支持。`;
        case "FOLDER_ALREADY_EXISTS":
          return `资源库中已存在同名${noun}。`;
        case "FOLDER_NOT_FOUND":
          return `目标${noun}已不存在，请刷新后重试。`;
        case "ASSET_NOT_FOUND":
          return "目标资产已不存在，请刷新后重试。";
        default:
          return (
            reason ??
            PUBLIC_ERROR_MESSAGES_ZH[error.code] ??
            "Serpent 无法完成这项操作，请查看日志了解详细原因。"
          );
      }
    })();
    return `${action}失败。原因：${detail}${reason && detail !== reason ? ` ${reason}` : ""}`;
  }
  const detail =
    error instanceof Error && error.message
      ? error.message
      : "发生未知错误，请查看日志了解详细原因。";
  return `${action}失败。原因：${detail}`;
}
function toMessage(error: unknown, fallback: string) {
  if (error instanceof LibraryOperationError) {
    const message = PUBLIC_ERROR_MESSAGES_ZH[error.code] ?? fallback;
    const reason = error.reason
      ? PUBLIC_ERROR_REASONS_ZH[error.reason]
      : undefined;
    return reason ? `${message} 原因：${reason}` : message;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

const PUBLIC_ERROR_MESSAGES_ZH: Partial<Record<PublicErrorCode, string>> = {
  CANCELLED: "操作已取消。",
  INTERNAL_ERROR: "Serpent 无法完成这项操作，请重试。",
  INVALID_LIBRARY_NAME: "请输入可跨平台安全使用的资源库名称。",
  INVALID_LIBRARY_PATH: "请选择有效的本地文件夹。",
  INVALID_FOLDER_NAME: "请输入可跨平台安全使用的文件夹名称。",
  FOLDER_ALREADY_EXISTS: "当前位置已经存在同名文件夹。",
  FOLDER_NOT_FOUND: "找不到所选资源库文件夹。",
  INVALID_IMPORT_SOURCE: "无法读取所选导入内容。",
  INVALID_DROP_SELECTION:
    "请一次拖入一个本地文件夹，或一个及以上本地文件；不能混合拖入文件与文件夹。",
  WEB_MEDIA_NOT_FOUND: "拖放内容中没有可下载的网页图片或视频地址。",
  WEB_MEDIA_URL_INVALID: "拖放内容中的媒体地址不是有效的 HTTP(S) 链接。",
  WEB_MEDIA_DROP_TOO_LARGE: "网页拖放元数据过大，Serpent 已拒绝解析。",
  CLIPBOARD_IMAGE_NOT_FOUND:
    "系统剪贴板中没有可导入的图片，请先复制图片再重试。",
  IMPORT_COLLECTION_ASSIGN_FAILED:
    "资产已经导入目标文件夹，但未能加入所选合集；资产不会丢失，请查看日志后重试合集操作。",
  INVALID_IMPORT_DECISION: "导入冲突处理选项无效。",
  INVALID_ASSET_METADATA:
    "资产元数据无效，请使用六位十六进制色值，并填写有效的 HTTP(S) 源链接。",
  IMPORT_NOT_FOUND: "待处理的导入已失效，请重新选择文件。",
  IMPORT_APPLY_FAILED: "无法安全完成导入。",
  LIBRARY_ALREADY_EXISTS: "该位置已经存在同名文件或文件夹。",
  LIBRARY_NOT_FOUND: "找不到所选资源库。",
  NOT_A_LIBRARY: "所选文件夹不是有效的 Serpent 资源库。",
  LIBRARY_CORRUPT: "资源库数据库或迁移记录已损坏。",
  LIBRARY_VERSION_TOO_NEW: "该资源库由更新版本的 Serpent 创建。",
  LIBRARY_NOT_WRITABLE: "Serpent 无法写入所选位置。",
  LIBRARY_CLEANUP_FAILED: "创建失败，且临时文件无法自动清理。",
  LIBRARY_NOT_OPEN: "该资源库当前没有打开。",
  ASSET_NOT_FOUND: "找不到所选资产。",
  ASSET_MOVE_CONFLICT:
    "资产移动无法完成：源位置或目标位置已经变化，Serpent 未执行静默覆盖。",
  ASSET_SOURCE_TRASH_FAILED:
    "无法将源文件移入系统回收站，请查看日志了解具体原因。",
  AI_ANALYSIS_FAILED: "AI 服务未能完成资产分析。",
  AI_SEARCH_FAILED: "AI 服务未能转换这次搜索。",
  VERSION_CONFLICT: "元数据已被其他操作修改。请刷新后重新编辑。",
  ZIP_TOO_LARGE:
    "资源库大小超出标准 ZIP 限制（4 GiB / 65534 条目）。请改为导出文件夹。",
  TRANSFER_IN_PROGRESS: "已有资源库导入或导出正在使用相同资源库或路径。",
};
const PUBLIC_ERROR_REASONS_ZH: Record<PublicErrorReason, string> = {
  PERMISSION_DENIED: "当前用户没有读取源文件或写入目标位置的权限。",
  FILE_BUSY: "文件正被其他应用使用，请关闭后重试。",
  PATH_LIMIT_EXCEEDED: "目标文件系统拒绝了该路径或名称长度。",
  DISK_FULL: "目标磁盘空间不足。",
  READ_ONLY_FILESYSTEM: "目标位置位于只读文件系统。",
  SOURCE_NOT_FOUND: "源文件在导入过程中消失或无法找到。",
  SOURCE_CHANGED: "源文件在复制过程中发生了变化。",
  SOURCE_TRASH_FAILED:
    "操作系统拒绝将源文件移入系统回收站；源文件与 Serpent 记录均已保留。",
  SOURCE_TRASH_RECONCILIATION_REQUIRED:
    "源文件可能已进入系统回收站，但记录尚未完成清理；请重新打开资源库以自动对账，并查看日志。",
  SYMBOLIC_LINK_NOT_ALLOWED: "目录中包含当前切片不支持的符号链接。",
  UNSUPPORTED_FILE_ENTRY: "目录中包含普通文件和文件夹之外的项目。",
  MIME_TYPE_MISSING: "远程响应未声明媒体类型，为避免保存伪装文件已拒绝导入。",
  MIME_TYPE_UNSUPPORTED: "远程响应声明的媒体类型不受支持。",
  MIME_EXTENSION_MISMATCH: "文件扩展名与远程响应声明的媒体类型不一致。",
  MAGIC_BYTES_MISMATCH:
    "文件头与远程响应声明的媒体类型不一致，文件可能已损坏或被伪装。",
  NAME_NOT_SUPPORTED: "当前目标文件系统不接受其中的文件名。",
  IO_ERROR: "操作系统报告了磁盘读写错误。",
  SHARP_UNAVAILABLE: "图像处理引擎 Sharp 不可用。",
  FFMPEG_REQUIRED: "当前安装中未找到 FFmpeg，暂时无法生成视频预览。",
  OIIO_REQUIRED: "当前安装中未找到 OpenImageIO，暂时无法解码 EXR/TGA。",
  MEDIA_PROCESSING_FAILED:
    "媒体处理失败。请检查源文件是否损坏，并查看应用日志了解详细原因。",
  PALETTE_SOURCE_NOT_READY: "当前修订的缩略图或视频封面尚未就绪。",
  PALETTE_EXTRACTION_FAILED: "本地色卡提取失败，请查看应用日志了解详细原因。",
  UNSUPPORTED_FORMAT: "当前切片不支持此文件格式。",
  ZIP_TOO_LARGE: "资源库大小超出标准 ZIP 限制（4 GiB / 65534 条目）。",
  NOT_A_LIBRARY: "所选目标不是有效的 Serpent 资源库。",
  PATH_ESCAPE: "ZIP 中包含路径逃逸条目，可能造成安全风险。",
  AI_AUTH: "API Key 无效或已失效，请更新凭据。",
  AI_PERMISSION: "当前 API Key 没有访问所选模型的权限。",
  AI_QUOTA: "供应商账户额度已用尽，请检查计费与额度。",
  AI_RATE_LIMIT: "请求过于频繁，Serpent 将稍后重试。",
  AI_NETWORK: "无法连接 AI 供应商，请检查网络。",
  AI_TIMEOUT: "AI 请求超时，Serpent 将稍后重试。",
  AI_INVALID_RESPONSE: "AI 供应商返回了无法解析的结果。",
  AI_NOT_CONFIGURED:
    "请先在 AI 设置中保存 API Key、选择模型并接受数据发送说明。",
  AI_REFUSED: "AI 供应商拒绝了这次查询转换；查询内容未执行。",
  THUMBNAIL_REQUIRED: "资产缩略图尚未就绪，无法安全发送到 AI 供应商。",
  TRANSFER_IN_PROGRESS: "已有资源库导入或导出正在使用相同资源库或路径。",
};
class LibraryOperationError extends Error {
  readonly code: PublicError["code"];
  readonly reason?: PublicErrorReason;
  constructor(error: PublicError) {
    super(error.message);
    this.code = error.code;
    this.reason = error.reason;
  }
}
