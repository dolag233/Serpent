import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";

import { Icon, type IconName } from "./Icons";
import { IconActionButton } from "./icon-action-button";
import { iconActionAttrs } from "./icon-action-attrs";
import { EditTextContextMenuHost } from "./edit-text-context-menu";
import { HoverTipHost } from "./hover-tip";
import { shouldShowMissingAssetOverlay } from "./availability-affordance";
import {
  assetTypeBadgeLabel,
  fileExtensionLabel,
  shouldShowAssetCardBadges,
  shouldShowDurationBadge,
  shouldShowExtensionBadge,
  shouldShowTypeBadgeAlongsideExtension,
} from "./asset-card-badges";
import {
  resolveAssetSourceBadgeLabel,
  shouldShowAssetSourceBadge,
} from "./asset-source-badge";
import {
  coverSrc,
  isCardHoverPreviewable,
} from "./asset-card-hover-preview";
import { AssetCardMedia } from "./AssetCardMedia";
import { useAssetCardHoverPreview } from "./use-asset-card-hover-preview";
import { resolveSearchSnippetCaption } from "./search-snippet-caption";
import { ConvertLinkedDialog } from "./ConvertLinkedDialog";
import { LinkedRulesDialog } from "./LinkedRulesDialog";
import { PermanentDeleteDialog } from "./PermanentDeleteDialog";
import { DiskDeleteConfirmDialog } from "./DiskDeleteConfirmDialog";
import {
  isDiskDeletePromptEnabled,
  setDiskDeletePromptEnabled,
} from "./disk-delete-confirm-preferences";
import { DeleteLinkedDialog } from "./DeleteLinkedDialog";
import { useFolderDeleteActions } from "./use-folder-delete-actions";
import { ExportDialog } from "./ExportDialog";
import { ImportDialog } from "./ImportDialog";
import { ImportLibraryChooserDialog } from "./ImportLibraryChooserDialog";
import {
  NavigationSidebar,
} from "./NavigationSidebar";
import { LibrarySwitcher, buildRecentLibraryMenuEntries, type RecentLibraryMenuEntry } from "./LibrarySwitcher";
import { CanvasToolbarControls } from "./CanvasToolbarControls";
import { ScopeHistoryButtons } from "./ScopeHistoryButtons";
import {
  ScopeBreadcrumbs,
  buildScopeBreadcrumbSegments,
} from "./ScopeBreadcrumbs";
import { buildManagedFolderBreadcrumbTrail } from "./folder-breadcrumb-trail";
import { folderBrowseScope } from "./folder-browse-scope";
import {
  resolveBrowseCanvasBodyLayout,
  resolveFolderBrowseParentId,
} from "./folder-browse-canvas";
import { FolderCard } from "./FolderCard";
import {
  isFolderRecursiveEnabled,
  loadFolderRecursivePreferences,
  saveFolderRecursivePreferences,
  withFolderRecursiveEnabled,
} from "./folder-recursive-preferences";
import { useT, useLocale, translateForLocale, type AppLocale } from "./i18n";
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
import {
  AiConfigDialog,
  type AiConnectionState,
} from "./AiConfigDialog";
import {
  collectRecentAiFailureCodes,
  computeAiBatchProgress,
} from "./ai-analyze-progress";
import { summarizeAiFailureCodes } from "./ai-job-error-message";
import {
  DEFAULT_AI_ANALYSIS_SETTINGS,
  toWireAiAnalysisSettings,
  type AiAnalysisSettingsWire,
} from "../shared/ai-analysis-settings";
import { AppSettingsDialog } from "./AppSettingsDialog";
import { AppSettingsEntry } from "./AppSettingsEntry";
import {
  loadAiUiPreferences,
  saveAiUiPreferences,
  type AiUiPreferences,
} from "./ai-ui-preferences";
import {
  SmartCollectionSettingsDialog,
  type SmartCollectionSettingsTarget,
} from "./SmartCollectionSettingsDialog";
import { MediaJobsDialog } from "./MediaJobsDialog";
import { AiConnectionFailureDialog } from "./AiConnectionFailureDialog";
import { useAiConnectionFailure } from "./use-ai-connection-failure";

import {
  ContextMenuProvider,
  useContextMenu,
} from "./context-menu";
import { useAssetSelection } from "./useAssetSelection";
import { resolveInspectorTagTarget } from "./inspector-tag-target";
import {
  buildInspectorMultiEdit,
  toMultiEditSlice,
  type InspectorMultiEditModel,
} from "./inspector-multi-edit";
import { useBatchActions } from "./useBatchActions";
import { useShellFileActions } from "./use-shell-file-actions";
import { useAssetDragDropHandlers } from "./use-asset-drag-drop-handlers";
import { useDialogEscapeDismiss } from "./use-dialog-escape-dismiss";
import { useExternalImportHandlers } from "./use-external-import-handlers";
import { importSummaryMessage } from "./import-summary";
import type { DialogEscapeSnapshot } from "./dialog-escape-stack";
import { useAssetRename } from "./useAssetRename";
import { useInlineFolderEdit } from "./use-inline-folder-edit";
import { useInlineSmartCollectionEdit } from "./use-inline-smart-collection-edit";
import { usePanelResize } from "./use-panel-resize";
import { useToastNotifications } from "./useToastNotifications";
import {
  MANAGED_ASSETS_DRAG_TYPE,
  resolveDragDropMode,
  resolveDraggedAssetIds,
} from "./asset-drag-drop";
import {
  ASSET_DRAG_PREVIEW_HEIGHT,
  ASSET_DRAG_PREVIEW_WIDTH,
  dismissAssetDragPreview,
  setAssetDragPreviewCopyMode,
  showAssetDragPreview,
} from "./asset-drag-preview";
import { DimensionFilterBar } from "./DimensionFilterBar";
import {
  buildActiveFilterChips,
  type ClearableFilterId,
} from "./active-discovery-filters";
import { resolveBrowseEmptyState, resolveImportMenuCopy } from "./browse-empty-state";
import { trashedFromLabel } from "./trashed-from-label";
import { toMessage, LibraryOperationError } from "./error-utils";

import type {
  AiSearchPlan,
  AssetSummary,
  AssetMetadataResult,
  CollectionSummary,
  FilterClause,
  FolderBrowseEntry,
  LinkedFolderRule,
  LinkedFolderSummary,
  ManagedFolderSummary,
  SearchScope,
  SmartCollectionSummary,
  SortDefinition,
  TagSummary,
} from "../shared/asset-types";
import { hasMeaningfulSmartCollectionCondition } from "../shared/smart-collection-query";
import type {
  SerpentLibraryApi,
  LibraryApiResult,
  RelinkBatchPreviewResult,
  ImportValidatedResult,
  MediaJobStatus,
  AiJobStatus,
} from "../shared/library-api";
import type { SerpentExtensionPairingApi } from "../shared/extension-pairing";
import {
  toOpenableExternalUrl,
  type SerpentShellApi,
} from "../shared/external-url";
import type {
  ImportConflictPlan,
  RendererLibrarySummary,
  ExportProgressEvent,
  ImportProgressEvent,
} from "../shared/protocol/responses";
import { AssetPreviewModal } from "./AssetPreviewModal";
import { WindowsWindowControls } from "./WindowsWindowControls";
import { useViewerChromeIdle } from "./use-viewer-chrome-idle";
import { useDialogFocusTrap } from "./use-dialog-focus-trap";
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
import { JustifiedAssetRows } from "./justified-asset-rows";
import { resolveJustifiedCaptionBandPx } from "./justified-caption-band";
import {
  captureAnchor,
  clampScrollOffset,
  computeAnchorScrollDelta,
  pickNearestCard,
  type AnchorCard,
  type CanvasAnchor,
} from "./canvas-scroll-anchor";
import {
  captureBrowseViewSnapshot,
  resolveBrowseRestoreScroll,
  type BrowseViewSnapshot,
} from "./view-restore";
import { createCommandRegistry } from "./commands/command-registry";
import { assetCommandDefinitions } from "./commands/asset-commands";
import {
  isMacPlatform,
  matchesShortcut,
  type CommandPlatform,
  type ShortcutSpec,
} from "./commands/command-types";
import { resolveRendererPlatform } from "./renderer-platform";
import { formatBatchRatingNotice } from "./batch-tag-notice";
import {
  defaultKeyboardCardSize,
  matchGlobalZoomShortcut,
  nextKeyboardCardSize,
  shouldIgnoreGlobalZoomShortcut,
} from "./global-zoom-shortcuts";

const IS_MAC_PLATFORM = isMacPlatform(navigator.userAgent);
const IS_WINDOWS_PLATFORM =
  resolveRendererPlatform(navigator.userAgent) === "windows";

// 键盘快捷键与菜单标签共用注册表中的同一份 ShortcutSpec（REQ-COMMAND-002）：
// 按键定义改在命令定义里，此处只按命令 id 查表匹配，不再维护第二份映射。
const SHORTCUT_PLATFORM: CommandPlatform = IS_MAC_PLATFORM ? "mac" : "windows";
const assetKeyboardCommandRegistry = createCommandRegistry(
  assetCommandDefinitions,
);
const matchAssetCommandShortcut = (
  commandId: string,
  event: KeyboardEvent,
): boolean => {
  const spec: ShortcutSpec | undefined =
    assetKeyboardCommandRegistry.get(commandId)?.shortcut;
  return (
    spec !== undefined && matchesShortcut(spec, event, SHORTCUT_PLATFORM)
  );
};

type RendererWindow = Window & {
  serpent?: {
    library?: SerpentLibraryApi;
    extensionPairing?: SerpentExtensionPairingApi;
    shell?: SerpentShellApi;
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
// REQ-FOLDER-007 removed the "folder" kind: folder create/rename now happens
// inline in the directory tree (use-inline-folder-edit), not in a dialog.
type DialogKind = "library" | "tag" | "collection" | null;
type AssetScope = "all" | "root" | string;
type OrganizationKind = "collection" | "smart";
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
      aria-pressed={pressed}
      className="tool-button"
      disabled={disabled}
      onClick={onClick}
      type="button"
      {...iconActionAttrs(label)}
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

/**
 * REQ-CANVAS-019: waits two frames for a card-size/width-driven reflow to
 * settle, then nudges scroll by the delta needed to keep `anchor` at the
 * same on-screen point it occupied before the reflow. Two frames (not one)
 * because the browser may re-clamp scroll against the new content size
 * before React finishes committing the new layout; the extra frame lets
 * that settle before we measure the anchor card's rect. Bails out if the
 * scroll position was already touched by something else in the meantime
 * (user drag, another scrollTo) so this never fights a newer scroll intent.
 */
function scheduleAnchorRestore(
  canvas: HTMLElement,
  anchor: CanvasAnchor | null,
  measuredScrollLeft: number,
  measuredScrollTop: number,
  frameRef: { current: number | null },
): void {
  if (frameRef.current !== null) {
    window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }
  if (!anchor) return;
  frameRef.current = window.requestAnimationFrame(() => {
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const clampedTop = clampScrollOffset(
        measuredScrollTop,
        canvas.scrollHeight,
        canvas.clientHeight,
      );
      const clampedLeft = clampScrollOffset(
        measuredScrollLeft,
        canvas.scrollWidth,
        canvas.clientWidth,
      );
      if (canvas.scrollTop !== clampedTop || canvas.scrollLeft !== clampedLeft) {
        return;
      }
      const restored = Array.from(
        canvas.querySelectorAll<HTMLElement>("[data-asset-id]"),
      ).find((card) => card.dataset.assetId === anchor.assetId);
      if (!restored) return;
      const rect = restored.getBoundingClientRect();
      const delta = computeAnchorScrollDelta(anchor, rect);
      canvas.scrollLeft += delta.deltaX;
      canvas.scrollTop += delta.deltaY;
    });
  });
}

function AppInner() {
  const t = useT();
  const { locale } = useLocale();
  const api = (window as RendererWindow).serpent?.library;
  const extensionPairingApi = (window as RendererWindow).serpent
    ?.extensionPairing;
  const shellApi = (window as RendererWindow).serpent?.shell;

  useEffect(() => {
    document.body.classList.toggle("platform-darwin", IS_MAC_PLATFORM);
  }, []);

  // Keep AI readiness (hasKey) in sync without requiring the settings dialog.
  useEffect(() => {
    if (!api) return;
    void loadAiConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per api identity
  }, [api]);
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
  // REQ-FOLDER-001/002/003/010: direct child folder cards shown above assets
  // when the current browse parent is a managed folder or the managed root.
  const [folderBrowseEntries, setFolderBrowseEntries] = useState<FolderBrowseEntry[]>([]);
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);
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
  // Toast notifications (REQ-SHELL-010): the controller owns auto-dismiss
  // timing and the closing lifecycle; setError/setNotice keep the old setter
  // shape so call sites are unchanged.
  const {
    rendered: renderedToast,
    closing: toastClosing,
    setError,
    setNotice,
    handleToastTransitionEnd,
  } = useToastNotifications();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [dialogValue, setDialogValue] = useState(() => t("shell.myLibrary"));
  const [conflicts, setConflicts] = useState<ImportConflictPlan | null>(null);
  const [duplicateDecision, setDuplicateDecision] = useState<
    "skip" | "merge" | "create-copy"
  >("skip");
  const [nameDecision, setNameDecision] = useState<
    "keep-both" | "replace" | "skip"
  >("keep-both");
  const [leftOpen, setLeftOpen] = useState(() => window.innerWidth > 800);
  const [rightOpen, setRightOpen] = useState(() => window.innerWidth > 1020);
  // REQ-SHELL-007 / REQ-SHELL-011: draggable nav/inspector pane widths + auto-hide.
  const {
    navPanelWidth,
    inspectorPanelWidth,
    resizing: panelResizing,
    shellStyle: panelResizeShellStyle,
    beginResize: beginPanelResize,
    beginEdgeRestore: beginPanelEdgeRestore,
    resetPanel: resetPanelWidth,
  } = usePanelResize({
    onAutoHide: (panel) => {
      if (panel === "nav") setLeftOpen(false);
      else setRightOpen(false);
    },
    onEdgeRestore: (panel) => {
      if (panel === "nav") setLeftOpen(true);
      else setRightOpen(true);
    },
  });
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
  // REQ-FOLDER-009: folder browse/search recurse only when explicitly enabled.
  const [folderRecursive, setFolderRecursive] = useState(false);
  const folderRecursiveRef = useRef(folderRecursive);
  const [folderRecursivePrefs, setFolderRecursivePrefs] = useState(() =>
    loadFolderRecursivePreferences(),
  );
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
  const [colorFilter, setColorFilter] = useState("");
  const [excludeColorFilter, setExcludeColorFilter] = useState(false);
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
  /** Shape/aspect preset OR ranges (Serpent-gp4). */
  const [aspectRatioRanges, setAspectRatioRanges] = useState<
    Array<{ min: string; max: string }>
  >([]);
  // REQ-FILTER-010: resolution buckets filter on the longer edge (long_edge).
  const [longEdgeRange, setLongEdgeRange] = useState({
    min: "",
    max: "",
    exclude: false,
  });
  const [durationRange, setDurationRange] = useState({
    min: "",
    max: "",
    exclude: false,
  });
  const [sortField, setSortField] = useState<SortDefinition["field"]>("name");
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
  const { open: openContextMenu, close: closeContextMenu } =
    useContextMenu();
  const hadDiscoveryInput = useRef(false);
  const reloadCurrentContentRef = useRef<() => Promise<void>>(
    async () => undefined,
  );
  const loadAiContentForAssetRef = useRef<(assetId: string) => Promise<void>>(
    async () => undefined,
  );
  const refreshAfterAiRef = useRef<(assetId: string) => Promise<void>>(
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
  const [editAuthor, setEditAuthor] = useState("");
  // REQ-SELECT-004: UE-style multi-select Inspector model (null when <2 selected).
  const [multiEdit, setMultiEdit] = useState<InspectorMultiEditModel | null>(null);
  const selectedAssetIdsRef = useRef(selectedAssetIds);
  useEffect(() => {
    selectedAssetIdsRef.current = selectedAssetIds;
  }, [selectedAssetIds]);

  // Inline collection editors
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
  /** Serpent-9i8: pending irreversible library root deletion. */
  const [libraryDiskDeletePending, setLibraryDiskDeletePending] = useState(false);
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

  // REQ-PREF-001: browse-area general settings panel (theme/language/canvas).
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [smartCollectionSettings, setSmartCollectionSettings] =
    useState<SmartCollectionSettingsTarget | null>(null);

  // AI analysis state
  const [aiConfigOpen, setAiConfigOpen] = useState(false);
  const [aiApiFormat, setAiApiFormat] = useState<
    "openai_chat" | "openai_responses" | "anthropic" | "gemini_native"
  >("openai_chat");
  const [aiModel, setAiModel] = useState("gpt-4o-mini");
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiHasKey, setAiHasKey] = useState(false);
  const [aiDescriptionEnabled, setAiDescriptionEnabled] = useState(true);
  const [aiTagsEnabled, setAiTagsEnabled] = useState(true);
  const [aiRatingEnabled, setAiRatingEnabled] = useState(true);
  const [aiForceExistingTags, setAiForceExistingTags] = useState(false);
  const [aiAnalysisSettings, setAiAnalysisSettings] =
    useState<AiAnalysisSettingsWire>(() =>
      toWireAiAnalysisSettings(DEFAULT_AI_ANALYSIS_SETTINGS),
    );
  const [aiLanguages, setAiLanguages] = useState<
    Array<"zh-CN" | "en" | "ja" | "ko">
  >(["zh-CN"]);
  const [aiAutoAnalyzeEnabled, setAiAutoAnalyzeEnabled] = useState(false);
  const [aiDisclaimerAccepted, setAiDisclaimerAccepted] = useState(false);
  const [aiConnectionState, setAiConnectionState] =
    useState<AiConnectionState>("idle");
  const [aiConnectionReason, setAiConnectionReason] = useState<
    string | undefined
  >(undefined);
  const [aiSaveVerifying, setAiSaveVerifying] = useState(false);
  const aiAutoConnectAttemptedRef = useRef(false);
  /** Fingerprint of credentials last proven by a successful probe. */
  const aiVerifiedFingerprintRef = useRef<string | null>(null);
  const [extensionPairingOpen, setExtensionPairingOpen] = useState(false);
  const [extensionPairingToken, setExtensionPairingToken] = useState("");
  const [extensionPairingError, setExtensionPairingError] = useState<
    string | null
  >(null);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const aiAnalyzingRef = useRef(false);
  const [aiContent, setAiContent] = useState<{
    assetId: string;
    description?: string;
    tags?: string[];
    rating?: number;
    modelVersion?: string;
  } | null>(null);
  const aiContentRef = useRef(aiContent);
  aiContentRef.current = aiContent;
  /** Description editor is showing AI-layer text (human description empty). */
  const [descriptionIsAi, setDescriptionIsAi] = useState(false);
  const analyzeFailedBaselineRef = useRef(0);
  const analyzeSucceededBaselineRef = useRef(0);
  const analyzingAssetIdRef = useRef<string | null>(null);
  const analyzingBatchSizeRef = useRef(0);
  const [aiUiPrefs, setAiUiPrefs] = useState<AiUiPreferences>(() =>
    loadAiUiPreferences(),
  );
  const [importValidated, setImportValidated] =
    useState<ImportValidatedResult | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [importLibraryChooserOpen, setImportLibraryChooserOpen] =
    useState(false);

  // Thumbnail / Preview state
  const [previewAsset, setPreviewAsset] = useState<AssetSummary | null>(null);
  // REQ-CANVAS-019: read synchronously inside the canvas ResizeObserver
  // callback (which is created once and does not close over fresh state)
  // to skip the reflow-anchor logic while the viewer hides the canvas.
  const previewAssetRef = useRef<AssetSummary | null>(null);
  useLayoutEffect(() => {
    previewAssetRef.current = previewAsset;
  }, [previewAsset]);
  // Serpent-ayf: owned here (not inside AssetPreviewModal, which remounts
  // per-asset via `key`) so switching assets never resets idle-faded chrome
  // back to visible. `wakeViewerChrome` is called only when the viewer first
  // opens; left/right navigation never calls it.
  const {
    idle: viewerChromeIdle,
    onActivity: onViewerChromeActivity,
    wake: wakeViewerChrome,
  } = useViewerChromeIdle();
  const [canvasPrefs, setCanvasPrefs] = useState<CanvasPreferences>(() =>
    loadCanvasPreferences(),
  );
  const assetViewMode = canvasPrefs.viewMode;
  const assetCardSize = canvasPrefs.cardSize;
  const [loadingMoreAssets, setLoadingMoreAssets] = useState(false);
  const workspaceCanvasRef = useRef<HTMLDivElement>(null);
  // REQ-CANVAS-019: rAF handle for the card-size-slider anchor restore.
  const cardSizeRestoreFrameRef = useRef<number | null>(null);
  // REQ-CANVAS-019: rAF handle for the container-width (sidebar/window
  // resize) anchor restore; separate from the card-size one above so the
  // two triggers never cancel each other's in-flight restoration.
  const reflowRestoreFrameRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (cardSizeRestoreFrameRef.current !== null) {
        window.cancelAnimationFrame(cardSizeRestoreFrameRef.current);
      }
      if (reflowRestoreFrameRef.current !== null) {
        window.cancelAnimationFrame(reflowRestoreFrameRef.current);
      }
    },
    [],
  );
  // 筛选与排序面板：外点 / Esc 自动关闭（现代浮层语义），summary 切换不变。
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreAssetsRef = useRef<() => Promise<void>>(async () => undefined);
  const pendingRestoredFocusRef = useRef<string | null>(null);
  const previewFocusReturnRef = useRef<string | null>(null);
  // REQ-VIEW-008: snapshot of the browse scroll position + the previewed
  // card's on-screen anchor, captured when the viewer opens so the close
  // path can correct for any reflow that happened while viewing (e.g. the
  // inspector panel toggled and changed the grid's available width).
  const previewScrollSnapshotRef = useRef<BrowseViewSnapshot | null>(null);
  const closingPreviewRef = useRef<string | null>(null);
  const previewRestoreFrameRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (previewRestoreFrameRef.current !== null) {
        window.cancelAnimationFrame(previewRestoreFrameRef.current);
      }
    },
    [],
  );
  // REQ-DND-003: the custom drag ghost node mounted by showAssetDragPreview,
  // kept so onDragEnd can remove it from the document.
  const dragPreviewRef = useRef<HTMLElement | null>(null);
  const [thumbnailFailures, setThumbnailFailures] = useState<
    Map<string, string>
  >(new Map());
  const [mediaJobsOpen, setMediaJobsOpen] = useState(false);
  const [mediaJobs, setMediaJobs] = useState<MediaJobStatus | null>(null);
  const [aiJobs, setAiJobs] = useState<AiJobStatus | null>(null);
  const [mediaJobsLoading, setMediaJobsLoading] = useState(false);
  const controlAiJobsRef = useRef<
    (action: "pause" | "resume" | "cancel" | "retry", jobIds?: string[]) => Promise<void>
  >(async () => undefined);
  const {
    gate: aiConnectionFailureGate,
    notifyBatchStarted: notifyAiConnectionBatchStarted,
    onRetry: onAiConnectionFailureRetry,
    onAbort: onAiConnectionFailureAbort,
  } = useAiConnectionFailure({
    api: api ?? null,
    libraryId: library?.libraryId,
    failedCount: aiJobs?.failed ?? 0,
    queuedCount: aiJobs?.queued ?? 0,
    runningCount: aiJobs?.running ?? 0,
    aiAnalyzing,
    controlAiJobs: useCallback(
      async (action, jobIds) => {
        await controlAiJobsRef.current(action, jobIds);
      },
      [],
    ),
  });
  const handleAiConnectionFailureRetry = useCallback(() => {
    // Re-arm batch progress / completion toast for the retry wave.
    flushSync(() => {
      aiAnalyzingRef.current = true;
      setAiAnalyzing(true);
    });
    onAiConnectionFailureRetry();
  }, [onAiConnectionFailureRetry]);


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

  // CU-U1: origin chip context for recursive folder / mixed-folder surfaces.
  const sourceBadgeContext = useMemo(() => {
    const mixedFolderBrowse =
      Boolean(searchValue.trim()) ||
      Boolean(activeTagId) ||
      Boolean(activeCollectionId) ||
      Boolean(activeSmartCollectionId);
    return {
      assetScope,
      mixedFolderBrowse,
    };
  }, [
    assetScope,
    searchValue,
    activeTagId,
    activeCollectionId,
    activeSmartCollectionId,
  ]);

  const organizationBrowseScope = activeSmartCollectionId
    ? ("smart-collection" as const)
    : activeCollectionId
      ? ("collection" as const)
      : ("folder" as const);
  const importMenuCopy = resolveImportMenuCopy(organizationBrowseScope);

  const browseEmptyState = useMemo(() => {
    const discoverySnapshot = {
      colorFilter,
      excludeColorFilter,
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
      aspectRatioRanges,
      longEdgeRange,
      durationRange,
    };
    const hasActiveDiscovery =
      searchValue.trim() !== "" ||
      buildActiveFilterChips(discoverySnapshot).length > 0;
    return resolveBrowseEmptyState({
      showTrash,
      hasActiveDiscovery,
      hasSelectedFolder: Boolean(selectedFolder),
      organizationScope: organizationBrowseScope,
    });
  }, [
    showTrash,
    searchValue,
    selectedFolder,
    organizationBrowseScope,
    colorFilter,
    excludeColorFilter,
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
    aspectRatioRanges,
    longEdgeRange,
    durationRange,
  ]);

  // CANVAS-022: folders-only (recursive off, zero direct assets) must not
  // mount an empty asset grid — its min-height:100% left a large void.
  const browseCanvasBodyLayout = resolveBrowseCanvasBodyLayout(
    visibleAssets.length,
    folderBrowseEntries.length,
  );

  const visibleAssetById = useMemo(() => {
    const map = new Map<string, (typeof visibleAssets)[number]>();
    for (const asset of visibleAssets) {
      map.set(asset.assetId, asset);
    }
    return map;
  }, [visibleAssets]);

  const isHoverPreviewable = useCallback(
    (assetId: string) => {
      const asset = visibleAssetById.get(assetId);
      return asset ? isCardHoverPreviewable(asset) : false;
    },
    [visibleAssetById],
  );

  const {
    setHoveredAssetId,
    clearHoveredAssetId,
    activePreviewAssetId,
    activeResolution,
  } = useAssetCardHoverPreview({
    api,
    libraryId: library?.libraryId,
    primarySelectedAssetId: selectedAssetId,
    isPreviewable: isHoverPreviewable,
  });

  // REQ-FOLDER-010: folder-card ids visible in the current browse view, used
  // for marquee/Shift-range selection; empty whenever folderBrowseEntries is
  // empty (trash/collection/smart/search/linked-only scopes, per
  // resolveFolderBrowseParentId).
  const visibleFolderIds = useMemo(
    () => folderBrowseEntries.map((entry) => entry.folderId),
    [folderBrowseEntries],
  );
  const {
    handleCanvasMouseDown,
    clearAssetSelection,
    selectionAnchorRef,
    handleCardClick,
    handleFolderCardClick,
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
    folderIds: visibleFolderIds,
    selectedFolderIds,
    setSelectedFolderIds,
  });
  const selectedFolderIdSet = useMemo(
    () => new Set(selectedFolderIds),
    [selectedFolderIds],
  );

  // REQ-FOLDER-001/002/003/010: load direct child folder cards whenever the
  // browse parent is a managed folder or the managed root; cleared for
  // trash/tag/collection/smart-collection/search/linked-only views.
  useEffect(() => {
    let cancelled = false;
    async function loadFolderBrowseEntries() {
      const parentFolderId =
        api && library
          ? resolveFolderBrowseParentId({
              assetScope,
              showTrash,
              activeTagId,
              activeCollectionId,
              activeSmartCollectionId,
              folders,
              searchActive:
                Boolean(searchValue.trim()) || activeAiSearchDefinition !== null,
            })
          : undefined;
      if (!api || !library || parentFolderId === undefined) {
        if (!cancelled) setFolderBrowseEntries([]);
        return;
      }
      const result = await api.listFolderBrowseEntries({
        libraryId: library.libraryId,
        parentFolderId,
      });
      if (!cancelled && result.ok) setFolderBrowseEntries(result.value);
    }
    void loadFolderBrowseEntries();
    return () => {
      cancelled = true;
    };
  }, [
    api,
    library,
    assetScope,
    showTrash,
    activeTagId,
    activeCollectionId,
    activeSmartCollectionId,
    folders,
    searchValue,
    activeAiSearchDefinition,
  ]);

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
      const cardEls = Array.from(
        root.querySelectorAll<HTMLElement>("[data-asset-id]"),
      );
      const cards: AnchorCard[] = cardEls.map((el) => {
        const rect = el.getBoundingClientRect();
        return { assetId: el.dataset.assetId!, ...rect };
      });
      const pointed = document
        .elementFromPoint(anchorX, anchorY)
        ?.closest<HTMLElement>("[data-asset-id]");
      const pointedInRoot = pointed && root.contains(pointed) ? pointed : null;
      const anchorCard = pointedInRoot
        ? cards.find((card) => card.assetId === pointedInRoot.dataset.assetId) ?? null
        : pickNearestCard(cards, rootRect, anchorX, anchorY);
      const anchorState = anchorCard
        ? captureAnchor(anchorCard, anchorX, anchorY)
        : null;

      setCanvasPrefs((p) => ({ ...p, cardSize: nextSize }));
      // 测量时刻的滚动位置：两帧后的锚点补偿只能覆盖「浏览器钳制」这一种
      // 位移。若期间出现其它滚动意图（用户拖滚动条、脚本 scrollTo），补偿
      // 必须作废，否则会把更新的滚动位置强行拉回到旧锚点。
      scheduleAnchorRestore(
        root,
        anchorState,
        root.scrollLeft,
        root.scrollTop,
        cardSizeRestoreFrameRef,
      );
    },
    [assetCardSize],
  );

  // REQ-CANVAS-019: dragging the sidebar or resizing the window changes the
  // canvas's available width, which the grid/masonry/justified layouts react
  // to by reflowing (different column/row placement). Left unhandled, that
  // reflow leaves the raw scroll offset pointing at a different area of the
  // grid. Watch the canvas's own box size (not the preview toggle, which
  // also changes it via `.is-viewing { display: none }`) and re-anchor scroll
  // the same way the card-size slider does.
  useEffect(() => {
    const canvas = workspaceCanvasRef.current;
    if (!canvas) return;
    let lastWidth: number | null = null;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? canvas.clientWidth;
      // `display:none` while viewing reports width 0; ignore both that
      // transition and the transition back (view-restore.ts owns scroll
      // restoration for the viewer close path) by requiring a genuine
      // non-zero-to-non-zero change.
      if (width <= 0) {
        lastWidth = null;
        return;
      }
      if (lastWidth === null) {
        lastWidth = width;
        return;
      }
      if (width === lastWidth || previewAssetRef.current) {
        lastWidth = width;
        return;
      }
      lastWidth = width;

      const rootRect = canvas.getBoundingClientRect();
      const anchorX = rootRect.left + rootRect.width / 2;
      const anchorY = rootRect.top + rootRect.height / 2;
      const cards: AnchorCard[] = Array.from(
        canvas.querySelectorAll<HTMLElement>("[data-asset-id]"),
      ).map((el) => ({ assetId: el.dataset.assetId!, ...el.getBoundingClientRect() }));
      const anchorCard = pickNearestCard(cards, rootRect, anchorX, anchorY);
      const anchorState = anchorCard
        ? captureAnchor(anchorCard, anchorX, anchorY)
        : null;
      scheduleAnchorRestore(
        canvas,
        anchorState,
        canvas.scrollLeft,
        canvas.scrollTop,
        reflowRestoreFrameRef,
      );
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    saveCanvasPreferences(canvasPrefs);
  }, [canvasPrefs]);
  useEffect(() => {
    saveAiUiPreferences(aiUiPrefs);
  }, [aiUiPrefs]);

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
      // Browse card zoom: keep the asset under the viewport center stable
      // (Serpent-f0oo). Pointer-relative anchoring jumps the grid when the
      // cursor is far from center during continuous Ctrl+wheel.
      const rect = canvas.getBoundingClientRect();
      resizeAssetCards(
        assetCardSize * Math.exp(-delta * 0.002),
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [assetCardSize, previewAsset, resizeAssetCards]);

  // Browse canvas Cmd/Ctrl+=|-|0 — same step as Ctrl+wheel; 0 = default size
  // (Serpent-46i9). Viewer owns the chord while preview is open.
  useEffect(() => {
    if (previewAsset) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreGlobalZoomShortcut(event.target)) return;
      const action = matchGlobalZoomShortcut(event, SHORTCUT_PLATFORM);
      if (!action) return;
      event.preventDefault();
      const canvas = workspaceCanvasRef.current;
      const rect = canvas?.getBoundingClientRect();
      const centerX = rect
        ? rect.left + rect.width / 2
        : undefined;
      const centerY = rect
        ? rect.top + rect.height / 2
        : undefined;
      if (action === "reset") {
        resizeAssetCards(defaultKeyboardCardSize(), centerX, centerY);
        return;
      }
      resizeAssetCards(
        nextKeyboardCardSize(assetCardSize, action),
        centerX,
        centerY,
      );
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [assetCardSize, previewAsset, resizeAssetCards]);

  const openAssetPreview = useCallback((asset: AssetSummary) => {
    if (asset.availability !== "available" || asset.deletedAt) return;
    // Serpent-ayf: entering the viewer always shows chrome, regardless of
    // whatever idle state accumulated while browsing; only opening (not
    // navigateAssetPreview) wakes it.
    wakeViewerChrome();
    if (previewRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(previewRestoreFrameRef.current);
      previewRestoreFrameRef.current = null;
    }
    previewFocusReturnRef.current = asset.assetId;
    const canvas = workspaceCanvasRef.current;
    if (canvas) {
      const card = Array.from(
        canvas.querySelectorAll<HTMLElement>("[data-asset-id]"),
      ).find((el) => el.dataset.assetId === asset.assetId);
      previewScrollSnapshotRef.current = captureBrowseViewSnapshot(
        asset.assetId,
        card?.getBoundingClientRect() ?? null,
        canvas.scrollLeft,
        canvas.scrollTop,
      );
    } else {
      previewScrollSnapshotRef.current = null;
    }
    setSelectedAssetIds([asset.assetId]);
    setSelectedAssetId(asset.assetId);
    selectionAnchorRef.current = asset.assetId;
    setPreviewAsset(asset);
  }, [selectionAnchorRef, wakeViewerChrome]);

  const navigateAssetPreview = useCallback((asset: AssetSummary) => {
    setSelectedAssetIds([asset.assetId]);
    setSelectedAssetId(asset.assetId);
    selectionAnchorRef.current = asset.assetId;
    previewFocusReturnRef.current = asset.assetId;
    setPreviewAsset(asset);
  }, [selectionAnchorRef]);

  const closeAssetPreview = useCallback(async (restoreBrowsePosition = true) => {
    // A scope transition can arrive after React has already cleared
    // `previewAsset` but before the two-frame browse restoration runs. Cancel
    // that stale restoration even when there is no longer an asset to close,
    // otherwise the previous scope can scroll/focus the newly selected scope.
    if (!restoreBrowsePosition && previewRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(previewRestoreFrameRef.current);
      previewRestoreFrameRef.current = null;
    }
    const closingAsset = previewAsset;
    if (!closingAsset) return;
    if (closingPreviewRef.current === closingAsset.assetId) return;
    closingPreviewRef.current = closingAsset.assetId;
    setPreviewAsset(null);
    const assetId = previewFocusReturnRef.current;
    const scrollSnapshot = previewScrollSnapshotRef.current;
    previewFocusReturnRef.current = null;
    previewScrollSnapshotRef.current = null;
    if (previewRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(previewRestoreFrameRef.current);
      previewRestoreFrameRef.current = null;
    }
    if (restoreBrowsePosition) previewRestoreFrameRef.current = window.requestAnimationFrame(() => {
      // React must first commit removal of `.is-viewing` (display:none). A
      // second frame restores scroll against the visible canvas; restoring in
      // the first frame is discarded by layout and jumps back to the top.
      previewRestoreFrameRef.current = window.requestAnimationFrame(() => {
        const canvas = workspaceCanvasRef.current;
        if (canvas && scrollSnapshot) {
          // REQ-VIEW-008: the grid may have reflowed while the viewer was
          // open (e.g. inspector panel width changed). Land on the raw
          // captured position first, measure where the previewed card
          // actually ended up, then correct the delta so it returns to the
          // exact spot it occupied before entering the viewer.
          canvas.scrollTo({ left: scrollSnapshot.scrollLeft, top: scrollSnapshot.scrollTop });
          const restoredCard = scrollSnapshot.anchor
            ? Array.from(
                canvas.querySelectorAll<HTMLElement>("[data-asset-id]"),
              ).find((el) => el.dataset.assetId === scrollSnapshot.anchor!.assetId)
            : null;
          const target = resolveBrowseRestoreScroll(
            scrollSnapshot,
            restoredCard?.getBoundingClientRect() ?? null,
            {
              scrollWidth: canvas.scrollWidth,
              scrollHeight: canvas.scrollHeight,
              clientWidth: canvas.clientWidth,
              clientHeight: canvas.clientHeight,
            },
          );
          canvas.scrollTo({ left: target.left, top: target.top });
        }
        canvas
          ?.querySelector<HTMLElement>(`[data-asset-id="${assetId ?? ""}"]`)
          ?.focus({ preventScroll: true });
        previewRestoreFrameRef.current = null;
      });
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
          : folderBrowseScope(scope, folderRecursiveRef.current));
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
        trashMode || scope !== "all"
          ? api.searchAssets({ ...libId, query: null, limit: 1, offset: 0 })
          : Promise.resolve(undefined),
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
      // CU-B2: keep library-wide count fresh even while browsing trash.
      setAllAssetCount(allResult?.value.total ?? assetResult.value.total);
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
      setError(t("toast.bridgeUnavailable"));
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
              const enabled = isFolderRecursiveEnabled(
                loadFolderRecursivePreferences(),
                activeLibrary.libraryId,
                session.scope.id,
              );
              folderRecursiveRef.current = enabled;
              setFolderRecursive(enabled);
              restoredItems =
                (await loadContent(activeLibrary, session.scope.id)) ?? [];
              searchScope = {
                kind: "folder",
                folderId: session.scope.id,
                recursive: enabled,
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
      setError(toMessage(caught, t("toast.workspaceRestoreFailed"), locale));
      setUiState(activeLibrary ? "ready" : "idle");
    }
  }, [api, loadContent, locale, selectionAnchorRef, setError, t]);
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
    if (!api) return;
    return api.onThumbnailEvent((event) => {
      if (event.libraryId !== library?.libraryId) return;
      setThumbnailFailures((current) => {
        const next = new Map(current);
        if (event.type === "asset.thumbnail.failed") {
          next.set(
            event.assetId,
            event.reason ?? t("toast.thumbnailFailed"),
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
  }, [api, library?.libraryId, t]);
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
          : {
              queued: event.queued,
              running: event.running,
              succeeded: event.succeeded,
              failed: event.failed,
              paused: 0,
              cancelled: 0,
              jobs: [],
            },
      );
      if (
        aiAnalyzingRef.current &&
        event.running === 0 &&
        event.queued === 0
      ) {
        const pendingAssetId = analyzingAssetIdRef.current;
        const batchSize = analyzingBatchSizeRef.current;
        const failedDelta = event.failed - analyzeFailedBaselineRef.current;
        const succeededDelta =
          event.succeeded - analyzeSucceededBaselineRef.current;
        aiAnalyzingRef.current = false;
        analyzingAssetIdRef.current = null;
        analyzingBatchSizeRef.current = 0;
        setAiAnalyzing(false);
        // Serpent-4i18 / iokf: completion toast with failure reason when possible.
        const showFailureToast = (detail?: string) => {
          setError(
            detail
              ? t("toast.aiAnalyzeFailedDetail", { detail })
              : t("toast.aiAnalyzeFailed"),
          );
        };
        if (failedDelta > 0) {
          void api
            .getAiJobStatus({ libraryId: library.libraryId })
            .then((result) => {
              const codes = result.ok
                ? collectRecentAiFailureCodes(result.value.jobs)
                : [];
              const detail = summarizeAiFailureCodes(codes, locale);
              if (succeededDelta === 0) {
                if (pendingAssetId && batchSize <= 1 && result.ok) {
                  const failedForAsset = result.value.jobs.some(
                    (job) =>
                      job.assetId === pendingAssetId && job.status === "failed",
                  );
                  if (failedForAsset) showFailureToast(detail || undefined);
                  return;
                }
                showFailureToast(detail || undefined);
                return;
              }
              setNotice(
                t("toast.aiAnalyzeDoneBatch", {
                  succeeded: Math.max(0, succeededDelta),
                  failed: Math.max(0, failedDelta),
                }) + (detail ? ` ${detail}` : ""),
              );
            })
            .catch(() => {
              if (succeededDelta === 0) {
                showFailureToast();
              } else {
                setNotice(
                  t("toast.aiAnalyzeDoneBatch", {
                    succeeded: Math.max(0, succeededDelta),
                    failed: Math.max(0, failedDelta),
                  }),
                );
              }
            });
        } else if (batchSize > 1) {
          setNotice(
            t("toast.aiAnalyzeDoneBatch", {
              succeeded: Math.max(0, succeededDelta),
              failed: Math.max(0, failedDelta),
            }),
          );
        } else {
          setNotice(t("toast.aiAnalyzeDone"));
        }
        void reloadCurrentContentRef.current();
      }
    });
    const unsubscribeCompleted = api.onAiCompleted((event) => {
      if (event.libraryId !== library.libraryId) return;
      // Refresh only — completion toast is owned by queue-drain (Serpent-4i18).
      void reloadCurrentContentRef.current();
      if (selectedAssetIdRef.current === event.assetId) {
        void refreshAfterAiRef.current(event.assetId);
      }
    });
    const unsubscribeCleared = api.onAiCleared((event) => {
      if (event.libraryId !== library.libraryId) return;
      setAiContent(null);
      setNotice(t("toast.aiContentCleared", { count: event.affectedAssetCount }));
      void reloadCurrentContentRef.current();
    });
    return () => {
      unsubscribeProgress();
      unsubscribeCompleted();
      unsubscribeCleared();
    };
  }, [api, library, locale, setError, setNotice, t]);

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
    if (previewAsset) {
      await closeAssetPreview();
      return;
    }
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
    if (previewAsset) {
      await closeAssetPreview();
      return;
    }
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
      t("toast.libraryOpFailed"),
    );
  }

  async function openRecentLibrary(libraryPath: string) {
    if (!api) return;
    await runLibraryOpenPipeline(
      "opening",
      () => api.openRecent({ path: libraryPath }),
      t("toast.openRecentFailed"),
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
      // Opening/creating can replace the entire browse scope while a
      // two-frame viewer restoration is still pending. Cancel only after the
      // picker succeeds so cancelling the picker leaves the current viewer
      // untouched.
      await closeAssetPreview(false);
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
    setColorFilter("");
    setExcludeColorFilter(false);
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
    setAspectRatioRanges([]);
    setDurationRange({ min: "", max: "", exclude: false });
    setLongEdgeRange({ min: "", max: "", exclude: false });
    setSortField("name");
    setSortOrder("asc");
    hadDiscoveryInput.current = false;
  }

  function clearDiscoveryFiltersOnly() {
    setFormatFilter("");
    setExcludeFormatFilter(false);
    setColorFilter("");
    setExcludeColorFilter(false);
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
    setAspectRatioRanges([]);
    setDurationRange({ min: "", max: "", exclude: false });
    setLongEdgeRange({ min: "", max: "", exclude: false });
  }

  function clearDiscoveryFilter(id: ClearableFilterId) {
    switch (id) {
      case "all":
        clearDiscoveryFiltersOnly();
        return;
      case "color":
        setColorFilter("");
        setExcludeColorFilter(false);
        return;
      case "format":
        setFormatFilter("");
        setExcludeFormatFilter(false);
        return;
      case "tag":
        setTagFilter("");
        setExcludeTagFilter(false);
        setActiveTagId(null);
        return;
      case "rating":
        setRatingFilter("");
        setExcludeRatingFilter(false);
        return;
      case "favorite":
        setFavoriteFilter("any");
        return;
      case "source_url":
        setSourceUrlFilter("any");
        return;
      case "availability":
        setAvailabilityFilter("any");
        setExcludeAvailabilityFilter(false);
        return;
      case "aspect_ratio":
        setAspectRatioRange({ min: "", max: "", exclude: false });
        setAspectRatioRanges([]);
        return;
      case "long_edge":
        setLongEdgeRange({ min: "", max: "", exclude: false });
        return;
      case "width":
        setWidthRange({ min: "", max: "", exclude: false });
        return;
      case "height":
        setHeightRange({ min: "", max: "", exclude: false });
        return;
      case "duration":
        setDurationRange({ min: "", max: "", exclude: false });
        return;
    }
  }

  async function chooseFolder(scope: AssetScope) {
    if (!library) return;
    // REQ-VIEW-004: leave the browse affiliate viewer when the browse scope changes.
    await closeAssetPreview(false);
    closeContextMenu();
    workspaceCanvasRef.current?.scrollTo({ top: 0, left: 0 });
    setShowTrash(false);
    setAssetScope(scope);
    if (scope !== "all" && scope !== "root") {
      const enabled = isFolderRecursiveEnabled(
        folderRecursivePrefs,
        library.libraryId,
        scope,
      );
      folderRecursiveRef.current = enabled;
      setFolderRecursive(enabled);
    } else {
      folderRecursiveRef.current = false;
      setFolderRecursive(false);
    }
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
      setError(toMessage(caught, t("toast.readAssetsFailed"), locale));
    } finally {
      setUiState("ready");
    }
  }

  async function enterTrash() {
    if (!library) return;
    await closeAssetPreview(false);
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
      setError(toMessage(caught, t("toast.readTrashFailed"), locale));
    } finally {
      setUiState("ready");
    }
  }

  async function chooseTag(tagId: string) {
    if (!api || !library) return;
    await closeAssetPreview(false);
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
      setError(toMessage(caught, t("toast.readTagAssetsFailed"), locale));
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
      setNotice(t("toast.tagAdded"));
    } catch (caught) {
      setError(toMessage(caught, t("toast.addTagFailed"), locale));
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
      setNotice(t("toast.tagRemoved"));
    } catch (caught) {
      setError(toMessage(caught, t("toast.removeTagFailed"), locale));
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
      setNotice(t("toast.tagCreatedAssigned", { name: tagName.trim() }));
    } catch (caught) {
      setError(toMessage(caught, t("toast.createTagFailed"), locale));
    }
  }

  // REQ-MENU-007: multi-selection path — create the tag once, then assign it
  // to the whole selection via the shared batch helper (which reports its own
  // "已为 N 项资产添加标签。" notice or a batch error).
  async function handleCreateAndAssignTagToSelection(
    tagName: string,
    assetIds: string[],
  ) {
    if (!api || !library || assetIds.length === 0 || !tagName.trim()) return;
    try {
      const createResult = await api.createTag({
        libraryId: library.libraryId,
        name: tagName.trim(),
      });
      if (!createResult.ok) throw new LibraryOperationError(createResult.error);
      await batchAssignTagToSelection(createResult.value.tagId, assetIds);
    } catch (caught) {
      setError(toMessage(caught, t("toast.createTagFailed"), locale));
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

  // REQ-MENU-007: Inspector tag operations apply to the whole multi-selection.
  // The shared batch helpers only refresh the tag list, so after a batch op
  // also refresh the primary asset's metadata to keep the Inspector's tag
  // chips in sync (single-asset handlers already do this themselves).
  async function refreshInspectorTagStateAfterBatch() {
    const ids =
      selectedAssetIds.length >= 2
        ? [...new Set(selectedAssetIds)]
        : selectedAssetId
          ? [selectedAssetId]
          : [];
    if (ids.length === 0) return;
    try {
      for (const assetId of ids) {
        await refreshTagAndMetadataState(assetId);
      }
      if (ids.length >= 2) {
        const model = rebuildMultiEditFromCache(ids);
        setMultiEdit(model);
        syncEditorsFromMultiEdit(model);
      }
    } catch (caught) {
      setError(toMessage(caught, t("toast.tagUpdatedRefreshFailed"), locale));
    }
  }

  async function handleInspectorAssignTag(tagId: string) {
    const target = resolveInspectorTagTarget(selectedAssetIds, selectedAssetId);
    if (!target) return;
    if (target.kind === "single") {
      await assignAssetToTag(target.assetId, tagId);
      return;
    }
    await batchAssignTagToSelection(tagId, target.assetIds);
    await refreshInspectorTagStateAfterBatch();
  }

  async function handleInspectorRemoveTag(tagId: string) {
    const target = resolveInspectorTagTarget(selectedAssetIds, selectedAssetId);
    if (!target) return;
    if (target.kind === "single") {
      await handleRemoveTagFromAsset(tagId);
      return;
    }
    await batchRemoveTagFromSelection(tagId, target.assetIds);
    await refreshInspectorTagStateAfterBatch();
  }

  async function handleInspectorCreateAndAssignTag(tagName: string) {
    const target = resolveInspectorTagTarget(selectedAssetIds, selectedAssetId);
    if (!target) return;
    if (target.kind === "single") {
      await handleCreateAndAssignTag(tagName);
      return;
    }
    await handleCreateAndAssignTagToSelection(tagName, target.assetIds);
    await refreshInspectorTagStateAfterBatch();
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
      setError(toOrganizationMessage(caught, "collection", "create", locale));
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
        await closeAssetPreview(false);
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
      setNotice(t("toast.collectionDeleted"));
    } catch (caught) {
      setError(toOrganizationMessage(caught, "collection", "delete", locale));
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
      setNotice(t("toast.collectionRenamed"));
    } catch (caught) {
      setError(toOrganizationMessage(caught, "collection", "rename", locale));
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
      setNotice(t("toast.collectionDetailsUpdated"));
    } catch (caught) {
      setError(toOrganizationMessage(caught, "collection", "rename", locale));
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
      setError(t("toast.collectionReorderSameLevelOnly"));
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
      setNotice(t("toast.collectionOrderUpdated"));
    } catch (caught) {
      setError(toMessage(caught, t("toast.collectionReorderFailed"), locale));
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
        throw new Error(t("toast.collectionMemberDirectOnly"));
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
      setNotice(t("toast.collectionMemberOrderUpdated"));
    } catch (caught) {
      setError(toMessage(caught, t("toast.collectionMemberReorderFailed"), locale));
    } finally {
      setUiState("ready");
    }
  }

  async function chooseCollection(
    collectionId: string,
    recursive = collectionRecursive,
  ) {
    if (!api || !library) return;
    await closeAssetPreview(false);
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
      setError(toMessage(caught, t("toast.readCollectionFailed"), locale));
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
      setNotice(t("toast.addedToCollection"));
    } catch (caught) {
      setError(toMessage(caught, t("toast.addToCollectionFailed"), locale));
    }
  }

  const loadCollectionMemberships = useCallback(
    async (assetIds: string[]) => {
      if (!api || !library || assetIds.length === 0) return [];
      const result = await api.listAssetCollectionMemberships({
        libraryId: library.libraryId,
        assetIds,
      });
      if (!result.ok) return [];
      return result.value;
    },
    [api, library],
  );

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
        setError(t("toast.removeFromChildCollection"));
        return;
      }
      const result = await api.removeCollectionAssets({
        libraryId: library.libraryId,
        collectionId,
        assetIds: [assetId],
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      const collectionResult = await api.listCollections({
        libraryId: library.libraryId,
      });
      if (!collectionResult.ok)
        throw new LibraryOperationError(collectionResult.error);
      setCollections(collectionResult.value);
      // CU-B1: refresh the *current* browse scope — do not force a collection search
      // when the user is still on All assets / a folder (that emptied the grid).
      if (activeCollectionId === collectionId) {
        await chooseCollection(collectionId);
      } else {
        await reloadCurrentContent();
      }
      clearAssetSelection();
      setError(null);
      setNotice(t("toast.removedFromCollection"));
    } catch (caught) {
      setError(toOrganizationMessage(caught, "collection", "removeAsset", locale));
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
    const colors = colorFilter
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (colors.length > 0)
      filters.push({
        field: "color",
        values: colors,
        exclude: excludeColorFilter,
      });
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
      field: "width" | "height" | "aspect_ratio" | "duration_ms" | "long_edge";
      input: { min: string; max: string; exclude: boolean };
      scale?: number;
      integer?: boolean;
    }> = [
      { field: "width", input: widthRange },
      { field: "height", input: heightRange },
      { field: "long_edge", input: longEdgeRange },
      { field: "duration_ms", input: durationRange, scale: 1_000 },
    ];
    const aspectInputs =
      aspectRatioRanges.length > 0
        ? aspectRatioRanges
        : aspectRatioRange.min || aspectRatioRange.max
          ? [{ min: aspectRatioRange.min, max: aspectRatioRange.max }]
          : [];
    const aspectParsed = aspectInputs
      .map((input) => parseNumericRange(input.min, input.max, 1, false))
      .filter((range): range is NonNullable<typeof range> => range !== null);
    if (aspectParsed.length > 0) {
      filters.push({
        field: "aspect_ratio",
        ranges: aspectParsed,
        exclude: aspectRatioRange.exclude,
      });
    }
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
      sort: { field: sortField, order: sortOrder },
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
      // REQ-FOLDER-009 / REQ-FILTER-012: folder search follows the same switch.
      return {
        kind: "folder",
        folderId: assetScope,
        recursive: folderRecursive,
      };
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

  const {
    diskDeleteTarget,
    cancelDiskDelete,
    confirmDiskDelete,
    trashManagedFolder,
    openDiskDelete,
    removeLinkedFolder,
    trashLinkedFolderSubtree,
  } = useFolderDeleteActions({
    api: api ?? null,
    libraryId: library?.libraryId ?? null,
    locale,
    assetScope,
    setNotice,
    setError,
    setUiState,
    reloadCurrentContent,
    onDeletedCurrentScope: () => {
      void chooseFolder("root");
    },
  });

  const {
    handleOpenExternal,
    handleRevealInFolder,
    handleCopyFilePath,
    handleOpenFolderInFileManager,
    handleCopyFolderPath,
  } = useShellFileActions({
    api: api ?? null,
    library,
    setError,
    setNotice,
  });

  const {
    handleAssetsDroppedOnFolder,
    handleAssetsDroppedOnCollection,
    handleAssetsDroppedOnTrash,
  } = useAssetDragDropHandlers({
    api: api ?? null,
    library,
    assets,
    assetScope,
    setNotice,
    setError,
    setUiState,
    clearAssetSelection,
    trashManagedAssets,
    reloadCurrentContentRef,
    setCollections,
    setLastMoveOperationId,
  });

  const {
    externalDropActive,
    pasteClipboardImage,
    importDroppedFiles,
    handleExternalDragEnter,
    handleExternalDragLeave,
    handleExternalDragOver,
    handleExternalDrop,
    handleTargetExternalDragOver,
    handleTargetExternalDrop,
  } = useExternalImportHandlers({
    api: api ?? null,
    library,
    busy,
    activeCollectionId,
    previewBlocksDrop: Boolean(previewAsset),
    managedImportTargetFolderIdRef,
    reloadCurrentContent,
    reloadCurrentContentRef,
    setUiState,
    setError,
    setNotice,
    setConflicts,
  });

  const {
    assetRenameDialog,
    openAssetRename,
    changeAssetRenameValue,
    cancelAssetRename,
    submitAssetRename,
  } = useAssetRename({
    api: api ?? null,
    library,
    visibleAssets,
    reloadCurrentContent,
    setNotice,
    setSelectedAssetId,
    setSelectedAssetIds,
  });

  const {
    inlineFolderEdit,
    openInlineFolderCreate,
    openInlineFolderRename,
    changeInlineFolderEdit,
    cancelInlineFolderEdit,
    commitInlineFolderEdit,
  } = useInlineFolderEdit({
    api: api ?? null,
    library,
    setNotice,
    reloadCurrentContent,
  });

  const reloadSmartCollections = useCallback(async () => {
    if (!api || !library) return;
    const listResult = await api.listSmartCollections({
      libraryId: library.libraryId,
    });
    if (listResult.ok) setSmartCollections(listResult.value);
  }, [api, library]);

  const {
    inlineSmartCollectionEdit,
    openInlineSmartCollectionCreate,
    changeInlineSmartCollectionEdit,
    cancelInlineSmartCollectionEdit,
    commitInlineSmartCollectionEdit,
  } = useInlineSmartCollectionEdit({
    api: api ?? null,
    library,
    getQueryDefinition: () =>
      activeAiSearchDefinition ?? currentQueryDefinition(),
    setNotice,
    reloadSmartCollections,
    onCreated: (collection) => {
      setSmartCollectionSettings({
        collectionId: collection.collectionId,
        name: collection.name,
      });
      void chooseSmartCollection(collection.collectionId);
    },
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
    if (offset === 0) clearAssetSelection({ preserveFolders: true });
    applySearchResult(result.value, offset > 0);
    return result.value;
  }

  async function runSearch(
    event?: FormEvent,
    offset = 0,
    opts?: { silent?: boolean },
  ) {
    event?.preventDefault();
    if (!api || !library) return;
    if (offset === 0) await closeAssetPreview(false);
    try {
      const definition = currentQueryDefinition();
      setActiveAiSearchDefinition(null);
      setAiSearchPlanSummary(null);
      const result = await executeSearchDefinition(definition, offset);
      // Serpent-huvw: discovery debounce / reload must not toast "搜索完成"
      // and wipe AI completion / error toasts.
      if (result && !opts?.silent) {
        setNotice(t("toast.searchDone", { total: result.total }));
      }
    } catch (caught) {
      setError(toMessage(caught, t("toast.searchFailed"), locale));
    }
  }

  async function runAiSearch(event?: FormEvent, offset = 0) {
    event?.preventDefault();
    if (!api || !library || !searchValue.trim() || aiSearchLoading) return;
    if (offset === 0) await closeAssetPreview(false);
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
      setAiSearchPlanSummary(describeAiSearchPlan(planned.value.plan, locale));
      const result = await executeSearchDefinition(definition, offset);
      if (result)
        setNotice(t("toast.aiSearchDone", { total: result.total }));
    } catch (caught) {
      const explanation = toMessage(caught, t("toast.aiSearchFailed"), locale);
      setAiSearchEnabled(false);
      setActiveAiSearchDefinition(null);
      setAiSearchPlanSummary(null);
      try {
        const fallback = await executeSearchDefinition(
          currentQueryDefinition(),
          0,
        );
        setError(
          t("toast.aiSearchFallback", {
            explanation,
            fallback: fallback
              ? t("toast.aiSearchFallbackFound", { total: fallback.total })
              : "",
          }) + t("common.sentenceEnd"),
        );
      } catch (fallbackError) {
        setError(
          t("toast.aiSearchFallbackFailed", {
            explanation,
            detail: toMessage(fallbackError, t("toast.desktopNoResponse"), locale),
          }),
        );
      }
    } finally {
      setAiSearchLoading(false);
    }
  }

  useEffect(() => {
    const hasDiscoveryInput = Boolean(
      searchValue.trim() ||
      colorFilter.trim() ||
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
      aspectRatioRanges.length > 0 ||
      durationRange.min ||
      durationRange.max ||
      longEdgeRange.min ||
      longEdgeRange.max ||
      sortField !== "name" ||
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
      void runSearch(undefined, 0, { silent: true });
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
    colorFilter,
    excludeColorFilter,
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
    aspectRatioRanges,
    durationRange,
    longEdgeRange,
    sortField,
    sortOrder,
  ]);

  async function chooseSmartCollection(collectionId: string, offset = 0) {
    if (!api || !library) return;
    if (offset === 0) await closeAssetPreview(false);
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
      setAssetScope("all");
      if (offset === 0) {
        clearAssetSelection();
        clearDiscoveryControls();
        recordNavigation({ kind: "smart-collection", collectionId });
        // Refresh sidebar badge from the live execute total (CU-M6 cache).
        setSmartCollections((current) =>
          current.map((collection) =>
            collection.collectionId === collectionId
              ? { ...collection, assetCount: result.value.total }
              : collection,
          ),
        );
      }
      applySearchResult(result.value, offset > 0);
    } catch (caught) {
      setError(toMessage(caught, t("toast.smartCollectionRunFailed"), locale));
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
      else await runSearch(undefined, offset, { silent: true });
    } catch (caught) {
      setError(toMessage(caught, t("toast.loadMoreFailed"), locale));
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
      setNotice(t("toast.smartCollectionRenamed"));
    } catch (caught) {
      setError(toMessage(caught, t("toast.smartCollectionRenameFailed"), locale));
    }
  }

  async function updateSmartCollectionQuery(collectionId: string) {
    if (!api || !library) return;
    const definition = activeAiSearchDefinition ?? currentQueryDefinition();
    if (!hasMeaningfulSmartCollectionCondition(definition)) {
      setError(t("toast.smartCollectionNeedsCondition"));
      return;
    }
    try {
      const result = await api.updateSmartCollection({
        libraryId: library.libraryId,
        collectionId,
        queryDefinitionJson: JSON.stringify(definition),
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setSmartCollections((current) =>
        current.map((collection) =>
          collection.collectionId === collectionId ? result.value : collection,
        ),
      );
      setNotice(t("toast.smartCollectionUpdated"));
    } catch (caught) {
      setError(toMessage(caught, t("toast.smartCollectionUpdateFailed"), locale));
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
        await closeAssetPreview(false);
        setActiveSmartCollectionId(null);
        await loadContent(library, "all");
      }
      setNotice(t("toast.smartCollectionDeleted"));
    } catch (caught) {
      setError(toMessage(caught, t("toast.smartCollectionDeleteFailed"), locale));
    }
  }

  // --- Asset metadata ---

  function resolveInspectorDescription(
    human: string | null | undefined,
    ai: string | undefined,
  ): { value: string; fromAi: boolean } {
    if ((human ?? "").trim()) return { value: human ?? "", fromAi: false };
    if ((ai ?? "").trim()) return { value: ai ?? "", fromAi: true };
    return { value: "", fromAi: false };
  }

  function applyLoadedMetadata(
    targetAssetId: string,
    metadata: AssetMetadataResult,
  ) {
    metadataByAssetRef.current.set(targetAssetId, metadata);
    metadataConflictAssetIdsRef.current.delete(targetAssetId);
    if (selectedAssetIdRef.current !== targetAssetId) return;
    setAssetMetadata(metadata);
    // Multi-select edit fields are owned by the multi-edit effect (REQ-SELECT-004).
    if (selectedAssetIdsRef.current.length >= 2) return;
    const ai =
      aiContentRef.current?.assetId === targetAssetId
        ? aiContentRef.current
        : null;
    const description = resolveInspectorDescription(
      metadata.description,
      ai?.description,
    );
    setEditDescription(description.value);
    setDescriptionIsAi(description.fromAi);
    setEditRating(metadata.rating);
    setEditFavorite(metadata.favorite);
    setEditSourceUrl(metadata.sourcePageUrl ?? "");
    setEditAuthor(metadata.author ?? "");
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
      setError(toMessage(caught, t("toast.readMetadataFailed"), locale));
    }
  }

  async function loadAiContentForAsset(assetId: string) {
    if (!api || !library || !assetId) {
      setAiContent(null);
      return;
    }
    try {
      const result = await api.getAiContent({
        libraryId: library.libraryId,
        assetId,
      });
      if (selectedAssetIdRef.current !== assetId) return;
      if (!result.ok) {
        setAiContent(null);
        return;
      }
      const { description, tags, rating, modelVersion } = result.value;
      const hasContent =
        Boolean(description?.trim()) ||
        tags.length > 0 ||
        rating != null;
      if (!hasContent) {
        setAiContent(null);
        if (selectedAssetIdsRef.current.length < 2) {
          const human =
            metadataByAssetRef.current.get(assetId)?.description ?? "";
          const resolved = resolveInspectorDescription(human, undefined);
          setEditDescription(resolved.value);
          setDescriptionIsAi(resolved.fromAi);
        }
        return;
      }
      const next = {
        assetId,
        ...(description ? { description } : {}),
        ...(tags.length > 0 ? { tags } : {}),
        ...(rating != null ? { rating } : {}),
        ...(modelVersion ? { modelVersion } : {}),
      };
      setAiContent(next);
      if (selectedAssetIdsRef.current.length < 2) {
        const human =
          metadataByAssetRef.current.get(assetId)?.description ?? "";
        const resolved = resolveInspectorDescription(
          human,
          next.description,
        );
        setEditDescription(resolved.value);
        setDescriptionIsAi(resolved.fromAi);
      }
    } catch {
      if (selectedAssetIdRef.current === assetId) setAiContent(null);
    }
  }
  loadAiContentForAssetRef.current = loadAiContentForAsset;
  refreshAfterAiRef.current = async (assetId: string) => {
    try {
      await refreshTagAndMetadataState(assetId);
    } catch {
      // Best-effort; AI content load still proceeds.
    }
    await loadAiContentForAsset(assetId);
  };

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
          if (!cancelled) setError(toMessage(caught, t("toast.readMetadataFailed"), locale));
        }
      });
      void Promise.resolve().then(async () => {
        if (cancelled) return;
        await loadAiContentForAsset(selectedAssetId);
      });
    } else {
      queueMicrotask(() => {
        setAssetMetadata(null);
        setVersionConflict(false);
        setAiContent(null);
        setDescriptionIsAi(false);
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAssetId]);

  function rebuildMultiEditFromCache(
    assetIds: readonly string[],
  ): InspectorMultiEditModel | null {
    if (assetIds.length < 2) return null;
    const slices = [];
    for (const assetId of assetIds) {
      const metadata = metadataByAssetRef.current.get(assetId);
      if (!metadata) return null;
      slices.push(
        toMultiEditSlice({
          description: metadata.description,
          rating: metadata.rating,
          favorite: metadata.favorite,
          sourcePageUrl: metadata.sourcePageUrl,
          author: metadata.author,
          tags: metadata.tags,
        }),
      );
    }
    return buildInspectorMultiEdit(slices);
  }

  function syncEditorsFromMultiEdit(model: InspectorMultiEditModel | null) {
    if (!model) return;
    setEditDescription(
      model.description.kind === "uniform" ? model.description.value : "",
    );
    setEditRating(model.rating.kind === "uniform" ? model.rating.value : 0);
    setEditFavorite(
      model.favorite.kind === "uniform" ? model.favorite.value : false,
    );
    setEditSourceUrl(
      model.sourceUrl.kind === "uniform" ? model.sourceUrl.value : "",
    );
    setEditAuthor(
      model.author.kind === "uniform" ? model.author.value : "",
    );
  }

  // REQ-SELECT-004: load metadata for every selected asset and derive mixed/uniform.
  useEffect(() => {
    const ids = [...selectedAssetIds];
    if (ids.length < 2 || !api || !library) {
      queueMicrotask(() => {
        setMultiEdit(null);
      });
      return;
    }
    let cancelled = false;
    const libraryId = library.libraryId;
    void (async () => {
      try {
        await Promise.all(
          ids.map(async (assetId) => {
            if (metadataByAssetRef.current.has(assetId)) return;
            const result = await api.getAssetMetadata({ libraryId, assetId });
            if (result.ok) {
              metadataByAssetRef.current.set(assetId, result.value);
            }
          }),
        );
        if (cancelled) return;
        const model = rebuildMultiEditFromCache(ids);
        setMultiEdit(model);
        syncEditorsFromMultiEdit(model);
      } catch (caught) {
        if (!cancelled) {
          setError(toMessage(caught, t("toast.readMetadataFailed"), locale));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAssetIds.join("\0"), library?.libraryId, api]);

  function saveMetadata(fields: {
    description?: string;
    rating?: number;
    favorite?: boolean;
    palette?: string[];
    sourcePageUrl?: string;
    author?: string;
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
            setNotice(t("toast.metadataVersionConflict"));
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
        setNotice(t("toast.metadataSaved"));
      } catch (caught) {
        setError(toMessage(caught, t("toast.metadataSaveFailed"), locale));
      }
    });
    metadataSaveQueueRef.current = operation;
    return operation;
  }

  async function saveMetadataForSelection(
    assetIds: readonly string[],
    fields: {
      description?: string;
      favorite?: boolean;
      palette?: string[];
      sourcePageUrl?: string;
      author?: string;
    },
  ): Promise<void> {
    if (!api || !library || assetIds.length === 0) return;
    const targetApi = api;
    const targetLibraryId = library.libraryId;
    let updated = 0;
    let conflicts = 0;
    for (const assetId of assetIds) {
      let current = metadataByAssetRef.current.get(assetId);
      if (!current) {
        const fetched = await targetApi.getAssetMetadata({
          libraryId: targetLibraryId,
          assetId,
        });
        if (!fetched.ok) continue;
        current = fetched.value;
        metadataByAssetRef.current.set(assetId, current);
      }
      if (metadataConflictAssetIdsRef.current.has(assetId)) {
        conflicts += 1;
        continue;
      }
      try {
        const result = await targetApi.setAssetMetadata({
          libraryId: targetLibraryId,
          assetId,
          expectedVersion: current.entityVersion,
          ...fields,
        });
        if (!result.ok) {
          if (result.error.code === "VERSION_CONFLICT") {
            metadataConflictAssetIdsRef.current.add(assetId);
            conflicts += 1;
            continue;
          }
          throw new LibraryOperationError(result.error);
        }
        metadataByAssetRef.current.set(assetId, result.value);
        updated += 1;
        if ("favorite" in fields && fields.favorite !== undefined) {
          const favorite = fields.favorite;
          const updateSummary = (asset: AssetSummary): AssetSummary =>
            asset.assetId === assetId ? { ...asset, favorite } : asset;
          setAssets((currentAssets) => currentAssets.map(updateSummary));
          setTrashedAssets((currentAssets) => currentAssets.map(updateSummary));
        }
        if (selectedAssetIdRef.current === assetId) {
          setAssetMetadata(result.value);
        }
      } catch (caught) {
        setError(toMessage(caught, t("toast.metadataSaveFailed"), locale));
        return;
      }
    }
    const model = rebuildMultiEditFromCache([...assetIds]);
    setMultiEdit(model);
    syncEditorsFromMultiEdit(model);
    if (conflicts > 0) {
      setNotice(t("toast.metadataVersionConflict"));
    } else if (updated > 0) {
      setNotice(t("toast.metadataSaved"));
    }
  }

  // --- Existing operations ---

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
      setNotice(importSummaryMessage(result.value, locale));
      await reloadCurrentContent();
    } catch (caught) {
      setError(toMessage(caught, t("toast.importFailed"), locale));
    } finally {
      setUiState("ready");
    }
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
      setNotice(importSummaryMessage(result.value, locale));
      await reloadCurrentContent();
    } catch (caught) {
      setError(toMessage(caught, t("toast.continueImportFailed"), locale));
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
      setError(toMessage(caught, t("toast.cancelPendingImportFailed"), locale));
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
          ? t("toast.diskSynced", { count: result.value.changedCount })
          : t("toast.diskUpToDate"),
      );
    } catch (caught) {
      setError(toMessage(caught, t("toast.refreshFailed"), locale));
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
      setNotice(t("toast.linkedFolderCreated", { name: result.value.displayName }));
      await reloadCurrentContent();
    } catch (caught) {
      setError(toMessage(caught, t("toast.linkFolderFailed"), locale));
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
      setNotice(t("toast.linkedFolderRelocated", { name: result.value.displayName }));
      await reloadCurrentContent();
    } catch (caught) {
      setError(toMessage(caught, t("toast.relocateFailed"), locale));
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
      setError(toMessage(caught, t("toast.readLinkedRulesFailed"), locale));
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
        t("toast.linkedRulesSaved", {
          hidden: result.value.hiddenCount,
          restored: result.value.restoredCount,
        }),
      );
      setLinkedRulesEditor(null);
      await reloadCurrentContent();
    } catch (caught) {
      setError(toMessage(caught, t("toast.saveLinkedRulesFailed"), locale));
    } finally {
      setUiState("ready");
    }
  }

  async function convertLinkedToManaged() {
    if (!api || !library || !convertLinkedDialog.folderId) return;
    const dialogState = convertLinkedDialog;
    if (
      !confirm(
        t("toast.convertLinkedConfirm", { name: dialogState.name }),
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
        t("toast.convertLinkedDone", { count: result.value.convertedCount }),
      );
      await reloadCurrentContent();
    } catch (caught) {
      setError(toMessage(caught, t("toast.convertLinkedFailed"), locale));
    } finally {
      setUiState("ready");
    }
  }

  async function closeLibrary() {
    if (!api || !library) return;
    setUiState("closing");
    let closed = false;
    try {
      await closeAssetPreview(false);
      const result = await api.close({ libraryId: library.libraryId });
      if (!result.ok) throw new LibraryOperationError(result.error);
      closed = true;
      applyClosedLibraryUi();
      await refreshRecentLibraries(null);
    } catch (caught) {
      setError(toMessage(caught, t("toast.closeFailed"), locale));
    } finally {
      setUiState(closed ? "idle" : "ready");
    }
  }

  async function removeLibrary() {
    if (!api || !library) return;
    const removedName = library.displayName;
    const removedPath = library.displayPath;
    setUiState("closing");
    let removed = false;
    try {
      await closeAssetPreview(false);
      const result = await api.close({ libraryId: library.libraryId });
      if (!result.ok) throw new LibraryOperationError(result.error);
      const forgotten = await api.forgetRecent({ path: removedPath });
      if (!forgotten.ok) throw new LibraryOperationError(forgotten.error);
      removed = true;
      applyClosedLibraryUi();
      await refreshRecentLibraries(null);
      setNotice(t("toast.libraryRemoved", { name: removedName }));
    } catch (caught) {
      setError(toMessage(caught, t("toast.libraryRemoveFailed"), locale));
    } finally {
      setUiState(removed ? "idle" : "ready");
    }
  }

  async function forgetRecentLibrary(libraryPath: string) {
    if (!api) return;
    try {
      const result = await api.forgetRecent({ path: libraryPath });
      if (!result.ok) throw new LibraryOperationError(result.error);
      await refreshRecentLibraries(library?.displayPath ?? null);
    } catch (caught) {
      setError(toMessage(caught, t("toast.libraryRemoveFailed"), locale));
    }
  }

  function applyClosedLibraryUi() {
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
  }

  function requestDeleteLibraryFromDisk() {
    if (!library) return;
    if (!isDiskDeletePromptEnabled()) {
      void confirmDeleteLibraryFromDisk(false);
      return;
    }
    setLibraryDiskDeletePending(true);
  }

  async function confirmDeleteLibraryFromDisk(dontShowAgain: boolean) {
    if (!api || !library) return;
    if (dontShowAgain) setDiskDeletePromptEnabled(false);
    setLibraryDiskDeletePending(false);
    const deletedName = library.displayName;
    setUiState("closing");
    let toreDown = false;
    try {
      await closeAssetPreview(false);
      const result = await api.deleteLibraryFromDisk({
        libraryId: library.libraryId,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      toreDown = true;
      applyClosedLibraryUi();
      await refreshRecentLibraries(null);
      setNotice(t("toast.libraryDeletedFromDisk", { name: deletedName }));
    } catch (caught) {
      // Worker closes the library before rm; clear UI even when rm fails.
      if (!(caught instanceof LibraryOperationError && caught.code === "LIBRARY_NOT_OPEN")) {
        toreDown = true;
        applyClosedLibraryUi();
        await refreshRecentLibraries(null);
      }
      setError(toMessage(caught, t("toast.libraryDeleteFailed"), locale));
    } finally {
      setUiState(toreDown ? "idle" : "ready");
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
        t("toast.restoredCount", { count: result.value.restoredCount }) +
          (skippedCount
            ? t("toast.conflictAssetsSkippedSuffix", { count: skippedCount })
            : "") +
          t("common.sentenceEnd"),
      );
      clearAssetSelection();
      await loadContent(library, "all", { trashMode: true });
    } catch (caught) {
      setError(toMessage(caught, t("toast.restoreFailed"), locale));
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
        t("toast.movedCountDetail", { count: result.value.movedCount }) +
          (result.value.skippedCount
            ? t("toast.skippedSuffix", { count: result.value.skippedCount })
            : "") +
          t("common.sentenceEnd"),
      );
      clearAssetSelection();
      await reloadCurrentContent();
    } catch (caught) {
      setError(toMessage(caught, t("toast.moveFailed"), locale));
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
        t("toast.undoMoveDone", { count: result.value.undoneCount }) +
          (result.value.skippedCount
            ? t("toast.conflictAssetsSkippedSuffix", {
                count: result.value.skippedCount,
              })
            : "") +
          t("common.sentenceEnd"),
      );
      await reloadCurrentContent();
    } catch (caught) {
      setError(toMessage(caught, t("toast.undoMoveFailed"), locale));
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
      let msg = t("toast.permanentDeleted", {
        count: result.value.deletedCount,
      });
      if (result.value.skippedCount > 0) {
        const skippedNames = new Map(
          trashedAssets.map((asset) => [asset.assetId, asset.displayName]),
        );
        msg += t("toast.permanentDeleteSkipped", {
          count: result.value.skippedCount,
          reasons: result.value.skippedReasons
            .map(({ assetId, reason }) =>
              t("toast.permanentDeleteItem", {
                name: skippedNames.get(assetId) ?? t("toast.selectedAsset"),
                reason: translateForLocale(locale, `error.reason.${reason}`),
              }),
            )
            .join("；"),
        });
      }
      setNotice(msg);
      clearAssetSelection();
      await loadContent(library, "all", { trashMode: true });
    } catch (caught) {
      setError(toMessage(caught, t("toast.permanentDeleteFailed"), locale));
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
          result.value.failures.map(({ reason }) =>
            translateForLocale(locale, `error.reason.${reason}`),
          ),
        ),
      ];
      setNotice(
        t("toast.emptyTrashDone", { count: result.value.purgedCount }) +
          (result.value.skippedCount > 0
            ? t("toast.emptyTrashSkipped", {
                count: result.value.skippedCount,
                reasons: failureReasons.join("；"),
              })
            : "") +
          t("common.sentenceEnd"),
      );
      await loadContent(library, "all", { trashMode: true });
    } catch (caught) {
      setError(toMessage(caught, t("toast.emptyTrashFailed"), locale));
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
            result.value.failures.map(({ reason }) =>
              translateForLocale(locale, `error.reason.${reason}`),
            ),
          ),
        ];
        outcomeError = t("toast.deleteLinkedPartial", {
          deleted: result.value.deletedCount,
          failed: result.value.failedCount,
          reasons: reasons.join("；"),
        });
        setError(outcomeError);
      } else {
        setError(null);
        setNotice(
          deleteSourceFile
            ? t("toast.deleteLinkedWithTrash", {
                count: result.value.deletedCount,
              })
            : t("toast.deleteLinkedRecordOnly", {
                count: result.value.deletedCount,
              }),
        );
      }
      if (result.value.deletedCount > 0) clearAssetSelection();
      try {
        await reloadCurrentContent();
      } catch (refreshError) {
        const refreshReason = toMessage(refreshError, t("toast.refreshListManually"), locale);
        setError(
          outcomeError
            ? t("toast.deleteOutcomeRefreshFailed", {
                outcome: outcomeError,
                reason: refreshReason,
              })
            : t("toast.deleteDoneRefreshFailed", { reason: refreshReason }),
        );
      }
    } catch (caught) {
      setError(toMessage(caught, t("toast.deleteLinkedFailed"), locale));
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
      setNotice(t("toast.relinkSuccess"));
      await reloadCurrentContent();
    } catch (caught) {
      setError(toMessage(caught, t("toast.relinkFailed"), locale));
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
      setError(toMessage(caught, t("toast.batchRelinkPreviewFailed"), locale));
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
        t("toast.batchRelinkDone", {
          restored: result.value.restoredCount,
          missing: result.value.unchangedMissingCount,
        }),
      );
      await reloadCurrentContent();
    } catch (caught) {
      setBatchRelinkPreview(null);
      setError(toMessage(caught, t("toast.batchRelinkFailed"), locale));
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
      setError(toMessage(caught, t("toast.cancelBatchRelinkFailed"), locale));
    }
  }, [api, batchRelinkPreview, library, locale, setError, t]);

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
          // Serpent-tye: folder/save dialog cancel must clear the optimistic strip.
          setExportProgress(null);
          setNotice(t("toast.exportCancelled"));
        } else {
          throw new LibraryOperationError(result.error);
        }
      }
    } catch (caught) {
      setExportProgress(null);
      setError(toMessage(caught, t("toast.exportFailed"), locale));
    } finally {
      setTimeout(() => {
        setExportProgress((prev) => {
          if (
            !prev ||
            prev.phase === "complete" ||
            prev.phase === "cancelled" ||
            prev.phase === "failed"
          ) {
            return null;
          }
          // Still running after the dialog returned — keep showing until events settle.
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
      setNotice(t("toast.cancellingExport"));
    } catch (caught) {
      setError(toMessage(caught, t("toast.cancelExportFailed"), locale));
    }
  }

  async function cancelImport() {
    if (!api || !importProgress?.importId) return;
    try {
      const result = await api.cancelLibraryImport({
        importId: importProgress.importId,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setNotice(t("toast.cancellingImport"));
    } catch (caught) {
      setError(toMessage(caught, t("toast.cancelImportFailed"), locale));
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
      setError(toMessage(caught, t("toast.importValidateFailed"), locale));
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
          setNotice(t("toast.importCancelled"));
          return;
        }
        throw new LibraryOperationError(result.error);
      }
      setImportProgress(null);
      await activateImportedLibrary(result.value);
    } catch (caught) {
      setError(toMessage(caught, t("toast.zipImportFailed"), locale));
      setImportProgress(null);
    }
  }

  async function activateImportedLibrary(imported: { libraryId: string }) {
    if (!api) {
      throw new Error(t("toast.bridgeUnavailable"));
    }
    let activated = false;
    try {
      const openResult = await api.listOpen();
      if (!openResult.ok) throw new LibraryOperationError(openResult.error);
      const summary =
        openResult.value.find((entry) => entry.libraryId === imported.libraryId) ??
        null;
      if (!summary) {
        throw new Error(t("toast.importFailed"));
      }
      await closeAssetPreview(false);
      setLibrary(summary);
      setShowTrash(false);
      setTrashedAssets([]);
      setAssetScope("all");
      setActiveTagId(null);
      setActiveCollectionId(null);
      setActiveSmartCollectionId(null);
      resetNavHistory({ kind: "all" });
      clearDiscoveryControls();
      api.setActiveContext(summary.libraryId);
      await loadContent(summary, "all");
      await refreshRecentLibraries(summary.displayPath);
      activated = true;
      setNotice(t("toast.libraryImportComplete", { name: summary.displayName }));
    } finally {
      setUiState(activated ? "ready" : "idle");
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
          setNotice(t("toast.importCancelled"));
        } else {
          throw new LibraryOperationError(result.error);
        }
        return;
      }
      setImportValidated(null);
      setImportProgress(null);
      await activateImportedLibrary(result.value);
    } catch (caught) {
      setError(toMessage(caught, t("toast.importFailed"), locale));
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
          setNotice(t("toast.importCancelled"));
        } else {
          throw new LibraryOperationError(result.error);
        }
        return;
      }
      setImportValidated(null);
      setImportProgress(null);
      await activateImportedLibrary(result.value);
    } catch (caught) {
      setError(toMessage(caught, t("toast.importFailed"), locale));
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
            ? t("toast.diskSyncedMissing", { count: event.missingCount })
            : "";
          setNotice(
            t("toast.diskSyncedAuto", {
              count: event.changedCount,
              missing,
            }),
          );
        } catch (caught) {
          setError(toMessage(caught, t("toast.diskChangedRefreshFailed"), locale));
        }
      });
    });
  }, [api, library, locale, selectedAssetId, setError, setNotice, t]);

  useEffect(() => {
    if (!api) return;
    return api.onProgress((event) => {
      if (event.type === "export.progress") {
        setExportProgress(event);
        if (event.phase === "complete") {
          setNotice(
            t("toast.exportComplete", {
              files: event.totalFiles,
              bytes: formatBytes(event.totalBytes),
            }),
          );
        }
      } else if (event.type === "import.progress") {
        setImportProgress(event);
        if (event.phase === "complete") {
          setImportProgress(null);
        }
      }
    });
  }, [api, setNotice, t]);

  const dialogEscapeSnapshot = useMemo((): DialogEscapeSnapshot => {
    return {
      assetRenameOpen: Boolean(assetRenameDialog),
      permanentDeleteOpen: Boolean(permanentDeleteDialog),
      diskDeleteOpen: Boolean(diskDeleteTarget) || libraryDiskDeletePending,
      deleteLinkedOpen: Boolean(deleteLinkedDialog),
      batchRelinkOpen: Boolean(batchRelinkPreview),
      restoreOpen: Boolean(restoreDialog),
      moveOpen: Boolean(moveDialog),
      undoMoveOpen: Boolean(undoMoveDialog),
      collectionEditorOpen: Boolean(collectionEditor),
      exportDialogOpen,
      importLibraryChooserOpen,
      appSettingsOpen,
      aiConfigOpen,
      extensionPairingOpen,
      mediaJobsOpen: Boolean(mediaJobsOpen && library !== null),
      linkedRulesEditorOpen: Boolean(linkedRulesEditor),
      convertLinkedOpen: Boolean(convertLinkedDialog.folderId),
      dialogOpen: Boolean(dialog),
      aiConnectionFailureOpen: aiConnectionFailureGate.open,
      conflictsImportId: conflicts?.importId ?? null,
    };
  }, [
    assetRenameDialog,
    permanentDeleteDialog,
    diskDeleteTarget,
    libraryDiskDeletePending,
    deleteLinkedDialog,
    batchRelinkPreview,
    restoreDialog,
    moveDialog,
    undoMoveDialog,
    collectionEditor,
    exportDialogOpen,
    importLibraryChooserOpen,
    appSettingsOpen,
    aiConfigOpen,
    extensionPairingOpen,
    mediaJobsOpen,
    library,
    linkedRulesEditor,
    convertLinkedDialog.folderId,
    dialog,
    aiConnectionFailureGate.open,
    conflicts?.importId,
  ]);

  useDialogEscapeDismiss({
    api: api ?? null,
    snapshot: dialogEscapeSnapshot,
    cancelAssetRename,
    cancelBatchRelink,
    setPermanentDeleteDialog,
    cancelDiskDelete: () => {
      cancelDiskDelete();
      setLibraryDiskDeletePending(false);
    },
    setDeleteLinkedDialog,
    setRestoreDialog,
    setMoveDialog,
    setUndoMoveDialog,
    setCollectionEditor,
    setExportDialogOpen,
    setImportLibraryChooserOpen,
    setAppSettingsOpen,
    setAiConfigOpen,
    setExtensionPairingOpen,
    setMediaJobsOpen,
    setLinkedRulesEditor,
    resetConvertLinkedDialog: () => {
      setConvertLinkedDialog({ folderId: "", name: "", targetFolderId: "" });
    },
    setDialog,
    setShowCollectionInput,
    setConflicts,
    setError,
    onAbortAiConnectionFailure: onAiConnectionFailureAbort,
  });

  const dialogFocusTrapActive = Boolean(
    dialog ||
      conflicts ||
      assetRenameDialog ||
      permanentDeleteDialog ||
      diskDeleteTarget ||
      libraryDiskDeletePending ||
      deleteLinkedDialog ||
      batchRelinkPreview ||
      restoreDialog ||
      moveDialog ||
      undoMoveDialog ||
      collectionEditor ||
      exportDialogOpen ||
      importLibraryChooserOpen ||
      appSettingsOpen ||
      Boolean(smartCollectionSettings) ||
      aiConfigOpen ||
      extensionPairingOpen ||
      aiConnectionFailureGate.open ||
      (mediaJobsOpen && library !== null) ||
      linkedRulesEditor ||
      convertLinkedDialog.folderId,
  );
  useDialogFocusTrap(dialogFocusTrapActive);

  useEffect(() => {
    // Serpent-0rk: freeze shell pointer targets while any modal is open.
    document.body.classList.toggle("serpent-modal-open", dialogFocusTrapActive);
    return () => {
      document.body.classList.remove("serpent-modal-open");
    };
  }, [dialogFocusTrapActive]);

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
        matchAssetCommandShortcut("asset.open-external", event) &&
        selectedAsset?.availability === "available" &&
        !selectedAsset.deletedAt &&
        !previewAsset &&
        !document.querySelector('[role="dialog"][aria-modal="true"]')
      ) {
        event.preventDefault();
        void handleOpenExternal(selectedAsset.assetId);
      } else if (
        matchAssetCommandShortcut("asset.move-to-trash", event) &&
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
        matchAssetCommandShortcut("asset.rename", event) &&
        selectedAsset?.availability === "available" &&
        !selectedAsset.deletedAt &&
        selectedAsset.locationKind === "managed" &&
        !previewAsset &&
        !document.querySelector('[role="dialog"][aria-modal="true"]')
      ) {
        event.preventDefault();
        openAssetRename(selectedAsset.assetId);
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
    openAssetRename,
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
      if (previewAsset) {
        if (event.key === "Escape" && !document.fullscreenElement) {
          event.preventDefault();
          void closeAssetPreview();
          return;
        }
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement ||
          (target instanceof HTMLElement &&
            (target.isContentEditable || target.closest('[role="dialog"]')))
        ) {
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
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement &&
          (target.isContentEditable || target.closest('[role="dialog"]')))
      )
        return;
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

  // macOS three-finger swipe while viewing → previous/next (same order as arrows).
  useEffect(() => {
    if (!previewAsset) return;
    const shellBridge = (window as RendererWindow).serpent?.shell;
    if (!shellBridge?.onSwipe) return;
    return shellBridge.onSwipe((direction) => {
      if (direction === "left") {
        if (previewIndex >= 0 && previewIndex < visibleAssets.length - 1) {
          navigateAssetPreview(visibleAssets[previewIndex + 1]!);
        }
        return;
      }
      if (direction === "right") {
        if (previewIndex > 0) {
          navigateAssetPreview(visibleAssets[previewIndex - 1]!);
        }
      }
    });
  }, [
    navigateAssetPreview,
    previewAsset,
    previewIndex,
    visibleAssets,
  ]);

  function workspaceTitle() {
    if (!library) return t("scope.workspace");
    if (showTrash) return t("scope.trash");
    if (activeTagId) {
      const tag = tags.find((x) => x.tagId === activeTagId);
      return tag
        ? t("scope.tagNamed", { name: tag.name })
        : t("scope.tagFilter");
    }
    if (activeCollectionId) {
      const collection = collections.find(
        (x) => x.collectionId === activeCollectionId,
      );
      return collection
        ? t("scope.collectionNamed", { name: collection.name })
        : t("scope.collectionView");
    }
    if (activeSmartCollectionId) {
      const smart = smartCollections.find(
        (x) => x.collectionId === activeSmartCollectionId,
      );
      return smart
        ? t("scope.smartCollectionScope", { name: smart.name })
        : t("scope.smartCollections");
    }
    if (assetScope === "all") return t("scope.allAssets");
    if (assetScope === "root") return t("scope.rootFolder");
    return selectedFolder?.name ?? t("scope.workspace");
  }

  // --- Metadata editor helpers ---
  function handleMetadataDescriptionInput(
    event: FormEvent<HTMLTextAreaElement>,
  ) {
    const value = (event.target as HTMLTextAreaElement).value;
    setEditDescription(value);
  }

  function handleMetadataDescriptionSave() {
    const target = resolveInspectorTagTarget(
      selectedAssetIds,
      selectedAssetId ?? undefined,
    );
    if (target?.kind === "batch") {
      if (multiEdit?.description.kind !== "uniform") return;
      if (editDescription === multiEdit.description.value) return;
      void saveMetadataForSelection(target.assetIds, {
        description: editDescription,
      });
      return;
    }
    if (descriptionIsAi) {
      void handlePromoteAiDescription(editDescription);
      return;
    }
    if (!assetMetadata || editDescription === (assetMetadata.description ?? ""))
      return;
    void saveMetadata({ description: editDescription });
  }

  // REQ-MENU-007: with a multi-selection the Inspector rating stars apply to
  // every selected asset through the batch rating command (last-write-wins),
  // exactly like the Inspector tag operations. The primary asset's stars
  // update optimistically; a single selection keeps the versioned write.
  function handleRatingClick(rating: number) {
    const target = resolveInspectorTagTarget(
      selectedAssetIds,
      selectedAssetId ?? undefined,
    );
    if (target?.kind === "batch") {
      if (multiEdit?.rating.kind === "mixed") return;
      setEditRating(rating);
      void batchSetRatingForSelection(rating, target.assetIds);
      return;
    }
    if (!assetMetadata) return;
    setEditRating(rating);
    void saveMetadata({ rating });
  }

  async function batchSetRatingForSelection(rating: number, assetIds: string[]) {
    if (!api || !library || assetIds.length === 0) return;
    try {
      const result = await api.setAssetsRating({
        libraryId: library.libraryId,
        assetIds,
        rating,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      const skippedIds = new Set(
        result.value.skipped.map((item) => item.assetId),
      );
      const appliedIds = new Set(
        assetIds.filter((assetId) => !skippedIds.has(assetId)),
      );
      const updateSummary = (asset: AssetSummary): AssetSummary =>
        appliedIds.has(asset.assetId) ? { ...asset, rating } : asset;
      setAssets((current) => current.map(updateSummary));
      setTrashedAssets((current) => current.map(updateSummary));
      // Refresh cached Inspector metadata in place. The batch write touches
      // only the rating column, so cached entityVersions stay valid for the
      // single-asset optimistic-lock path.
      for (const assetId of appliedIds) {
        const cached = metadataByAssetRef.current.get(assetId);
        if (cached)
          metadataByAssetRef.current.set(assetId, { ...cached, rating });
      }
      const primaryAssetId = selectedAssetIdRef.current;
      if (primaryAssetId && appliedIds.has(primaryAssetId)) {
        setAssetMetadata((current) =>
          current && current.assetId === primaryAssetId
            ? { ...current, rating }
            : current,
        );
      }
      const model = rebuildMultiEditFromCache(assetIds);
      setMultiEdit(model);
      syncEditorsFromMultiEdit(model);
      setNotice(
        formatBatchRatingNotice(
          rating,
          assetIds.length - result.value.skipped.length,
          result.value.skipped,
          locale,
        ),
      );
    } catch (caught) {
      setError(toMessage(caught, t("toast.batchRatingFailed"), locale));
    }
  }

  function handleFavoriteToggle() {
    const target = resolveInspectorTagTarget(
      selectedAssetIds,
      selectedAssetId ?? undefined,
    );
    if (target?.kind === "batch") {
      if (multiEdit?.favorite.kind !== "uniform") return;
      const next = !editFavorite;
      setEditFavorite(next);
      void saveMetadataForSelection(target.assetIds, { favorite: next });
      return;
    }
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
    const target = resolveInspectorTagTarget(
      selectedAssetIds,
      selectedAssetId ?? undefined,
    );
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
        setError(t("toast.sourceUrlSaveFailed"));
        return;
      }
    }
    if (target?.kind === "batch") {
      if (multiEdit?.sourceUrl.kind !== "uniform") return;
      if (editSourceUrl === multiEdit.sourceUrl.value) return;
      void saveMetadataForSelection(target.assetIds, {
        sourcePageUrl: editSourceUrl,
      });
      return;
    }
    if (!assetMetadata || editSourceUrl === (assetMetadata.sourcePageUrl ?? ""))
      return;
    void saveMetadata({ sourcePageUrl: editSourceUrl });
  }

  function handleAuthorInput(event: FormEvent<HTMLInputElement>) {
    const value = (event.target as HTMLInputElement).value;
    setEditAuthor(value);
  }

  function handleAuthorSave() {
    const target = resolveInspectorTagTarget(
      selectedAssetIds,
      selectedAssetId ?? undefined,
    );
    if (target?.kind === "batch") {
      if (multiEdit?.author.kind !== "uniform") return;
      if (editAuthor === multiEdit.author.value) return;
      void saveMetadataForSelection(target.assetIds, { author: editAuthor });
      return;
    }
    if (!assetMetadata || editAuthor === (assetMetadata.author ?? "")) return;
    void saveMetadata({ author: editAuthor });
  }

  // 检查器「源链接」跳转：有效性先按共享口径预判（禁用态），主进程仍会
  // 在 shell.openExternal 前做最终校验，两道防线都不放行非 HTTP(S)。
  // 失败时按公开错误码给出可操作提示（不含 URL 原文）。
  function handleOpenSourceUrl() {
    const url = toOpenableExternalUrl(editSourceUrl);
    const shellBridge = (window as RendererWindow).serpent?.shell;
    if (!url || !shellBridge) return;
    void shellBridge.openExternalUrl(url).then((result) => {
      if (result.ok) return;
      const toastKey =
        result.code === "rejected_url" || result.code === "malformed_request"
          ? "toast.sourceUrlOpenFailed"
          : result.code === "unauthorized_sender"
            ? "toast.sourceUrlOpenUnauthorized"
            : "toast.sourceUrlOpenShellFailed";
      setError(t(toastKey));
    });
  }

  // ── AI Analysis ────────────────────────────────────────────────────

  async function openExtensionPairing() {
    setExtensionPairingOpen(true);
    setExtensionPairingToken("");
    setExtensionPairingError(null);
    if (!extensionPairingApi) {
      setExtensionPairingError(t("toast.extensionPairingUnsupported"));
      return;
    }
    const result = await extensionPairingApi.getToken();
    if (result.ok) setExtensionPairingToken(result.token);
    else setExtensionPairingError(result.message);
  }

  async function rotateExtensionPairing() {
    if (!extensionPairingApi) return;
    if (!confirm(t("toast.extensionRotateConfirm")))
      return;
    const result = await extensionPairingApi.rotateToken();
    if (result.ok) {
      setExtensionPairingToken(result.token);
      setExtensionPairingError(null);
      setNotice(t("toast.extensionRotated"));
    } else {
      setExtensionPairingError(result.message);
    }
  }

  async function copyExtensionPairingToken() {
    if (!extensionPairingToken) return;
    try {
      await navigator.clipboard.writeText(extensionPairingToken);
      setNotice(t("toast.extensionCopied"));
    } catch {
      setExtensionPairingError(t("toast.extensionCopyFailed"));
    }
  }

  async function loadAiConfig() {
    if (!api) return;
    const result = await api.getAiConfig();
    if (!result.ok) return;
    setAiApiFormat(
      (result.value.apiFormat as
        | "openai_chat"
        | "openai_responses"
        | "anthropic"
        | "gemini_native") ?? "openai_chat",
    );
    setAiModel(result.value.model ?? "gpt-4o-mini");
    setAiBaseUrl(result.value.baseUrl ?? "");
    setAiHasKey(result.value.hasKey);
    setAiDescriptionEnabled(result.value.enabledFields.description);
    setAiTagsEnabled(result.value.enabledFields.tags);
    setAiRatingEnabled(result.value.enabledFields.rating);
    setAiForceExistingTags(result.value.analysisSettings.forceExistingTags);
    setAiAnalysisSettings({
      ...result.value.analysisSettings,
      forceExistingTags: result.value.analysisSettings.forceExistingTags,
    });
    const langs = result.value.languages as
      | Array<"zh-CN" | "en" | "ja" | "ko">
      | undefined;
    setAiLanguages(langs?.length ? [langs[0]!] : ["zh-CN"]);
    setAiAutoAnalyzeEnabled(result.value.autoAnalyzeEnabled);
    setAiDisclaimerAccepted(result.value.disclaimerAccepted);
    aiVerifiedFingerprintRef.current = null;
  }

  function aiCredentialFingerprint(): string {
    return [
      aiApiFormat,
      aiModel.trim(),
      aiBaseUrl.trim(),
      aiApiKey.trim() || (aiHasKey ? "__stored__" : ""),
    ].join("\u0001");
  }

  const testAiConnectionFromDialog = useCallback(async (): Promise<{
    success: boolean;
    reason?: string;
  }> => {
    if (!api) return { success: false, reason: t("aiConfig.testFailed") };
    if (!aiApiKey.trim() && !aiHasKey) {
      setAiConnectionState("disconnected");
      setAiConnectionReason(t("aiConfig.testFailed"));
      aiVerifiedFingerprintRef.current = null;
      return { success: false, reason: t("aiConfig.testFailed") };
    }
    setAiConnectionState("connecting");
    setAiConnectionReason(undefined);
    const fingerprint = [
      aiApiFormat,
      aiModel.trim(),
      aiBaseUrl.trim(),
      aiApiKey.trim() || (aiHasKey ? "__stored__" : ""),
    ].join("\u0001");
    const result = await api.testAiConnection({
      apiFormat: aiApiFormat,
      model: aiModel.trim(),
      ...(aiApiKey.trim() ? { apiKey: aiApiKey.trim() } : {}),
      baseUrl: aiBaseUrl.trim() || undefined,
    });
    if (!result.ok) {
      const reason = toMessage(
        result.error,
        t("aiConfig.testFailed"),
        locale,
      );
      setAiConnectionState("error");
      setAiConnectionReason(reason);
      aiVerifiedFingerprintRef.current = null;
      return { success: false, reason };
    }
    if (result.value.success) {
      setAiConnectionState("connected");
      setAiConnectionReason(undefined);
      aiVerifiedFingerprintRef.current = fingerprint;
      // Typed key is not on disk until save — only mark ready when stored.
      if (aiHasKey || !aiApiKey.trim()) {
        setAiHasKey(true);
      } else {
        // Probe OK with unsaved key: refresh from disk (still false until save).
        void api.getAiConfig().then((cfg) => {
          if (cfg.ok) setAiHasKey(cfg.value.hasKey);
        });
      }
      return { success: true };
    }
    const reason = result.value.reason ?? t("aiConfig.testFailed");
    setAiConnectionState("error");
    setAiConnectionReason(reason);
    aiVerifiedFingerprintRef.current = null;
    return { success: false, reason };
  }, [
    aiApiFormat,
    aiApiKey,
    aiBaseUrl,
    aiHasKey,
    aiModel,
    api,
    locale,
    t,
  ]);

  async function saveAiConfig() {
    if (!api || (!aiApiKey.trim() && !aiHasKey)) return;
    const alreadyVerified =
      aiVerifiedFingerprintRef.current === aiCredentialFingerprint() &&
      aiConnectionState === "connected";
    const result = await api.setAiConfig({
      apiFormat: aiApiFormat,
      model: aiModel,
      baseUrl: aiBaseUrl.trim(),
      ...(aiApiKey.trim() ? { apiKey: aiApiKey.trim() } : {}),
      enabledFields: {
        description: aiDescriptionEnabled,
        tags: aiTagsEnabled,
        rating: aiRatingEnabled,
      },
      analysisSettings: {
        ...aiAnalysisSettings,
        forceExistingTags: aiForceExistingTags,
      },
      languages: aiLanguages.length > 0 ? [aiLanguages[0]!] : ["zh-CN"],
      autoAnalyzeEnabled: aiAutoAnalyzeEnabled,
      disclaimerAccepted: aiDisclaimerAccepted,
    });
    if (!result.ok) {
      setError(toMessage(result.error, t("toast.aiConfigSaveFailed"), locale));
      return;
    }
    setAiHasKey(true);
    setAiApiKey("");
    setNotice(t("toast.aiConfigSaved"));
    if (alreadyVerified) {
      setAiConfigOpen(false);
      setAiConnectionState("idle");
      setAiConnectionReason(undefined);
      setAiSaveVerifying(false);
      return;
    }
    setAiSaveVerifying(true);
    try {
      const connection = await testAiConnectionFromDialog();
      if (connection.success) {
        setAiConfigOpen(false);
        setAiConnectionState("idle");
        setAiConnectionReason(undefined);
      }
    } finally {
      setAiSaveVerifying(false);
    }
  }

  useEffect(() => {
    if (!aiConfigOpen) {
      aiAutoConnectAttemptedRef.current = false;
      return;
    }
    if (!aiHasKey || aiAutoConnectAttemptedRef.current) return;
    aiAutoConnectAttemptedRef.current = true;
    void testAiConnectionFromDialog();
  }, [aiConfigOpen, aiHasKey, testAiConnectionFromDialog]);

  async function fetchAiModelsFromDialog(): Promise<{
    models: string[];
    reason?: string;
  }> {
    if (!api) return { models: [], reason: t("aiConfig.fetchModelsFailed") };
    const result = await api.listAiModels({
      apiFormat: aiApiFormat,
      ...(aiApiKey.trim() ? { apiKey: aiApiKey.trim() } : {}),
      baseUrl: aiBaseUrl.trim() || undefined,
    });
    if (!result.ok) {
      return {
        models: [],
        reason: toMessage(
          result.error,
          t("aiConfig.fetchModelsFailed"),
          locale,
        ),
      };
    }
    return {
      models: result.value.models,
      reason: result.value.reason,
    };
  }

  async function handleAnalyzeClick(
    assetId = selectedAssetId,
    batchIds?: readonly string[],
  ) {
    if (!api || !library) {
      setError(t("toast.aiAnalyzeFailed"));
      return;
    }
    const targetIds = [
      ...new Set(
        (batchIds && batchIds.length > 0
          ? batchIds
          : assetId
            ? [assetId]
            : []
        ).filter(Boolean),
      ),
    ] as string[];
    if (targetIds.length === 0) {
      setError(t("toast.aiAnalyzeNoAsset"));
      return;
    }
    if (!aiHasKey) {
      setError(t("command.reason.aiNotConfigured"));
      void loadAiConfig();
      return;
    }
    analyzeFailedBaselineRef.current = aiJobs?.failed ?? 0;
    analyzeSucceededBaselineRef.current = aiJobs?.succeeded ?? 0;
    analyzingAssetIdRef.current = targetIds[0] ?? null;
    analyzingBatchSizeRef.current = targetIds.length;
    // Serpent-kdnm: capture baseline failed jobs before enqueue so old
    // failures do not immediately re-open the connection dialog.
    try {
      const status = await api.getAiJobStatus({ libraryId: library.libraryId });
      if (status.ok) {
        setAiJobs(status.value);
        notifyAiConnectionBatchStarted(status.value.jobs);
      } else {
        notifyAiConnectionBatchStarted(aiJobs?.jobs ?? []);
      }
    } catch {
      notifyAiConnectionBatchStarted(aiJobs?.jobs ?? []);
    }
    flushSync(() => {
      aiAnalyzingRef.current = true;
      setAiAnalyzing(true);
    });
    setNotice(
      targetIds.length > 1
        ? t("toast.aiAnalyzeStartedBatch", { count: targetIds.length })
        : t("toast.aiAnalyzeStarted"),
    );
    void loadAiJobs(true);
    let queuedAny = false;
    let syncDone = false;
    try {
      for (const id of targetIds) {
        const result = await api.analyzeAsset({
          libraryId: library.libraryId,
          assetId: id,
        });
        if (!result.ok) {
          setError(toMessage(result.error, t("toast.aiAnalyzeFailed"), locale));
          continue;
        }
        if ("queued" in result.value && result.value.queued) {
          queuedAny = true;
          continue;
        }
        if ("reason" in result.value) {
          setNotice(
            t("toast.aiAnalyzeUnavailable", { reason: result.value.reason }),
          );
          continue;
        }
        if (!("generatedFields" in result.value)) {
          setError(t("toast.aiAnalyzeFailed"));
          continue;
        }
        syncDone = true;
        const analyzed = result.value;
        if (targetIds.length === 1) {
          setAiContent({
            assetId: id,
            description: analyzed.generatedFields.description,
            tags: analyzed.generatedFields.tags,
            rating: analyzed.generatedFields.rating,
            modelVersion: analyzed.modelVersion,
          });
          const human =
            metadataByAssetRef.current.get(id)?.description ?? "";
          const description = resolveInspectorDescription(
            human,
            analyzed.generatedFields.description,
          );
          if (selectedAssetIdRef.current === id) {
            setEditDescription(description.value);
            setDescriptionIsAi(description.fromAi);
          }
          setNotice(t("toast.aiAnalyzeDone"));
          await refreshTagAndMetadataState(id);
          await loadAiContentForAsset(id);
        }
      }
      if (queuedAny) {
        void loadAiJobs(true);
      } else if (syncDone && targetIds.length > 1) {
        setNotice(
          t("toast.aiAnalyzeDoneBatch", {
            succeeded: targetIds.length,
            failed: 0,
          }),
        );
        await reloadCurrentContentRef.current();
      }
    } catch (caught) {
      setError(toMessage(caught, t("toast.aiAnalyzeFailed"), locale));
    } finally {
      if (!queuedAny) {
        aiAnalyzingRef.current = false;
        analyzingAssetIdRef.current = null;
        analyzingBatchSizeRef.current = 0;
        setAiAnalyzing(false);
      }
    }
  }

  async function handleClearAiContent(assetIds: string[]) {
    if (!api || !library || assetIds.length === 0) return;
    // Product brief: batch clear requires confirmation (UI gate; worker only
    // enforces confirm for folder/library scopes).
    if (
      assetIds.length > 1 &&
      !confirm(
        t("toast.aiContentClearConfirm", { count: String(assetIds.length) }),
      )
    ) {
      return;
    }
    try {
      const result = await api.clearAiContent({
        libraryId: library.libraryId,
        scope: { kind: "asset", assetIds },
        confirm: assetIds.length > 1,
      });
      if (!result.ok) {
        setError(
          toMessage(result.error, t("toast.aiContentClearFailed"), locale),
        );
        return;
      }
      if (
        selectedAssetId &&
        assetIds.includes(selectedAssetId)
      ) {
        setAiContent(null);
      }
      // Toast + list refresh also arrive via onAiCleared.
    } catch (caught) {
      setError(toMessage(caught, t("toast.aiContentClearFailed"), locale));
    }
  }

  async function handlePromoteAiDescription(value: string) {
    if (!api || !library || !selectedAsset) return;
    const trimmed = value.trim();
    const previous = aiContent?.description?.trim() ?? "";
    if (
      aiContent?.assetId !== selectedAsset.assetId ||
      trimmed === previous
    ) {
      return;
    }
    try {
      await saveMetadata({ description: trimmed });
      const cleared = await api.clearAiContent({
        libraryId: library.libraryId,
        scope: { kind: "asset", assetIds: [selectedAsset.assetId] },
        confirm: false,
        fields: ["description"],
      });
      if (!cleared.ok) {
        setError(
          toMessage(cleared.error, t("toast.aiContentClearFailed"), locale),
        );
        return;
      }
      setAiContent((current) => {
        if (!current || current.assetId !== selectedAsset.assetId) return current;
        const { description: _cleared, ...rest } = current;
        const stillHas =
          Boolean(rest.tags && rest.tags.length > 0) || rest.rating != null;
        return stillHas ? rest : null;
      });
      setDescriptionIsAi(false);
      setNotice(t("toast.aiContentPromoted"));
      loadMetadata();
    } catch (caught) {
      setError(toMessage(caught, t("toast.aiContentPromoteFailed"), locale));
    }
  }

  async function loadMediaJobs(quiet = false) {
    if (!api || !library) return;
    if (!quiet) setMediaJobsLoading(true);
    try {
      const result = await api.listMediaJobs({ libraryId: library.libraryId });
      if (!result.ok) {
        if (!quiet) setError(toMessage(result.error, t("toast.mediaJobsLoadFailed"), locale));
        return;
      }
      setMediaJobs(result.value);
    } catch {
      if (!quiet) setError(t("toast.mediaJobsLoadNoResponse"));
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
        if (!quiet) setError(toMessage(result.error, t("toast.aiJobsLoadFailed"), locale));
        return;
      }
      setAiJobs(result.value);
    } catch {
      if (!quiet) setError(t("toast.aiJobsLoadNoResponse"));
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
        setError(toMessage(result.error, t("toast.mediaJobsOpFailed"), locale));
        return;
      }
      await loadMediaJobs(true);
    } catch {
      setError(t("toast.mediaJobsOpNoResponse"));
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
        setError(toMessage(result.error, t("toast.aiJobsOpFailed"), locale));
        return;
      }
      if (action === "cancel") {
        aiAnalyzingRef.current = false;
        analyzingAssetIdRef.current = null;
        analyzingBatchSizeRef.current = 0;
        setAiAnalyzing(false);
        setNotice(t("toast.aiAnalyzeStopped"));
      }
      await loadAiJobs(true);
    } catch {
      setError(t("toast.aiJobsOpNoResponse"));
    }
  }
  controlAiJobsRef.current = controlAiJobs;

  // Handle inline input keydown for collection creation
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
    <>
    <HoverTipHost />
    <EditTextContextMenuHost />
    <main
      className={`app-shell${leftOpen ? "" : " left-collapsed"}${rightOpen ? "" : " right-collapsed"}${panelResizing ? " is-resizing" : ""}`}
      style={panelResizeShellStyle as React.CSSProperties}
    >
      <header className="app-toolbar">
        <div className="toolbar-cluster toolbar-leading">
          <ToolButton
            icon={leftOpen ? "panel-left-close" : "panel-left"}
            label={leftOpen ? t("shell.collapseNav") : t("shell.expandNav")}
            onClick={() => setLeftOpen((v) => !v)}
            pressed={leftOpen}
          />
          <ScopeHistoryButtons
            canBack={navHistoryUi.canBack}
            canForward={navHistoryUi.canForward}
            onBack={() => void goWorkspaceBack()}
            onForward={() => void goWorkspaceForward()}
          />
          <div className="toolbar-library-settings">
            <LibrarySwitcher
              busy={busy}
              disabled={busy}
              importMenuCopy={importMenuCopy}
              libraryName={library?.displayName ?? null}
              libraryOpen={Boolean(library)}
              onCloseLibrary={() => void closeLibrary()}
              onRemoveLibrary={() => void removeLibrary()}
              onDeleteLibraryFromDisk={() => requestDeleteLibraryFromDisk()}
              onCreateLibrary={() => {
                setDialogValue(t("shell.myLibrary"));
                setDialog("library");
              }}
              onExportLibrary={() => setExportDialogOpen(true)}
              onImportFiles={() => void importAssets("files")}
              onImportFolder={() => void importAssets("folder")}
              onImportLibrary={() => setImportLibraryChooserOpen(true)}
              onImportLinkedFolder={() => void importFolderAsLinked()}
              onMenuOpen={() => void refreshRecentLibraries()}
              onOpenLibrary={() => void runLibraryOperation("open")}
              onOpenRecent={(path) => void openRecentLibrary(path)}
              onForgetRecent={(path) => void forgetRecentLibrary(path)}
              onPasteImage={() => void pasteClipboardImage()}
              recentLibraries={recentLibraries}
            />
            <AppSettingsEntry
              disabled={busy}
              onOpen={() => setAppSettingsOpen(true)}
            />
          </div>
        </div>
        <ScopeBreadcrumbs
          onNavigateFolder={(folderId) => void chooseFolder(folderId)}
          segments={buildScopeBreadcrumbSegments(
            {
              showTrash,
              activeTagLabel: activeTagId
                ? (tags.find((tag) => tag.tagId === activeTagId)?.name ?? null)
                : null,
              activeCollectionLabel: activeCollectionId
                ? (collections.find(
                    (collection) =>
                      collection.collectionId === activeCollectionId,
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
                  ? (linkedFolders.find(
                      (folder) => folder.folderId === assetScope,
                    )?.displayName ?? null)
                  : null,
            },
            t,
          )}
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
            data-hover-tip={t("toolbar.aiSearchTitle")}
            disabled={!library || aiSearchLoading}
            onClick={() => {
              setAiSearchEnabled((enabled) => !enabled);
              setActiveAiSearchDefinition(null);
              setAiSearchPlanSummary(null);
            }}
            type="button"
          >
            <Icon name="smart" size={14} />
            {t("toolbar.aiSearch")}
          </button>
          <div className="search-control-wrap">
            <input
              aria-label={t("toolbar.searchLibrary")}
              className="search-control"
              disabled={!library}
              onChange={(event) => {
                setSearchValue(event.target.value);
                setActiveAiSearchDefinition(null);
                setAiSearchPlanSummary(null);
              }}
              placeholder={
                aiSearchEnabled
                  ? t("toolbar.aiSearchPlaceholder")
                  : t("toolbar.searchPlaceholder")
              }
              title={
                aiSearchEnabled
                  ? t("toolbar.aiSearchHint")
                  : t("toolbar.searchHint")
              }
              value={searchValue}
            />
            {searchValue.trim() !== "" && (
              <button
                aria-label={t("toolbar.clearSearch")}
                className="search-clear-btn"
                disabled={!library}
                onClick={() => {
                  setSearchValue("");
                  setActiveAiSearchDefinition(null);
                  setAiSearchPlanSummary(null);
                }}
                type="button"
              >
                <Icon name="close" size={12} />
              </button>
            )}
          </div>
          {searchValue.trim() !== "" && (
            <span className="search-active-chip" title={searchValue.trim()}>
              {t("toolbar.searchingFor", { query: searchValue.trim() })}
            </span>
          )}
          <button
            className="compact-action is-accent"
            disabled={
              !library ||
              aiSearchLoading ||
              (aiSearchEnabled && !searchValue.trim())
            }
            type="submit"
          >
            <Icon name="search" size={14} />
            {aiSearchLoading ? t("toolbar.converting") : t("common.search")}
          </button>
          {aiSearchPlanSummary && (
            <span
              className="ai-search-plan-summary"
              title={aiSearchPlanSummary}
            >
              {aiSearchPlanSummary}
            </span>
          )}
          <ToolButton
            icon={rightOpen ? "panel-right-close" : "panel-right"}
            label={rightOpen ? t("shell.collapseInspector") : t("shell.expandInspector")}
            onClick={() => setRightOpen((v) => !v)}
            pressed={rightOpen}
          />
        </form>
        {IS_WINDOWS_PLATFORM ? (
          <WindowsWindowControls shell={shellApi} />
        ) : null}
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
        collections={collections}
        collectionTree={collectionTree}
        smartCollections={smartCollections}
        linkedFolders={linkedFolders}
        showCollectionInput={showCollectionInput}
        collectionInputValue={collectionInputValue}
        newCollectionParentId={newCollectionParentId}
        collectionRecursive={collectionRecursive}
        collectionRecursiveRef={collectionRecursiveRef}
        draggedCollectionId={draggedCollectionId}
        onSetDraggedCollectionId={setDraggedCollectionId}
        onChooseAllAssets={() => void chooseFolder("all")}
        onEnterTrash={() => void enterTrash()}
        onChooseFolder={(folderId) => void chooseFolder(folderId)}
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
        onAssetsDroppedOnFolder={(folderId, assetIds, mode) =>
          handleAssetsDroppedOnFolder(folderId, assetIds, mode)
        }
        onAssetsDroppedOnTrash={(assetIds) =>
          handleAssetsDroppedOnTrash(assetIds)
        }
        onAssetsDroppedOnCollection={(collectionId, assetIds, mode) =>
          handleAssetsDroppedOnCollection(collectionId, assetIds, mode)
        }
        onManagedAssetCopyModeChange={(copyMode) => {
          setAssetDragPreviewCopyMode(dragPreviewRef.current, copyMode);
        }}
        onImportFolderAsLinked={() => void importFolderAsLinked()}
        onRelinkFolder={(folderId) => void relinkFolder(folderId)}
        onConvertLinkedDialog={setConvertLinkedDialog}
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
          cancelInlineSmartCollectionEdit();
          openInlineFolderCreate(selectedFolderId ?? null);
        }}
        onAddSmartCollection={() => {
          cancelInlineFolderEdit();
          openInlineSmartCollectionCreate();
        }}
        inlineFolderEdit={inlineFolderEdit}
        onInlineFolderEditChange={changeInlineFolderEdit}
        onInlineFolderEditCommit={(onCreateSuccess) =>
          void commitInlineFolderEdit(onCreateSuccess)
        }
        onInlineFolderEditCancel={cancelInlineFolderEdit}
        inlineSmartCollectionEdit={inlineSmartCollectionEdit}
        onInlineSmartCollectionEditChange={changeInlineSmartCollectionEdit}
        onInlineSmartCollectionEditCommit={() =>
          void commitInlineSmartCollectionEdit()
        }
        onInlineSmartCollectionEditCancel={cancelInlineSmartCollectionEdit}
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
            {library &&
              !showTrash &&
              !activeTagId &&
              !activeCollectionId &&
              !activeSmartCollectionId &&
              assetScope !== "all" &&
              assetScope !== "root" && (
                <button
                  aria-pressed={folderRecursive}
                  className="workspace-include-subfolders"
                  onClick={() => {
                    // Include-subfolders changes the browse result set (REQ-VIEW-004).
                    void closeAssetPreview(false);
                    const next = !folderRecursiveRef.current;
                    folderRecursiveRef.current = next;
                    setFolderRecursive(next);
                    const nextPrefs = withFolderRecursiveEnabled(
                      folderRecursivePrefs,
                      library.libraryId,
                      assetScope,
                      next,
                    );
                    setFolderRecursivePrefs(nextPrefs);
                    saveFolderRecursivePreferences(nextPrefs);
                    void loadContent(library, assetScope, {
                      discovery: currentQueryDefinition(),
                      searchScope: {
                        kind: "folder",
                        folderId: assetScope,
                        recursive: next,
                      },
                    }).catch((caught) => {
                      setError(
                        toMessage(caught, t("toast.readAssetsFailed"), locale),
                      );
                    });
                  }}
                  type="button"
                  {...iconActionAttrs(t("nav.includeChildFolders"))}
                >
                  <Icon name="folders" size={14} />
                </button>
              )}
            <span>{workspaceTitle()}</span>
            <span className="item-count">
              {library ? t("common.itemCount", { count: visibleAssets.length }) : t("common.notLoaded")}
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
                      t("toast.emptyTrashConfirm"),
                    )
                  )
                    void purgeTrash();
                }}
                type="button"
              >
                <Icon name="trash" size={14} />
                {t("toolbar.emptyExpiredTrash")}
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
                  {t("toolbar.batchRelink")}
                </button>
              )
            )}
            <span className="tool-separator" />
            <CanvasToolbarControls
              actions={{
                refresh: () => {
                  void refreshAssets();
                },
                setViewMode: (mode) => {
                  setCanvasPrefs((p) => ({ ...p, viewMode: mode }));
                },
                toggleField: (field) => {
                  setCanvasPrefs((p) => ({
                    ...p,
                    fields: { ...p.fields, [field]: !p.fields[field] },
                  }));
                },
                openBrowserExtension: () => {
                  void openExtensionPairing();
                },
                openBackgroundJobs: () => setMediaJobsOpen(true),
                openAiSettings: () => {
                  void loadAiConfig();
                  setAiConfigOpen(true);
                },
                openAppSettings: () => setAppSettingsOpen(true),
              }}
              busy={busy}
              canvasPrefs={canvasPrefs}
              cardSize={assetCardSize}
              libraryOpen={Boolean(library)}
              locale={locale}
              onCardSizeChange={resizeAssetCards}
              platform={SHORTCUT_PLATFORM}
            />
          </div>
        </div>
        <div
          className={`workspace-discovery${previewAsset ? " is-viewing" : ""}`}
        >
          <DimensionFilterBar
            availabilityFilter={availabilityFilter}
            aspectRatioRange={aspectRatioRange}
            aspectRatioRanges={aspectRatioRanges}
            colorFilter={colorFilter}
            disabled={!library}
            interactionsLocked={dialogFocusTrapActive}
            durationRange={durationRange}
            excludeAvailabilityFilter={excludeAvailabilityFilter}
            excludeColorFilter={excludeColorFilter}
            excludeFormatFilter={excludeFormatFilter}
            excludeRatingFilter={excludeRatingFilter}
            excludeTagFilter={excludeTagFilter}
            favoriteFilter={favoriteFilter}
            formatFilter={formatFilter}
            heightRange={heightRange}
            longEdgeRange={longEdgeRange}
            onClearFilter={clearDiscoveryFilter}
            onTagNamesChange={(names) => {
              // Discovery tag filters overlay the current folder/collection
              // scope. Do not set activeTagId — that is "browse by tag" mode
              // (chooseTag) and would clear folder nav highlight + folder cards
              // (Serpent-w9c6 / resolveFolderBrowseParentId).
              setTagFilter(names.join(", "));
              setActiveTagId(null);
            }}
            ratingFilter={ratingFilter}
            setAspectRatioRange={setAspectRatioRange}
            setAspectRatioRanges={setAspectRatioRanges}
            setAvailabilityFilter={setAvailabilityFilter}
            setColorFilter={setColorFilter}
            setDurationRange={setDurationRange}
            setExcludeAvailabilityFilter={setExcludeAvailabilityFilter}
            setExcludeColorFilter={setExcludeColorFilter}
            setExcludeFormatFilter={setExcludeFormatFilter}
            setExcludeRatingFilter={setExcludeRatingFilter}
            setExcludeTagFilter={setExcludeTagFilter}
            setFavoriteFilter={setFavoriteFilter}
            setFormatFilter={setFormatFilter}
            setHeightRange={setHeightRange}
            setLongEdgeRange={setLongEdgeRange}
            setRatingFilter={setRatingFilter}
            setSortField={setSortField}
            setSortOrder={setSortOrder}
            setSourceUrlFilter={setSourceUrlFilter}
            setTagFilter={setTagFilter}
            setWidthRange={setWidthRange}
            snapshot={{
              colorFilter,
              excludeColorFilter,
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
              aspectRatioRanges,
              longEdgeRange,
              durationRange,
            }}
            sortField={sortField}
            sortOrder={sortOrder}
            sourceUrlFilter={sourceUrlFilter}
            tagFilter={tagFilter}
            tags={tags}
            widthRange={widthRange}
          />
        </div>
        {(aiAnalyzing ||
          (aiJobs !== null && aiJobs.queued + aiJobs.running > 0)) &&
          (() => {
            const batchProgress = computeAiBatchProgress(
              analyzingBatchSizeRef.current,
              {
                succeeded: analyzeSucceededBaselineRef.current,
                failed: analyzeFailedBaselineRef.current,
              },
              {
                queued: aiJobs?.queued ?? 0,
                running: aiJobs?.running ?? 0,
                succeeded: aiJobs?.succeeded ?? 0,
                failed: aiJobs?.failed ?? 0,
              },
            );
            const progressLabel =
              batchProgress.batchTotal > 0
                ? t("toast.aiAnalyzeProgressCount", {
                    done: String(batchProgress.done),
                    total: String(batchProgress.batchTotal),
                  })
                : t("toast.aiAnalyzeStarted");
            return (
              <div className="workspace-ai-progress" role="status">
                <div className="workspace-ai-progress-body">
                  <div className="workspace-ai-progress-headline">
                    <span className="activity-pulse" aria-hidden />
                    <span className="workspace-ai-progress-message">
                      {progressLabel}
                    </span>
                  </div>
                  {batchProgress.batchTotal > 0 && (
                    <div
                      aria-valuemax={batchProgress.batchTotal}
                      aria-valuemin={0}
                      aria-valuenow={batchProgress.done}
                      className="task-progress-track workspace-ai-progress-bar"
                      role="progressbar"
                    >
                      <div
                        className="task-progress-fill"
                        style={{
                          width: `${Math.round((batchProgress.ratio ?? 0) * 100)}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
                <div className="workspace-ai-progress-actions">
                  <button
                    className="secondary-button"
                    onClick={() => void controlAiJobs("cancel")}
                    type="button"
                  >
                    {t("toast.aiAnalyzeStop")}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => setMediaJobsOpen(true)}
                    type="button"
                  >
                    {t("toolbar.backgroundJobs")}
                  </button>
                </div>
              </div>
            );
          })()}
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
              <strong>{t("toolbar.dropToImport")}</strong>
              <span>
                {activeCollectionId
                  ? t("toolbar.dropHintWithCollection")
                  : t("toolbar.dropHint")}
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
              <span className="activity-strip-message">
                {t("toolbar.importingProgress")}
              </span>
            </div>
          )}
          {exportProgress &&
            !["complete", "cancelled", "failed"].includes(
              exportProgress.phase,
            ) && (
              <div className="activity-strip" role="status">
                <span className="activity-pulse" />
                <span className="activity-strip-message">
                  {t("progress.exportingLibrary")}
                  {exportProgress.phase === "snapshot-db"
                    ? t("progress.snapshotDb")
                    : exportProgress.phase === "enumerate"
                      ? t("progress.enumerateFiles")
                      : exportProgress.phase === "compress"
                        ? t("progress.compressing")
                        : t("progress.copyingFiles", {
                            processed: exportProgress.filesProcessed,
                            total: exportProgress.totalFiles,
                            bytesProcessed: formatBytes(
                              exportProgress.bytesProcessed,
                            ),
                            bytesTotal: formatBytes(exportProgress.totalBytes),
                          })}
                </span>
                <button
                  className="secondary-button"
                  disabled={!exportProgress.exportId}
                  onClick={() => void cancelExport()}
                  type="button"
                >
                  {t("progress.cancelExport")}
                </button>
              </div>
            )}
          {importProgress &&
            !["complete", "cancelled", "failed"].includes(
              importProgress.phase,
            ) && (
              <div className="activity-strip" role="status">
                <span className="activity-pulse" />
                <span className="activity-strip-message">
                  {t("progress.importingLibrary")}
                  {importProgress.phase === "validate"
                    ? t("progress.validating")
                    : importProgress.phase === "copy"
                      ? t("progress.copying")
                      : t("progress.opening")}
                </span>
                <button
                  className="secondary-button"
                  disabled={!importProgress.importId}
                  onClick={() => void cancelImport()}
                  type="button"
                >
                  {t("progress.cancelImport")}
                </button>
              </div>
            )}
          {library ? (
            browseCanvasBodyLayout.mode !== "empty" ? (
              <>
                {browseCanvasBodyLayout.showFolders && (
                  <div
                    className={
                      browseCanvasBodyLayout.mode === "folders-only"
                        ? "folder-card-row is-folders-only"
                        : "folder-card-row"
                    }
                    style={
                      { "--folder-card-size": `${assetCardSize}px` } as CSSProperties
                    }
                  >
                    {folderBrowseEntries.map((entry) => (
                      <FolderCard
                        entry={entry}
                        key={entry.folderId}
                        libraryId={library.libraryId}
                        onClick={(folderId, event) => {
                          if (handleFolderCardClick(folderId, event) === "navigate") {
                            void chooseFolder(folderId);
                          }
                        }}
                        onContextMenu={(clickedEntry, event) => {
                          event.preventDefault();
                          setSelectedFolderIds([clickedEntry.folderId]);
                          setSelectedAssetIds([]);
                          openContextMenu(
                            {
                              type: "folder",
                              folderId: clickedEntry.folderId,
                              name: clickedEntry.name,
                              locationKind: "managed",
                            },
                            { x: event.clientX, y: event.clientY },
                          );
                        }}
                        onDoubleClick={(folderId) => void chooseFolder(folderId)}
                        onMouseDown={(event) => {
                          cardMouseDownRef.current = event.button;
                        }}
                        selected={selectedFolderIdSet.has(entry.folderId)}
                      />
                    ))}
                  </div>
                )}
                {browseCanvasBodyLayout.showAssetGrid && (
                  <div
                    className={`asset-grid is-${assetViewMode}`}
                    style={assetGridLayoutStyle(assetViewMode, assetCardSize)}
                  >
                  {(() => {
                    const showCornerBadges =
                      shouldShowAssetCardBadges(assetCardSize);
                    const cards = visibleAssets.map((asset) => {
                      const typeBadge = assetTypeBadgeLabel(
                        asset.mediaType,
                        asset.displayName,
                      );
                      const showExtension =
                        showCornerBadges &&
                        canvasPrefs.fields.badgeExtension &&
                        shouldShowExtensionBadge(asset.mediaType);
                      const showDuration =
                        showCornerBadges &&
                        canvasPrefs.fields.badgeDuration &&
                        shouldShowDurationBadge(
                          asset.mediaType,
                          asset.displayName,
                          asset.durationMs,
                        );
                      const showTypeBadge =
                        showCornerBadges &&
                        canvasPrefs.fields.badgeType &&
                        Boolean(typeBadge) &&
                        shouldShowTypeBadgeAlongsideExtension(showExtension) &&
                        !asset.deletedAt &&
                        !shouldShowMissingAssetOverlay(asset.availability);
                      const sourceBadgeLabel =
                        showCornerBadges &&
                        canvasPrefs.fields.badgeSource &&
                        !showTrash &&
                        shouldShowAssetSourceBadge(
                          sourceBadgeContext,
                          asset.managedFolderId,
                        )
                          ? resolveAssetSourceBadgeLabel(
                              folders,
                              asset.managedFolderId,
                              selectedFolderId ?? null,
                            )
                          : null;
                      const snippetCaption = resolveSearchSnippetCaption(
                        searchSnippets.get(asset.assetId),
                        asset.displayName,
                      );
                      const renamingThisAsset =
                        assetRenameDialog?.assetId === asset.assetId;
                      const CardTag = renamingThisAsset ? "div" : "button";
                      return (
                    <CardTag
                      aria-label={canvasPrefs.fields.name ? undefined : asset.displayName}
                      aria-pressed={selectedIdSet.has(asset.assetId)}
                      className={`asset-card${selectedIdSet.has(asset.assetId) ? " is-selected" : ""}${asset.availability === "missing" ? " is-missing" : ""}${asset.deletedAt ? " is-trashed" : ""}${renamingThisAsset ? " is-renaming" : ""}`}
                      data-asset-id={asset.assetId}
                      title={asset.displayName}
                      draggable={!showTrash && !renamingThisAsset}
                      key={asset.assetId}
                      {...(renamingThisAsset
                        ? { role: "group" as const }
                        : { type: "button" as const })}
                      onMouseDown={(e) => {
                        cardMouseDownRef.current = e.button;
                      }}
                      onMouseEnter={() => {
                        setHoveredAssetId(asset.assetId);
                      }}
                      onMouseLeave={() => {
                        clearHoveredAssetId(asset.assetId);
                      }}
                      onClick={(event) => {
                        if (renamingThisAsset) return;
                        handleCardClick(asset.assetId, event);
                      }}
                      onDoubleClick={() => {
                        if (renamingThisAsset) return;
                        openAssetPreview(asset);
                      }}
                      onDragEnd={() => {
                        setDraggedMemberId(null);
                        // REQ-DND-003: unmount the custom drag ghost.
                        dismissAssetDragPreview(dragPreviewRef.current);
                        dragPreviewRef.current = null;
                      }}
                      onDragOver={(event) => {
                        if (draggedMemberId) event.preventDefault();
                      }}
                      onDragStart={(event) => {
                        // Collection member reorder keeps its own drag path.
                        if (activeCollectionId && !collectionRecursive) {
                          setDraggedMemberId(asset.assetId);
                          event.dataTransfer.effectAllowed = "move";
                          return;
                        }
                        // REQ-DND-001/002: folder/trash drops resolve this
                        // selection snapshot at the target (asset-drag-drop.ts).
                        const ids = resolveDraggedAssetIds(asset.assetId, selectedAssetIds);
                        event.dataTransfer.setData(
                          MANAGED_ASSETS_DRAG_TYPE,
                          JSON.stringify(ids),
                        );
                        // Serpent-aa3: Option/Alt during dragover selects copy
                        // vs move via dropEffect; both must be allowed here.
                        event.dataTransfer.effectAllowed = "copyMove";
                        // REQ-DND-003: replace Chromium's full-card ghost with
                        // the small, translucent, rounded preview tile
                        // (asset-drag-preview.ts); the same serpent:// URL as
                        // the card's <img>, so it is already cached.
                        const preview = showAssetDragPreview({
                          thumbnailUrl:
                            asset.thumbnailStatus === "ready" &&
                            asset.thumbnailArtifactId &&
                            library
                              ? `serpent://preview/${library.libraryId}/${asset.thumbnailArtifactId}`
                              : null,
                          fileName: asset.displayName,
                          count: ids.length,
                          copyMode: resolveDragDropMode({
                            altKey: event.altKey,
                          }) === "copy",
                        });
                        dragPreviewRef.current = preview;
                        event.dataTransfer.setDragImage(
                          preview,
                          ASSET_DRAG_PREVIEW_WIDTH / 2,
                          ASSET_DRAG_PREVIEW_HEIGHT / 2,
                        );
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
                        {(() => {
                          const thumbCover =
                            asset.thumbnailStatus === "ready" &&
                            asset.thumbnailArtifactId &&
                            library
                              ? coverSrc(
                                  library.libraryId,
                                  asset.thumbnailArtifactId,
                                )
                              : null;
                          const cardActive =
                            activePreviewAssetId === asset.assetId;
                          if (isCardHoverPreviewable(asset)) {
                            if (
                              thumbCover ||
                              (cardActive && activeResolution?.url)
                            ) {
                              return (
                                <AssetCardMedia
                                  alt={asset.displayName}
                                  coverUrl={thumbCover}
                                  isActive={cardActive}
                                  preview={
                                    cardActive ? activeResolution : null
                                  }
                                />
                              );
                            }
                          } else if (thumbCover) {
                            return (
                              <img
                                alt={asset.displayName}
                                className="asset-thumbnail"
                                loading="lazy"
                                src={thumbCover}
                              />
                            );
                          }
                          return (
                            <>
                              {!showExtension &&
                                shouldShowExtensionBadge(asset.mediaType) && (
                                  <span className="asset-extension">
                                    {fileExtensionLabel(asset.displayName)}
                                  </span>
                                )}
                              <Icon name="file" size={28} />
                            </>
                          );
                        })()}
                        {sourceBadgeLabel && (
                          <span
                            aria-label={t("scope.containingFolder", {
                              name: sourceBadgeLabel,
                            })}
                            className="asset-source-badge"
                            title={t("scope.containingFolder", {
                              name: sourceBadgeLabel,
                            })}
                          >
                            {sourceBadgeLabel}
                          </span>
                        )}
                        {showExtension && (
                          <span className="asset-extension">
                            {fileExtensionLabel(asset.displayName)}
                          </span>
                        )}
                        {thumbnailFailures.has(asset.assetId) && (
                          <span className="missing-banner">
                            <Icon name="warning" size={12} />
                            {t("toast.thumbnailFailedBadge")}
                          </span>
                        )}
                        {shouldShowMissingAssetOverlay(asset.availability) && (
                          <span
                            aria-label={t("inspector.missing")}
                            title={t("inspector.missing")}
                            className="missing-overlay"
                          >
                            <Icon name="link-off" size={28} />
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
                            {t("inspector.trashed")}
                            {asset.remainingDays !== null &&
                              t("scope.remainingDays", {
                                days: asset.remainingDays,
                              })}
                          </span>
                        )}
                        {showDuration && asset.durationMs != null && (
                          <span className="asset-duration-badge">
                            {formatDuration(asset.durationMs)}
                          </span>
                        )}
                        {showTypeBadge && typeBadge && (
                          <span className="asset-type-badge">{typeBadge}</span>
                        )}
                      </div>
                      {(renamingThisAsset ||
                        canvasPrefs.fields.name ||
                        canvasPrefs.fields.size ||
                        canvasPrefs.fields.date ||
                        snippetCaption != null ||
                        (asset.deletedAt && asset.trashedFromPath) ||
                        (assetViewMode === "grid" &&
                          asset.width != null &&
                          asset.height != null)) && (
                        <div className="asset-caption">
                          {assetViewMode === "grid" &&
                            asset.width != null &&
                            asset.height != null &&
                            !renamingThisAsset && (
                              <span className="asset-dimensions">
                                {asset.width} × {asset.height}
                              </span>
                            )}
                          {(canvasPrefs.fields.name || renamingThisAsset) && (
                            <>
                              {renamingThisAsset && assetRenameDialog ? (
                                <span className="asset-inline-rename">
                                  <input
                                    aria-label={t("dialog.rename.fileTitle")}
                                    autoFocus
                                    className="text-field asset-inline-rename-input"
                                    disabled={assetRenameDialog.submitting}
                                    onBlur={() => {
                                      void submitAssetRename();
                                    }}
                                    onChange={(event) =>
                                      changeAssetRenameValue(event.target.value)
                                    }
                                    onClick={(event) => event.stopPropagation()}
                                    onKeyDown={(event) => {
                                      event.stopPropagation();
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        void submitAssetRename();
                                      } else if (event.key === "Escape") {
                                        event.preventDefault();
                                        cancelAssetRename();
                                      }
                                    }}
                                    onMouseDown={(event) => event.stopPropagation()}
                                    value={assetRenameDialog.value}
                                  />
                                  {assetRenameDialog.extension ? (
                                    <span className="asset-inline-rename-ext">
                                      {assetRenameDialog.extension}
                                    </span>
                                  ) : null}
                                  {assetRenameDialog.error ? (
                                    <span className="asset-inline-rename-error">
                                      {assetRenameDialog.error}
                                    </span>
                                  ) : null}
                                </span>
                              ) : (
                                <strong title={asset.displayName}>
                                  {asset.displayName}
                                </strong>
                              )}
                            </>
                          )}
                          {snippetCaption != null ? (
                            <span className="search-snippet">
                              {highlightSnippet(snippetCaption)}
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
                              {trashedFromLabel(asset.trashedFromPath, locale)}
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
                                formatDate(asset.modifiedAt, locale, t("common.unknownTime"))}
                            </span>
                          ) : null}
                        </div>
                      )}
                    </CardTag>
                    );
                    });
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
                    ) : (
                      <JustifiedAssetRows
                        assets={visibleAssets}
                        cardSize={assetCardSize}
                        captionBandPx={resolveJustifiedCaptionBandPx({
                          // Flat/tiled always renders「宽 × 高」when metadata exists.
                          dimensions: true,
                          name: canvasPrefs.fields.name,
                          secondary:
                            canvasPrefs.fields.size ||
                            canvasPrefs.fields.date ||
                            showTrash ||
                            searchSnippets.size > 0,
                        })}
                      >
                        {cards}
                      </JustifiedAssetRows>
                    );
                  })()}
                  <div
                    className="asset-loading-more"
                    ref={loadMoreSentinelRef}
                    role="status"
                  >
                    {loadingMoreAssets && (
                      <>
                        <span className="activity-pulse" />
                        {t("progress.loadingMore")}
                      </>
                    )}
                  </div>
                  </div>
                )}
              </>
            ) : (
              <div className="empty-library">
                <div className="empty-orbit">
                  <Icon name={browseEmptyState.icon} size={24} />
                </div>
                <h1>{t(browseEmptyState.titleKey)}</h1>
                <p>{t(browseEmptyState.detailKey)}</p>
                {browseEmptyState.showImportActions ? (
                  <div className="empty-actions">
                    <button
                      className="primary-button"
                      onClick={() => void importAssets("files")}
                      type="button"
                    >
                      {t("toolbar.importFiles")}
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => void importAssets("folder")}
                      type="button"
                    >
                      {t("toolbar.importFolder")}
                    </button>
                  </div>
                ) : null}
              </div>
            )
          ) : (
            <div className="empty-state">
              <div className="empty-copy">
                {/* REQ-SHELL-008/009: the «01» step sidebar and the decorative
                    English caption are gone — the form renders directly. */}
                <h1>{t("empty.noLibraryTitle")}</h1>
                <p>{t("empty.noLibraryBody")}</p>
                <div className="empty-actions">
                  <button
                    className="primary-button"
                    onClick={() => {
                      setDialogValue(t("shell.myLibrary"));
                      setDialog("library");
                    }}
                    type="button"
                  >
                    <Icon name="plus" size={15} />
                    {t("shell.createLibrary")}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => void runLibraryOperation("open")}
                    type="button"
                  >
                    <Icon name="folder" size={15} />
                    {t("shell.openLibrary")}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => setImportLibraryChooserOpen(true)}
                    type="button"
                  >
                    <Icon name="download" size={15} />
                    {t("toolbar.importLibrary")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        {renderedToast && (
          <div
            className={`toast${renderedToast.kind === "error" ? " is-error" : ""}${renderedToast.kind === "warning" ? " is-warning" : ""}${toastClosing ? " is-closing" : ""}`}
            onTransitionEnd={handleToastTransitionEnd}
            role={renderedToast.kind === "error" ? "alert" : "status"}
          >
            <Icon
              name={
                renderedToast.kind === "error"
                  ? "warning"
                  : renderedToast.kind === "warning"
                    ? "warning"
                    : "info"
              }
              size={15}
            />
            <span>{renderedToast.text}</span>
            {renderedToast.kind === "notice" && lastMoveOperationId && (
              <button
                className="secondary-button"
                onClick={() => void undoManagedMove(lastMoveOperationId)}
                type="button"
              >
                {t("action.undoMove")}
              </button>
            )}
            <IconActionButton
              omitClassName
              icon="close"
              label={t("common.closeHint")}
              onClick={() => {
                setError(null);
                setNotice(null);
              }}
            />
          </div>
        )}
        {previewAsset && library && api && (
          <AssetPreviewModal
            api={api}
            asset={previewAsset}
            chromeIdle={viewerChromeIdle}
            key={previewAsset.assetId}
            libraryId={library.libraryId}
            onChromeActivity={onViewerChromeActivity}
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
        aiAnalyzing={aiAnalyzing}
        descriptionIsAi={descriptionIsAi}
        showAiBadges={aiUiPrefs.showAiBadges}
        allAssetCount={allAssetCount}
        allTags={tags}
        api={api}
        assetMetadata={assetMetadata}
        automaticPaletteRatios={automaticPaletteRatios}
        displayedPalette={displayedPalette}
        editDescription={editDescription}
        editFavorite={editFavorite}
        editRating={editRating}
        editSourceUrl={editSourceUrl}
        editAuthor={editAuthor}
        folderCount={folders.length}
        handleFavoriteToggle={handleFavoriteToggle}
        handleMetadataDescriptionInput={handleMetadataDescriptionInput}
        handleMetadataDescriptionSave={handleMetadataDescriptionSave}
        handleRatingClick={handleRatingClick}
        handleSourceUrlInput={handleSourceUrlInput}
        handleSourceUrlSave={handleSourceUrlSave}
        handleAuthorInput={handleAuthorInput}
        handleAuthorSave={handleAuthorSave}
        library={library}
        loadMetadata={loadMetadata}
        onAssignTagToAsset={(tagId) => void handleInspectorAssignTag(tagId)}
        onCreateAndAssignTag={(tagName) => void handleInspectorCreateAndAssignTag(tagName)}
        onOpenSourceUrl={handleOpenSourceUrl}
        onPaletteColorCopy={(color, copied) => {
          if (copied) {
            setNotice(t("toast.colorCopiedAlt", { color }));
          } else {
            setError(t("toast.colorCopyUnavailable"));
          }
        }}
        onRemoveTagFromAsset={(tagId) => void handleInspectorRemoveTag(tagId)}
        selectedAsset={selectedAsset}
        selectedAssets={selectedAssets}
        multiEdit={multiEdit}
        versionConflict={versionConflict}
      />
      {!leftOpen && (
        <IconActionButton
          className="pane-reveal pane-reveal-left"
          icon="panel-left"
          label={t("shell.expandNav")}
          onClick={() => setLeftOpen(true)}
          size={15}
        />
      )}
      {!rightOpen && (
        <IconActionButton
          className="pane-reveal pane-reveal-right"
          icon="panel-right"
          label={t("shell.expandInspector")}
          onClick={() => setRightOpen(true)}
          size={15}
        />
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
        kind={renameTarget?.kind ?? "collection"}
        currentName={renameTarget?.name ?? ""}
        onNameChange={(name) =>
          setRenameTarget((current) =>
            current ? { ...current, name } : current,
          )
        }
        onSave={() => {
          if (!renameTarget) return;
          if (renameTarget.kind === "collection")
            void renameCollection();
          else {
            const target = renameTarget;
            setRenameTarget(null);
            void renameSmartCollection(target.id, target.name);
          }
        }}
        onCancel={() => setRenameTarget(null)}
      />
      <AppSettingsDialog
        aiUiPrefs={aiUiPrefs}
        canvasPrefs={canvasPrefs}
        onClose={() => setAppSettingsOpen(false)}
        onSetViewMode={(mode) => {
          setCanvasPrefs((p) => ({ ...p, viewMode: mode }));
        }}
        onToggleField={(field) => {
          setCanvasPrefs((p) => ({
            ...p,
            fields: { ...p.fields, [field]: !p.fields[field] },
          }));
        }}
        onToggleShowAiBadges={() => {
          setAiUiPrefs((p) => ({ ...p, showAiBadges: !p.showAiBadges }));
        }}
        open={appSettingsOpen}
      />
      {smartCollectionSettings ? (
        <SmartCollectionSettingsDialog
          key={smartCollectionSettings.collectionId}
          onClose={() => setSmartCollectionSettings(null)}
          onRename={async (collectionId, name) => {
            await renameSmartCollection(collectionId, name);
            setSmartCollectionSettings((current) =>
              current && current.collectionId === collectionId
                ? { ...current, name }
                : current,
            );
          }}
          onSaveCurrentQuery={async (collectionId) => {
            await updateSmartCollectionQuery(collectionId);
          }}
          target={smartCollectionSettings}
        />
      ) : null}
      <CreateDialog
        open={dialog !== null}
        value={dialogValue}
        onValueChange={setDialogValue}
        onSubmit={() => {
          setDialog(null);
          void runLibraryOperation("create");
        }}
        onCancel={() => {
          setDialog(null);
        }}
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
      <ImportLibraryChooserDialog
        open={importLibraryChooserOpen}
        onCancel={() => setImportLibraryChooserOpen(false)}
        onImportFolder={() => {
          setImportLibraryChooserOpen(false);
          void startImport();
        }}
        onImportZip={() => {
          setImportLibraryChooserOpen(false);
          void startImportZip();
        }}
      />
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
      {diskDeleteTarget && (
        <DiskDeleteConfirmDialog
          subjectName={diskDeleteTarget.name}
          onCancel={cancelDiskDelete}
          onConfirm={(dontShowAgain) => confirmDiskDelete(dontShowAgain)}
        />
      )}
      {libraryDiskDeletePending && library && (
        <DiskDeleteConfirmDialog
          bodyKey="dialog.diskDelete.libraryBody"
          subjectName={library.displayName}
          onCancel={() => setLibraryDiskDeletePending(false)}
          onConfirm={(dontShowAgain) => {
            void confirmDeleteLibraryFromDisk(dontShowAgain);
          }}
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
      <AiConnectionFailureDialog
        failedCount={aiConnectionFailureGate.failedJobIds.length}
        onAbort={onAiConnectionFailureAbort}
        onRetry={handleAiConnectionFailureRetry}
        open={aiConnectionFailureGate.open}
      />
      <AiConfigDialog
        open={aiConfigOpen}
        apiKey={aiApiKey}
        apiFormat={aiApiFormat}
        model={aiModel}
        baseUrl={aiBaseUrl}
        languages={aiLanguages}
        hasKey={aiHasKey}
        descriptionEnabled={aiDescriptionEnabled}
        tagsEnabled={aiTagsEnabled}
        ratingEnabled={aiRatingEnabled}
        forceExistingTags={aiForceExistingTags}
        analysisSettings={aiAnalysisSettings}
        disclaimerAccepted={aiDisclaimerAccepted}
        autoAnalyzeEnabled={aiAutoAnalyzeEnabled}
        connectionState={aiConnectionState}
        connectionReason={aiConnectionReason}
        onApiKeyChange={setAiApiKey}
        onApiFormatChange={setAiApiFormat}
        onModelChange={setAiModel}
        onBaseUrlChange={setAiBaseUrl}
        onLanguagesChange={setAiLanguages}
        onDescriptionEnabledChange={setAiDescriptionEnabled}
        onTagsEnabledChange={setAiTagsEnabled}
        onRatingEnabledChange={setAiRatingEnabled}
        onForceExistingTagsChange={setAiForceExistingTags}
        onAnalysisSettingsChange={setAiAnalysisSettings}
        onDisclaimerAcceptedChange={setAiDisclaimerAccepted}
        onAutoAnalyzeEnabledChange={setAiAutoAnalyzeEnabled}
        saveVerifying={aiSaveVerifying}
        onClose={() => {
          if (aiSaveVerifying) return;
          setAiConfigOpen(false);
          setAiApiKey("");
          setAiConnectionState("idle");
          setAiConnectionReason(undefined);
        }}
        onSave={() => void saveAiConfig()}
        onTestConnection={testAiConnectionFromDialog}
        onFetchModels={fetchAiModelsFromDialog}
      />
      <MediaJobsDialog
        open={mediaJobsOpen && library !== null}
        mediaJobs={mediaJobs}
        mediaJobsLoading={mediaJobsLoading}
        aiJobs={aiJobs}
        onClose={() => setMediaJobsOpen(false)}
        onControlMediaJobs={(action, jobIds) => void controlMediaJobs(action, jobIds)}
        onControlAiJobs={(action, jobIds) => void controlAiJobs(action, jobIds)}
        onRevealAppLog={() => {
          const shellBridge = (window as RendererWindow).serpent?.shell;
          if (!shellBridge?.revealAppLog) {
            setError(t("toast.aiRevealLogFailed"));
            return;
          }
          void shellBridge.revealAppLog().then((result) => {
            if (!result.ok) setError(t("toast.aiRevealLogFailed"));
          });
        }}
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
        onRenameOrganization={(id, name) => setRenameTarget({ kind: "collection", id, name })}
        onEditCollectionDetails={(collectionId) => {
          const collection = collections.find((c) => c.collectionId === collectionId);
          if (collection)
            setCollectionEditor({
              collectionId: collection.collectionId,
              description: collection.description ?? "",
              coverAssetId: collection.coverAssetId ?? "",
            });
        }}
        onDeleteOrganization={(id) => {
          void deleteCollection(id);
        }}
        onCreateSubfolder={(folderId) => {
          cancelInlineSmartCollectionEdit();
          openInlineFolderCreate(folderId);
        }}
        onRenameFolder={(folderId, currentName) => {
          cancelInlineSmartCollectionEdit();
          openInlineFolderRename(folderId, currentName);
        }}
        onOpenFolderInFileManager={(folderId) => {
          void handleOpenFolderInFileManager(folderId);
        }}
        onCopyFolderPath={(folderId) => {
          void handleCopyFolderPath(folderId);
        }}
        onOpenLinkedRules={(folder) => void openLinkedRules(folder)}
        onTrashManagedFolder={(folderId, name) => {
          void trashManagedFolder(folderId, name);
        }}
        onDeleteFolderFromDisk={({ folderId, name, locationKind, linkedRelativePath }) => {
          if (locationKind === "managed") {
            openDiskDelete({ kind: "managed", folderId, name });
            return;
          }
          if (linkedRelativePath) {
            openDiskDelete({
              kind: "linked-child",
              linkedFolderId: folderId,
              relativePath: linkedRelativePath,
              name,
            });
          }
        }}
        onRemoveLinkedFolder={(folderId, name) => {
          void removeLinkedFolder(folderId, name);
        }}
        onTrashLinkedFolderSubtree={(linkedFolderId, relativePath, name) => {
          void trashLinkedFolderSubtree(linkedFolderId, relativePath, name);
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
        onAnalyze={(assetId, batchIds) => {
          void handleAnalyzeClick(assetId, batchIds);
        }}
        onClearAiContent={(assetIds) => { void handleClearAiContent(assetIds); }}
        canAnalyze={aiHasKey && !aiAnalyzing}
        onCopyToLinked={(folder, assetIds) => { void copyManagedSelectionToLinked(folder, assetIds); }}
        onClearSelection={clearAssetSelection}
        onOpenExternal={(assetId) => { void handleOpenExternal(assetId); }}
        onViewAsset={(assetId) => {
          const asset = visibleAssets.find((item) => item.assetId === assetId);
          if (asset) openAssetPreview(asset);
        }}
        onRevealInFolder={(assetId) => { void handleRevealInFolder(assetId); }}
        onCopyFilePath={(assetId) => { void handleCopyFilePath(assetId); }}
        onRenameAssetFile={(assetId) => { openAssetRename(assetId); }}
        onRemoveFromCurrentCollection={(assetId) => {
          if (activeCollectionId) void removeAssetFromCollection(assetId, activeCollectionId);
        }}
        onRemoveFromCollection={(assetId, collectionId) => { void removeAssetFromCollection(assetId, collectionId); }}
        onAssignTag={(assetId, tagId) => { void assignAssetToTag(assetId, tagId); }}
        onAddToCollection={(assetId, collectionId) => { void addAssetToCollection(assetId, collectionId); }}
        onLoadCollectionMemberships={loadCollectionMemberships}
      />
      {/* REQ-SHELL-007 / REQ-SHELL-011 pane resize + edge restore handles. */}
      {leftOpen ? (
        <div
          aria-label={t("shell.resizeNav")}
          aria-orientation="vertical"
          className={`panel-resizer${panelResizing === "nav" ? " is-active" : ""}`}
          data-hover-tip={t("shell.resizeNav")}
          onDoubleClick={() => resetPanelWidth("nav")}
          onPointerDown={(event) => {
            event.preventDefault();
            beginPanelResize("nav", event.clientX);
          }}
          role="separator"
          style={{ left: navPanelWidth - 3 }}
        />
      ) : (
        <div
          aria-label={t("shell.restoreNavEdge")}
          aria-orientation="vertical"
          className={`panel-resizer panel-resizer-edge${panelResizing === "nav" ? " is-active" : ""}`}
          data-hover-tip={t("shell.restoreNavEdge")}
          onPointerDown={(event) => {
            event.preventDefault();
            beginPanelEdgeRestore("nav", event.clientX);
          }}
          role="separator"
          style={{ left: 0 }}
        />
      )}
      {rightOpen ? (
        <div
          aria-label={t("shell.resizeInspector")}
          aria-orientation="vertical"
          className={`panel-resizer${panelResizing === "inspector" ? " is-active" : ""}`}
          data-hover-tip={t("shell.resizeInspector")}
          onDoubleClick={() => resetPanelWidth("inspector")}
          onPointerDown={(event) => {
            event.preventDefault();
            beginPanelResize("inspector", event.clientX);
          }}
          role="separator"
          style={{ right: inspectorPanelWidth - 3 }}
        />
      ) : (
        <div
          aria-label={t("shell.restoreInspectorEdge")}
          aria-orientation="vertical"
          className={`panel-resizer panel-resizer-edge${panelResizing === "inspector" ? " is-active" : ""}`}
          data-hover-tip={t("shell.restoreInspectorEdge")}
          onPointerDown={(event) => {
            event.preventDefault();
            beginPanelEdgeRestore("inspector", event.clientX);
          }}
          role="separator"
          style={{ right: 0 }}
        />
      )}
    </main>
    </>
  );
}

export function App() {
  return (
    <ContextMenuProvider>
      <AppInner />
    </ContextMenuProvider>
  );
}

function organizationNoun(kind: OrganizationKind, locale: AppLocale) {
  return translateForLocale(
    locale,
    kind === "collection"
      ? "dialog.rename.nounCollection"
      : "dialog.rename.nounSmartCollection",
  );
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
function describeAiSearchPlan(plan: AiSearchPlan, locale: AppLocale): string {
  const parts = [
    plan.keywords.length + plan.synonyms.length > 0
      ? translateForLocale(locale, "aiPlan.terms", {
          count: plan.keywords.length + plan.synonyms.length,
        })
      : undefined,
    plan.exclusions.length > 0
      ? translateForLocale(locale, "aiPlan.exclusions", {
          count: plan.exclusions.length,
        })
      : undefined,
    plan.filters.length > 0
      ? translateForLocale(locale, "aiPlan.filters", {
          count: plan.filters.length,
        })
      : undefined,
    plan.sort ? translateForLocale(locale, "aiPlan.withSort") : undefined,
  ].filter((part): part is string => Boolean(part));
  return translateForLocale(locale, "aiPlan.summary", {
    parts: parts.join(" · "),
  });
}
function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
function formatDate(value: string, locale: AppLocale, unknownLabel: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? unknownLabel
    : new Intl.DateTimeFormat(locale, {
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
type OrganizationOperation = "create" | "rename" | "delete" | "removeAsset";

function organizationAction(
  kind: OrganizationKind,
  operation: OrganizationOperation,
  locale: AppLocale,
) {
  const noun = organizationNoun(kind, locale);
  switch (operation) {
    case "create":
      return translateForLocale(locale, "toast.orgCreate", { noun });
    case "rename":
      return translateForLocale(locale, "toast.orgRename", { noun });
    case "delete":
      return translateForLocale(locale, "toast.orgDelete", { noun });
    case "removeAsset":
      return translateForLocale(locale, "toast.orgRemoveAsset");
  }
}

function toOrganizationMessage(
  error: unknown,
  kind: OrganizationKind,
  operation: OrganizationOperation,
  locale: AppLocale,
) {
  const noun = organizationNoun(kind, locale);
  const action = organizationAction(kind, operation, locale);
  if (error instanceof LibraryOperationError) {
    const reason = error.reason
      ? translateForLocale(locale, `error.reason.${error.reason}`)
      : undefined;
    const detail = (() => {
      switch (error.code) {
        case "INVALID_FOLDER_NAME":
          return translateForLocale(locale, "toast.nameEmpty", { noun });
        case "FOLDER_ALREADY_EXISTS":
          return translateForLocale(locale, "toast.nameConflict", { noun });
        case "FOLDER_NOT_FOUND":
          return translateForLocale(locale, "toast.targetGone", { noun });
        case "ASSET_NOT_FOUND":
          return translateForLocale(locale, "toast.assetGone");
        default: {
          if (reason) return reason;
          const codeKey = `error.code.${error.code}`;
          const codeMsg = translateForLocale(locale, codeKey);
          return codeMsg !== codeKey
            ? codeMsg
            : translateForLocale(locale, "toast.opFailedSeeLog");
        }
      }
    })();
    const message = translateForLocale(locale, "toast.opFailedReason", {
      action,
      detail,
    });
    return reason && detail !== reason ? `${message} ${reason}` : message;
  }
  const detail =
    error instanceof Error && error.message
      ? error.message
      : translateForLocale(locale, "toast.unknownError");
  return translateForLocale(locale, "toast.opFailedReason", { action, detail });
}
