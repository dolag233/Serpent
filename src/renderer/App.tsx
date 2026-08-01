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
import { iconActionAttrs } from "./icon-action-attrs";
import { EditTextContextMenuHost } from "./edit-text-context-menu";
import { HoverTipHost } from "./hover-tip";
import {
  missingAssetAffordance,
  shouldShowMissingAssetOverlay,
} from "./availability-affordance";
import {
  assetTypeBadgeLabel,
  fileExtensionLabel,
  formatSequenceDuration,
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
  isCardSequencePlayable,
} from "./asset-card-hover-preview";
import { shouldShowThumbnailFailureBadge } from "./thumbnail-failure-badge";
import {
  assetSupportsThumbnail,
  isBenignThumbnailErrorCode,
} from "../shared/thumbnail-support";
import { AssetCardMedia } from "./AssetCardMedia";
import { useAssetCardHoverPreview } from "./use-asset-card-hover-preview";
import { resolveSearchSnippetCaption } from "./search-snippet-caption";
import { parseSearchExpression, splitSearchHighlights } from "./search-expression";
import { ConvertLinkedDialog } from "./ConvertLinkedDialog";
import { LinkedRulesDialog } from "./LinkedRulesDialog";
import { TagManagementWorkspace } from "./TagManagementWorkspace";
import { PermanentDeleteDialog } from "./PermanentDeleteDialog";
import { DiskDeleteConfirmDialog } from "./DiskDeleteConfirmDialog";
import {
  isDiskDeletePromptEnabled,
  setDiskDeletePromptEnabled,
} from "./disk-delete-confirm-preferences";
import { DeleteLinkedDialog } from "./DeleteLinkedDialog";
import { useFolderDeleteActions } from "./use-folder-delete-actions";
import { useFolderOrganizeActions } from "./use-folder-organize-actions";
import { useFolderCommandShortcuts } from "./use-folder-command-shortcuts";
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
import type { AiApiFormat } from "../shared/ai-endpoints";
import type { SearchQuery } from "../shared/asset-types";
import {
  createWorkspaceNavHistory,
  type WorkspaceNavLocation,
} from "./workspace-nav-history";
import { mergeAssetSummaries } from "./merge-asset-summaries";
import {
  RelinkPreview,
  type BatchRelinkPreviewSession,
  formatRelinkExamplePath,
} from "./RelinkPreview";
import { MoveDialog } from "./MoveDialog";
import { RestoreDialog } from "./RestoreDialog";
import { UndoMoveDialog } from "./UndoMoveDialog";
import { ImageSequenceDialog } from "./ImageSequenceDialog";
import { ImageSequenceImportDialog } from "./ImageSequenceImportDialog";
import {
  isImageSequenceImportOffer,
  isImportConflictPlan,
} from "../shared/import-outcome";
import { DEFAULT_IMAGE_SEQUENCE_FPS } from "../shared/image-sequence";
import { NameConflictDialog } from "./NameConflictDialog";
import { ContentDuplicateDialog } from "./ContentDuplicateDialog";
import {
  loadImportConflictPreferences,
  rememberDuplicateDecision,
  rememberNameConflictDecision,
  type RememberedDuplicateDecision,
  type RememberedNameConflictDecision,
} from "./import-conflict-preferences";
import {
  nextImportConflictPhaseAfterName,
  resolveImportConflictPresentation,
  type ImportConflictPhase,
} from "./import-conflict-flow";
import { RenameDialog } from "./RenameDialog";
import {
  CreateDialog,
  type CreateLibraryPhase,
} from "./CreateDialog";
import { CollectionEditorDialog } from "./CollectionEditorDialog";
import {
  AiConfigDialog,
  type AiConnectionState,
} from "./AiConfigDialog";
import {
  cancellationAffectsAiBatch,
  collectRecentAiFailureCodes,
  computeAiBatchProgressForJobs,
  type AiBatchProgressSnapshot,
} from "./ai-analyze-progress";
import { summarizeAiFailureCodes } from "./ai-job-error-message";
import {
  DEFAULT_AI_ANALYSIS_SETTINGS,
  normalizeAiAnalysisSettings,
  toWireAiAnalysisSettings,
  type AiAnalysisSettingsWire,
} from "../shared/ai-analysis-settings";
import { AppSettingsDialog } from "./AppSettingsDialog";
import { AppLogDialog } from "./AppLogDialog";
import { ScriptSandboxPreviewDialog } from "./ScriptSandboxPreviewDialog";
import { AppSettingsEntry } from "./AppSettingsEntry";
import type { AppSettingsCategoryId } from "./app-settings-sections";
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
import { FatalAlertDialog } from "./FatalAlertDialog";
import { useAiConnectionFailure } from "./use-ai-connection-failure";
import { useScrollbarActivity } from "./use-scrollbar-activity";

import {
  ContextMenuProvider,
  useContextMenu,
} from "./context-menu";
import { resolveBrowseContextMenuIntent } from "./browse-selection-menu";
import { buildMultiAssetMenuSkipReport } from "./menu-skip-report";
import { useAssetSelection } from "./useAssetSelection";
import { useDesktopAutomationSelection } from "./use-desktop-automation-selection";
import { useSelectionKeyboard } from "./use-selection-keyboard";
import { useBrowseCommandKeyboard } from "./use-browse-command-keyboard";
import { resolveBrowsePasteDestination } from "./browse-paste-target";
import { useWorkspaceMouseNavigation } from "./use-workspace-mouse-navigation";
import {
  shouldOpenTrashRestoreDialog,
  silentTrashRestoreRequest,
  type TrashRestoreRequest,
} from "./trash-restore-flow";
import { isBrowseScopeAffectedByFolderTrash } from "./folder-trash-scope";
import {
  useBrowserSessionPersist,
  useBrowserSessionRestore,
  usePendingRestoredAssetFocus,
} from "./use-browser-session-restore";
import { useExtensionActiveContext } from "./use-extension-active-context";
import { useExtensionSaveReveal } from "./use-extension-save-reveal";
import { usePendingAssetReveal } from "./use-pending-asset-reveal";
import {
  currentScopeShowsRevealAssets,
  pendingRevealFromAssets,
  sharedBrowseScopeForAssets,
  type PendingAssetReveal,
} from "./pending-asset-reveal";
import { resolveInspectorTagTarget } from "./inspector-tag-target";
import { useBatchActions } from "./useBatchActions";
import { useShellFileActions } from "./use-shell-file-actions";
import { useInspectorMultiEdit } from "./use-inspector-multi-edit";
import { useInspectorAssetMetadata } from "./use-inspector-asset-metadata";
import { useInspectorFieldHandlers } from "./use-inspector-field-handlers";
import { useAssetDragDropHandlers, type UndoableFileOp } from "./use-asset-drag-drop-handlers";
import { useDialogEscapeDismiss } from "./use-dialog-escape-dismiss";
import { useExternalImportHandlers } from "./use-external-import-handlers";
import { useFolderDragDropHandlers } from "./use-folder-drag-drop-handlers";
import { WorkspaceNoticeBanner } from "./WorkspaceNoticeBanner";
import { WorkspaceToolsOverflow } from "./WorkspaceToolsOverflow";
import {
  MANAGED_FOLDERS_DRAG_TYPE,
  resolveDraggedFolderIds,
} from "./folder-drag-drop";
import { importSummaryMessage } from "./import-summary";
import type { DialogEscapeSnapshot } from "./dialog-escape-stack";
import { useAssetRename } from "./useAssetRename";
import { useInlineFolderEdit } from "./use-inline-folder-edit";
import { useInlineSmartCollectionEdit } from "./use-inline-smart-collection-edit";
import { usePanelResize } from "./use-panel-resize";
import { useToastNotifications } from "./useToastNotifications";
import {
  AI_CONNECTION_HEARTBEAT_MS,
  aiAnalyzeConnectionReady,
  aiAnalyzeShowsDisconnectGlyph,
  shouldRunAiConnectionHeartbeat,
} from "./ai-connection-heartbeat";
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
import {
  buildTrashBreadcrumbHops,
  filterTrashedAssetsAtTombstone,
  filterTrashedFoldersAtTombstone,
} from "./trash-browse";
import { invertSelection } from "./invert-selection";
import { trashedFoldersToBrowseEntries } from "./trashed-folder-entries";
import { computeMasonrySelectionAssetIds } from "./masonry-selection-order";
import { shuffleArray } from "./client-shuffle";
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
  TrashedFolderSummary,
} from "../shared/asset-types";
import { hasMeaningfulSmartCollectionCondition } from "../shared/smart-collection-query";
import { expandFormatFilterTokens } from "../shared/text-media";
import type {
  SerpentLibraryApi,
  LibraryApiResult,
  ImportValidatedResult,
  MediaJobStatus,
  AiJobStatus,
} from "../shared/library-api";
import type { SerpentShellApi } from "../shared/external-url";
import type { SerpentAutomationScriptApi } from '../shared/automation-script-api';
import type { SerpentPluginManagerApi } from '../shared/plugin-manager-api';
import type { AppLogEntry, ReadAppLogResult } from "../shared/app-log";
import type {
  ImportConflictPlan,
  ImageSequenceImportOffer,
  RendererLibrarySummary,
  ExportProgressEvent,
  ImportProgressEvent,
} from "../shared/protocol/responses";
import { AssetPreviewModal, type AssetPreviewModalHandle } from "./AssetPreviewModal";
import { TextAssetPreviewTile } from "./TextAssetPreviewTile";
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
  loadBrowseSortPreferences,
  saveBrowseSortPreferences,
} from "./browse-sort-preferences";
import {
  FOLDER_CARD_ROW_INLINE_PADDING_PX,
  masonryAlignedFolderWidthPx,
} from "./folder-card-width";
import { BROWSE_SCOPE_SEARCH } from "./browse-scope-search";
import {
  enumerateDiscreteCardSizes,
  nearestDiscreteCardSize,
  nextDiscreteCardSizeFromWheelDelta,
  stepDiscreteCardSize,
} from "./card-size-stops";
import {
  assetGridLayoutStyle,
  countFittingColumns,
  distributeMasonryItems,
} from "./asset-grid-layout";
import { JustifiedAssetRows } from "./justified-asset-rows";
import {
  estimateMasonryPreviewHeightPx,
  resolveMasonryPreviewStyle,
} from "./masonry-preview-frame";
import {
  captureAnchor,
  pickNearestCard,
  rectLikeFromDomRect,
  type AnchorCard,
  type CanvasAnchor,
} from "./canvas-scroll-anchor";
import {
  captureReflowAnchorFromCards,
  retainReflowAnchor,
  scheduleAnchorRestore,
  type ScrollOffsetSnapshot,
} from "./canvas-reflow-restore";
import {
  captureBrowseViewSnapshot,
  resolveBrowseRestoreScroll,
  type BrowseViewSnapshot,
} from "./view-restore";
import {
  isMacPlatform,
  type CommandPlatform,
} from "./commands/command-types";
import { resolveRendererPlatform } from "./renderer-platform";
import {
  defaultKeyboardCardSize,
  matchGlobalZoomShortcut,
  shouldIgnoreGlobalZoomShortcut,
} from "./global-zoom-shortcuts";

const IS_MAC_PLATFORM = isMacPlatform(navigator.userAgent);
const IS_WINDOWS_PLATFORM =
  resolveRendererPlatform(navigator.userAgent) === "windows";

const SHORTCUT_PLATFORM: CommandPlatform = IS_MAC_PLATFORM ? "mac" : "windows";

type RendererWindow = Window & {
  serpent?: {
    library?: SerpentLibraryApi;
    shell?: SerpentShellApi;
    automation?: SerpentAutomationScriptApi;
    plugins?: SerpentPluginManagerApi;
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
  search?: SearchQuery;
  filters?: FilterClause[];
  sort?: SortDefinition;
};
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
  const availableWidthRef = useRef(0);
  const restoreFrameRef = useRef<number | null>(null);
  const scrollSnapshotRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const canvas = () => element.closest<HTMLElement>(".workspace-canvas");
    const scheduleRawRestore = () => {
      if (restoreFrameRef.current !== null) return;
      const settle = (remaining: number) => {
        const root = canvas();
        const snapshot = scrollSnapshotRef.current;
        if (!root || snapshot === null) {
          restoreFrameRef.current = null;
          return;
        }
        root.scrollTop = Math.min(
          Math.max(0, snapshot),
          Math.max(0, root.scrollHeight - root.clientHeight),
        );
        if (remaining <= 0) {
          scrollSnapshotRef.current = null;
          restoreFrameRef.current = null;
          return;
        }
        restoreFrameRef.current = requestAnimationFrame(() => settle(remaining - 1));
      };
      restoreFrameRef.current = requestAnimationFrame(() => settle(12));
    };
    const updateWidth = () => {
      const width = element.clientWidth;
      const widthChanged = width !== availableWidthRef.current;
      if (widthChanged) {
        availableWidthRef.current = width;
        const root = canvas();
        if (root) scrollSnapshotRef.current = root.scrollTop;
        setAvailableWidth(width);
      }
      if (scrollSnapshotRef.current !== null) {
        if (restoreFrameRef.current !== null) {
          cancelAnimationFrame(restoreFrameRef.current);
          restoreFrameRef.current = null;
        }
        scheduleRawRestore();
      }
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (restoreFrameRef.current !== null) {
        cancelAnimationFrame(restoreFrameRef.current);
      }
    };
  }, []);

  const columnCount = countFittingColumns(availableWidth, cardSize);
  const distributed = distributeMasonryItems(
    assets.map((asset, index) => ({ asset, child: children[index] })),
    columnCount,
    ({ asset }) => {
      // Serpent-5p45: keep column packing consistent with the natural preview
      // height; a fixed cap would create a wider contain-fit letterbox.
      const previewHeight = estimateMasonryPreviewHeightPx(
        asset.width,
        asset.height,
        cardSize,
      );
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

function AppInner() {
  const t = useT();
  const { locale } = useLocale();
  const api = (window as RendererWindow).serpent?.library;
  const shellApi = (window as RendererWindow).serpent?.shell;

  useEffect(() => {
    document.body.classList.toggle("platform-darwin", IS_MAC_PLATFORM);
  }, []);

  useScrollbarActivity();

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
  /** Full trash tombstone list for hierarchy browse (Serpent-6pcd). */
  const [trashedFolders, setTrashedFolders] = useState<TrashedFolderSummary[]>(
    [],
  );
  const [trashBrowseTombstoneId, setTrashBrowseTombstoneId] = useState<
    string | null
  >(null);
  const [masonryGridWidth, setMasonryGridWidth] = useState(0);
  const assetGridRef = useRef<HTMLDivElement | null>(null);
  const [fatalDialogTitle, setFatalDialogTitle] = useState<string | null>(null);
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);
  const managedImportTargetFolderIdRef = useRef<string | undefined>(undefined);
  const [allAssetCount, setAllAssetCount] = useState(0);
  const [selectedAssetId, setSelectedAssetId] = useState<string | undefined>();
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [uiState, setUiState] = useState<UiState>("booting");
  const uiStateRef = useRef(uiState);
  uiStateRef.current = uiState;
  const busy = [
    "booting",
    "creating",
    "opening",
    "closing",
    "loading",
    "importing",
  ].includes(uiState);
  // Toast + fatal alert (REQ-SHELL-010 / Serpent-99lv): controller owns
  // auto-dismiss, severity priority, and the toast closing lifecycle.
  const {
    rendered: renderedToast,
    closing: toastClosing,
    fatal: fatalAlertMessage,
    setError,
    setNotice,
    setFatal,
    dismissVisible,
    handleToastTransitionEnd,
  } = useToastNotifications();
  const dismissFatalAlert = useCallback(() => {
    setFatalDialogTitle(null);
    setFatal(null);
  }, [setFatal]);

  const showBlockingError = useCallback(
    (title: string, message: string) => {
      setFatalDialogTitle(title);
      setFatal(message);
    },
    [setFatal],
  );
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [createLibraryPhase, setCreateLibraryPhase] =
    useState<CreateLibraryPhase>("start");
  const hadLibraryRef = useRef(false);
  const allowRequiredDialogDismissRef = useRef(false);
  const [dialogValue, setDialogValue] = useState(() => t("shell.myLibrary"));
  const [conflicts, setConflicts] = useState<ImportConflictPlan | null>(null);
  const [imageSequenceImportOffer, setImageSequenceImportOffer] =
    useState<ImageSequenceImportOffer | null>(null);
  const [imageSequenceImportError, setImageSequenceImportError] = useState<
    string | null
  >(null);
  const [imageSequenceImportSubmitting, setImageSequenceImportSubmitting] =
    useState(false);
  const [conflictPhase, setConflictPhase] = useState<ImportConflictPhase | null>(
    null,
  );
  const [duplicateDecision, setDuplicateDecision] =
    useState<RememberedDuplicateDecision>("skip");
  const [nameDecision, setNameDecision] =
    useState<RememberedNameConflictDecision>("keep-both");
  const [rememberNameConflict, setRememberNameConflict] = useState(false);
  const [rememberDuplicate, setRememberDuplicate] = useState(false);
  const resolveImportConflictsRef = useRef<
    (
      plan: ImportConflictPlan,
      name: RememberedNameConflictDecision,
      duplicate: RememberedDuplicateDecision,
    ) => Promise<void>
  >(async () => {});
  const presentImportConflicts = useCallback((plan: ImportConflictPlan) => {
    const prefs = loadImportConflictPreferences();
    const presentation = resolveImportConflictPresentation(plan, prefs);
    setConflicts(plan);
    setNameDecision(presentation.nameDecision);
    setDuplicateDecision(presentation.duplicateDecision);
    setRememberNameConflict(false);
    setRememberDuplicate(false);
    setConflictPhase(presentation.phase);
    if (presentation.phase === null) {
      void resolveImportConflictsRef.current(
        plan,
        presentation.nameDecision,
        presentation.duplicateDecision,
      );
    }
  }, []);
  const clearImportConflictsUi = useCallback(() => {
    setConflicts(null);
    setConflictPhase(null);
  }, []);
  const [leftOpen, setLeftOpen] = useState(() => window.innerWidth > 800);
  const [rightOpen, setRightOpen] = useState(() => window.innerWidth > 1020);
  const panelResizeReleaseRef = useRef<() => void>(() => undefined);
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
    onResizeEnd: () => panelResizeReleaseRef.current(),
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
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [formatFilter, setFormatFilter] = useState("");
  const [excludeFormatFilter, setExcludeFormatFilter] = useState(false);
  const [colorFilter, setColorFilter] = useState("");
  const [excludeColorFilter, setExcludeColorFilter] = useState(false);
  const [tagFilter, setTagFilter] = useState("");
  const [excludeTagFilter, setExcludeTagFilter] = useState(false);
  // Serpent-eaxs: tag-management AND search ("包含 N 个标签") splits the tag
  // names into separate clauses (clauses are ANDed; values within one clause
  // are ORed). Any explicit filter-bar edit resets this to "any".
  const [tagFilterMatch, setTagFilterMatch] = useState<"any" | "all">("any");
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
  const [sortField, setSortField] = useState<SortDefinition["field"]>(
    () => loadBrowseSortPreferences().field,
  );
  const [sortOrder, setSortOrder] = useState<SortDefinition["order"]>(
    () => loadBrowseSortPreferences().order,
  );
  /** Serpent-hm28: null = normal sort; otherwise client shuffle seed. */
  const [shuffleSeed, setShuffleSeed] = useState<number | null>(null);
  const [, setSearchOffset] = useState(0);
  const [searchTotal, setSearchTotal] = useState<number | null>(null);
  const [searchSnippets, setSearchSnippets] = useState<Map<string, string>>(
    new Map(),
  );
  const { open: openContextMenu, close: closeContextMenu } =
    useContextMenu();
  const hadDiscoveryInput = useRef(false);
  // Auto-search requests can resolve out of order while the user is still
  // typing. Only the newest first-page request may replace the canvas.
  const searchRequestGenerationRef = useRef(0);
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
  // Pending edit values
  const [editDescription, setEditDescription] = useState("");
  const [editRating, setEditRating] = useState(0);
  const [editFavorite, setEditFavorite] = useState(false);
  const [editSourceUrl, setEditSourceUrl] = useState("");
  const [editAuthor, setEditAuthor] = useState("");
  // REQ-SELECT-004: UE-style multi-select Inspector model (null when <2 selected).
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
  useEffect(() => {
    if (!showTrash) {
      queueMicrotask(() => setTrashBrowseTombstoneId(null));
    }
  }, [showTrash]);
  const [showTagManagement, setShowTagManagement] = useState(false);
  const [trashedAssets, setTrashedAssets] = useState<AssetSummary[]>([]);

  const {
    multiEdit,
    rebuildAndApplyMultiEdit,
    saveMetadataForSelection,
    batchSetRatingForSelection,
  } = useInspectorMultiEdit({
    api: api ?? null,
    library,
    selectedAssetIds,
    selectedAssetIdRef,
    metadataByAssetRef,
    metadataConflictAssetIdsRef,
    setEditDescription,
    setEditRating,
    setEditFavorite,
    setEditSourceUrl,
    setEditAuthor,
    setAssetMetadata,
    setAssets,
    setTrashedAssets,
    setNotice,
    setError,
  });
  // Serpent-c9r3: bridge the multi-edit rebuilder into the ai.content.cleared
  // event effect (whose deps intentionally exclude it) via a ref, matching the
  // reloadCurrentContentRef / refreshAfterAiRef pattern.
  const rebuildAndApplyMultiEditRef = useRef<(ids: string[]) => void>(
    () => undefined,
  );

  const [deleteLinkedDialog, setDeleteLinkedDialog] = useState<{
    assetIds: string[];
    displayNames: string;
    deleteSourceFile: boolean;
    canDeleteSourceFile: boolean;
  } | null>(null);
  const [permanentDeleteDialog, setPermanentDeleteDialog] = useState<
    string[] | null
  >(null);
  /** Serpent-9zc: pending irreversible managed-asset disk delete. */
  const [assetDiskDeleteIds, setAssetDiskDeleteIds] = useState<string[] | null>(
    null,
  );
  /** Serpent-koy: pending disk delete for mixed/multi folder cards (+ assets). */
  const [selectionDiskDelete, setSelectionDiskDelete] = useState<{
    assetIds: string[];
    folderIds: string[];
  } | null>(null);
  /** Serpent-9i8: pending irreversible library root deletion. */
  const [libraryDiskDeletePending, setLibraryDiskDeletePending] = useState(false);
  const [restoreDialog, setRestoreDialog] = useState<{
    assetIds: string[];
    target: "original" | "root" | string;
    conflictStrategy: "keep-both" | "replace" | "skip";
  } | null>(null);
  const [moveDialog, setMoveDialog] = useState<{
    assetIds: string[];
    folderIds: string[];
    targetFolderId: string | null;
    conflictStrategy: "keep-both" | "replace" | "skip";
  } | null>(null);
  const [lastUndoableOp, setLastUndoableOp] = useState<UndoableFileOp | null>(
    null,
  );
  const [undoMoveDialog, setUndoMoveDialog] = useState<{
    operationId: string;
    conflictStrategy: "keep-both" | "replace" | "skip";
  } | null>(null);
  const [imageSequenceDialog, setImageSequenceDialog] = useState<{
    assetIds: string[];
    mode: "create" | "update";
    sequenceId?: string;
    frameCount?: number;
    fps: number;
    submitting: boolean;
    error: string | null;
  } | null>(null);
  const [batchRelinkPreview, setBatchRelinkPreview] =
    useState<BatchRelinkPreviewSession | null>(null);
  const [batchRelinkKeepMetadata, setBatchRelinkKeepMetadata] = useState(true);

  // Export / Import state
  const [exportProgress, setExportProgress] =
    useState<ExportProgressEvent | null>(null);
  const [importProgress, setImportProgress] =
    useState<ImportProgressEvent | null>(null);

  // REQ-PREF-001: browse-area general settings panel (theme/language/canvas).
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [appSettingsCategory, setAppSettingsCategory] =
    useState<AppSettingsCategoryId>("general");
  const [smartCollectionSettings, setSmartCollectionSettings] =
    useState<SmartCollectionSettingsTarget | null>(null);
  const [appLogOpen, setAppLogOpen] = useState(false);
  const [scriptSandboxPreviewOpen, setScriptSandboxPreviewOpen] = useState(false);
  const [appLogEntries, setAppLogEntries] = useState<AppLogEntry[]>([]);
  const [appLogLoading, setAppLogLoading] = useState(false);
  const [appLogAutomationCorrelationId, setAppLogAutomationCorrelationId] = useState("");
  const [appLogErrorCode, setAppLogErrorCode] = useState<
    Extract<ReadAppLogResult, { ok: false }>["code"] | null
  >(null);

  async function refreshAppLog(automationCorrelationId = appLogAutomationCorrelationId): Promise<void> {
    const bridge = (window as RendererWindow).serpent?.shell;
    if (!bridge?.readAppLog) {
      setAppLogEntries([]);
      setAppLogErrorCode("read_failure");
      return;
    }
    setAppLogLoading(true);
    try {
      const correlationId = automationCorrelationId.trim();
      const result = await bridge.readAppLog(correlationId === "" ? undefined : correlationId);
      if (result.ok) {
        setAppLogEntries(result.entries);
        setAppLogErrorCode(null);
      } else {
        setAppLogEntries([]);
        setAppLogErrorCode(result.code);
      }
    } finally {
      setAppLogLoading(false);
    }
  }

  function openAppLog(automationCorrelationId = ""): void {
    setAppSettingsOpen(false);
    setMediaJobsOpen(false);
    setAppLogAutomationCorrelationId(automationCorrelationId);
    setAppLogOpen(true);
    void refreshAppLog(automationCorrelationId);
  }

  // AI analysis state
  const [aiApiFormat, setAiApiFormat] = useState<AiApiFormat>("dashscope_native");
  const [aiModel, setAiModel] = useState("qwen3-vl-plus");
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
  const [aiConcurrencyLimit, setAiConcurrencyLimit] = useState(16);
  const [aiMaxAnalysisImageEdgePx, setAiMaxAnalysisImageEdgePx] = useState(2048);
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
  const aiConfigPersistDraftRef = useRef({
    apiFormat: "dashscope_native" as AiApiFormat,
    model: "qwen3-vl-plus",
    baseUrl: "",
    apiKey: "",
    hasKey: false,
    descriptionEnabled: true,
    tagsEnabled: true,
    ratingEnabled: true,
    forceExistingTags: false,
    analysisSettings: toWireAiAnalysisSettings(DEFAULT_AI_ANALYSIS_SETTINGS),
    languages: ["zh-CN"] as Array<"zh-CN" | "en" | "ja" | "ko">,
    concurrencyLimit: 16,
    maxAnalysisImageEdgePx: 2048,
    autoAnalyzeEnabled: false,
    disclaimerAccepted: false,
  });

  useEffect(() => {
    aiConfigPersistDraftRef.current = {
      apiFormat: aiApiFormat,
      model: aiModel,
      baseUrl: aiBaseUrl,
      apiKey: aiApiKey,
      hasKey: aiHasKey,
      descriptionEnabled: aiDescriptionEnabled,
      tagsEnabled: aiTagsEnabled,
      ratingEnabled: aiRatingEnabled,
      forceExistingTags: aiForceExistingTags,
      analysisSettings: aiAnalysisSettings,
      languages: aiLanguages,
      concurrencyLimit: aiConcurrencyLimit,
      maxAnalysisImageEdgePx: aiMaxAnalysisImageEdgePx,
      autoAnalyzeEnabled: aiAutoAnalyzeEnabled,
      disclaimerAccepted: aiDisclaimerAccepted,
    };
  }, [
    aiAnalysisSettings,
    aiApiFormat,
    aiApiKey,
    aiAutoAnalyzeEnabled,
    aiBaseUrl,
    aiConcurrencyLimit,
    aiDescriptionEnabled,
    aiDisclaimerAccepted,
    aiForceExistingTags,
    aiHasKey,
    aiLanguages,
    aiMaxAnalysisImageEdgePx,
    aiModel,
    aiRatingEnabled,
    aiTagsEnabled,
  ]);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const aiAnalyzingRef = useRef(false);
  const [aiProgressBannerVisible, setAiProgressBannerVisible] = useState(true);
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

  const {
    loadMetadata,
    loadAiContentForAsset,
    saveMetadata,
    applyLoadedMetadata,
  } = useInspectorAssetMetadata({
    api: api ?? null,
    library,
    selectedAssetId,
    selectedAssetIdRef,
    selectedAssetIdsRef,
    metadataByAssetRef,
    metadataConflictAssetIdsRef,
    assetMetadata,
    setAssetMetadata,
    setVersionConflict,
    setEditDescription,
    setEditRating,
    setEditFavorite,
    setEditSourceUrl,
    setEditAuthor,
    setDescriptionIsAi,
    aiContentRef,
    setAiContent,
    setAssets,
    setTrashedAssets,
    setNotice,
    setError,
  });

  const analyzingAssetIdRef = useRef<string | null>(null);
  const analyzingBatchSizeRef = useRef(0);
  const aiBatchJobIdsRef = useRef<string[]>([]);
  const aiBatchSkippedCountRef = useRef(0);
  const lastAiBatchJobIdsRef = useRef<string[]>([]);
  const lastAiBatchAssetIdRef = useRef<string | null>(null);
  const aiBatchStatusRequestRef = useRef(0);
  const refreshAiBatchStatusRef = useRef<() => void>(() => undefined);
  const [aiBatchProgress, setAiBatchProgress] =
    useState<AiBatchProgressSnapshot | null>(null);
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
  const previewModalRef = useRef<AssetPreviewModalHandle>(null);
  // REQ-CANVAS-019: read synchronously inside the canvas ResizeObserver
  // callback (which is created once and does not close over fresh state)
  // to skip the reflow-anchor logic while the viewer hides the canvas.
  const previewAssetRef = useRef<AssetSummary | null>(null);
  useLayoutEffect(() => {
    previewAssetRef.current = previewAsset;
  }, [previewAsset]);
  // Serpent-njoy: owned here (not inside AssetPreviewModal, which remounts
  // per-asset via `key`) so switching assets never resets idle by itself.
  // While preview is open, any keyboard/pointer/wheel input wakes chrome;
  // `wakeViewerChrome` also runs when the viewer first opens.
  const {
    idle: viewerChromeIdle,
    onActivity: onViewerChromeActivity,
    wake: wakeViewerChrome,
  } = useViewerChromeIdle(undefined, Boolean(previewAsset));
  const [canvasPrefs, setCanvasPrefs] = useState<CanvasPreferences>(() =>
    loadCanvasPreferences(),
  );
  const assetViewMode = canvasPrefs.viewMode;
  const assetCardSize = canvasPrefs.cardSize;
  const [canvasWidthPx, setCanvasWidthPx] = useState(0);
  const cardSizeStops = useMemo(
    () => enumerateDiscreteCardSizes(canvasWidthPx),
    [canvasWidthPx],
  );
  // Serpent-l67w: folder cards share the flush masonry column width so the
  // folder row lines up with waterfall columns (raw slider size can leave
  // leftover that `1fr` columns absorb).
  const folderCardWidthPx = useMemo(
    () =>
      masonryAlignedFolderWidthPx(
        Math.max(
          0,
          canvasWidthPx - FOLDER_CARD_ROW_INLINE_PADDING_PX * 2,
        ),
        assetCardSize,
      ),
    [assetCardSize, canvasWidthPx],
  );
  const workspaceCanvasRef = useRef<HTMLDivElement>(null);
  // REQ-CANVAS-019: rAF handle for the card-size-slider anchor restore.
  const cardSizeRestoreFrameRef = useRef<number | null>(null);
  // REQ-CANVAS-019: rAF handle for the container-width (sidebar/window
  // resize) anchor restore; separate from the card-size one above so the
  // two triggers never cancel each other's in-flight restoration.
  const reflowRestoreFrameRef = useRef<number | null>(null);
  const cardResizeAnchorRef = useRef<CanvasAnchor | null>(null);
  const cardResizeScrollSnapshotRef = useRef<ScrollOffsetSnapshot | null>(null);
  const reflowAnchorRef = useRef<CanvasAnchor | null>(null);
  const reflowScrollSnapshotRef = useRef<ScrollOffsetSnapshot | null>(null);
  const panelResizeLockRef = useRef(false);
  const panelReflowFrozenWidthRef = useRef<number | null>(null);
  const panelWidthSnapshotRef = useRef({ nav: navPanelWidth, inspector: inspectorPanelWidth });
  const panelResizingRef = useRef(panelResizing);
  useLayoutEffect(() => {
    panelResizingRef.current = panelResizing;
  }, [panelResizing]);

  const capturePanelResizeAnchor = useCallback((lock = true) => {
    const canvas = workspaceCanvasRef.current;
    if (!canvas) return;
    const cards: AnchorCard[] = Array.from(
      canvas.querySelectorAll<HTMLElement>("[data-asset-id]"),
    ).map((el) => ({
      assetId: el.dataset.assetId!,
      ...rectLikeFromDomRect(el.getBoundingClientRect()),
    }));
    reflowAnchorRef.current = captureReflowAnchorFromCards(
      cards,
      rectLikeFromDomRect(canvas.getBoundingClientRect()),
    );
    reflowScrollSnapshotRef.current = {
      left: canvas.scrollLeft,
      top: canvas.scrollTop,
    };
    panelReflowFrozenWidthRef.current = canvas.clientWidth;
    canvas.classList.add("is-reflow-frozen");
    canvas.style.setProperty(
      "--reflow-frozen-width",
      `${panelReflowFrozenWidthRef.current}px`,
    );
    panelResizeLockRef.current = lock;
  }, []);

  const restorePanelAfterResize = useCallback(() => {
    panelResizeLockRef.current = false;
    const canvas = workspaceCanvasRef.current;
    const anchor = reflowAnchorRef.current;
    if (!canvas || !anchor) return;
    scheduleAnchorRestore(
      canvas,
      anchor,
      reflowRestoreFrameRef,
      12,
      () => {
        reflowAnchorRef.current = null;
        reflowScrollSnapshotRef.current = null;
      },
      reflowScrollSnapshotRef.current ?? undefined,
    );
  }, []);

  useEffect(() => {
    window.addEventListener("pointerup", restorePanelAfterResize);
    return () => window.removeEventListener("pointerup", restorePanelAfterResize);
  }, [restorePanelAfterResize]);

  useLayoutEffect(() => {
    panelResizeReleaseRef.current = restorePanelAfterResize;
    return () => {
      panelResizeReleaseRef.current = () => undefined;
    };
  }, [restorePanelAfterResize]);

  useLayoutEffect(() => {
    if (!panelResizing) {
      panelReflowFrozenWidthRef.current = null;
      const canvas = workspaceCanvasRef.current;
      canvas?.classList.remove("is-reflow-frozen");
      canvas?.style.removeProperty("--reflow-frozen-width");
    }
  }, [panelResizing]);

  useLayoutEffect(() => {
    const previous = panelWidthSnapshotRef.current;
    if (
      previous.nav === navPanelWidth &&
      previous.inspector === inspectorPanelWidth
    ) {
      return;
    }
    panelWidthSnapshotRef.current = {
      nav: navPanelWidth,
      inspector: inspectorPanelWidth,
    };
    if (!reflowAnchorRef.current) return;
    const canvas = workspaceCanvasRef.current;
    if (!canvas) return;
    const snapshot = reflowScrollSnapshotRef.current;
    if (snapshot) {
      canvas.scrollLeft = Math.min(
        Math.max(0, snapshot.left),
        Math.max(0, canvas.scrollWidth - canvas.clientWidth),
      );
      canvas.scrollTop = Math.min(
        Math.max(0, snapshot.top),
        Math.max(0, canvas.scrollHeight - canvas.clientHeight),
      );
    }
    // During a drag, keep the raw offset fixed. Applying anchor deltas on
    // every width tick makes the viewport visibly slide with the divider.
    if (panelResizeLockRef.current) return;
    scheduleAnchorRestore(
      canvas,
      reflowAnchorRef.current,
      reflowRestoreFrameRef,
      10,
      () => {
        if (!panelResizingRef.current) {
          reflowAnchorRef.current = null;
          reflowScrollSnapshotRef.current = null;
        }
      },
      snapshot ?? undefined,
    );
  }, [inspectorPanelWidth, navPanelWidth]);
  useEffect(
    () => () => {
      if (cardSizeRestoreFrameRef.current !== null) {
        window.cancelAnimationFrame(cardSizeRestoreFrameRef.current);
      }
      if (reflowRestoreFrameRef.current !== null) {
        window.cancelAnimationFrame(reflowRestoreFrameRef.current);
      }
      reflowAnchorRef.current = null;
      reflowScrollSnapshotRef.current = null;
    },
    [],
  );
  // 筛选与排序面板：外点 / Esc 自动关闭（现代浮层语义），summary 切换不变。
  const pendingRestoredFocusRef = useRef<string | null>(null);
  const pendingRevealRef = useRef<PendingAssetReveal | null>(null);
  const chooseFolderRef = useRef<(scope: AssetScope) => Promise<void>>(
    async () => undefined,
  );
  const revealAfterImportRef = useRef<
    (completion: { assets: AssetSummary[] }) => Promise<void>
  >(async () => undefined);
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
  const backgroundJobsActive = useMemo(() => {
    if (aiAnalyzing) return true;
    const mediaActive =
      (mediaJobs?.queued ?? 0) + (mediaJobs?.running ?? 0) > 0;
    const aiActive = (aiJobs?.queued ?? 0) + (aiJobs?.running ?? 0) > 0;
    return mediaActive || aiActive;
  }, [aiAnalyzing, aiJobs, mediaJobs]);
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
  const handleAiConnectionFailureRetry = useCallback(async () => {
    const retryJobIds = aiConnectionFailureGate.failedJobIds.filter((jobId) =>
      lastAiBatchJobIdsRef.current.includes(jobId),
    );
    // Wait for Worker retry to persist `queued` before re-arming. Otherwise a
    // status refresh can observe the old terminal `failed` state and finish
    // the retried batch immediately.
    await onAiConnectionFailureRetry();
    if (retryJobIds.length === 0) return;
    aiBatchStatusRequestRef.current++;
    aiBatchJobIdsRef.current = retryJobIds;
    aiBatchSkippedCountRef.current = 0;
    analyzingAssetIdRef.current = lastAiBatchAssetIdRef.current;
    analyzingBatchSizeRef.current = retryJobIds.length;
    setAiBatchProgress(computeAiBatchProgressForJobs(retryJobIds, []));
    flushSync(() => {
      aiAnalyzingRef.current = true;
      setAiAnalyzing(true);
      setAiProgressBannerVisible(true);
    });
    void refreshAiBatchStatusRef.current();
  }, [aiConnectionFailureGate.failedJobIds, onAiConnectionFailureRetry]);


  const selectedFolderId =
    assetScope === "all" || assetScope === "root" ? undefined : assetScope;
  const selectedFolder = folders.find(
    (folder) => folder.folderId === selectedFolderId,
  );
  const selectedAsset = showTrash
    ? trashedAssets.find((a) => a.assetId === selectedAssetId)
    : assets.find((asset) => asset.assetId === selectedAssetId);

  const {
    handleMetadataDescriptionInput,
    handleMetadataDescriptionSave,
    handleRatingClick,
    handleFavoriteToggle,
    handleSourceUrlInput,
    handleSourceUrlSave,
    handleAuthorInput,
    handleAuthorSave,
    handleOpenSourceUrl,
  } = useInspectorFieldHandlers({
    api: api ?? null,
    shellApi,
    library,
    selectedAsset,
    selectedAssetId,
    selectedAssetIds,
    assetMetadata,
    multiEdit,
    editDescription,
    editFavorite,
    editSourceUrl,
    editAuthor,
    descriptionIsAi,
    aiContent,
    setEditDescription,
    setEditRating,
    setEditFavorite,
    setEditSourceUrl,
    setEditAuthor,
    setDescriptionIsAi,
    setAiContent,
    saveMetadata,
    saveMetadataForSelection,
    batchSetRatingForSelection,
    loadMetadata,
    setNotice,
    setError,
  });

  const displayedPalette = assetMetadata?.effectivePalette ?? [];
  const automaticPaletteRatios = new Map(
    (assetMetadata?.automaticPalette ?? []).map((color) => [
      color.hex,
      color.ratio,
    ]),
  );

  const visibleAssets = useMemo(() => {
    const base = showTrash
      ? filterTrashedAssetsAtTombstone(
          trashedAssets,
          trashedFolders,
          trashBrowseTombstoneId,
        )
      : assets;
    if (shuffleSeed === null || showTrash) return base;
    return shuffleArray(base, shuffleSeed);
  }, [
    assets,
    showTrash,
    shuffleSeed,
    trashBrowseTombstoneId,
    trashedAssets,
    trashedFolders,
  ]);

  // Serpent-6pcd: assets at the current trash hop only (no source-folder grouping).
  const assetRenderSections = useMemo(
    () => [{ key: "", label: null as string | null, assets: visibleAssets }],
    [visibleAssets],
  );
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
  const canvasFolderBrowseEntries = useMemo(() => {
    if (!showTrash) return folderBrowseEntries;
    return trashedFoldersToBrowseEntries(
      filterTrashedFoldersAtTombstone(trashedFolders, trashBrowseTombstoneId),
    );
  }, [folderBrowseEntries, showTrash, trashBrowseTombstoneId, trashedFolders]);
  const trashBreadcrumbHops = useMemo(
    () =>
      showTrash
        ? buildTrashBreadcrumbHops(
            trashedFolders,
            trashBrowseTombstoneId,
            t("scope.trash"),
          )
        : [],
    [showTrash, t, trashBrowseTombstoneId, trashedFolders],
  );
  const browseCanvasBodyLayout = resolveBrowseCanvasBodyLayout(
    visibleAssets.length,
    canvasFolderBrowseEntries.length,
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
    hoveredAssetId,
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

  const selectionAssetIds = useMemo(() => {
    if (assetViewMode !== "masonry") return undefined;
    return computeMasonrySelectionAssetIds(
      visibleAssets,
      masonryGridWidth,
      assetCardSize,
      canvasPrefs.fields.name ||
        canvasPrefs.fields.size ||
        canvasPrefs.fields.date,
    );
  }, [
    assetCardSize,
    assetViewMode,
    canvasPrefs.fields.date,
    canvasPrefs.fields.name,
    canvasPrefs.fields.size,
    masonryGridWidth,
    visibleAssets,
  ]);

  useLayoutEffect(() => {
    if (assetViewMode !== "masonry") return;
    const element = assetGridRef.current;
    if (!element) return;
    const updateWidth = () => setMasonryGridWidth(element.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [assetViewMode, visibleAssets.length, canvasFolderBrowseEntries.length]);

  // REQ-FOLDER-010 / Serpent-nu6o: selection order must match the canvas,
  // including trash tombstone cards (folderBrowseEntries is empty in trash).
  const visibleFolderIds = useMemo(
    () => canvasFolderBrowseEntries.map((entry) => entry.folderId),
    [canvasFolderBrowseEntries],
  );
  const {
    handleCanvasMouseDown,
    clearAssetSelection,
    selectionAnchorRef,
    setAssetSelectionAnchor,
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
    selectionAssetIds,
    masonryShiftSelection: assetViewMode === "masonry",
    selectedFolderIds,
    setSelectedFolderIds,
    onSelectionCleared: () => {
      setHoveredAssetId(null);
      // An import reveal intentionally re-applies selection once its first
      // content refresh settles. A deliberate blank-canvas click must cancel
      // that pending action, otherwise a just-imported sequence is impossible
      // to deselect for the next 280 ms.
      pendingRevealRef.current = null;
      pendingRestoredFocusRef.current = null;
    },
  });
  const selectedFolderIdSet = useMemo(
    () => new Set(selectedFolderIds),
    [selectedFolderIds],
  );

  const visibleAssetIds = useMemo(
    () => visibleAssets.map((asset) => asset.assetId),
    [visibleAssets],
  );
  const browseScopeAssetIds = useMemo(() => {
    const rows = showTrash ? trashedAssets : assets;
    return rows.map((asset) => asset.assetId);
  }, [showTrash, trashedAssets, assets]);
  const workspaceBrowseCount = useMemo(() => {
    if (showTagManagement) return tags.length;
    if (searchTotal !== null) return searchTotal;
    return showTrash ? trashedAssets.length : visibleAssets.length;
  }, [
    showTagManagement,
    tags.length,
    searchTotal,
    showTrash,
    trashedAssets.length,
    visibleAssets.length,
  ]);
  useSelectionKeyboard({
    enabled: Boolean(library),
    platform: SHORTCUT_PLATFORM,
    previewOpen: Boolean(previewAsset),
    browseScopeAssetIds,
    visibleAssetIds,
    selectedAssetIds,
    setSelectedAssetIds,
    setSelectedAssetId,
    selectionAnchorRef,
    setAssetSelectionAnchor,
    clearAssetSelection,
  });

  useDesktopAutomationSelection({
    shellApi,
    libraryId: library?.libraryId,
    previewOpen: Boolean(previewAsset),
    selectedAssetIds,
    selectedAssetId,
    setSelectedAssetIds,
    setSelectedAssetId,
    setAssetSelectionAnchor,
    setSelectedFolderIds,
  });

  useEffect(() => {
    if (!shellApi) return;
    return shellApi.onInvertSelection(() => {
      if (previewAsset) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (browseScopeAssetIds.length === 0) return;
      const next = invertSelection(browseScopeAssetIds, selectedAssetIds);
      setSelectedAssetIds(next);
      setSelectedAssetId(next.at(-1));
      setAssetSelectionAnchor(next[0] ?? null);
    });
  }, [
    shellApi,
    previewAsset,
    browseScopeAssetIds,
    selectedAssetIds,
    selectionAnchorRef,
    setAssetSelectionAnchor,
  ]);

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
              searchActive: Boolean(searchValue.trim()),
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
  const diskDeleteKeyboardTargets = useMemo(() => {
    const report = buildMultiAssetMenuSkipReport(
      selectedAssetIds,
      visibleAssets,
      selectedFolderIds,
    );
    return {
      assetIds: [...report.trash.processAssetIds],
      folderIds: [...report.trash.processFolderIds],
    };
  }, [selectedAssetIds, visibleAssets, selectedFolderIds]);
  const resizeAssetCards = useCallback(
    (requestedSize: number, clientX?: number, clientY?: number) => {
      const root = workspaceCanvasRef.current;
      const width = root?.clientWidth ?? 0;
      const stops = enumerateDiscreteCardSizes(width);
      const nextSize = nearestDiscreteCardSize(
        Math.min(
          CARD_SIZE_MAX,
          Math.max(CARD_SIZE_MIN, Math.round(requestedSize)),
        ),
        stops,
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
        return {
          assetId: el.dataset.assetId!,
          ...rectLikeFromDomRect(rect),
        };
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
      if (!cardResizeAnchorRef.current) {
        cardResizeAnchorRef.current = anchorState;
        cardResizeScrollSnapshotRef.current = {
          left: root.scrollLeft,
          top: root.scrollTop,
        };
      }

      setCanvasPrefs((p) => ({ ...p, cardSize: nextSize }));
      // Serpent-32p: always re-anchor after settle; width/size reflow may reset
      // scrollTop mid-wait, and bailing left the visible set wrong.
      scheduleAnchorRestore(
        root,
        cardResizeAnchorRef.current,
        cardSizeRestoreFrameRef,
        30,
        () => {
          cardResizeAnchorRef.current = null;
          cardResizeScrollSnapshotRef.current = null;
        },
        cardResizeScrollSnapshotRef.current ?? undefined,
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
    const host = canvas.parentElement;
    const observer = new ResizeObserver(() => {
      // The host is the flex item whose width changes when a divider moves.
      // Read the canvas's current width instead of trusting observer entry
      // ordering when both elements resize in the same notification.
      const width = canvas.clientWidth;
      // `display:none` while viewing reports width 0; ignore both that
      // transition and the transition back (view-restore.ts owns scroll
      // restoration for the viewer close path) by requiring a genuine
      // non-zero-to-non-zero change.
      if (width <= 0) {
        lastWidth = null;
        return;
      }
      setCanvasWidthPx(Math.round(width));
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
      const cards: AnchorCard[] = Array.from(
        canvas.querySelectorAll<HTMLElement>("[data-asset-id]"),
      ).map((el) => ({
        assetId: el.dataset.assetId!,
        ...rectLikeFromDomRect(el.getBoundingClientRect()),
      }));
      // Prefer topmost visible card so the leading visible set (A/B/C) stays
      // after column-count changes — center-nearest jumped too easily.
      reflowAnchorRef.current = retainReflowAnchor(
        reflowAnchorRef.current,
        cards,
        rectLikeFromDomRect(rootRect),
      );
      if (!reflowScrollSnapshotRef.current) {
        reflowScrollSnapshotRef.current = {
          left: canvas.scrollLeft,
          top: canvas.scrollTop,
        };
      }
      if (panelResizeLockRef.current) {
        const snapshot = reflowScrollSnapshotRef.current;
        if (snapshot) {
          canvas.scrollLeft = snapshot.left;
          canvas.scrollTop = snapshot.top;
        }
        return;
      }
      scheduleAnchorRestore(
        canvas,
        reflowAnchorRef.current,
        reflowRestoreFrameRef,
        10,
        () => {
          if (!panelResizingRef.current) {
      reflowAnchorRef.current = null;
      reflowScrollSnapshotRef.current = null;
      cardResizeAnchorRef.current = null;
      cardResizeScrollSnapshotRef.current = null;
          }
        },
        reflowScrollSnapshotRef.current ?? undefined,
      );
    });
    observer.observe(canvas);
    if (host) observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    saveCanvasPreferences(canvasPrefs);
  }, [canvasPrefs]);
  useEffect(() => {
    saveBrowseSortPreferences({
      version: 1,
      field: sortField,
      order: sortOrder,
    });
  }, [sortField, sortOrder]);
  useEffect(() => {
    saveAiUiPreferences(aiUiPrefs);
  }, [aiUiPrefs]);

  useEffect(() => {
    const canvas = workspaceCanvasRef.current;
    if (!canvas) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || previewAsset) return;
      event.preventDefault();
      const wheelSample = {
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
      };
      // Mouse notches: sign-only (one stop). Trackpad pinch: normalize LINE/PAGE
      // into pixels for the continuous high-gain path (Serpent-fvpi / Serpent-7ny).
      const delta =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? event.deltaY * 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? event.deltaY * canvas.clientHeight
            : event.deltaY;
      const stops = enumerateDiscreteCardSizes(canvas.clientWidth);
      const nextSize = nextDiscreteCardSizeFromWheelDelta(
        assetCardSize,
        delta,
        stops,
        wheelSample,
      );
      const rect = canvas.getBoundingClientRect();
      resizeAssetCards(
        nextSize,
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [assetCardSize, previewAsset, resizeAssetCards]);

  // Browse canvas Cmd/Ctrl+=|-|0 — discrete card stops; 0 = default size
  // (Serpent-46i9 / Serpent-7ny). Viewer owns the chord while preview is open.
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
      const stops = enumerateDiscreteCardSizes(canvas?.clientWidth ?? 0);
      resizeAssetCards(
        stepDiscreteCardSize(
          assetCardSize,
          action === "in" ? 1 : -1,
          stops,
        ),
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

  const persistAssetColorSpace = useCallback(async (assetId: string, colorSpace: string | null) => {
    if (!api || !library) return;
    const result = await api.setAssetColorSpaceOverride({
      libraryId: library.libraryId,
      assetId,
      colorSpace,
    });
    if (!result.ok) {
      setError(t("toast.colorSpaceSaveFailed"));
      return;
    }
    setNotice(t("toast.colorSpaceSaved"));
  }, [api, library, setError, setNotice, t]);

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
        trashedFoldersResult,
      ] = await Promise.all([
        api.listFolders(libId),
        api.searchAssets({
          ...libId,
          query: opts?.discovery?.search ?? null,
          filters: opts?.discovery?.filters,
          scope: browseScope,
          sort: opts?.discovery?.sort,
          ...BROWSE_SCOPE_SEARCH,
        }),
        trashMode || scope !== "all"
          ? api.searchAssets({ ...libId, query: null, limit: 1, offset: 0 })
          : Promise.resolve(undefined),
        api.listLinkedFolders(libId),
        api.listTags(libId),
        api.listCollections(libId),
        api.listSmartCollections(libId),
        trashMode
          ? api.listTrashedFolders(libId)
          : Promise.resolve(null),
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
        if (trashedFoldersResult && !trashedFoldersResult.ok) {
          throw new LibraryOperationError(trashedFoldersResult.error);
        }
        setTrashedFolders(trashedFoldersResult?.value ?? []);
      } else {
        setAssets(assetResult.value.items);
        setTrashedFolders([]);
      }
      // Serpent-2oga: drop stale failure badges when the list already has ready thumbs.
      setThumbnailFailures((current) => {
        if (current.size === 0) return current;
        const next = new Map(current);
        for (const asset of assetResult.value.items) {
          if (
            asset.thumbnailStatus === "ready" ||
            !assetSupportsThumbnail(asset)
          ) {
            next.delete(asset.assetId);
          }
        }
        return next.size === current.size ? current : next;
      });
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

  useBrowserSessionRestore({
    api: api ?? null,
    loadContent,
    collectionRecursiveRef,
    folderRecursiveRef,
    setFolderRecursive,
    setLibrary,
    setShowTrash,
    setTrashedAssets,
    setAssetScope,
    setActiveTagId,
    setTagFilter,
    setActiveCollectionId,
    setActiveSmartCollectionId,
    setAssets,
    setSearchTotal,
    setSelectedAssetId,
    setSelectedAssetIds,
    setAssetSelectionAnchor,
    pendingRestoredFocusRef,
    navHistoryRef,
    setNavHistoryUi,
    setUiState,
    setError,
  });
  useExtensionActiveContext({
    api: api ?? null,
    libraryId: library?.libraryId ?? null,
    showTrash,
    activeTagId,
    activeCollectionId,
    activeSmartCollectionId,
    assetScope,
  });
  useBrowserSessionPersist({
    library,
    selectedAsset,
    showTrash,
    activeTagId,
    tags,
    activeCollectionId,
    activeSmartCollectionId,
    assetScope,
  });
  usePendingRestoredAssetFocus({
    pendingRestoredFocusRef,
    workspaceCanvasRef,
    assets,
    trashedAssets,
    selectedAssetId,
  });
  usePendingAssetReveal({
    pendingRevealRef,
    assets,
    setSelectedAssetIds,
    setSelectedAssetId,
    setAssetSelectionAnchor,
    pendingRestoredFocusRef,
  });
  useExtensionSaveReveal({
    api: api ?? null,
    libraryId: library?.libraryId,
    chooseFolderRef,
    pendingRevealRef,
  });
  // Serpent-y0au: keep recent libraries warm on the no-library start surface.
  useEffect(() => {
    if (!api || library) return;
    void refreshRecentLibraries(null);
    // refreshRecentLibraries closes over library; null path is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when api/library identity changes
  }, [api, library]);
  // Serpent-kipk: no-library surface is the shared create dialog (start phase),
  // full-window centered with backdrop — not a card inside the canvas.
  useEffect(() => {
    if (library) return;
    if (scriptSandboxPreviewOpen) return;
    if (importLibraryChooserOpen || appSettingsOpen || busy) return;
    if (dialog === "library") return;
    queueMicrotask(() => {
      setDialogValue(t("shell.myLibrary"));
      setCreateLibraryPhase("start");
      setDialog("library");
    });
  }, [
    library,
    dialog,
    importLibraryChooserOpen,
    appSettingsOpen,
    busy,
    scriptSandboxPreviewOpen,
    t,
  ]);
  // Yield the required create surface while another full-window modal is up.
  useEffect(() => {
    if (library) return;
    if (!importLibraryChooserOpen && !appSettingsOpen) return;
    if (dialog === "library") {
      queueMicrotask(() => setDialog(null));
    }
  }, [library, importLibraryChooserOpen, appSettingsOpen, dialog]);
  // Dismiss the auto-opened no-library surface once a library becomes available.
  // Do not close a menu-opened create dialog while a library is already open.
  useEffect(() => {
    if (!library) {
      hadLibraryRef.current = false;
      return;
    }
    if (!hadLibraryRef.current && dialog === "library") {
      setDialog(null);
      setCreateLibraryPhase("start");
    }
    hadLibraryRef.current = true;
  }, [library, dialog]);
  // A headless Console execution can create and bind a library without going
  // through the renderer's library request pipeline. Consume that Main-owned
  // lifecycle event so the welcome shell transitions into the opened library.
  useEffect(() => {
    if (!api || !scriptSandboxPreviewOpen || library) return;
    return api.onLifecycle((event) => {
      if (event.type !== "library.opened") return;
      void (async () => {
        try {
          await closeAssetPreview(false);
          setLibrary(event.library);
          setAssetScope("all");
          setActiveTagId(null);
          setActiveCollectionId(null);
          setActiveSmartCollectionId(null);
          resetNavHistory({ kind: "all" });
          api.setActiveContext(event.library.libraryId);
          await loadContent(event.library, "all");
          await refreshRecentLibraries(event.library.displayPath);
        } catch (caught) {
          setError(toMessage(caught, t("toast.readAssetsFailed"), locale));
        }
      })();
    });
    // loadContent is intentionally read from the current render; adding its
    // per-render function identity would resubscribe the lifecycle bridge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    api,
    closeAssetPreview,
    library,
    locale,
    refreshRecentLibraries,
    resetNavHistory,
    scriptSandboxPreviewOpen,
    setError,
    t,
  ]);
  useEffect(() => {
    if (!api) return;
    return api.onThumbnailEvent((event) => {
      if (event.libraryId !== library?.libraryId) return;
      // A failed worker job can complete before the first post-import browse
      // request puts its asset in `assets` (ENOENT for a missing media tool is
      // especially fast). Keep the result independently so loadContent can
      // render the failure once that request resolves, rather than dropping a
      // terminal error forever because this particular state snapshot is empty.
      if (event.type === "asset.thumbnail.failed") {
        const suppressFailure = isBenignThumbnailErrorCode(event.errorCode);
        setThumbnailFailures((failures) => {
          const next = new Map(failures);
          if (suppressFailure) {
            next.delete(event.assetId);
          } else {
            next.set(
              event.assetId,
              event.reason ?? t("toast.thumbnailFailed"),
            );
          }
          return next;
        });
      }
      setAssets((current) => {
        const asset = current.find((item) => item.assetId === event.assetId);
        if (!asset && event.type === "asset.thumbnail.ready" && event.artifactId) {
          const ownsSequenceFrame = current.some((item) =>
            item.sequence?.frames.some((frame) => frame.assetId === event.assetId),
          );
          if (!ownsSequenceFrame) return current;
          return current.map((item) =>
            item.sequence?.frames.some((frame) => frame.assetId === event.assetId)
              ? {
                  ...item,
                  sequence: {
                    ...item.sequence,
                    frames: item.sequence.frames.map((frame) =>
                      frame.assetId === event.assetId
                        ? { ...frame, thumbnailArtifactId: event.artifactId ?? null }
                        : frame,
                    ),
                  },
                }
              : item,
          );
        }
        if (!asset) return current;

        if (event.type === "asset.thumbnail.failed") {
          const suppressFailure =
            isBenignThumbnailErrorCode(event.errorCode) ||
            !assetSupportsThumbnail(asset);
          if (suppressFailure) {
            setThumbnailFailures((failures) => {
              if (!failures.has(event.assetId)) return failures;
              const next = new Map(failures);
              next.delete(event.assetId);
              return next;
            });
          }
          if (suppressFailure) return current;
          return current.map((item) =>
            item.assetId === event.assetId
              ? {
                  ...item,
                  thumbnailStatus: "failed",
                  thumbnailArtifactId: null,
                }
              : item,
          );
        }

        if (event.type === "asset.thumbnail.ready" && event.artifactId) {
          setThumbnailFailures((failures) => {
            if (!failures.has(event.assetId)) return failures;
            const next = new Map(failures);
            next.delete(event.assetId);
            return next;
          });
          return current.map((item) =>
            item.assetId === event.assetId
              ? {
                  ...item,
                  thumbnailStatus: "ready" as const,
                  thumbnailArtifactId: event.artifactId ?? null,
                }
              : item,
          );
        }

        if (event.type === "asset.thumbnail.ready") {
          setThumbnailFailures((failures) => {
            if (!failures.has(event.assetId)) return failures;
            const next = new Map(failures);
            next.delete(event.assetId);
            return next;
          });
        }
        return current;
      });
    });
  }, [api, library?.libraryId, t]);
  useEffect(() => {
    if (!api || !library) return;
    const unsubscribeProgress = api.onAiProgress((event) => {
      if (event.libraryId !== library.libraryId) return;
      // Serpent-u0tn: do not arm analyzing UI for background/import auto jobs
      // when no user-initiated batch size was set (JOBS-007 rollback residue).
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
      if (aiAnalyzingRef.current) refreshAiBatchStatusRef.current();
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
      // Serpent-c9r3: clearing AI must NOT disturb the browsing view, selection
      // or scroll position — so we deliberately do NOT call reloadCurrentContent
      // here (a full grid refetch resets the canvas). Grid cards carry no AI
      // badges, so skipping the grid reload leaves no visible AI residue. The
      // only surface that shows AI provenance is the Inspector, so refresh just
      // that: when the current selection (primary, or any member of a
      // multi-selection) was among the cleared assets, reload its metadata +
      // tags + AI content so the Inspector drops the stale AI description /
      // badge / tags / rating immediately instead of waiting for a reselect.
      const affected = new Set(event.affectedAssetIds);
      const selectedIds = selectedAssetIdsRef.current;
      const primary = selectedAssetIdRef.current;
      const selectedAffected =
        (primary != null && affected.has(primary)) ||
        selectedIds.some((id) => affected.has(id));
      if (selectedAffected && primary) {
        void refreshAfterAiRef.current(primary).then(() => {
          if (selectedAssetIdsRef.current.length >= 2) {
            rebuildAndApplyMultiEditRef.current([...selectedAssetIdsRef.current]);
          }
        });
      }
    });
    return () => {
      unsubscribeProgress();
      unsubscribeCompleted();
      unsubscribeCleared();
    };
  }, [api, library, locale, setError, setFatal, setNotice, t]);

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
        await enterTrashAt(location.tombstoneId);
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
      showBlockingError(
        busyState === "creating"
          ? t("dialog.blockingError.libraryCreateFailed")
          : t("dialog.blockingError.libraryOpenFailed"),
        toMessage(caught, failureMessage),
      );
    } finally {
      setUiState(opened ? "ready" : "idle");
    }
  }

  function clearDiscoveryControls() {
    setSearchValue("");
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
    setShowTagManagement(false);
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
      await loadContent(library, scope, {
        discovery: { sort: { field: sortField, order: sortOrder } },
      });
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
  chooseFolderRef.current = chooseFolder;

  async function enterTrash() {
    await enterTrashAt(null);
  }

  async function enterTrashAt(tombstoneId: string | null) {
    if (!library) return;
    await closeAssetPreview(false);
    workspaceCanvasRef.current?.scrollTo({ top: 0, left: 0 });
    if (showTrash) {
      setTrashBrowseTombstoneId(tombstoneId);
      clearAssetSelection();
      if (!suppressNavHistoryRef.current) {
        recordNavigation({ kind: "trash", tombstoneId });
      }
      return;
    }
    setShowTrash(true);
    setTrashBrowseTombstoneId(tombstoneId);
    setShowTagManagement(false);
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
      recordNavigation({ kind: "trash", tombstoneId });
    } catch (caught) {
      setError(toMessage(caught, t("toast.readTrashFailed"), locale));
    } finally {
      setUiState("ready");
    }
  }

  async function enterTagManagement() {
    if (!library) return;
    await closeAssetPreview(false);
    closeContextMenu();
    workspaceCanvasRef.current?.scrollTo({ top: 0, left: 0 });
    setShowTagManagement(true);
    setShowTrash(false);
    setActiveTagId(null);
    setActiveCollectionId(null);
    setActiveSmartCollectionId(null);
    setAssetScope("all");
    clearAssetSelection();
    clearDiscoveryControls();
    setSearchTotal(null);
    setSearchSnippets(new Map());
    api?.setActiveContext(library.libraryId);
    setUiState("loading");
    try {
      if (!api) return;
      const tagResult = await api.listTags({ libraryId: library.libraryId });
      if (!tagResult.ok) throw new LibraryOperationError(tagResult.error);
      setTags(tagResult.value);
    } catch (caught) {
      setError(toMessage(caught, t("toast.readTagAssetsFailed"), locale));
    } finally {
      setUiState("ready");
    }
  }

  async function handleCreateTagInManagement(name: string): Promise<boolean> {
    if (!api || !library) return false;
    try {
      const result = await api.createTag({
        libraryId: library.libraryId,
        name,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      const tagResult = await api.listTags({ libraryId: library.libraryId });
      if (!tagResult.ok) throw new LibraryOperationError(tagResult.error);
      setTags(tagResult.value);
      setNotice(t("toast.tagCreated", { name }));
      return true;
    } catch (caught) {
      setError(toMessage(caught, t("toast.createTagFailed"), locale));
      return false;
    }
  }

  async function handleRenameTagInManagement(
    tagId: string,
    name: string,
  ): Promise<boolean> {
    if (!api || !library) return false;
    try {
      const result = await api.renameTag({
        libraryId: library.libraryId,
        tagId,
        name,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      const tagResult = await api.listTags({ libraryId: library.libraryId });
      if (!tagResult.ok) throw new LibraryOperationError(tagResult.error);
      setTags(tagResult.value);
      setNotice(t("toast.tagRenamed", { name }));
      return true;
    } catch (caught) {
      setError(toMessage(caught, t("toast.renameTagFailed"), locale));
      return false;
    }
  }

  async function handleDeleteTagsInManagement(
    tagIds: string[],
  ): Promise<boolean> {
    if (!api || !library || tagIds.length === 0) return false;
    try {
      const result =
        tagIds.length === 1
          ? await api.deleteTag({
              libraryId: library.libraryId,
              tagId: tagIds[0]!,
            })
          : await api.deleteTags({ libraryId: library.libraryId, tagIds });
      if (!result.ok) throw new LibraryOperationError(result.error);
      const tagResult = await api.listTags({ libraryId: library.libraryId });
      if (!tagResult.ok) throw new LibraryOperationError(tagResult.error);
      setTags(tagResult.value);
      setNotice(
        tagIds.length === 1
          ? t("toast.tagDeleted")
          : t("toast.tagsDeleted", { count: tagIds.length }),
      );
      return true;
    } catch (caught) {
      setError(toMessage(caught, t("toast.deleteTagFailed"), locale));
      return false;
    }
  }

  async function handleMergeTagsInManagement(
    tagIds: string[],
    name: string,
  ): Promise<boolean> {
    if (!api || !library || tagIds.length < 2 || !name.trim()) return false;
    try {
      const result = await api.mergeTags({
        libraryId: library.libraryId,
        sourceTagIds: tagIds,
        name: name.trim(),
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      const tagResult = await api.listTags({ libraryId: library.libraryId });
      if (!tagResult.ok) throw new LibraryOperationError(tagResult.error);
      setTags(tagResult.value);
      setNotice(t("toast.tagMerged", { name: name.trim() }));
      return true;
    } catch (caught) {
      setError(toMessage(caught, t("toast.mergeTagsFailed"), locale));
      return false;
    }
  }

  // Serpent-eaxs: tag-management AND/OR jump — leave management, scope to all
  // assets and apply the selected tag names as one OR clause (any) or one
  // clause per tag (all).
  async function handleSearchTagsFromManagement(
    tagNames: string[],
    match: "all" | "any",
  ) {
    if (!api || !library || tagNames.length === 0) return;
    await closeAssetPreview(false);
    closeContextMenu();
    const joined = tagNames.join(", ");
    workspaceCanvasRef.current?.scrollTo({ top: 0, left: 0 });
    setShowTrash(false);
    setShowTagManagement(false);
    setActiveTagId(null);
    setActiveCollectionId(null);
    setActiveSmartCollectionId(null);
    setAssetScope("all");
    clearAssetSelection();
    setTagFilter(joined);
    setTagFilterMatch(match);
    setSearchOffset(0);
    api.setActiveContext(library.libraryId);
    setUiState("loading");
    try {
      const definition = currentQueryDefinition({
        tagFilter: joined,
        tagFilterMatch: match,
      });
      const result = await api.searchAssets({
        libraryId: library.libraryId,
        query: definition.search ?? null,
        filters: definition.filters,
        sort: definition.sort,
        ...BROWSE_SCOPE_SEARCH,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      applySearchResult(result.value);
    } catch (caught) {
      setError(toMessage(caught, t("toast.readTagAssetsFailed"), locale));
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
    setShowTagManagement(false);
    setActiveTagId(tagId);
    setActiveCollectionId(null);
    setActiveSmartCollectionId(null);
    setAssetScope("all");
    clearAssetSelection();
    setTagFilter(tag.name);
    setTagFilterMatch("any");
    setSearchOffset(0);
    api.setActiveContext(library.libraryId);
    setUiState("loading");
    try {
      const definition = currentQueryDefinition({ tagFilter: tag.name });
      const result = await api.searchAssets({
        libraryId: library.libraryId,
        query: definition.search ?? null,
        filters: definition.filters,
        sort: definition.sort,
        ...BROWSE_SCOPE_SEARCH,
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
    // Keep cache and Inspector editor fields coherent. Updating only
    // `assetMetadata` leaves editRating/editFavorite stale, which made a
    // completed script look as though its metadata write had not applied.
    applyLoadedMetadata(assetId, metadataResult.value);
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
        rebuildAndApplyMultiEdit(ids);
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
    setShowTagManagement(false);
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
        ...BROWSE_SCOPE_SEARCH,
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
    overrides: { tagFilter?: string; tagFilterMatch?: "any" | "all" } = {},
  ): SearchDefinition {
    const filters: FilterClause[] = [];
    const formats = expandFormatFilterTokens(
      formatFilter
        .split(",")
        .map((value) => value.trim().replace(/^\./, ""))
        .filter(Boolean),
    );
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
    if (selectedTags.length > 0) {
      const matchAll =
        (overrides.tagFilterMatch ?? tagFilterMatch) === "all" &&
        selectedTags.length > 1;
      // AND semantics ("包含 N 个标签"): one clause per tag — separate
      // clauses are ANDed, values within a clause are ORed.
      if (matchAll) {
        for (const tag of selectedTags) {
          filters.push({ field: "tag", values: [tag], exclude: excludeTagFilter });
        }
      } else {
        filters.push({
          field: "tag",
          values: selectedTags,
          exclude: excludeTagFilter,
        });
      }
    }
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
      ...(searchValue.trim()
        ? {
            search: parseSearchExpression(searchValue),
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
  ) {
    setAssets(result.items);
    setSearchTotal(result.total);
    setSearchOffset(result.offset + result.items.length);
    setSearchSnippets(
      new Map(
        (result.snippets ?? []).map(
          (snippet) => [snippet.assetId, snippet.text] as const,
        ),
      ),
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
      await chooseSmartCollection(activeSmartCollectionId);
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

  async function createSelectedImageSequence() {
    if (!api || !library || !imageSequenceDialog) return;
    setImageSequenceDialog((current) =>
      current ? { ...current, submitting: true, error: null } : current,
    );
    const result = await api.createImageSequence({
      libraryId: library.libraryId,
      assetIds: imageSequenceDialog.assetIds,
      fps: imageSequenceDialog.fps,
    });
    if (!result.ok) {
      setImageSequenceDialog((current) =>
        current
          ? { ...current, submitting: false, error: result.error.message }
          : current,
      );
      return;
    }
    setImageSequenceDialog(null);
    clearAssetSelection();
    await reloadCurrentContent();
    setSelectedAssetIds([result.value.assetId]);
  }

  async function updateImageSequenceFps() {
    if (
      !api ||
      !library ||
      !imageSequenceDialog ||
      imageSequenceDialog.mode !== "update" ||
      !imageSequenceDialog.sequenceId
    ) {
      return;
    }
    setImageSequenceDialog((current) =>
      current ? { ...current, submitting: true, error: null } : current,
    );
    const result = await api.setImageSequenceFps({
      libraryId: library.libraryId,
      sequenceId: imageSequenceDialog.sequenceId,
      fps: imageSequenceDialog.fps,
    });
    if (!result.ok) {
      setImageSequenceDialog((current) =>
        current
          ? { ...current, submitting: false, error: result.error.message }
          : current,
      );
      return;
    }
    setImageSequenceDialog(null);
    await reloadCurrentContent();
  }

  async function dissolveSelectedImageSequence(sequenceId: string) {
    if (!api || !library) return;
    const result = await api.dissolveImageSequence({
      libraryId: library.libraryId,
      sequenceId,
    });
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    clearAssetSelection();
    await reloadCurrentContent();
  }
  useEffect(() => {
    reloadCurrentContentRef.current = reloadCurrentContent;
  });

  async function refreshAfterAutomationScript() {
    try {
      // A script may issue hundreds of write commands. Refresh once after the
      // execution settles so cards retain the current browse scope/selection
      // and Inspector reflects committed metadata without a reload per batch.
      await reloadCurrentContent();
      const selected = selectedAssetIdRef.current;
      if (selected) await refreshTagAndMetadataState(selected);
    } catch (caught) {
      setError(toMessage(caught, t("toast.diskChangedRefreshFailed"), locale));
    }
  }

  const {
    batchAssignTagToSelection,
    batchRemoveTagFromSelection,
    batchAddSelectionToCollection,
    batchRemoveSelectionFromCollection,
    trashManagedAssets,
    deleteManagedAssetsFromDisk,
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
    folders,
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
    handleCopyAssetFiles,
    handleOpenFolderInFileManager,
    handleCopyFolderPath,
    handleCopyFolder,
  } = useShellFileActions({
    api: api ?? null,
    library,
    setError,
    setNotice,
  });

  const browsePasteDestination = resolveBrowsePasteDestination({
    libraryOpen: Boolean(library),
    showTrash,
    showTagManagement,
    assetScope,
    selectedFolderId,
  });

  const { pasteIntoFolder, cloneFolder } =
    useFolderOrganizeActions({
      api: api ?? null,
      libraryId: library?.libraryId ?? null,
      locale,
      setNotice,
      setError,
      setUiState,
      reloadCurrentContent,
      onPasteConflict: (plan) => {
        presentImportConflicts(plan);
      },
      onPasteCompleted: (completion) => revealAfterImportRef.current(completion),
    });

  const osClipboardPasteAtRef = useRef(0);
  const pasteOsClipboardFiles = useCallback(
    (folderId: string | null) => {
      const now = Date.now();
      if (now - osClipboardPasteAtRef.current < 400) return;
      osClipboardPasteAtRef.current = now;
      void pasteIntoFolder(folderId);
    },
    [pasteIntoFolder],
  );

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
    setLastUndoableOp,
  });

  const { handleFoldersDroppedOnFolder } = useFolderDragDropHandlers({
    api: api ?? null,
    libraryId: library?.libraryId ?? null,
    folders,
    setNotice,
    setError,
    setUiState,
    reloadCurrentContent,
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
    createFolderCardDropHandlers,
  } = useExternalImportHandlers({
    api: api ?? null,
    library,
    busy,
    activeCollectionId,
    previewBlocksDrop: Boolean(previewAsset),
    managedImportTargetFolderIdRef,
    reloadCurrentContent,
    reloadCurrentContentRef,
    onImportCompleted: (completion) => revealAfterImportRef.current(completion),
    setUiState,
    setError,
    setNotice,
    setConflicts: (plan) => {
      if (plan === null) clearImportConflictsUi();
      else presentImportConflicts(plan);
    },
    setImageSequenceImportOffer,
    onFoldersDroppedOnFolder: handleFoldersDroppedOnFolder,
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
    getQueryDefinition: () => currentQueryDefinition(),
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

  const resolveManagedFolderName = useCallback(
    (folderId: string) =>
      folders.find((folder) => folder.folderId === folderId)?.name,
    [folders],
  );

  // Serpent-vf8x: folder create/rename/trash chords (mac ⌘ / Windows Ctrl).
  useFolderCommandShortcuts({
    enabled: Boolean(library) && !showTrash,
    platform: SHORTCUT_PLATFORM,
    previewOpen: Boolean(previewAsset),
    browseManagedFolderId: selectedFolder?.folderId ?? null,
    selectedFolderCardIds: selectedFolderIds,
    selectedAssetCount: selectedAssetIds.length,
    resolveManagedFolderName,
    createSubfolder: (parentFolderId) => {
      cancelInlineSmartCollectionEdit();
      openInlineFolderCreate(parentFolderId);
    },
    renameFolder: (folderId, currentName) => {
      cancelInlineSmartCollectionEdit();
      openInlineFolderRename(folderId, currentName);
    },
    trashManagedFolder: (folderId, name) => {
      void trashManagedFolder(folderId, name);
    },
  });

  async function executeSearchDefinition(definition: SearchDefinition) {
    if (!api || !library) return;
    const requestGeneration = ++searchRequestGenerationRef.current;
    const result = await api.searchAssets({
      libraryId: library.libraryId,
      query: definition.search ?? null,
      filters: definition.filters,
      scope: currentSearchScope(),
      sort: definition.sort,
      ...BROWSE_SCOPE_SEARCH,
    });
    if (!result.ok) throw new LibraryOperationError(result.error);
    if (requestGeneration !== searchRequestGenerationRef.current) return;
    setShowTrash(false);
    setShowTagManagement(false);
    if (!tagFilter.trim()) setActiveTagId(null);
    setActiveSmartCollectionId(null);
    if (!pendingRevealRef.current) {
      clearAssetSelection({ preserveFolders: true });
    }
    applySearchResult(result.value);
    return result.value;
  }

  async function runSearch(
    event?: FormEvent,
    opts?: { silent?: boolean },
  ) {
    event?.preventDefault();
    if (!api || !library) return;
    await closeAssetPreview(false);
    try {
      const definition = currentQueryDefinition();
      const result = await executeSearchDefinition(definition);
      // Serpent-huvw: discovery debounce / reload must not toast "搜索完成"
      // and wipe AI completion / error toasts.
      if (result && !opts?.silent) {
        setNotice(t("toast.searchDone", { total: result.total }));
      }
    } catch (caught) {
      setError(toMessage(caught, t("toast.searchFailed"), locale));
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
      // Serpent-eaxs: entering tag management clears discovery controls; the
      // debounced "clear filters → show all" reload must not fire behind the
      // management page — its response handler closes the page and dumps the
      // user back on 所有资产. Explicit submit (runSearch) still exits.
      showTagManagement ||
      (!hasDiscoveryInput && !shouldClearPreviousResults)
    )
      return;
    const timer = window.setTimeout(() => {
      void runSearch(undefined, { silent: true });
    }, 200);
    return () => window.clearTimeout(timer);
    // Search execution reads the current scope and API from the same render;
    // only discovery controls should restart the debounce timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    library,
    showTrash,
    showTagManagement,
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

  async function chooseSmartCollection(collectionId: string) {
    if (!api || !library) return;
    await closeAssetPreview(false);
    closeContextMenu();
    workspaceCanvasRef.current?.scrollTo({ top: 0, left: 0 });
    try {
      const result = await api.executeSmartCollection({
        libraryId: library.libraryId,
        collectionId,
        ...BROWSE_SCOPE_SEARCH,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setShowTrash(false);
      setShowTagManagement(false);
      setActiveTagId(null);
      setActiveCollectionId(null);
      setActiveSmartCollectionId(collectionId);
      setAssetScope("all");
      clearAssetSelection();
      clearDiscoveryControls();
      recordNavigation({ kind: "smart-collection", collectionId });
      setSmartCollections((current) =>
        current.map((collection) =>
          collection.collectionId === collectionId
            ? { ...collection, assetCount: result.value.total }
            : collection,
        ),
      );
      applySearchResult(result.value);
    } catch (caught) {
      setError(toMessage(caught, t("toast.smartCollectionRunFailed"), locale));
    }
  }

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
    const definition = currentQueryDefinition();
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

  loadAiContentForAssetRef.current = loadAiContentForAsset;
  rebuildAndApplyMultiEditRef.current = rebuildAndApplyMultiEdit;
  refreshAfterAiRef.current = async (assetId: string) => {
    try {
      await refreshTagAndMetadataState(assetId);
    } catch {
      // Best-effort; AI content load still proceeds.
    }
    await loadAiContentForAsset(assetId);
  };

  async function revealAfterImport(completion: {
    assets: AssetSummary[];
  }): Promise<void> {
    const reveal = pendingRevealFromAssets(completion.assets);
    if (!reveal) {
      await reloadCurrentContent();
      return;
    }
    pendingRevealRef.current = reveal;
    if (!currentScopeShowsRevealAssets(assetScope, completion.assets)) {
      const target = sharedBrowseScopeForAssets(completion.assets);
      if (target) {
        await chooseFolder(target);
        return;
      }
    }
    await reloadCurrentContent();
  }
  revealAfterImportRef.current = revealAfterImport;

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
      if (isImportConflictPlan(result.value)) {
        presentImportConflicts(result.value);
        return;
      }
      if (isImageSequenceImportOffer(result.value)) {
        setImageSequenceImportOffer(result.value);
        return;
      }
      setNotice(importSummaryMessage(result.value, locale));
      await revealAfterImport(result.value);
    } catch (caught) {
      showBlockingError(
        t("dialog.blockingError.importFailed"),
        toMessage(caught, t("toast.importFailed"), locale),
      );
    } finally {
      setUiState("ready");
    }
  }

  async function confirmImageSequenceImportOffer(input: {
    action: "import-sequence" | "import-selected";
    firstFrame: number;
    fps: number;
    lastFrame: number;
    sequenceIndex: number;
  }) {
    if (!api || !library || !imageSequenceImportOffer) return;
    setImageSequenceImportSubmitting(true);
    setImageSequenceImportError(null);
    setUiState("importing");
    try {
      const result = await api.confirmImageSequenceImport({
        libraryId: library.libraryId,
        offerId: imageSequenceImportOffer.offerId!,
        action: input.action,
        sequenceIndex: input.sequenceIndex,
        firstFrame: input.firstFrame,
        lastFrame: input.lastFrame,
        fps: input.fps,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setImageSequenceImportOffer(null);
      if (isImportConflictPlan(result.value)) {
        presentImportConflicts(result.value);
        return;
      }
      setNotice(importSummaryMessage(result.value, locale));
      await revealAfterImport(result.value);
    } catch (caught) {
      setImageSequenceImportError(
        toMessage(caught, t("toast.importFailed"), locale),
      );
    } finally {
      setImageSequenceImportSubmitting(false);
      setUiState("ready");
    }
  }

  async function resolveImportConflictsWith(
    plan: ImportConflictPlan,
    name: RememberedNameConflictDecision,
    duplicate: RememberedDuplicateDecision,
  ) {
    if (!api || !library) return;
    setUiState("importing");
    try {
      const result = await api.resolveImport({
        importId: plan.importId,
        suspectedDuplicate: duplicate,
        nameConflict: name,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      clearImportConflictsUi();
      setNotice(importSummaryMessage(result.value, locale));
      await revealAfterImport(result.value);
    } catch (caught) {
      showBlockingError(
        t("dialog.blockingError.importContinueFailed"),
        toMessage(caught, t("toast.continueImportFailed"), locale),
      );
    } finally {
      setUiState("ready");
    }
  }
  resolveImportConflictsRef.current = resolveImportConflictsWith;

  function confirmNameConflictDialog() {
    if (!conflicts) return;
    if (rememberNameConflict) {
      rememberNameConflictDecision(nameDecision);
    }
    const prefs = loadImportConflictPreferences();
    const next = nextImportConflictPhaseAfterName(conflicts, prefs);
    if (next === "duplicate") {
      setConflictPhase("duplicate");
      return;
    }
    void resolveImportConflictsWith(
      conflicts,
      nameDecision,
      duplicateDecision,
    );
  }

  function confirmContentDuplicateDialog() {
    if (!conflicts) return;
    if (rememberDuplicate) {
      rememberDuplicateDecision(duplicateDecision);
    }
    void resolveImportConflictsWith(
      conflicts,
      nameDecision,
      duplicateDecision,
    );
  }

  async function abandonConflicts() {
    if (!api || !conflicts) return;
    const plan = conflicts;
    clearImportConflictsUi();
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
    setShowTagManagement(false);
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
    setLastUndoableOp(null);
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

  async function requestRestoreTrashedAssets(assetIds: string[]) {
    if (!api || !library) return;
    try {
      const preview = await api.previewRestoreAssets({
        libraryId: library.libraryId,
        assetIds,
      });
      if (!preview.ok) throw new LibraryOperationError(preview.error);
      if (shouldOpenTrashRestoreDialog(preview.value.hasNameConflicts)) {
        setRestoreDialog({
          assetIds,
          target: "original",
          conflictStrategy: "keep-both",
        });
        return;
      }
      await restoreTrashedAssets(silentTrashRestoreRequest(assetIds));
    } catch (caught) {
      setError(toMessage(caught, t("toast.restoreFailed"), locale));
    }
  }

  // --- Trash operations ---

  async function restoreTrashedAssets(payload?: TrashRestoreRequest) {
    const request = payload ?? restoreDialog;
    if (!api || !library || !request) return;
    const { assetIds, target, conflictStrategy } = request;
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

  async function restoreTrashedManagedFolder(
    tombstoneId: string,
    name: string,
  ) {
    if (!api || !library) return;
    closeContextMenu();
    setUiState("loading");
    try {
      const result = await api.restoreTrashedManagedFolder({
        libraryId: library.libraryId,
        tombstoneId,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setNotice(
        t("toast.restoreTrashedFolderDone", {
          name,
          folders: result.value.restoredFolderCount,
          assets: result.value.restoredAssetCount,
        }) + t("common.sentenceEnd"),
      );
      clearAssetSelection();
      await loadContent(library, "all", { trashMode: true });
    } catch (caught) {
      setError(toMessage(caught, t("toast.restoreTrashedFolderFailed"), locale));
    } finally {
      setUiState("ready");
    }
  }

  async function moveManagedAssets() {
    if (!api || !library || !moveDialog) return;
    const { assetIds, folderIds, targetFolderId, conflictStrategy } = moveDialog;
    setMoveDialog(null);
    setUiState("loading");
    try {
      if (assetIds.length > 0) {
        const result = await api.moveAssets({
          libraryId: library.libraryId,
          assetIds,
          targetFolderId,
          conflictStrategy,
        });
        if (!result.ok) throw new LibraryOperationError(result.error);
        if (result.value.operationId) {
          setLastUndoableOp({
            kind: "move",
            operationId: result.value.operationId,
          });
        } else {
          setLastUndoableOp(null);
        }
        setNotice(
          t("toast.movedCountDetail", { count: result.value.movedCount }) +
            (result.value.skippedCount
              ? t("toast.skippedSuffix", { count: result.value.skippedCount })
              : "") +
            t("common.sentenceEnd"),
        );
      }
      if (folderIds.length > 0) {
        const folderResult = await api.moveFolders({
          libraryId: library.libraryId,
          folderIds,
          targetParentFolderId: targetFolderId,
          conflictStrategy:
            conflictStrategy === "replace" ? "keep-both" : conflictStrategy,
        });
        if (!folderResult.ok) throw new LibraryOperationError(folderResult.error);
        if (assetIds.length === 0) {
          if (folderResult.value.skippedCount > 0) {
            setNotice(
              t("toast.folderMoveSkipped", {
                moved: folderResult.value.movedCount,
                skipped: folderResult.value.skippedCount,
              }),
            );
          } else {
            setNotice(
              t("toast.folderMoveDone", {
                count: folderResult.value.movedCount,
              }),
            );
          }
        }
      }
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
      setLastUndoableOp(null);
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

  async function undoManagedCopy(
    operationId: string,
    conflictStrategy: "error" | "keep-both" | "replace" | "skip" = "error",
  ) {
    if (!api || !library) return;
    setUiState("loading");
    try {
      const result = await api.undoCopyAssets({
        libraryId: library.libraryId,
        operationId,
        conflictStrategy,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setLastUndoableOp(null);
      setNotice(
        t("toast.undoCopyDone", { count: result.value.undoneCount }) +
          (result.value.skippedCount
            ? t("toast.conflictAssetsSkippedSuffix", {
                count: result.value.skippedCount,
              })
            : "") +
          t("common.sentenceEnd"),
      );
      await reloadCurrentContent();
    } catch (caught) {
      setError(toMessage(caught, t("toast.undoCopyFailed"), locale));
    } finally {
      setUiState("ready");
    }
  }

  async function undoLastFileOp() {
    if (!lastUndoableOp) return;
    if (lastUndoableOp.kind === "copy") {
      await undoManagedCopy(lastUndoableOp.operationId);
      return;
    }
    await undoManagedMove(lastUndoableOp.operationId);
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

  function requestAssetDiskDelete(assetIds: string[]) {
    if (assetIds.length === 0) return;
    if (!isDiskDeletePromptEnabled()) {
      void deleteManagedAssetsFromDisk(assetIds);
      return;
    }
    setAssetDiskDeleteIds(assetIds);
  }

  async function confirmAssetDiskDelete(dontShowAgain: boolean) {
    if (!assetDiskDeleteIds) return;
    if (dontShowAgain) setDiskDeletePromptEnabled(false);
    const assetIds = assetDiskDeleteIds;
    setAssetDiskDeleteIds(null);
    await deleteManagedAssetsFromDisk(assetIds);
  }

  function requestSelectionDiskDelete(
    assetIds: string[],
    folderIds: readonly string[],
  ) {
    const folderIdList = [...folderIds];
    if (folderIdList.length === 0) {
      requestAssetDiskDelete(assetIds);
      return;
    }
    if (assetIds.length === 0 && folderIdList.length === 1) {
      const folderId = folderIdList[0]!;
      const name =
        folderBrowseEntries.find((entry) => entry.folderId === folderId)
          ?.name ??
        folders.find((folder) => folder.folderId === folderId)?.name ??
        folderId;
      openDiskDelete({ kind: "managed", folderId, name });
      return;
    }
    if (!isDiskDeletePromptEnabled()) {
      void executeSelectionDiskDelete(assetIds, folderIdList);
      return;
    }
    setSelectionDiskDelete({ assetIds, folderIds: folderIdList });
  }

  async function confirmSelectionDiskDelete(dontShowAgain: boolean) {
    if (!selectionDiskDelete) return;
    if (dontShowAgain) setDiskDeletePromptEnabled(false);
    const pending = selectionDiskDelete;
    setSelectionDiskDelete(null);
    await executeSelectionDiskDelete(pending.assetIds, pending.folderIds);
  }

  async function executeSelectionDiskDelete(
    assetIds: string[],
    folderIds: readonly string[],
  ) {
    if (!api || !library) return;
    if (assetIds.length === 0 && folderIds.length === 0) return;
    setUiState("loading");
    try {
      let deletedAssets = 0;
      let deletedFolders = 0;
      if (assetIds.length > 0) {
        const result = await api.deleteAssetsFromDisk({
          libraryId: library.libraryId,
          assetIds,
        });
        if (!result.ok) throw new LibraryOperationError(result.error);
        deletedAssets = result.value.deletedCount;
      }
      for (const folderId of folderIds) {
        const result = await api.deleteFolderFromDisk({
          libraryId: library.libraryId,
          folderId,
        });
        if (!result.ok) throw new LibraryOperationError(result.error);
        deletedFolders += 1;
        deletedAssets += result.value.deletedAssetCount;
      }
      setNotice(
        t("toast.selectionDeletedFromDisk", {
          folders: deletedFolders,
          assets: deletedAssets,
        }),
      );
      clearAssetSelection();
      await reloadCurrentContent();
    } catch (caught) {
      setError(toMessage(caught, t("toast.folderDeleteFromDiskFailed"), locale));
    } finally {
      setUiState("ready");
    }
  }

  async function trashMixedSelection(
    assetIds: string[],
    folderIds: readonly string[] = [],
  ) {
    if (!api || !library) return;
    if (assetIds.length === 0 && folderIds.length === 0) return;
    if (folderIds.length === 0) {
      await trashManagedAssets(assetIds);
      return;
    }
    setUiState("loading");
    try {
      let trashedAssets = 0;
      let trashedFolders = 0;
      if (assetIds.length > 0) {
        const result = await api.trashAssets({
          libraryId: library.libraryId,
          assetIds,
        });
        if (!result.ok) throw new LibraryOperationError(result.error);
        trashedAssets = result.value.trashedCount;
      }
      for (const folderId of folderIds) {
        const result = await api.trashFolder({
          libraryId: library.libraryId,
          folderId,
        });
        if (!result.ok) throw new LibraryOperationError(result.error);
        trashedFolders += 1;
        trashedAssets += result.value.trashedAssetCount;
      }
      setNotice(
        t("toast.selectionTrashed", {
          folders: trashedFolders,
          assets: trashedAssets,
        }),
      );
      clearAssetSelection();
      if (
        isBrowseScopeAffectedByFolderTrash(assetScope, folderIds, folders)
      ) {
        await chooseFolder("root");
      } else {
        await reloadCurrentContent();
      }
    } catch (caught) {
      setError(toMessage(caught, t("toast.batchDeleteFailed"), locale));
    } finally {
      setUiState("ready");
    }
  }

  async function emptyTrash() {
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
      setAssets((current) =>
        mergeAssetSummaries(current, [result.value.asset]),
      );
      setNotice(t("toast.relinkSuccess"));
      await reloadCurrentContent();

      const preview = await api.relinkBatchPreviewAtRoot({
        libraryId: library.libraryId,
        newRootPath: result.value.batchFollowUpRoot,
        keepMetadata: batchRelinkKeepMetadata,
      });
      if (!preview.ok) {
        if (preview.error.code === "CANCELLED") return;
        throw new LibraryOperationError(preview.error);
      }
      if (preview.value.matchedCount > 0) {
        setBatchRelinkPreview({
          preview: preview.value,
          priorRestoredCount: 1,
          priorRestoredExamples: [
            {
              relativeFilePath: formatRelinkExamplePath(
                result.value.asset.relativeFilePath,
              ),
              matched: true,
            },
          ],
        });
      }
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
      setBatchRelinkPreview({
        preview: result.value,
        priorRestoredCount: 0,
        priorRestoredExamples: [],
      });
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
        previewId: batchRelinkPreview.preview.previewId,
        keepMetadata: batchRelinkKeepMetadata,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      const priorRestoredCount = batchRelinkPreview.priorRestoredCount;
      setBatchRelinkPreview(null);
      setAssets((current) =>
        mergeAssetSummaries(current, result.value.assets),
      );
      const refresh = await api.refreshAssets({
        libraryId: library.libraryId,
      });
      if (refresh.ok) {
        setAssets((current) =>
          mergeAssetSummaries(current, refresh.value.assets),
        );
      }
      await reloadCurrentContent();
      setNotice(
        t("toast.batchRelinkDone", {
          restored: result.value.restoredCount + priorRestoredCount,
          missing: result.value.unchangedMissingCount,
        }),
      );
    } catch (caught) {
      setBatchRelinkPreview(null);
      setError(toMessage(caught, t("toast.batchRelinkFailed"), locale));
    } finally {
      setUiState("ready");
    }
  }

  const cancelBatchRelink = useCallback(async () => {
    if (!api || !library || !batchRelinkPreview) return;
    const previewId = batchRelinkPreview.preview.previewId;
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
      showBlockingError(
        t("dialog.blockingError.importValidateFailed"),
        toMessage(caught, t("toast.importValidateFailed"), locale),
      );
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
      showBlockingError(
        t("dialog.blockingError.libraryImportFailed"),
        toMessage(caught, t("toast.zipImportFailed"), locale),
      );
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
      setShowTagManagement(false);
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
      showBlockingError(
        t("dialog.blockingError.libraryImportFailed"),
        toMessage(caught, t("toast.importFailed"), locale),
      );
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
      showBlockingError(
        t("dialog.blockingError.libraryImportFailed"),
        toMessage(caught, t("toast.importFailed"), locale),
      );
      setImportProgress(null);
    }
  }

  useEffect(() => {
    if (!api || !library) return;
    let reloadTimer: number | undefined;
    let reloadInFlight = false;
    let reloadQueued = false;
    const scheduleSilentReload = () => {
      if (reloadTimer !== undefined) window.clearTimeout(reloadTimer);
      reloadTimer = window.setTimeout(() => {
        reloadTimer = undefined;
        if (reloadInFlight) {
          reloadQueued = true;
          return;
        }
        reloadInFlight = true;
        void reloadCurrentContentRef
          .current()
          .catch(() => undefined)
          .finally(() => {
            reloadInFlight = false;
            if (reloadQueued) {
              reloadQueued = false;
              scheduleSilentReload();
            }
          });
      }, 120);
    };
    const unsubscribe = api.onAssetsChanged((event) => {
      if (event.libraryId !== library.libraryId) return;
      // Serpent-yqrl: while a user import is applying, each committed asset
      // triggers a silent canvas refresh so cards appear one-by-one.
      if (uiStateRef.current === "importing") {
        scheduleSilentReload();
        return;
      }
      void Promise.resolve().then(async () => {
        try {
          await reloadCurrentContentRef.current();
          if (selectedAssetId) {
            const metadata = await api.getAssetMetadata({
              libraryId: library.libraryId,
              assetId: selectedAssetId,
            });
            if (metadata.ok) {
              applyLoadedMetadata(selectedAssetId, metadata.value);
            }
          }
          if (event.source === "text-save") {
            setNotice(t("toast.textFileSaved"));
          } else if (event.source === "watcher") {
            const missing = event.missingCount
              ? t("toast.diskSyncedMissing", { count: event.missingCount })
              : "";
            setNotice(
              t("toast.diskSyncedAuto", {
                count: event.changedCount,
                missing,
              }),
            );
          }
          // source === 'client' (or omitted): silent canvas refresh only.
        } catch (caught) {
          setError(toMessage(caught, t("toast.diskChangedRefreshFailed"), locale));
        }
      });
    });
    const unsubscribeLibraryChanged = api.onLibraryChanged((event) => {
      if (event.libraryId !== library.libraryId) return;
      // Cross-process change-sequence bumps are not asset mutation counts.
      // Refresh silently without forging an asset.changed payload.
      if (uiStateRef.current === "importing") {
        scheduleSilentReload();
        return;
      }
      void Promise.resolve().then(async () => {
        try {
          await reloadCurrentContentRef.current();
          if (selectedAssetId) {
            const metadata = await api.getAssetMetadata({
              libraryId: library.libraryId,
              assetId: selectedAssetId,
            });
            if (metadata.ok) {
              applyLoadedMetadata(selectedAssetId, metadata.value);
            }
          }
        } catch (caught) {
          setError(toMessage(caught, t("toast.diskChangedRefreshFailed"), locale));
        }
      });
    });
    return () => {
      if (reloadTimer !== undefined) window.clearTimeout(reloadTimer);
      unsubscribe();
      unsubscribeLibraryChanged();
    };
  }, [api, applyLoadedMetadata, library, locale, selectedAssetId, setError, setNotice, t]);

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
        } else if (event.phase === "cancelled") {
          setNotice(t("toast.exportCancelled"));
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
      diskDeleteOpen:
        Boolean(diskDeleteTarget) ||
        libraryDiskDeletePending ||
        Boolean(assetDiskDeleteIds) ||
        Boolean(selectionDiskDelete),
      deleteLinkedOpen: Boolean(deleteLinkedDialog),
      batchRelinkOpen: Boolean(batchRelinkPreview),
      restoreOpen: Boolean(restoreDialog),
      moveOpen: Boolean(moveDialog),
      undoMoveOpen: Boolean(undoMoveDialog),
      collectionEditorOpen: Boolean(collectionEditor),
      exportDialogOpen,
      importLibraryChooserOpen,
      appSettingsOpen,
      appLogOpen,
      scriptSandboxPreviewOpen,
      mediaJobsOpen: Boolean(mediaJobsOpen && library !== null),
      linkedRulesEditorOpen: Boolean(linkedRulesEditor),
      convertLinkedOpen: Boolean(convertLinkedDialog.folderId),
      dialogOpen: Boolean(dialog),
      fatalAlertOpen: Boolean(fatalAlertMessage),
      aiConnectionFailureOpen: aiConnectionFailureGate.open,
      conflictsImportId: conflictPhase ? (conflicts?.importId ?? null) : null,
    };
  }, [
    assetRenameDialog,
    permanentDeleteDialog,
    diskDeleteTarget,
    libraryDiskDeletePending,
    assetDiskDeleteIds,
    selectionDiskDelete,
    deleteLinkedDialog,
    batchRelinkPreview,
    restoreDialog,
    moveDialog,
    undoMoveDialog,
    collectionEditor,
    exportDialogOpen,
    importLibraryChooserOpen,
    appSettingsOpen,
    appLogOpen,
    scriptSandboxPreviewOpen,
    mediaJobsOpen,
    library,
    linkedRulesEditor,
    convertLinkedDialog.folderId,
    dialog,
    fatalAlertMessage,
    aiConnectionFailureGate.open,
    conflicts?.importId,
    conflictPhase,
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
      setAssetDiskDeleteIds(null);
    },
    setDeleteLinkedDialog,
    setRestoreDialog,
    setMoveDialog,
    setUndoMoveDialog,
    setCollectionEditor,
    setExportDialogOpen,
    setImportLibraryChooserOpen,
    setAppSettingsOpen,
    setAppLogOpen,
    setScriptSandboxPreviewOpen,
    setMediaJobsOpen,
    setLinkedRulesEditor,
    resetConvertLinkedDialog: () => {
      setConvertLinkedDialog({ folderId: "", name: "", targetFolderId: "" });
    },
    setDialog: (value) => {
      // Serpent-kipk: required no-library surface cannot dismiss; Escape returns
      // to the start phase instead of leaving an empty canvas.
      if (value === null && !library) {
        if (allowRequiredDialogDismissRef.current) {
          allowRequiredDialogDismissRef.current = false;
          setDialog(value);
          return;
        }
        setCreateLibraryPhase("start");
        return;
      }
      setDialog(value);
    },
    setShowCollectionInput,
    setConflicts: (value) => {
      if (value === null) clearImportConflictsUi();
      else presentImportConflicts(value);
    },
    setError,
    onDismissFatalAlert: dismissFatalAlert,
    onAbortAiConnectionFailure: onAiConnectionFailureAbort,
  });

  const dialogFocusTrapActive = Boolean(
    dialog ||
      conflicts ||
      assetRenameDialog ||
      permanentDeleteDialog ||
      diskDeleteTarget ||
      libraryDiskDeletePending ||
      assetDiskDeleteIds ||
      selectionDiskDelete ||
      deleteLinkedDialog ||
      batchRelinkPreview ||
      restoreDialog ||
      moveDialog ||
      undoMoveDialog ||
      collectionEditor ||
      exportDialogOpen ||
      importLibraryChooserOpen ||
      appSettingsOpen ||
      appLogOpen ||
      scriptSandboxPreviewOpen ||
      Boolean(smartCollectionSettings) ||
      Boolean(imageSequenceDialog) ||
      Boolean(fatalAlertMessage) ||
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

  useBrowseCommandKeyboard({
    enabled: Boolean(library) && !showTagManagement,
    platform: SHORTCUT_PLATFORM,
    previewOpen: Boolean(previewAsset),
    showTrash,
    libraryOpen: Boolean(library),
    busy,
    selectedAsset,
    selectedAssets,
    selectedManagedCount,
    pasteDestinationFolderId: browsePasteDestination,
    diskDeleteAssetIds: diskDeleteKeyboardTargets.assetIds,
    diskDeleteFolderIds: diskDeleteKeyboardTargets.folderIds,
    searchInputRef,
    onOpenExternal: (assetId) => {
      void handleOpenExternal(assetId);
    },
    onTrashManaged: (assetIds) => {
      void trashManagedAssets(assetIds);
    },
    onRename: openAssetRename,
    onCopyFiles: (assetIds) => {
      void handleCopyAssetFiles(assetIds);
    },
    onPasteIntoFolder: pasteOsClipboardFiles,
    onRevealInFolder: (assetId) => {
      void handleRevealInFolder(assetId);
    },
    onDiskDelete: (assetIds, folderIds) => {
      requestSelectionDiskDelete([...assetIds], folderIds);
    },
    onPermanentDelete: (assetIds) => {
      setPermanentDeleteDialog([...assetIds]);
    },
    onRefreshDisk: () => {
      void refreshAssets();
    },
  });

  useWorkspaceMouseNavigation({
    enabled: Boolean(library),
    onBack: () => {
      void goWorkspaceBack();
    },
    onForward: () => {
      void goWorkspaceForward();
    },
  });

  // Serpent-166q: macOS Edit → Copy accelerator (custom menu, not role:copy).
  useEffect(() => {
    if (!shellApi) return;
    return shellApi.onCopySelection(() => {
      const target = document.activeElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        void shellApi.nativeEditCopy();
        return;
      }
      if (previewAsset || showTrash || !library) {
        void shellApi.nativeEditCopy();
        return;
      }
      const copyIds = selectedAssets
        .filter(
          (asset) => asset.availability === "available" && !asset.deletedAt,
        )
        .map((asset) => asset.assetId);
      if (copyIds.length > 0) {
        void handleCopyAssetFiles(copyIds);
        return;
      }
      void shellApi.nativeEditCopy();
    });
  }, [
    shellApi,
    previewAsset,
    showTrash,
    library,
    selectedAssets,
    handleCopyAssetFiles,
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
        showTrash ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;

      const hasImage =
        event.clipboardData &&
        Array.from(event.clipboardData.items).some((item) =>
          item.type.startsWith("image/"),
        );
      if (hasImage) {
        event.preventDefault();
        void pasteClipboardImage();
        return;
      }

      if (browsePasteDestination === undefined) return;
      event.preventDefault();
      pasteOsClipboardFiles(browsePasteDestination);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [
    library,
    busy,
    showTrash,
    browsePasteDestination,
    pasteClipboardImage,
    pasteOsClipboardFiles,
  ]);

  useEffect(() => {
    if (
      dialog ||
      conflicts ||
      permanentDeleteDialog ||
      diskDeleteTarget ||
      libraryDiskDeletePending ||
      assetDiskDeleteIds ||
      selectionDiskDelete ||
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
          void (async () => {
            if (previewModalRef.current) {
              await previewModalRef.current.requestClose();
            } else {
              await closeAssetPreview();
            }
          })();
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
    assetDiskDeleteIds,
    diskDeleteTarget,
    libraryDiskDeletePending,
    selectionDiskDelete,
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

  // Serpent-oy07: sync BrowserWindow focus to document (native macOS traffic lights
  // dim on inactive via hiddenInset; renderer can mirror for shell chrome).
  useEffect(() => {
    const shellBridge = (window as RendererWindow).serpent?.shell;
    if (!shellBridge?.onWindowFocusChanged) return;
    const apply = (focused: boolean) => {
      document.documentElement.dataset.windowFocused = focused
        ? "true"
        : "false";
    };
    apply(document.hasFocus());
    return shellBridge.onWindowFocusChanged(apply);
  }, []);

  function workspaceTitle() {
    if (!library) return t("scope.workspace");
    if (showTagManagement) return t("scope.tagManagement");
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

  async function loadAiConfig() {
    if (!api) return;
    const result = await api.getAiConfig();
    if (!result.ok) return;
    setAiApiFormat(
      (result.value.apiFormat as AiApiFormat) ?? "dashscope_native",
    );
    setAiModel(result.value.model ?? "qwen3-vl-plus");
    setAiBaseUrl(result.value.baseUrl ?? "");
    setAiHasKey(result.value.hasKey);
    setAiDescriptionEnabled(result.value.enabledFields.description);
    setAiTagsEnabled(result.value.enabledFields.tags);
    setAiRatingEnabled(result.value.enabledFields.rating);
    setAiForceExistingTags(result.value.analysisSettings.forceExistingTags);
    setAiAnalysisSettings(
      toWireAiAnalysisSettings(
        normalizeAiAnalysisSettings(result.value.analysisSettings),
      ),
    );
    const langs = result.value.languages as
      | Array<"zh-CN" | "en" | "ja" | "ko">
      | undefined;
    setAiLanguages(langs?.length ? [langs[0]!] : ["zh-CN"]);
    setAiConcurrencyLimit(result.value.concurrencyLimit);
    setAiMaxAnalysisImageEdgePx(result.value.maxAnalysisImageEdgePx);
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

  type AiConfigPersistOverrides = {
    maxAnalysisImageEdgePx?: number;
    concurrencyLimit?: number;
    analysisSettings?: AiAnalysisSettingsWire;
  };

  async function persistAiConfig(
    overrides: AiConfigPersistOverrides = {},
    options: {
      showNotice?: boolean;
      clearApiKeyDraft?: boolean;
      verifyConnection?: boolean;
    } = {},
  ): Promise<boolean> {
    const {
      showNotice = true,
      clearApiKeyDraft = false,
      verifyConnection = false,
    } = options;
    if (!api) return false;
    const draft = aiConfigPersistDraftRef.current;
    if (!draft.apiKey.trim() && !draft.hasKey) {
      if (showNotice) {
        setError(t("toast.aiConfigSaveFailed"));
      }
      return false;
    }
    const result = await api.setAiConfig({
      apiFormat: draft.apiFormat,
      model: draft.model,
      baseUrl: draft.baseUrl.trim(),
      ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
      enabledFields: {
        description: draft.descriptionEnabled,
        tags: draft.tagsEnabled,
        rating: draft.ratingEnabled,
      },
      analysisSettings: {
        ...(overrides.analysisSettings ?? draft.analysisSettings),
        forceExistingTags: draft.forceExistingTags,
      },
      languages: draft.languages.length > 0 ? [draft.languages[0]!] : ["zh-CN"],
      concurrencyLimit: overrides.concurrencyLimit ?? draft.concurrencyLimit,
      maxAnalysisImageEdgePx:
        overrides.maxAnalysisImageEdgePx ?? draft.maxAnalysisImageEdgePx,
      autoAnalyzeEnabled: draft.autoAnalyzeEnabled,
      disclaimerAccepted: draft.disclaimerAccepted,
    });
    if (!result.ok) {
      if (showNotice) {
        setError(toMessage(result.error, t("toast.aiConfigSaveFailed"), locale));
      }
      return false;
    }
    setAiHasKey(true);
    if (clearApiKeyDraft) setAiApiKey("");
    if (showNotice) setNotice(t("toast.aiConfigSaved"));
    if (verifyConnection) {
      setAiSaveVerifying(true);
      try {
        const connection = await testAiConnectionFromDialog();
        if (connection.success) {
          setAiConnectionReason(undefined);
        }
      } finally {
        setAiSaveVerifying(false);
      }
    }
    return true;
  }

  function commitAiMaxAnalysisImageEdgePx(value: number) {
    setAiMaxAnalysisImageEdgePx(value);
    aiConfigPersistDraftRef.current.maxAnalysisImageEdgePx = value;
    void persistAiConfig({ maxAnalysisImageEdgePx: value });
  }

  function commitAiConcurrencyLimit(value: number) {
    setAiConcurrencyLimit(value);
    aiConfigPersistDraftRef.current.concurrencyLimit = value;
    void persistAiConfig({ concurrencyLimit: value });
  }

  function commitAiAnalysisSettingsPatch(
    patch: Partial<AiAnalysisSettingsWire>,
  ) {
    const next = { ...aiAnalysisSettings, ...patch };
    setAiAnalysisSettings(next);
    aiConfigPersistDraftRef.current.analysisSettings = next;
    void persistAiConfig({ analysisSettings: next });
  }

  async function saveAiConfig() {
    if (!api || (!aiApiKey.trim() && !aiHasKey)) return;
    const alreadyVerified =
      aiVerifiedFingerprintRef.current === aiCredentialFingerprint() &&
      aiConnectionState === "connected";
    const ok = await persistAiConfig(
      {},
      {
        showNotice: true,
        clearApiKeyDraft: true,
        verifyConnection: !alreadyVerified,
      },
    );
    if (!ok) return;
    if (alreadyVerified) {
      setAiConnectionReason(undefined);
      setAiSaveVerifying(false);
    }
  }

  useEffect(() => {
    const aiSettingsOpen =
      appSettingsOpen && appSettingsCategory === "ai";
    if (!aiSettingsOpen) {
      aiAutoConnectAttemptedRef.current = false;
      return;
    }
    if (!aiHasKey || aiAutoConnectAttemptedRef.current) return;
    aiAutoConnectAttemptedRef.current = true;
    void testAiConnectionFromDialog();
  }, [
    appSettingsOpen,
    appSettingsCategory,
    aiHasKey,
    testAiConnectionFromDialog,
  ]);

  useEffect(() => {
    if (!appSettingsOpen || appSettingsCategory !== "ai") return;
    void loadAiConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when AI settings surface opens
  }, [appSettingsOpen, appSettingsCategory]);

  const probeStoredAiConnection = useCallback(async () => {
    if (!api) return;
    if (!shouldRunAiConnectionHeartbeat(aiHasKey)) {
      setAiConnectionState("disconnected");
      setAiConnectionReason(undefined);
      aiVerifiedFingerprintRef.current = null;
      return;
    }
    setAiConnectionState((prev) =>
      prev === "connected" || prev === "connecting" ? prev : "connecting",
    );
    const cfg = await api.getAiConfig();
    if (!cfg.ok || !cfg.value.hasKey || !cfg.value.apiFormat || !cfg.value.model) {
      setAiConnectionState("disconnected");
      setAiConnectionReason(t("aiConfig.testFailed"));
      aiVerifiedFingerprintRef.current = null;
      return;
    }
    const result = await api.testAiConnection({
      apiFormat: cfg.value.apiFormat,
      model: cfg.value.model,
      baseUrl: cfg.value.baseUrl.trim() || undefined,
    });
    if (!result.ok) {
      setAiConnectionState("error");
      setAiConnectionReason(
        toMessage(result.error, t("aiConfig.testFailed"), locale),
      );
      aiVerifiedFingerprintRef.current = null;
      return;
    }
    if (result.value.success) {
      setAiConnectionState("connected");
      setAiConnectionReason(undefined);
      aiVerifiedFingerprintRef.current = [
        cfg.value.apiFormat,
        cfg.value.model.trim(),
        cfg.value.baseUrl.trim(),
        "__stored__",
      ].join("\u0001");
      return;
    }
    setAiConnectionState("error");
    setAiConnectionReason(result.value.reason ?? t("aiConfig.testFailed"));
    aiVerifiedFingerprintRef.current = null;
  }, [api, aiHasKey, locale, t]);

  useEffect(() => {
    if (!shouldRunAiConnectionHeartbeat(aiHasKey)) {
      return;
    }
    queueMicrotask(() => {
      void probeStoredAiConnection();
    });
    const timer = window.setInterval(() => {
      void probeStoredAiConnection();
    }, AI_CONNECTION_HEARTBEAT_MS);
    const onFocus = () => {
      void probeStoredAiConnection();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [aiHasKey, probeStoredAiConnection]);

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
    try {
      const result = await api.analyzeAssets({
        libraryId: library.libraryId,
        assetIds: targetIds,
      });
      if (!result.ok) {
        setError(toMessage(result.error, t("toast.aiAnalyzeFailed"), locale));
        return;
      }
      const jobIds = result.value.jobIds;
      const skippedCount = result.value.skippedAssetIds.length;
      if (jobIds.length === 0) {
        if (skippedCount > 0) {
          setNotice(
            t("toast.aiAnalyzeDoneBatch", {
              succeeded: 0,
              failed: skippedCount,
            }),
          );
        } else {
          setError(t("toast.aiAnalyzeFailed"));
        }
        return;
      }
      aiBatchStatusRequestRef.current++;
      aiBatchJobIdsRef.current = jobIds;
      aiBatchSkippedCountRef.current = skippedCount;
      lastAiBatchJobIdsRef.current = jobIds;
      analyzingAssetIdRef.current = targetIds[0] ?? null;
      lastAiBatchAssetIdRef.current = analyzingAssetIdRef.current;
      analyzingBatchSizeRef.current = jobIds.length + skippedCount;
      setAiBatchProgress(
        computeAiBatchProgressForJobs(jobIds, [], { skipped: skippedCount }),
      );
      flushSync(() => {
        aiAnalyzingRef.current = true;
        setAiAnalyzing(true);
        setAiProgressBannerVisible(true);
      });
      // The fixed workspace progress banner is the only in-progress signal.
      // A transient notice duplicates it and can hide more important feedback.
      void loadAiJobs(true);
      void refreshAiBatchStatus();
    } catch (caught) {
      setError(toMessage(caught, t("toast.aiAnalyzeFailed"), locale));
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

  async function refreshAiBatchStatus() {
    if (!api || !library) return;
    const jobIds = aiBatchJobIdsRef.current;
    if (jobIds.length === 0) return;
    const requestNumber = ++aiBatchStatusRequestRef.current;
    try {
      const result = await api.getAiJobStatus({
        libraryId: library.libraryId,
        jobIds,
      });
      if (
        !result.ok ||
        requestNumber !== aiBatchStatusRequestRef.current ||
        aiBatchJobIdsRef.current !== jobIds
      ) {
        return;
      }
      const progress = computeAiBatchProgressForJobs(jobIds, result.value.jobs, {
        skipped: aiBatchSkippedCountRef.current,
      });
      setAiBatchProgress(progress);
      if (progress.done < progress.batchTotal) return;

      // Completion is defined by this batch's durable job IDs, not by the
      // whole library becoming idle. Other manual or automatic jobs may run.
      aiBatchJobIdsRef.current = [];
      aiBatchStatusRequestRef.current++;
      const pendingAssetId = analyzingAssetIdRef.current;
      const batchSize = analyzingBatchSizeRef.current;
      aiAnalyzingRef.current = false;
      analyzingAssetIdRef.current = null;
      analyzingBatchSizeRef.current = 0;
      setAiAnalyzing(false);
      setAiBatchProgress(null);

      const detail = summarizeAiFailureCodes(
        collectRecentAiFailureCodes(result.value.jobs),
        locale,
      );
      const showTotalFailure = () => {
        showBlockingError(
          t("dialog.aiAnalyzeFailure.title"),
          detail
            ? t("toast.aiAnalyzeFailedDetail", { detail })
            : t("toast.aiAnalyzeFailed"),
        );
      };
      const showSingleFailure = () => {
        setError(
          detail
            ? t("toast.aiAnalyzeFailedDetail", { detail })
            : t("toast.aiAnalyzeFailed"),
        );
      };

      const failedOutcomes = progress.failed + progress.skipped;
      if (failedOutcomes > 0) {
        if (progress.succeeded === 0 && progress.cancelled === 0) {
          if (pendingAssetId && batchSize <= 1) showSingleFailure();
          else showTotalFailure();
        } else {
          setNotice(
            t("toast.aiAnalyzeDoneBatch", {
              succeeded: progress.succeeded,
              failed: failedOutcomes,
            }) + (detail ? ` ${detail}` : ""),
          );
        }
      } else if (progress.cancelled > 0) {
        setNotice(t("toast.aiAnalyzeStopped"));
      } else if (batchSize > 1) {
        setNotice(
          t("toast.aiAnalyzeDoneBatch", {
            succeeded: progress.succeeded,
            failed: 0,
          }),
        );
      } else if (batchSize > 0) {
        setNotice(t("toast.aiAnalyzeDone"));
      }
      void reloadCurrentContentRef.current();
    } catch {
      // A transient status query must not finish or miscount an active batch;
      // the next throttled progress event will retry this refresh.
    }
  }
  refreshAiBatchStatusRef.current = () => {
    void refreshAiBatchStatus();
  };

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

  useEffect(() => {
    if (!library || !api) return;
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
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [api, library]);

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
        const activeJobIds = aiBatchJobIdsRef.current;
        const affectsActiveBatch = cancellationAffectsAiBatch(activeJobIds, jobIds);
        if (!jobIds) {
          // The workspace Stop control cancels the whole queue, including the
          // active batch. A panel action with explicit ids must not erase
          // unrelated or partially cancelled batch tracking.
          aiBatchJobIdsRef.current = [];
          aiBatchSkippedCountRef.current = 0;
          lastAiBatchJobIdsRef.current = [];
          lastAiBatchAssetIdRef.current = null;
          aiBatchStatusRequestRef.current++;
          aiAnalyzingRef.current = false;
          analyzingAssetIdRef.current = null;
          analyzingBatchSizeRef.current = 0;
          setAiAnalyzing(false);
          setAiBatchProgress(null);
          setNotice(t("toast.aiAnalyzeStopped"));
        } else if (affectsActiveBatch) {
          // Keep the full ID set: the next status refresh records cancelled
          // jobs alongside any remaining success/failure outcomes.
          void refreshAiBatchStatus();
        }
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
        <div className="toolbar-cluster toolbar-nav-cluster">
          <ToolButton
            icon={leftOpen ? "panel-left-close" : "panel-left"}
            label={leftOpen ? t("shell.collapseNav") : t("shell.expandNav")}
            onClick={() => setLeftOpen((v) => !v)}
            pressed={leftOpen}
          />
        </div>
        <div className="toolbar-cluster toolbar-workspace-cluster">
          <div className="toolbar-workspace-main">
            <ScopeHistoryButtons
              canBack={navHistoryUi.canBack}
              canForward={navHistoryUi.canForward}
              onBack={() => void goWorkspaceBack()}
              onForward={() => void goWorkspaceForward()}
            />
            <AppSettingsEntry
              disabled={busy}
              onOpen={() => {
                setAppSettingsCategory("general");
                setAppSettingsOpen(true);
              }}
            />
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
                setCreateLibraryPhase("start");
                setDialog("library");
              }}
              onExportLibrary={() => setExportDialogOpen(true)}
              onImportFolder={() => void importAssets("folder")}
              onImportLibrary={() => setImportLibraryChooserOpen(true)}
              onImportLinkedFolder={() => void importFolderAsLinked()}
              onMenuOpen={() => void refreshRecentLibraries()}
              onOpenLibrary={() => void runLibraryOperation("open")}
              onOpenRecent={(path) => void openRecentLibrary(path)}
              onForgetRecent={(path) => void forgetRecentLibrary(path)}
              recentLibraries={recentLibraries}
            />
            <ScopeBreadcrumbs
              onNavigateFolder={(folderId) => void chooseFolder(folderId)}
              onNavigateTrashTombstone={(tombstoneId) => {
                void enterTrashAt(tombstoneId);
              }}
              segments={buildScopeBreadcrumbSegments(
                {
                  showTrash,
                  trashBreadcrumbHops,
                  activeTagLabel: activeTagId
                    ? (tags.find((tag) => tag.tagId === activeTagId)?.name ??
                      null)
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
          </div>
          <form
            className="toolbar-workspace-search"
            onSubmit={(event) => void runSearch(event)}
            role="search"
          >
            <div
              className={`search-control-wrap${searchValue.trim() ? " has-value" : ""}`}
            >
              <Icon name="search" size={15} />
              <input
                aria-label={t("toolbar.searchLibrary")}
                className="search-control"
                disabled={!library}
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder={t("toolbar.searchPlaceholder")}
                ref={searchInputRef}
                type="search"
                value={searchValue}
              />
              <button
                aria-label={t("toolbar.searchSyntax")}
                className="search-syntax-help"
                data-hover-tip={t("toolbar.searchSyntaxHint")}
                data-hover-tip-variant="search-syntax"
                type="button"
              >
                ?
              </button>
              {searchValue.trim() !== "" && (
                <button
                  aria-label={t("toolbar.clearSearch")}
                  className="search-clear-btn"
                  disabled={!library}
                  onClick={() => setSearchValue("")}
                  type="button"
                >
                  <Icon name="close" size={12} />
                </button>
              )}
            </div>
          </form>
        </div>
        <div className="toolbar-cluster toolbar-inspector-cluster">
          <ToolButton
            icon={rightOpen ? "panel-right-close" : "panel-right"}
            label={
              rightOpen
                ? t("shell.collapseInspector")
                : t("shell.expandInspector")
            }
            onClick={() => setRightOpen((v) => !v)}
            pressed={rightOpen}
          />
        </div>
        {IS_WINDOWS_PLATFORM ? (
          <WindowsWindowControls shell={shellApi} />
        ) : null}
      </header>
      <NavigationSidebar
        library={library}
        assetScope={assetScope}
        showTrash={showTrash}
        showTagManagement={showTagManagement}
        activeTagId={activeTagId}
        activeCollectionId={activeCollectionId}
        activeSmartCollectionId={activeSmartCollectionId}
        allAssetCount={allAssetCount}
        trashedAssetCount={searchTotal ?? trashedAssets.length}
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
        onTrashContextMenu={(event) => {
          openContextMenu(
            { type: "trash" },
            { x: event.clientX, y: event.clientY },
          );
        }}
        onEnterTagManagement={() => void enterTagManagement()}
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
        onFoldersDroppedOnFolder={handleFoldersDroppedOnFolder}
        selectedFolderIds={selectedFolderIds}
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
              !showTagManagement &&
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
              {library
                ? showTagManagement
                  ? t("common.itemCount", { count: tags.length })
                  : t("common.itemCount", { count: workspaceBrowseCount })
                : t("common.notLoaded")}
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
                        t("toast.emptyTrashConfirm"),
                      )
                    )
                      void emptyTrash();
                  }}
                  type="button"
                >
                  <Icon name="trash" size={14} />
                  {t("toolbar.emptyTrash")}
                </button>
                <span className="tool-separator" />
              </>
            ) : (
              library &&
              !showTrash &&
              !showTagManagement &&
              visibleAssets.some(
                (a) => a.availability === "missing" && !a.deletedAt,
              ) && (
                <>
                  <button
                    className="compact-action"
                    disabled={busy}
                    onClick={() => void startBatchRelink()}
                    type="button"
                  >
                    <Icon name="folder" size={14} />
                    {t("toolbar.batchRelink")}
                  </button>
                  <span className="tool-separator" />
                </>
              )
            )}
            <CanvasToolbarControls
              backgroundJobsActive={backgroundJobsActive}
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
                openBackgroundJobs: () => setMediaJobsOpen(true),
                openAiSettings: () => {
                  setAppSettingsCategory("ai");
                  setAppSettingsOpen(true);
                },
                openAppSettings: () => {
                  setAppSettingsCategory("general");
                  setAppSettingsOpen(true);
                },
              }}
              busy={busy}
              canvasPrefs={canvasPrefs}
              cardSize={assetCardSize}
              cardSizeStops={cardSizeStops}
              libraryOpen={Boolean(library)}
              locale={locale}
              onCardSizeChange={resizeAssetCards}
              platform={SHORTCUT_PLATFORM}
            />
            <WorkspaceToolsOverflow
              items={[
                {
                  id: "script-sandbox-preview",
                  label: t("automation.preview.open"),
                  onSelect: () => setScriptSandboxPreviewOpen(true),
                },
              ]}
            />
          </div>
        </div>
        {!showTagManagement && (
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
            setSortField={(field) => {
              setShuffleSeed(null);
              setSortField(field);
            }}
            setSortOrder={(order) => {
              setShuffleSeed(null);
              setSortOrder(order);
            }}
            setSourceUrlFilter={setSourceUrlFilter}
            setTagFilter={(value) => {
              // Explicit filter-bar edits leave the tag-management AND mode.
              setTagFilterMatch("any");
              setTagFilter(value);
            }}
            setWidthRange={setWidthRange}
            shuffleActive={shuffleSeed !== null}
            onShuffle={() => {
              setShuffleSeed((prev) => {
                const next = Date.now() >>> 0;
                return prev === null ? next : (next ^ ((prev + 1) >>> 0)) >>> 0;
              });
            }}
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
        )}
        {(aiAnalyzing ||
          (aiJobs !== null && aiJobs.queued + aiJobs.running > 0)) &&
          aiProgressBannerVisible &&
          (() => {
            const batchProgress = aiBatchProgress;
            const progressLabel =
              batchProgress && batchProgress.batchTotal > 0
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
                  {batchProgress && batchProgress.batchTotal > 0 && (
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
                    onClick={() => setAiProgressBannerVisible(false)}
                    type="button"
                  >
                    {t("toast.aiAnalyzeRunInBackground")}
                  </button>
                </div>
              </div>
            );
          })()}
        <div
          className={`workspace-canvas-host${previewAsset ? " is-viewing" : ""}`}
        >
          {renderedToast && (
            <WorkspaceNoticeBanner
              closing={toastClosing}
              message={renderedToast}
              onDismiss={() => dismissVisible()}
              onTransitionEnd={handleToastTransitionEnd}
              onUndo={
                lastUndoableOp && renderedToast.kind === "notice"
                  ? () => void undoLastFileOp()
                  : undefined
              }
              undoLabel={
                lastUndoableOp && renderedToast.kind === "notice"
                  ? lastUndoableOp.kind === "copy"
                    ? t("action.undoCopy")
                    : t("action.undoMove")
                  : undefined
              }
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
        <div
          className={`workspace-canvas${previewAsset ? " is-viewing" : ""}${externalDropActive ? " is-external-drop" : ""}`}
          onDragEnter={handleExternalDragEnter}
          onDragLeave={handleExternalDragLeave}
          onDragOver={handleExternalDragOver}
          onDragOverCapture={handleExternalDragOver}
          onDrop={handleExternalDrop}
          onMouseDown={handleCanvasMouseDown}
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
          {library && showTagManagement ? (
            <TagManagementWorkspace
              busy={busy}
              onCreate={handleCreateTagInManagement}
              onDeleteMany={handleDeleteTagsInManagement}
              onMerge={handleMergeTagsInManagement}
              onOpenTag={(tagId) => void chooseTag(tagId)}
              onRename={handleRenameTagInManagement}
              onSearchTags={(names, match) =>
                void handleSearchTagsFromManagement(names, match)
              }
              tags={tags}
            />
          ) : library ? (
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
                      {
                        "--folder-card-size": `${folderCardWidthPx}px`,
                        ...(panelResizing && panelReflowFrozenWidthRef.current
                          ? {
                              width: `${panelReflowFrozenWidthRef.current}px`,
                            }
                          : {}),
                      } as CSSProperties
                    }
                  >
                    {canvasFolderBrowseEntries.map((entry) => (
                      <FolderCard
                        draggable={!showTrash}
                        entry={entry}
                        key={entry.folderId}
                        libraryId={library.libraryId}
                        trashed={showTrash}
                        {...(showTrash
                          ? {}
                          : createFolderCardDropHandlers(entry.folderId))}
                        onDragStart={(event) => {
                          const folderIds = resolveDraggedFolderIds(
                            entry.folderId,
                            selectedFolderIds,
                          );
                          event.dataTransfer.setData(
                            MANAGED_FOLDERS_DRAG_TYPE,
                            JSON.stringify(folderIds),
                          );
                          event.dataTransfer.effectAllowed = "move";
                        }}
                        onClick={(folderId, event) => {
                          handleFolderCardClick(folderId, event);
                        }}
                        onContextMenu={(clickedEntry, event) => {
                          event.preventDefault();
                          if (showTrash) {
                            openContextMenu(
                              {
                                type: "trashed-folder",
                                tombstoneId: clickedEntry.folderId,
                                name: clickedEntry.name,
                                relativePath: clickedEntry.relativePath,
                              },
                              { x: event.clientX, y: event.clientY },
                            );
                            return;
                          }
                          const intent = resolveBrowseContextMenuIntent(
                            { kind: "folder", id: clickedEntry.folderId },
                            {
                              assetIds: selectedAssetIds,
                              folderIds: selectedFolderIds,
                            },
                          );
                          if (intent.type === "single-folder") {
                            setSelectedFolderIds([intent.folderId]);
                            setSelectedAssetIds([]);
                            openContextMenu(
                              {
                                type: "folder",
                                folderId: intent.folderId,
                                name: clickedEntry.name,
                                locationKind: "managed",
                              },
                              { x: event.clientX, y: event.clientY },
                            );
                            return;
                          }
                          if (intent.type !== "multi") return;
                          openContextMenu(
                            {
                              type: "multi-asset",
                              assetIds: [...intent.assetIds],
                              folderIds: [...intent.folderIds],
                              count:
                                intent.assetIds.length + intent.folderIds.length,
                            },
                            { x: event.clientX, y: event.clientY },
                          );
                        }}
                        onDoubleClick={(folderId) => {
                          if (showTrash) {
                            const entry = canvasFolderBrowseEntries.find(
                              (item) => item.folderId === folderId,
                            );
                            if (!entry) return;
                            void enterTrashAt(entry.folderId);
                            return;
                          }
                          void chooseFolder(folderId);
                        }}
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
                    ref={assetGridRef}
                    style={{
                      ...assetGridLayoutStyle(assetViewMode, assetCardSize),
                      ...(panelResizing && panelReflowFrozenWidthRef.current
                        ? {
                            width: `${panelReflowFrozenWidthRef.current}px`,
                            maxWidth: "none",
                          }
                        : {}),
                    }}
                  >
                  {(() => {
                    const showCornerBadges =
                      shouldShowAssetCardBadges(assetCardSize);
                    const renderAssetCard = (asset: AssetSummary) => {
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
                      const trashOriginBadgeLabel =
                        showTrash &&
                        asset.deletedAt &&
                        asset.trashedFromPath
                          ? trashedFromLabel(asset.trashedFromPath, locale)
                          : null;
                      const snippetCaption = resolveSearchSnippetCaption(
                        searchSnippets.get(asset.assetId),
                        asset.displayName,
                      );
                      const showThumbnailFailure = shouldShowThumbnailFailureBadge(
                        asset,
                        thumbnailFailures.has(asset.assetId),
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
                        const intent = resolveBrowseContextMenuIntent(
                          { kind: "asset", id: asset.assetId },
                          {
                            assetIds: selectedAssetIds,
                            folderIds: selectedFolderIds,
                          },
                        );
                        if (intent.type === "single-asset") {
                          if (!selectedIdSet.has(intent.assetId)) {
                            setSelectedAssetIds([intent.assetId]);
                            setSelectedAssetId(intent.assetId);
                          }
                          setSelectedFolderIds([]);
                          if (library) {
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
                          return;
                        }
                        if (intent.type !== "multi" || !library) return;
                        openContextMenu(
                          {
                            type: "multi-asset",
                            assetIds: [...intent.assetIds],
                            folderIds: [...intent.folderIds],
                            count:
                              intent.assetIds.length + intent.folderIds.length,
                          },
                          { x: e.clientX, y: e.clientY },
                        );
                      }}
                      type="button"
                    >
                      <div
                        className="asset-preview"
                        style={
                          assetViewMode === "masonry"
                            ? resolveMasonryPreviewStyle(
                                asset.width,
                                asset.height,
                              )
                            : undefined
                        }
                        title={
                          showThumbnailFailure
                            ? thumbnailFailures.get(asset.assetId)
                            : undefined
                        }
                      >
                        {(() => {
                          if (asset.mediaType === "text" && api && library) {
                            return (
                              <TextAssetPreviewTile
                                api={api}
                                assetId={asset.assetId}
                                libraryId={library.libraryId}
                                revisionId={asset.currentRevisionId}
                              />
                            );
                          }
                          const thumbCover =
                            asset.thumbnailStatus === "ready" &&
                            asset.thumbnailArtifactId &&
                            library
                              ? coverSrc(
                                  library.libraryId,
                                  asset.thumbnailArtifactId,
                                )
                              : null;
                          if (isCardSequencePlayable(asset) && library) {
                            const sequenceActive =
                              hoveredAssetId === asset.assetId ||
                              selectedAssetId === asset.assetId;
                            if (
                              thumbCover ||
                              asset.sequence?.frames.some(
                                (frame) => frame.thumbnailArtifactId,
                              )
                            ) {
                              return (
                                <AssetCardMedia
                                  alt={asset.displayName}
                                  coverUrl={thumbCover}
                                  isActive={sequenceActive}
                                  libraryId={library.libraryId}
                                  preview={null}
                                  sequence={asset.sequence}
                                />
                              );
                            }
                          }
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
                                  libraryId={library.libraryId}
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
                        {trashOriginBadgeLabel && (
                          <span
                            aria-label={t("scope.containingFolder", {
                              name: trashOriginBadgeLabel,
                            })}
                            className="asset-source-badge"
                            title={asset.trashedFromPath ?? trashOriginBadgeLabel}
                          >
                            {trashOriginBadgeLabel}
                          </span>
                        )}
                        {showExtension && (
                          <span className="asset-extension">
                            {fileExtensionLabel(asset.displayName)}
                          </span>
                        )}
                        {showThumbnailFailure && (
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
                            {(() => {
                              const affordance = missingAssetAffordance();
                              return (
                                <Icon
                                  color={affordance.iconColor}
                                  name={affordance.icon}
                                  size={28}
                                />
                              );
                            })()}
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
                        {asset.sequence && (
                          <span className="asset-duration-badge asset-sequence-badge">
                            {asset.sequence.frameCount}F · {asset.sequence.fps} FPS ·{" "}
                            {formatSequenceDuration(
                              asset.sequence.frameCount,
                              asset.sequence.fps,
                            )}
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
                                  {splitSearchHighlights(
                                    asset.displayName,
                                    searchValue,
                                    "filename",
                                  ).map((segment, index) =>
                                    segment.matched ? (
                                      <mark
                                        className="search-text-highlight"
                                        key={index}
                                      >
                                        {segment.text}
                                      </mark>
                                    ) : (
                                      <span key={index}>{segment.text}</span>
                                    ),
                                  )}
                                </strong>
                              )}
                            </>
                          )}
                          {snippetCaption != null ? (
                            <span className="search-snippet">
                              {highlightSnippet(snippetCaption)}
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
                    };
                    return assetRenderSections.map((section) => (
                      <div
                        className={
                          section.label ? "trash-folder-group" : undefined
                        }
                        key={section.key || "__root__"}
                      >
                        {section.label ? (
                          <h3 className="trash-folder-group-header">
                            {section.label}
                          </h3>
                        ) : null}
                        {assetViewMode === "masonry" ? (
                          <MasonryColumns
                            assets={section.assets}
                            cardSize={assetCardSize}
                            showCaption={
                              canvasPrefs.fields.name ||
                              canvasPrefs.fields.size ||
                              canvasPrefs.fields.date
                            }
                          >
                            {section.assets.map(renderAssetCard)}
                          </MasonryColumns>
                        ) : (
                          <JustifiedAssetRows
                            assets={section.assets}
                            cardSize={assetCardSize}
                          >
                            {section.assets.map(renderAssetCard)}
                          </JustifiedAssetRows>
                        )}
                      </div>
                    ));
                  })()}
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
          ) : null}
        </div>
        </div>
        {previewAsset && library && api && (
          <AssetPreviewModal
            ref={previewModalRef}
            api={api}
            asset={previewAsset}
            chromeIdle={viewerChromeIdle}
            key={previewAsset.assetId}
            libraryId={library.libraryId}
            onChromeActivity={onViewerChromeActivity}
            onSetColorSpace={(assetId, colorSpace) => {
              void persistAssetColorSpace(assetId, colorSpace);
            }}
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
      <ImageSequenceDialog
        count={
          imageSequenceDialog?.mode === "update"
            ? imageSequenceDialog.frameCount ?? 0
            : imageSequenceDialog?.assetIds.length ?? 0
        }
        error={imageSequenceDialog?.error}
        fps={imageSequenceDialog?.fps ?? DEFAULT_IMAGE_SEQUENCE_FPS}
        mode={imageSequenceDialog?.mode}
        onCancel={() => setImageSequenceDialog(null)}
        onFpsChange={(fps) =>
          setImageSequenceDialog((current) =>
            current ? { ...current, fps, error: null } : current,
          )
        }
        onSubmit={() =>
          void (
            imageSequenceDialog?.mode === "update"
              ? updateImageSequenceFps()
              : createSelectedImageSequence()
          )
        }
        open={imageSequenceDialog !== null}
        submitting={imageSequenceDialog?.submitting}
      />
      <ImageSequenceImportDialog
        error={imageSequenceImportError}
        offer={imageSequenceImportOffer}
        onCancel={() => {
          setImageSequenceImportOffer(null);
          setImageSequenceImportError(null);
        }}
        onConfirm={(input) => void confirmImageSequenceImportOffer(input)}
        open={imageSequenceImportOffer !== null}
        submitting={imageSequenceImportSubmitting}
      />
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
          folderIds={moveDialog.folderIds}
          folders={folders}
          targetFolderId={moveDialog.targetFolderId}
          conflictStrategy={moveDialog.conflictStrategy}
          folderOnly={
            moveDialog.folderIds.length > 0 && moveDialog.assetIds.length === 0
          }
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
        activeCategory={appSettingsCategory}
        aiConfigPanel={
          <AiConfigDialog
            open={appSettingsOpen && appSettingsCategory === "ai"}
            variant="embedded"
            apiKey={aiApiKey}
            apiFormat={aiApiFormat}
            model={aiModel}
            baseUrl={aiBaseUrl}
            languages={aiLanguages}
            concurrencyLimit={aiConcurrencyLimit}
            maxAnalysisImageEdgePx={aiMaxAnalysisImageEdgePx}
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
            onConcurrencyLimitChange={commitAiConcurrencyLimit}
            onMaxAnalysisImageEdgePxChange={commitAiMaxAnalysisImageEdgePx}
            onDescriptionEnabledChange={setAiDescriptionEnabled}
            onTagsEnabledChange={setAiTagsEnabled}
            onRatingEnabledChange={setAiRatingEnabled}
            onForceExistingTagsChange={setAiForceExistingTags}
            onAnalysisSettingsChange={setAiAnalysisSettings}
            onCommitAnalysisSettingsPatch={commitAiAnalysisSettingsPatch}
            onDisclaimerAcceptedChange={setAiDisclaimerAccepted}
            onAutoAnalyzeEnabledChange={setAiAutoAnalyzeEnabled}
            saveVerifying={aiSaveVerifying}
            onClose={() => {
              if (aiSaveVerifying) return;
              setAiApiKey("");
              // Keep global connection state for heartbeat / context menu
              // (Serpent-rsbt); re-sync from stored credentials after draft edits.
              void probeStoredAiConnection();
            }}
            onSave={() => void saveAiConfig()}
            onTestConnection={testAiConnectionFromDialog}
            onFetchModels={fetchAiModelsFromDialog}
          />
        }
        aiUiPrefs={aiUiPrefs}
        canvasPrefs={canvasPrefs}
        onActiveCategoryChange={setAppSettingsCategory}
        onClose={() => {
          setAppSettingsOpen(false);
          setAppSettingsCategory("general");
        }}
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
        onOpenAppLog={openAppLog}
        pluginApi={(window as RendererWindow).serpent?.plugins}
        libraryId={library?.libraryId}
        open={appSettingsOpen}
      />
      <AppLogDialog
        automationCorrelationId={appLogAutomationCorrelationId}
        entries={appLogEntries}
        errorCode={appLogErrorCode}
        loading={appLogLoading}
        onClose={() => setAppLogOpen(false)}
        onAutomationCorrelationIdChange={setAppLogAutomationCorrelationId}
        onRefresh={() => void refreshAppLog()}
        onReveal={() => {
          const bridge = (window as RendererWindow).serpent?.shell;
          if (!bridge?.revealAppLog) {
            setError(t("toast.aiRevealLogFailed"));
            return;
          }
          void bridge.revealAppLog().then((result) => {
            if (!result.ok) setError(t("toast.aiRevealLogFailed"));
          });
        }}
        open={appLogOpen}
      />
      <ScriptSandboxPreviewDialog
        automation={(window as RendererWindow).serpent?.automation}
        libraryId={library?.libraryId ?? null}
        onClose={() => {
          allowRequiredDialogDismissRef.current = false;
          setScriptSandboxPreviewOpen(false);
        }}
        onExecutionSettled={() => refreshAfterAutomationScript()}
        onOpenExecutionLog={(logId) => {
          allowRequiredDialogDismissRef.current = false;
          setScriptSandboxPreviewOpen(false);
          openAppLog(logId);
        }}
        open={scriptSandboxPreviewOpen}
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
        busy={busy}
        open={dialog === "library"}
        phase={createLibraryPhase}
        required={!library}
        value={dialogValue}
        onValueChange={setDialogValue}
        onBeginCreate={() => {
          setDialogValue(t("shell.myLibrary"));
          setCreateLibraryPhase("form");
        }}
        onBackToStart={() => {
          setCreateLibraryPhase("start");
        }}
        onSubmit={() => {
          setDialog(null);
          void runLibraryOperation("create");
        }}
        onCancel={() => {
          setDialog(null);
          setCreateLibraryPhase("start");
        }}
        onOpenExisting={() => {
          setDialog(null);
          void runLibraryOperation("open");
        }}
        onImportLibrary={() => {
          setDialog(null);
          setImportLibraryChooserOpen(true);
        }}
        onOpenAutomation={() => {
          allowRequiredDialogDismissRef.current = true;
          setDialog(null);
          setScriptSandboxPreviewOpen(true);
        }}
        onOpenRecent={(path) => {
          setDialog(null);
          void openRecentLibrary(path);
        }}
        recentLibraries={recentLibraries}
      />
      {conflicts && conflictPhase === "name" && (
        <NameConflictDialog
          conflicts={conflicts}
          decision={nameDecision}
          remember={rememberNameConflict}
          onDecisionChange={setNameDecision}
          onRememberChange={setRememberNameConflict}
          onCancel={() => void abandonConflicts()}
          onConfirm={() => confirmNameConflictDialog()}
        />
      )}
      {conflicts && conflictPhase === "duplicate" && (
        <ContentDuplicateDialog
          conflicts={conflicts}
          decision={duplicateDecision}
          remember={rememberDuplicate}
          onDecisionChange={setDuplicateDecision}
          onRememberChange={setRememberDuplicate}
          onCancel={() => void abandonConflicts()}
          onConfirm={() => confirmContentDuplicateDialog()}
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
      {assetDiskDeleteIds && (
        <DiskDeleteConfirmDialog
          bodyKey="dialog.diskDelete.assetBody"
          assetCount={assetDiskDeleteIds.length}
          onCancel={() => setAssetDiskDeleteIds(null)}
          onConfirm={(dontShowAgain) => {
            void confirmAssetDiskDelete(dontShowAgain);
          }}
        />
      )}
      {selectionDiskDelete && (
        <DiskDeleteConfirmDialog
          bodyKey="dialog.diskDelete.selectionBody"
          assetCount={
            selectionDiskDelete.assetIds.length +
            selectionDiskDelete.folderIds.length
          }
          onCancel={() => setSelectionDiskDelete(null)}
          onConfirm={(dontShowAgain) => {
            void confirmSelectionDiskDelete(dontShowAgain);
          }}
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
        session={batchRelinkPreview}
        keepMetadata={batchRelinkKeepMetadata}
        onKeepMetadataChange={setBatchRelinkKeepMetadata}
        onApply={() => void applyBatchRelink()}
        onCancel={() => void cancelBatchRelink()}
      />
      <AiConnectionFailureDialog
        failedCount={aiConnectionFailureGate.failedJobIds.length}
        onAbort={onAiConnectionFailureAbort}
        onRetry={handleAiConnectionFailureRetry}
        open={aiConnectionFailureGate.open}
      />
      <FatalAlertDialog
        message={fatalAlertMessage}
        title={fatalDialogTitle}
        onDismiss={dismissFatalAlert}
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
        onViewAppLog={openAppLog}
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
        onCopyFolder={(folderId) => {
          void handleCopyFolder(folderId);
        }}
        onPasteIntoFolder={(folderId) => {
          void pasteIntoFolder(folderId);
        }}
        onCloneFolder={(folderId) => {
          void cloneFolder(folderId);
        }}
        onMoveFolder={(folderIds) =>
          setMoveDialog({
            assetIds: [],
            folderIds: [...folderIds],
            targetFolderId: null,
            conflictStrategy: "keep-both",
          })
        }
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
        onMoveToFolder={(assetIds, folderIds) =>
          setMoveDialog({
            assetIds: [...assetIds],
            folderIds: [...(folderIds ?? [])],
            targetFolderId: null,
            conflictStrategy: "keep-both",
          })
        }
        onTrash={(assetIds, folderIds) => {
          void trashMixedSelection(assetIds, folderIds ?? []);
        }}
        onDeleteFromDisk={(assetIds, folderIds) => {
          requestSelectionDiskDelete(assetIds, folderIds ?? []);
        }}
        onRestore={(assetIds) => {
          void requestRestoreTrashedAssets(assetIds);
        }}
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
        canAnalyze={
          aiAnalyzeConnectionReady(aiHasKey, aiConnectionState) && !aiAnalyzing
        }
        aiDisconnected={aiAnalyzeShowsDisconnectGlyph(
          aiHasKey,
          aiConnectionState,
        )}
        onCopyToLinked={(folder, assetIds) => { void copyManagedSelectionToLinked(folder, assetIds); }}
        onClearSelection={clearAssetSelection}
        onOpenExternal={(assetId) => { void handleOpenExternal(assetId); }}
        onViewAsset={(assetId) => {
          const asset = visibleAssets.find((item) => item.assetId === assetId);
          if (asset) openAssetPreview(asset);
        }}
        onSetAssetColorSpace={(assetId, colorSpace) => {
          void persistAssetColorSpace(assetId, colorSpace);
        }}
        onCreateImageSequence={(assetIds) =>
          setImageSequenceDialog({
            assetIds: [...assetIds],
            mode: "create",
            fps: DEFAULT_IMAGE_SEQUENCE_FPS,
            submitting: false,
            error: null,
          })
        }
        onSetImageSequenceFps={(sequenceId, frameCount, fps) => {
          setImageSequenceDialog({
            assetIds: [],
            mode: "update",
            sequenceId,
            frameCount,
            fps,
            submitting: false,
            error: null,
          });
        }}
        onDissolveImageSequence={(sequenceId) => {
          void dissolveSelectedImageSequence(sequenceId);
        }}
        onRevealInFolder={(assetId) => { void handleRevealInFolder(assetId); }}
        onCopyFilePath={(assetId) => { void handleCopyFilePath(assetId); }}
        onCopyAssetFiles={(assetIds) => {
          void handleCopyAssetFiles(assetIds);
        }}
        pasteTargetFolderId={browsePasteDestination}
        onRenameAssetFile={(assetId) => { openAssetRename(assetId); }}
        onRemoveFromCurrentCollection={(assetId) => {
          if (activeCollectionId) void removeAssetFromCollection(assetId, activeCollectionId);
        }}
        onRemoveFromCollection={(assetId, collectionId) => { void removeAssetFromCollection(assetId, collectionId); }}
        onAssignTag={(assetId, tagId) => { void assignAssetToTag(assetId, tagId); }}
        onAddToCollection={(assetId, collectionId) => { void addAssetToCollection(assetId, collectionId); }}
        onLoadCollectionMemberships={loadCollectionMemberships}
        trashedAssetCount={searchTotal ?? trashedAssets.length}
        trashedFolderCount={trashedFolders.length}
        onRestoreTrashedFolder={(tombstoneId, name) => {
          void restoreTrashedManagedFolder(tombstoneId, name);
        }}
        onEmptyTrash={() => {
          void emptyTrash();
        }}
      />
      {/* REQ-SHELL-007 / REQ-SHELL-011 pane resize + edge restore handles. */}
      {leftOpen ? (
        <div
          aria-label={t("shell.resizeNav")}
          aria-orientation="vertical"
          className={`panel-resizer${panelResizing === "nav" ? " is-active" : ""}`}
          data-hover-tip={t("shell.resizeNav")}
          onDoubleClick={() => {
            capturePanelResizeAnchor(false);
            resetPanelWidth("nav");
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            capturePanelResizeAnchor();
            beginPanelResize("nav", event.clientX);
          }}
          onMouseDown={() => capturePanelResizeAnchor()}
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
            capturePanelResizeAnchor();
            beginPanelEdgeRestore("nav", event.clientX);
          }}
          onMouseDown={() => capturePanelResizeAnchor()}
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
          onDoubleClick={() => {
            capturePanelResizeAnchor(false);
            resetPanelWidth("inspector");
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            capturePanelResizeAnchor();
            beginPanelResize("inspector", event.clientX);
          }}
          onMouseDown={() => capturePanelResizeAnchor()}
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
            capturePanelResizeAnchor();
            beginPanelEdgeRestore("inspector", event.clientX);
          }}
          onMouseDown={() => capturePanelResizeAnchor()}
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
export function aiSearchPlanToDefinition(plan: AiSearchPlan): SearchDefinition {
  const positiveTerms = [...new Set([...plan.keywords, ...plan.synonyms])];
  const clauses: SearchQuery["clauses"] = [];
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
