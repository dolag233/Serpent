import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";

import { Icon, type IconName } from "./Icons";
import { ConvertLinkedDialog } from "./ConvertLinkedDialog";
import { LinkedRulesDialog } from "./LinkedRulesDialog";
import { PermanentDeleteDialog } from "./PermanentDeleteDialog";
import { DeleteLinkedDialog } from "./DeleteLinkedDialog";
import { ExportDialog } from "./ExportDialog";
import { ImportDialog } from "./ImportDialog";
import {
  NavigationSidebar,
} from "./NavigationSidebar";
import { LibrarySwitcher, buildRecentLibraryMenuEntries, type RecentLibraryMenuEntry } from "./LibrarySwitcher";
import {
  ScopeBreadcrumbs,
  buildScopeBreadcrumbSegments,
} from "./ScopeBreadcrumbs";
import { buildManagedFolderBreadcrumbTrail } from "./folder-breadcrumb-trail";
import {
  createWorkspaceNavHistory,
  type WorkspaceNavLocation,
} from "./workspace-nav-history";
import { RelinkPreview } from "./RelinkPreview";
import { MoveDialog } from "./MoveDialog";
import { RestoreDialog } from "./RestoreDialog";
import { UndoMoveDialog } from "./UndoMoveDialog";
import { ConflictsDialog } from "./ConflictsDialog";
import { RenameDialog } from "./RenameDialog";
import { CreateDialog } from "./CreateDialog";
import { CollectionEditorDialog } from "./CollectionEditorDialog";
import { ExtensionPairingDialog } from "./ExtensionPairingDialog";
import { AiConfigDialog } from "./AiConfigDialog";
import { MediaJobsDialog } from "./MediaJobsDialog";

import {
  ContextMenuProvider,
  useContextMenu,
} from "./context-menu";
import { useAssetSelection } from "./useAssetSelection";
import { useBatchActions } from "./useBatchActions";
import {
  toMessage,
  LibraryOperationError,
  PUBLIC_ERROR_MESSAGES_ZH,
  PUBLIC_ERROR_REASONS_ZH,
} from "./error-utils";

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
  LibraryApiResult,
  RelinkBatchPreviewResult,
  ImportValidatedResult,
  MediaJobStatus,
  AiJobStatus,
} from "../shared/library-api";
import type { SerpentExtensionPairingApi } from "../shared/extension-pairing";
import type {
  ImportConflictPlan,
  RendererLibrarySummary,
  ExportProgressEvent,
  ImportProgressEvent,
} from "../shared/protocol/responses";
import { AssetPreviewModal } from "./AssetPreviewModal";
import { AssetContextMenu } from "./AssetContextMenu";
import { InspectorPanel } from "./InspectorPanel";
import {
  CARD_SIZE_MAX,
  CARD_SIZE_MIN,
  loadCanvasPreferences,
  saveCanvasPreferences,
  type CanvasPreferences,
} from "./canvas-preferences";
import {
  assetGridLayoutStyle,
  countFittingColumns,
  distributeMasonryItems,
} from "./asset-grid-layout";
import {
  isMacPlatform,
  matchesAssetCommandShortcut,
} from "./asset-command-shortcuts";

const IS_MAC_PLATFORM = isMacPlatform(navigator.userAgent);

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

function MasonryColumns({
  assets,
  cardSize,
  children,
  showCaption,
}: {
  assets: AssetSummary[];
  cardSize: number;
  children: ReactNode[];
  showCaption: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const updateWidth = () => setAvailableWidth(element.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const columnCount = countFittingColumns(availableWidth, cardSize);
  const distributed = distributeMasonryItems(
    assets.map((asset, index) => ({ asset, child: children[index] })),
    columnCount,
    ({ asset }) => {
      const previewHeight =
        asset.width && asset.height
          ? cardSize * (asset.height / asset.width)
          : cardSize * 0.72;
      return previewHeight + (showCaption ? 42 : 0) + 12;
    },
  );

  return (
    <div
      className="masonry-columns"
      ref={containerRef}
      style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
    >
      {distributed.map((column, index) => (
        <div className="masonry-column" key={`masonry-column-${index}`}>
          {column.items.map(({ asset, child }) => (
            <div className="masonry-card-slot" key={asset.assetId}>
              {child}
            </div>
          ))}
        </div>
      ))}
    </div>
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
  const [recentLibraries, setRecentLibraries] = useState<
    RecentLibraryMenuEntry[]
  >([]);
  const [folders, setFolders] = useState<ManagedFolderSummary[]>([]);
  const [linkedFolders, setLinkedFolders] = useState<LinkedFolderSummary[]>([]);
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
  const navHistoryRef = useRef(createWorkspaceNavHistory());
  const suppressNavHistoryRef = useRef(false);
  const [navHistoryUi, setNavHistoryUi] = useState({
    canBack: false,
    canForward: false,
  });

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
  const { open: openContextMenu, close: closeContextMenu } =
    useContextMenu();
  const hadDiscoveryInput = useRef(false);
  const reloadCurrentContentRef = useRef<() => Promise<void>>(
    async () => undefined,
  );

  // Metadata editor
  const [assetMetadata, setAssetMetadata] =
    useState<AssetMetadataResult | null>(null);
  const [versionConflict, setVersionConflict] = useState(false);
  const selectedAssetIdRef = useRef(selectedAssetId);
  useEffect(() => {
    selectedAssetIdRef.current = selectedAssetId;
  }, [selectedAssetId]);
  const metadataByAssetRef = useRef(new Map<string, AssetMetadataResult>());
  const metadataConflictAssetIdsRef = useRef(new Set<string>());
  const metadataSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  // Pending edit values
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
    assetId: string;
    description?: string;
    tags?: string[];
    structuredMetadata?: Record<string, unknown>;
    modelVersion?: string;
  } | null>(null);
  const [importValidated, setImportValidated] =
    useState<ImportValidatedResult | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);

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
  const previewScrollPositionRef = useRef<{
    left: number;
    top: number;
  } | null>(null);
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

  const {
    handleCanvasMouseDown,
    clearAssetSelection,
    selectionAnchorRef,
    handleCardClick,
    cardMouseDownRef,
    marqueeBox,
    selectedIdSet,
  } = useAssetSelection({
    assets: visibleAssets,
    selectedAssetIds,
    setSelectedAssetIds,
    setSelectedAssetId,
    previewAsset,
    draggedMemberId,
    draggedCollectionId,
    workspaceCanvasRef,
  });

  const previewIndex = previewAsset
    ? visibleAssets.findIndex((asset) => asset.assetId === previewAsset.assetId)
    : -1;
  const selectedAssets = useMemo(
    () => visibleAssets.filter((asset) => selectedIdSet.has(asset.assetId)),
    [selectedIdSet, visibleAssets],
  );
  const selectedManagedCount = useMemo(
    () => selectedAssets.filter((a) => a.locationKind === "managed").length,
    [selectedAssets],
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

  const openAssetPreview = useCallback((asset: AssetSummary) => {
    if (asset.availability !== "available" || asset.deletedAt) return;
    previewFocusReturnRef.current = asset.assetId;
    previewScrollPositionRef.current = workspaceCanvasRef.current
      ? {
          left: workspaceCanvasRef.current.scrollLeft,
          top: workspaceCanvasRef.current.scrollTop,
        }
      : null;
    setSelectedAssetIds([asset.assetId]);
    setSelectedAssetId(asset.assetId);
    selectionAnchorRef.current = asset.assetId;
    setPreviewAsset(asset);
  }, [selectionAnchorRef]);

  const navigateAssetPreview = useCallback((asset: AssetSummary) => {
    setSelectedAssetIds([asset.assetId]);
    setSelectedAssetId(asset.assetId);
    selectionAnchorRef.current = asset.assetId;
    previewFocusReturnRef.current = asset.assetId;
    setPreviewAsset(asset);
  }, [selectionAnchorRef]);

  const closeAssetPreview = useCallback(async () => {
    const closingAsset = previewAsset;
    if (!closingAsset) return;
    if (closingPreviewRef.current === closingAsset.assetId) return;
    closingPreviewRef.current = closingAsset.assetId;
    setPreviewAsset(null);
    const assetId = previewFocusReturnRef.current;
    const scrollPosition = previewScrollPositionRef.current;
    previewFocusReturnRef.current = null;
    previewScrollPositionRef.current = null;
    window.requestAnimationFrame(() => {
      const canvas = workspaceCanvasRef.current;
      if (canvas && scrollPosition) canvas.scrollTo(scrollPosition);
      canvas
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
        let restoredLocation: WorkspaceNavLocation = { kind: "all" };
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
              restoredLocation = { kind: "trash" };
            } else if (session.scope.kind === "root") {
              setAssetScope("root");
              restoredItems = (await loadContent(activeLibrary, "root")) ?? [];
              searchScope = {
                kind: "folder",
                folderId: null,
                recursive: false,
              };
              restoredLocation = { kind: "root" };
            } else if (session.scope.kind === "folder") {
              setAssetScope(session.scope.id);
              restoredItems =
                (await loadContent(activeLibrary, session.scope.id)) ?? [];
              searchScope = {
                kind: "folder",
                folderId: session.scope.id,
                recursive: false,
              };
              restoredLocation = {
                kind: "folder",
                folderId: session.scope.id,
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
              restoredLocation = { kind: "tag", tagId: session.scope.id };
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
              restoredLocation = {
                kind: "collection",
                collectionId: session.scope.id,
                recursive: collectionRecursiveRef.current,
              };
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
              restoredLocation = {
                kind: "smart-collection",
                collectionId: session.scope.id,
              };
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
            restoredLocation = { kind: "all" };
            await loadContent(activeLibrary, "all");
          }
        }
        navHistoryRef.current.clear(restoredLocation);
        setNavHistoryUi({ canBack: false, canForward: false });
      } else {
        navHistoryRef.current.clear({ kind: "all" });
        setNavHistoryUi({ canBack: false, canForward: false });
      }
      setUiState(activeLibrary ? "ready" : "idle");
    } catch (caught) {
      setError(toMessage(caught, "无法恢复工作区。"));
      setUiState(activeLibrary ? "ready" : "idle");
    }
  }, [api, loadContent, selectionAnchorRef, setError]);
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

  function syncNavHistoryUi() {
    setNavHistoryUi({
      canBack: navHistoryRef.current.canBack,
      canForward: navHistoryRef.current.canForward,
    });
  }

  function resetNavHistory(initial: WorkspaceNavLocation = { kind: "all" }) {
    navHistoryRef.current.clear(initial);
    syncNavHistoryUi();
  }

  function recordNavigation(location: WorkspaceNavLocation) {
    if (suppressNavHistoryRef.current) return;
    navHistoryRef.current.push(location);
    syncNavHistoryUi();
  }

  async function applyWorkspaceLocation(location: WorkspaceNavLocation) {
    switch (location.kind) {
      case "all":
        await chooseFolder("all");
        return;
      case "root":
        await chooseFolder("root");
        return;
      case "folder":
        await chooseFolder(location.folderId);
        return;
      case "tag":
        await chooseTag(location.tagId);
        return;
      case "collection":
        await chooseCollection(location.collectionId, location.recursive);
        return;
      case "smart-collection":
        await chooseSmartCollection(location.collectionId);
        return;
      case "trash":
        await enterTrash();
        return;
    }
  }

  async function goWorkspaceBack() {
    const location = navHistoryRef.current.back();
    if (!location) return;
    syncNavHistoryUi();
    suppressNavHistoryRef.current = true;
    try {
      await applyWorkspaceLocation(location);
    } finally {
      suppressNavHistoryRef.current = false;
    }
  }

  async function goWorkspaceForward() {
    const location = navHistoryRef.current.forward();
    if (!location) return;
    syncNavHistoryUi();
    suppressNavHistoryRef.current = true;
    try {
      await applyWorkspaceLocation(location);
    } finally {
      suppressNavHistoryRef.current = false;
    }
  }

  async function refreshRecentLibraries(currentLibraryPath?: string | null) {
    if (!api) return;
    try {
      const result = await api.listRecent();
      if (!result.ok) return;
      setRecentLibraries(
        buildRecentLibraryMenuEntries(
          result.value,
          currentLibraryPath === undefined
            ? (library?.displayPath ?? null)
            : currentLibraryPath,
        ),
      );
    } catch {
      // 最近资源库列表读取失败不影响菜单主功能，保持现有列表。
    }
  }

  async function runLibraryOperation(kind: "create" | "open") {
    if (!api) return;
    await runLibraryOpenPipeline(
      kind === "create" ? "creating" : "opening",
      () =>
        kind === "create"
          ? api.create({ displayName: dialogValue.trim() })
          : api.open(),
      "资源库操作失败。",
    );
  }

  async function openRecentLibrary(libraryPath: string) {
    if (!api) return;
    await runLibraryOpenPipeline(
      "opening",
      () => api.openRecent({ path: libraryPath }),
      "打开最近资源库失败。",
    );
  }

  async function runLibraryOpenPipeline(
    busyState: "creating" | "opening",
    action: () => Promise<LibraryApiResult<RendererLibrarySummary>>,
    failureMessage: string,
  ) {
    setError(null);
    setUiState(busyState);
    let opened = false;
    try {
      const result = await action();
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
      resetNavHistory({ kind: "all" });
      api?.setActiveContext(result.value.libraryId);
      await loadContent(result.value, "all");
      await refreshRecentLibraries(result.value.displayPath);
    } catch (caught) {
      setError(toMessage(caught, failureMessage));
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
      recordNavigation(
        scope === "all"
          ? { kind: "all" }
          : scope === "root"
            ? { kind: "root" }
            : { kind: "folder", folderId: scope },
      );
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
      recordNavigation({ kind: "trash" });
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
      recordNavigation({ kind: "tag", tagId });
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
      await refreshTagAndMetadataState(assetId);
      setNotice("标签已添加。");
    } catch (caught) {
      setError(toMessage(caught, "添加标签失败。"));
    }
  }

  async function handleRemoveTagFromAsset(tagId: string) {
    if (!api || !library || !selectedAssetId) return;
    const targetAssetId = selectedAssetId;
    try {
      const result = await api.removeTags({
        libraryId: library.libraryId,
        assetIds: [targetAssetId],
        tagIds: [tagId],
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      await refreshTagAndMetadataState(targetAssetId);
      setNotice("标签已移除。");
    } catch (caught) {
      setError(toMessage(caught, "移除标签失败。"));
    }
  }

  async function handleCreateAndAssignTag(tagName: string) {
    if (!api || !library || !selectedAssetId || !tagName.trim()) return;
    const targetAssetId = selectedAssetId;
    try {
      const createResult = await api.createTag({
        libraryId: library.libraryId,
        name: tagName.trim(),
      });
      if (!createResult.ok) throw new LibraryOperationError(createResult.error);
      const assignResult = await api.assignTags({
        libraryId: library.libraryId,
        assetIds: [targetAssetId],
        tagIds: [createResult.value.tagId],
      });
      if (!assignResult.ok) throw new LibraryOperationError(assignResult.error);
      await refreshTagAndMetadataState(targetAssetId);
      setNotice(`已创建并添加标签 "${tagName.trim()}"。`);
    } catch (caught) {
      setError(toMessage(caught, "创建标签失败。"));
    }
  }

  async function refreshTagAndMetadataState(assetId: string) {
    if (!api || !library) return;
    const targetLibraryId = library.libraryId;
    const [tagResult, metadataResult] = await Promise.all([
      api.listTags({ libraryId: targetLibraryId }),
      api.getAssetMetadata({ libraryId: targetLibraryId, assetId }),
    ]);
    if (!tagResult.ok) throw new LibraryOperationError(tagResult.error);
    if (!metadataResult.ok) throw new LibraryOperationError(metadataResult.error);
    setTags(tagResult.value);
    metadataByAssetRef.current.set(assetId, metadataResult.value);
    if (selectedAssetIdRef.current === assetId) {
      setAssetMetadata(metadataResult.value);
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
      recordNavigation({
        kind: "collection",
        collectionId,
        recursive,
      });
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

  const {
    batchAssignTagToSelection,
    batchRemoveTagFromSelection,
    batchAddSelectionToCollection,
    batchRemoveSelectionFromCollection,
    trashManagedAssets,
    copyManagedSelectionToLinked,
  } = useBatchActions({
    api: api ?? null,
    library,
    setUiState,
    setTags,
    setCollections,
    setNotice,
    setError,
    reloadCurrentContent,
    chooseTag,
    chooseCollection,
    clearAssetSelection,
    activeTagId,
    activeCollectionId,
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
      if (offset === 0) {
        clearAssetSelection();
        recordNavigation({ kind: "smart-collection", collectionId });
      }
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

  function applyLoadedMetadata(
    targetAssetId: string,
    metadata: AssetMetadataResult,
  ) {
    metadataByAssetRef.current.set(targetAssetId, metadata);
    metadataConflictAssetIdsRef.current.delete(targetAssetId);
    if (selectedAssetIdRef.current !== targetAssetId) return;
    setAssetMetadata(metadata);
    setEditDescription(metadata.description ?? "");
    setEditRating(metadata.rating);
    setEditFavorite(metadata.favorite);
    setEditSourceUrl(metadata.sourcePageUrl ?? "");
    setEditPalette(parseStoredPalette(metadata.palette).join(", "));
  }

  async function loadMetadata() {
    if (!api || !library || !selectedAssetId) return;
    const targetAssetId = selectedAssetId;
    setVersionConflict(false);
    try {
      const result = await api.getAssetMetadata({
        libraryId: library.libraryId,
        assetId: targetAssetId,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      applyLoadedMetadata(targetAssetId, result.value);
    } catch (caught) {
      setError(toMessage(caught, "无法读取元数据。"));
    }
  }

  useEffect(() => {
    let cancelled = false;
    if (selectedAssetId) {
      void Promise.resolve().then(async () => {
        if (!api || !library) return;
        setVersionConflict(false);
        try {
          const result = await api.getAssetMetadata({
            libraryId: library.libraryId,
            assetId: selectedAssetId,
          });
          if (!cancelled && result.ok) {
            applyLoadedMetadata(selectedAssetId, result.value);
          } else if (!cancelled && !result.ok) {
            throw new LibraryOperationError(result.error);
          }
        } catch (caught) {
          if (!cancelled) setError(toMessage(caught, "无法读取元数据。"));
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

  const handleOpenExternal = useCallback(async (assetId: string) => {
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
  }, [api, library]);

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

  async function saveLinkedRules(finalRules: LinkedFolderRule[]) {
    if (!api || !library || !linkedRulesEditor) return;
    setUiState("loading");
    try {
      const result = await api.setLinkedFolderRules({
        libraryId: library.libraryId,
        folderId: linkedRulesEditor.folderId,
        rules: finalRules,
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
      resetNavHistory({ kind: "all" });
      api?.setActiveContext(null);
      await refreshRecentLibraries(null);
    } catch (caught) {
      setError(toMessage(caught, "关闭失败。"));
    } finally {
      setUiState(closed ? "idle" : "ready");
    }
  }

  // --- Trash operations ---

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

  async function relinkMissingAsset(assetId = selectedAssetId) {
    if (!api || !library || !assetId) return;
    setUiState("loading");
    try {
      const result = await api.relinkAsset({
        libraryId: library.libraryId,
        assetId,
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

  async function exportLibrary(format: "folder" | "zip", includeLinkedContent: boolean) {
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
        format,
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
        matchesAssetCommandShortcut(event, "open-external", IS_MAC_PLATFORM) &&
        selectedAsset?.availability === "available" &&
        !selectedAsset.deletedAt &&
        !previewAsset &&
        !document.querySelector('[role="dialog"][aria-modal="true"]')
      ) {
        event.preventDefault();
        void handleOpenExternal(selectedAsset.assetId);
      } else if (
        matchesAssetCommandShortcut(event, "move-to-trash", IS_MAC_PLATFORM) &&
        !showTrash &&
        library &&
        selectedManagedCount > 0 &&
        !previewAsset &&
        !document.querySelector('[role="dialog"][aria-modal="true"]')
      ) {
        event.preventDefault();
        const managedIds = selectedAssets
          .filter((a) => a.locationKind === "managed")
          .map((a) => a.assetId);
        void trashManagedAssets(managedIds);
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
  }, [
    library,
    previewAsset,
    selectedAssetIds.length,
    showTrash,
    selectedManagedCount,
    selectedAsset,
    handleOpenExternal,
    selectedAssets,
    trashManagedAssets,
    visibleAssets,
    clearAssetSelection,
    selectionAnchorRef,
  ]);

  // Capture-phase Escape guard: when context menu is open, stop
  // propagation so the non-capture handler (which clears selection)
  // does not fire on the same Escape key press. Uses stopPropagation()
  // (not stopImmediatePropagation()) to avoid blocking the context-
  // menu's own native capture listener, which is registered first.
  useEffect(() => {
    const onEscapeCapture = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector(".context-menu")) {
        event.stopPropagation();
      }
    };
    document.addEventListener("keydown", onEscapeCapture, true);
    return () => document.removeEventListener("keydown", onEscapeCapture, true);
  }, []);

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
    navigateAssetPreview,
    openAssetPreview,
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

  // --- Metadata editor helpers ---
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

  async function handleAnalyzeClick(assetId = selectedAssetId) {
    if (!api || !library || !assetId) return;
    setAiAnalyzing(true);
    setAiContent(null);
    try {
      const result = await api.analyzeAsset({
        libraryId: library.libraryId,
        assetId,
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
        assetId,
        description: result.value.generatedFields.description,
        tags: result.value.generatedFields.tags,
        structuredMetadata: result.value.generatedFields.structuredMetadata,
        modelVersion: result.value.modelVersion,
      });
      setNotice("AI 分析完成。");
      await refreshTagAndMetadataState(assetId);
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
          <LibrarySwitcher
            disabled={busy}
            libraryName={library?.displayName ?? null}
            onCloseLibrary={() => void closeLibrary()}
            onCreateLibrary={() => {
              setDialogValue("我的资源库");
              setDialog("library");
            }}
            onMenuOpen={() => void refreshRecentLibraries()}
            onOpenLibrary={() => void runLibraryOperation("open")}
            onOpenRecent={(path) => void openRecentLibrary(path)}
            recentLibraries={recentLibraries}
          />
        </div>
        <ScopeBreadcrumbs
          canBack={navHistoryUi.canBack}
          canForward={navHistoryUi.canForward}
          onBack={() => void goWorkspaceBack()}
          onForward={() => void goWorkspaceForward()}
          onNavigateFolder={(folderId) => void chooseFolder(folderId)}
          segments={buildScopeBreadcrumbSegments({
            showTrash,
            activeTagLabel: activeTagId
              ? (tags.find((tag) => tag.tagId === activeTagId)?.name ?? null)
              : null,
            activeCollectionLabel: activeCollectionId
              ? (collections.find(
                  (collection) => collection.collectionId === activeCollectionId,
                )?.name ?? null)
              : null,
            activeSmartCollectionLabel: activeSmartCollectionId
              ? (smartCollections.find(
                  (collection) =>
                    collection.collectionId === activeSmartCollectionId,
                )?.name ?? null)
              : null,
            assetScope,
            folderTrail:
              assetScope !== "all" && assetScope !== "root"
                ? buildManagedFolderBreadcrumbTrail(folders, assetScope)
                : [],
            linkedFolderLabel:
              assetScope !== "all" && assetScope !== "root"
                ? (linkedFolders.find((folder) => folder.folderId === assetScope)
                    ?.displayName ?? null)
                : null,
          })}
        />
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
                : '搜索；支持 filename:"短语"、NOT tags:草图、OR'
            }
            title={
              aiSearchEnabled
                ? "提交后由已配置的云端模型生成受限搜索条件"
                : '示例：filename:"hero concept" NOT tags:草图'
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
      <NavigationSidebar
        library={library}
        assetScope={assetScope}
        showTrash={showTrash}
        activeTagId={activeTagId}
        activeCollectionId={activeCollectionId}
        activeSmartCollectionId={activeSmartCollectionId}
        allAssetCount={allAssetCount}
        trashedAssetCount={trashedAssets.length}
        folders={folders}
        tags={tags}
        collections={collections}
        collectionTree={collectionTree}
        smartCollections={smartCollections}
        linkedFolders={linkedFolders}
        showTagInput={showTagInput}
        tagInputValue={tagInputValue}
        showCollectionInput={showCollectionInput}
        collectionInputValue={collectionInputValue}
        newCollectionParentId={newCollectionParentId}
        collectionRecursive={collectionRecursive}
        collectionRecursiveRef={collectionRecursiveRef}
        draggedCollectionId={draggedCollectionId}
        onSetDraggedCollectionId={setDraggedCollectionId}
        onChooseAllAssets={() => void chooseFolder("all")}
        onEnterTrash={() => void enterTrash()}
        onChooseRootFolder={() => void chooseFolder("root")}
        onChooseFolder={(folderId) => void chooseFolder(folderId)}
        onChooseTag={(tagId) => void chooseTag(tagId)}
        onChooseCollection={(collectionId, recursive) =>
          void chooseCollection(collectionId, recursive)
        }
        onChooseSmartCollection={(collectionId) =>
          void chooseSmartCollection(collectionId)
        }
        onExternalDragOver={handleTargetExternalDragOver}
        onExternalDrop={(event, targetFolderId, targetCollectionId) =>
          handleTargetExternalDrop(event, targetFolderId, targetCollectionId)
        }
        onImportFolderAsLinked={() => void importFolderAsLinked()}
        onRelinkFolder={(folderId) => void relinkFolder(folderId)}
        onOpenLinkedRules={(folder) => void openLinkedRules(folder)}
        onConvertLinkedDialog={setConvertLinkedDialog}
        onAddTag={() => {
          setShowTagInput(true);
          setTagInputValue("");
        }}
        onSetShowTagInput={setShowTagInput}
        onSetTagInputValue={setTagInputValue}
        onTagInputKeyDown={handleTagInputKeyDown}
        onAddCollection={(parentId) => {
          setShowCollectionInput(true);
          setCollectionInputValue("");
          setNewCollectionParentId(parentId);
        }}
        onSetShowCollectionInput={setShowCollectionInput}
        onSetCollectionInputValue={setCollectionInputValue}
        onSetNewCollectionParentId={setNewCollectionParentId}
        onCollectionInputKeyDown={handleCollectionInputKeyDown}
        onSetCollectionRecursive={setCollectionRecursive}
        onAddFolder={() => {
          setDialogValue("新建文件夹");
          setDialog("folder");
        }}
        onOpenContextMenu={openContextMenu}
        onReorderCollection={(sourceId, targetId) =>
          void reorderCollectionSibling(sourceId, targetId)
        }
        onImportDroppedFiles={(files, targetFolderId, targetCollectionId, webPayload) =>
          void importDroppedFiles(files, targetFolderId, targetCollectionId, webPayload)
        }
        onCopyManagedToLinked={(folder, assetIds) =>
          void copyManagedSelectionToLinked(folder, assetIds)
        }
      />
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
            ) : (
              library &&
              !showTrash &&
              visibleAssets.some(
                (a) => a.availability === "missing" && !a.deletedAt,
              ) && (
                <button
                  className="compact-action"
                  disabled={busy}
                  onClick={() => void startBatchRelink()}
                  type="button"
                >
                  <Icon name="folder" size={14} />
                  批量重新定位
                </button>
              )
            )}
            <span className="tool-separator" />
            <span className="tool-group-import">
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
            </span>
            <span className="tool-separator" />
            <span className="tool-group-export">
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
            </span>
            <span className="tool-group-view">
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
                    icon: "clock" as const,
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
            </span>
            <span className="tool-separator" />
            <span className="tool-group-utility">
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
            </span>
          </div>
        </div>
        <div
          className={`workspace-canvas${previewAsset ? " is-viewing" : ""}${externalDropActive ? " is-external-drop" : ""}`}
          onDragEnter={handleExternalDragEnter}
          onDragLeave={handleExternalDragLeave}
          onDragOver={handleExternalDragOver}
          onDrop={handleExternalDrop}
          onMouseDown={handleCanvasMouseDown}
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
          {marqueeBox && (
            <div
              className="marquee-selection-box"
              style={{
                left: marqueeBox.left,
                top: marqueeBox.top,
                width: marqueeBox.width,
                height: marqueeBox.height,
              }}
            />
          )}
          {uiState === "importing" && (
            <div className="activity-strip" role="status">
              <span className="activity-pulse" />
              正在安全复制与登记资产…
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
                  style={assetGridLayoutStyle(assetViewMode, assetCardSize)}
                >
                  {(() => {
                    const cards = visibleAssets.map((asset) => (
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
                      onMouseDown={(e) => {
                        cardMouseDownRef.current = e.button;
                      }}
                      onClick={(event) => handleCardClick(asset.assetId, event)}
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
                        const inSelection = selectedIdSet.has(asset.assetId);
                        const multiSelected = selectedIdSet.size >= 2 && inSelection;
                        if (!inSelection) {
                          setSelectedAssetIds([asset.assetId]);
                          setSelectedAssetId(asset.assetId);
                        }
                        if (library) {
                          if (multiSelected) {
                            openContextMenu(
                              {
                                type: "multi-asset",
                                assetIds: [...selectedAssetIds],
                                count: selectedAssetIds.length,
                              },
                              { x: e.clientX, y: e.clientY },
                            );
                          } else {
                            openContextMenu(
                              {
                                type: "asset",
                                assetId: asset.assetId,
                                displayName: asset.displayName,
                                locationKind: asset.locationKind,
                                isAvailable: asset.availability === "available",
                                isDeleted: Boolean(asset.deletedAt),
                              },
                              { x: e.clientX, y: e.clientY },
                            );
                          }
                        }
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
                              <strong title={asset.displayName}>
                                {asset.displayName}
                              </strong>
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
                    ));
                    return assetViewMode === "masonry" ? (
                      <MasonryColumns
                        assets={visibleAssets}
                        cardSize={assetCardSize}
                        showCaption={
                          canvasPrefs.fields.name ||
                          canvasPrefs.fields.size ||
                          canvasPrefs.fields.date
                        }
                      >
                        {cards}
                      </MasonryColumns>
                    ) : cards;
                  })()}
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
        {previewAsset && library && api && (
          <AssetPreviewModal
            api={api}
            asset={previewAsset}
            key={previewAsset.assetId}
            libraryId={library.libraryId}
            onClose={() => void closeAssetPreview()}
            onNext={
              previewIndex >= 0 && previewIndex < visibleAssets.length - 1
                ? () => navigateAssetPreview(visibleAssets[previewIndex + 1]!)
                : undefined
            }
            onPrevious={
              previewIndex > 0
                ? () => navigateAssetPreview(visibleAssets[previewIndex - 1]!)
                : undefined
            }
          />
        )}
      </section>
      <InspectorPanel
        aiContent={
          aiContent?.assetId === selectedAsset?.assetId ? aiContent : null
        }
        allAssetCount={allAssetCount}
        allTags={tags}
        assetMetadata={assetMetadata}
        automaticPaletteRatios={automaticPaletteRatios}
        closeLibrary={closeLibrary}
        displayedPalette={displayedPalette}
        editDescription={editDescription}
        editFavorite={editFavorite}
        editPalette={editPalette}
        editRating={editRating}
        editSourceUrl={editSourceUrl}
        folderCount={folders.length}
        handleFavoriteToggle={handleFavoriteToggle}
        handleMetadataDescriptionInput={handleMetadataDescriptionInput}
        handleMetadataDescriptionSave={handleMetadataDescriptionSave}
        handlePaletteSave={handlePaletteSave}
        handleRatingClick={handleRatingClick}
        handleSourceUrlInput={handleSourceUrlInput}
        handleSourceUrlSave={handleSourceUrlSave}
        library={library}
        loadMetadata={loadMetadata}
        onCreateAndAssignTag={handleCreateAndAssignTag}
        onAssignTagToAsset={(tagId) => { if (selectedAssetId) void assignAssetToTag(selectedAssetId, tagId); }}
        onRemoveTagFromAsset={(tagId) => void handleRemoveTagFromAsset(tagId)}
        selectedAsset={selectedAsset}
        setEditPalette={setEditPalette}
        versionConflict={versionConflict}
      />
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
        <LinkedRulesDialog
          name={linkedRulesEditor.name}
          initialRules={linkedRulesEditor.rules}
          onClose={() => setLinkedRulesEditor(null)}
          onSave={(finalRules) => void saveLinkedRules(finalRules)}
        />
      )}
      {convertLinkedDialog.folderId && (
        <ConvertLinkedDialog
          folderName={convertLinkedDialog.name}
          folders={folders}
          targetFolderId={convertLinkedDialog.targetFolderId}
          onCancel={() =>
            setConvertLinkedDialog({
              folderId: "",
              name: "",
              targetFolderId: "",
            })
          }
          onConfirm={() => void convertLinkedToManaged()}
          onTargetChange={(targetFolderId) =>
            setConvertLinkedDialog((current) => ({
              ...current,
              targetFolderId,
            }))
          }
        />
      )}
      {restoreDialog && (
        <RestoreDialog
          assetIds={restoreDialog.assetIds}
          folders={folders}
          target={restoreDialog.target}
          conflictStrategy={restoreDialog.conflictStrategy}
          onTargetChange={(target) =>
            setRestoreDialog((current) =>
              current ? { ...current, target } : current,
            )
          }
          onStrategyChange={(strategy) =>
            setRestoreDialog((current) =>
              current ? { ...current, conflictStrategy: strategy } : current,
            )
          }
          onConfirm={() => void restoreTrashedAssets()}
          onCancel={() => setRestoreDialog(null)}
        />
      )}
      {moveDialog && (
        <MoveDialog
          assetIds={moveDialog.assetIds}
          folders={folders}
          targetFolderId={moveDialog.targetFolderId}
          conflictStrategy={moveDialog.conflictStrategy}
          onTargetChange={(folderId) =>
            setMoveDialog((current) =>
              current ? { ...current, targetFolderId: folderId } : current,
            )
          }
          onStrategyChange={(strategy) =>
            setMoveDialog((current) =>
              current ? { ...current, conflictStrategy: strategy } : current,
            )
          }
          onConfirm={() => void moveManagedAssets()}
          onCancel={() => setMoveDialog(null)}
        />
      )}
      <UndoMoveDialog
        open={undoMoveDialog !== null}
        conflictStrategy={undoMoveDialog?.conflictStrategy ?? "keep-both"}
        onConflictStrategyChange={(strategy) =>
          setUndoMoveDialog((current) =>
            current ? { ...current, conflictStrategy: strategy } : current,
          )
        }
        onConfirm={() =>
          undoMoveDialog &&
          void undoManagedMove(
            undoMoveDialog.operationId,
            undoMoveDialog.conflictStrategy,
          )
        }
        onCancel={() => setUndoMoveDialog(null)}
      />
      <CollectionEditorDialog
        open={collectionEditor !== null}
        description={collectionEditor?.description ?? ""}
        coverAssetId={collectionEditor?.coverAssetId ?? ""}
        assetOptions={visibleAssets.map((asset) => ({
          assetId: asset.assetId,
          displayName: asset.displayName,
        }))}
        onDescriptionChange={(d) =>
          setCollectionEditor((current) =>
            current ? { ...current, description: d } : current,
          )
        }
        onCoverAssetChange={(id) =>
          setCollectionEditor((current) =>
            current ? { ...current, coverAssetId: id } : current,
          )
        }
        onSave={() => void saveCollectionDetails()}
        onCancel={() => setCollectionEditor(null)}
      />
      <RenameDialog
        open={renameTarget !== null}
        kind={renameTarget?.kind ?? "tag"}
        currentName={renameTarget?.name ?? ""}
        onNameChange={(name) =>
          setRenameTarget((current) =>
            current ? { ...current, name } : current,
          )
        }
        onSave={() => {
          if (!renameTarget) return;
          if (renameTarget.kind === "tag") void renameTag();
          else if (renameTarget.kind === "collection")
            void renameCollection();
          else {
            const target = renameTarget;
            setRenameTarget(null);
            void renameSmartCollection(target.id, target.name);
          }
        }}
        onCancel={() => setRenameTarget(null)}
      />
      <CreateDialog
        open={dialog !== null}
        kind={dialog === "library" ? "library" : "folder"}
        value={dialogValue}
        onValueChange={setDialogValue}
        onSubmit={() => {
          if (dialog === "library") {
            setDialog(null);
            void runLibraryOperation("create");
          } else void createFolder();
        }}
        onCancel={() => setDialog(null)}
        folderName={selectedFolder?.name}
      />
      {conflicts && (
        <ConflictsDialog
          conflicts={conflicts}
          duplicateDecision={duplicateDecision}
          nameDecision={nameDecision}
          onDuplicateDecisionChange={setDuplicateDecision}
          onNameDecisionChange={setNameDecision}
          onCancel={() => void abandonConflicts()}
          onConfirm={() => void resolveConflicts()}
        />
      )}
      {exportDialogOpen && (
        <ExportDialog
          open={exportDialogOpen}
          exporting={
            exportProgress !== null &&
            !["complete", "cancelled", "failed"].includes(exportProgress.phase)
          }
          onClose={() => setExportDialogOpen(false)}
          onExportFolder={(includeLinked) =>
            void exportLibrary("folder", includeLinked)
          }
          onExportZip={(includeLinked) =>
            void exportLibrary("zip", includeLinked)
          }
        />
      )}
      {importValidated && (
        <ImportDialog
          open
          validated={importValidated}
          importing={
            importProgress !== null &&
            !["complete", "cancelled", "failed"].includes(importProgress.phase)
          }
          onClose={() => setImportValidated(null)}
          onImportCopy={() => void completeImportCopy()}
          onImportOpenInPlace={() => void completeImportInPlace()}
          onImportZip={() => {
            setImportValidated(null);
            void startImportZip();
          }}
        />
      )}
      {permanentDeleteDialog && (
        <PermanentDeleteDialog
          assetCount={permanentDeleteDialog.length}
          onCancel={() => setPermanentDeleteDialog(null)}
          onConfirm={() => void deletePermanentFromTrash()}
        />
      )}
      {deleteLinkedDialog && (
        <DeleteLinkedDialog
          displayNames={deleteLinkedDialog.displayNames}
          deleteSourceFile={deleteLinkedDialog.deleteSourceFile}
          canDeleteSourceFile={deleteLinkedDialog.canDeleteSourceFile}
          onClose={() => setDeleteLinkedDialog(null)}
          onConfirm={() => void executeDeleteLinked()}
          onToggleDeleteSourceFile={(checked) =>
            setDeleteLinkedDialog((current) =>
              current ? { ...current, deleteSourceFile: checked } : current,
            )
          }
        />
      )}
      <RelinkPreview
        preview={batchRelinkPreview}
        keepMetadata={batchRelinkKeepMetadata}
        onKeepMetadataChange={setBatchRelinkKeepMetadata}
        onApply={() => void applyBatchRelink()}
        onCancel={() => void cancelBatchRelink()}
      />
      <ExtensionPairingDialog
        open={extensionPairingOpen}
        token={extensionPairingToken}
        error={extensionPairingError}
        onClose={() => {
          setExtensionPairingOpen(false);
          setExtensionPairingToken("");
          setExtensionPairingError(null);
        }}
        onRotate={() => void rotateExtensionPairing()}
        onCopy={() => void copyExtensionPairingToken()}
      />
      <AiConfigDialog
        open={aiConfigOpen}
        apiKey={aiApiKey}
        provider={aiProvider}
        model={aiModel}
        language={aiLanguage}
        hasKey={aiHasKey}
        descriptionEnabled={aiDescriptionEnabled}
        tagsEnabled={aiTagsEnabled}
        structuredEnabled={aiStructuredEnabled}
        disclaimerAccepted={aiDisclaimerAccepted}
        autoAnalyzeEnabled={aiAutoAnalyzeEnabled}
        onApiKeyChange={setAiApiKey}
        onProviderChange={setAiProvider}
        onModelChange={setAiModel}
        onLanguageChange={setAiLanguage}
        onDescriptionEnabledChange={setAiDescriptionEnabled}
        onTagsEnabledChange={setAiTagsEnabled}
        onStructuredEnabledChange={setAiStructuredEnabled}
        onDisclaimerAcceptedChange={setAiDisclaimerAccepted}
        onAutoAnalyzeEnabledChange={setAiAutoAnalyzeEnabled}
        onClose={() => {
          setAiConfigOpen(false);
          setAiApiKey("");
        }}
        onSave={() => void saveAiConfig()}
      />
      <MediaJobsDialog
        open={mediaJobsOpen && library !== null}
        mediaJobs={mediaJobs}
        mediaJobsLoading={mediaJobsLoading}
        aiJobs={aiJobs}
        onClose={() => setMediaJobsOpen(false)}
        onControlMediaJobs={(action, jobIds) => void controlMediaJobs(action, jobIds)}
        onControlAiJobs={(action, jobIds) => void controlAiJobs(action, jobIds)}
      />
      {/* Unified context menu */}
      <AssetContextMenu
        tags={tags}
        collections={collections}
        linkedFolders={linkedFolders}
        activeCollectionId={activeCollectionId}
        assets={visibleAssets}
        onRenameSmartCollection={(id, name) => setRenameTarget({ kind: "smart", id, name })}
        onUpdateSmartCollection={(id) => { void updateSmartCollectionQuery(id); }}
        onDeleteSmartCollection={(id) => { void deleteSmartCollection(id); }}
        onRenameOrganization={(kind, id, name) => setRenameTarget({ kind, id, name })}
        onEditCollectionDetails={(collectionId) => {
          const collection = collections.find((c) => c.collectionId === collectionId);
          if (collection)
            setCollectionEditor({
              collectionId: collection.collectionId,
              description: collection.description ?? "",
              coverAssetId: collection.coverAssetId ?? "",
            });
        }}
        onDeleteOrganization={(kind, id) => {
          if (kind === "tag") void deleteTag(id);
          else void deleteCollection(id);
        }}
        onBatchAssignTag={(tagId, assetIds) => {
          void batchAssignTagToSelection(tagId, assetIds);
        }}
        onBatchRemoveTag={(tagId, assetIds) => {
          void batchRemoveTagFromSelection(tagId, assetIds);
        }}
        onBatchAddToCollection={(collectionId, assetIds) => {
          void batchAddSelectionToCollection(collectionId, assetIds);
        }}
        onBatchRemoveFromCollection={(collectionId, assetIds) => {
          void batchRemoveSelectionFromCollection(collectionId, assetIds);
        }}
        onMoveToFolder={(assetIds) =>
          setMoveDialog({
            assetIds,
            targetFolderId: null,
            conflictStrategy: "keep-both",
          })
        }
        onTrash={(assetIds) => { void trashManagedAssets(assetIds); }}
        onRestore={(assetIds) =>
          setRestoreDialog({
            assetIds,
            target: "original",
            conflictStrategy: "keep-both",
          })
        }
        onPermanentDelete={(assetIds) => setPermanentDeleteDialog(assetIds)}
        onRelink={(assetId) => { void relinkMissingAsset(assetId); }}
        onDeleteLinked={(assetId, displayName, canDeleteSourceFile) =>
          setDeleteLinkedDialog({
            assetIds: [assetId],
            displayNames: displayName,
            deleteSourceFile: false,
            canDeleteSourceFile,
          })
        }
        onAnalyze={(assetId) => { void handleAnalyzeClick(assetId); }}
        canAnalyze={aiHasKey && !aiAnalyzing}
        onCopyToLinked={(folder, assetIds) => { void copyManagedSelectionToLinked(folder, assetIds); }}
        onClearSelection={clearAssetSelection}
        onOpenExternal={(assetId) => { void handleOpenExternal(assetId); }}
        onRemoveFromCurrentCollection={(assetId) => {
          if (activeCollectionId) void removeAssetFromCollection(assetId, activeCollectionId);
        }}
        onRemoveFromCollection={(assetId, collectionId) => { void removeAssetFromCollection(assetId, collectionId); }}
        onAssignTag={(assetId, tagId) => { void assignAssetToTag(assetId, tagId); }}
        onAddToCollection={(assetId, collectionId) => { void addAssetToCollection(assetId, collectionId); }}
      />
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
export function parseSearchExpression(
  value: string,
): Array<{ field: string | null; values: string[]; exclude: boolean }> {
  const allowedFields = new Set([
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
