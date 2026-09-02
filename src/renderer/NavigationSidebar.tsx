import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "./Icons";
import { IconActionButton } from "./icon-action-button";
import {
  linkedFolderHoverDetail,
  linkedFolderNavAffordance,
} from "./availability-affordance";
import { useT } from "./i18n";
import { isImeKeyboardEvent, shouldHoldDismissForIme } from "./ime-safe-dismiss";
import type {
  CollectionSummary,
  LinkedFolderSummary,
  ManagedFolderSummary,
  SmartCollectionSummary,
} from "../shared/asset-types";
import type { ContextMenuDescriptor } from "./context-menu";
import type { RendererLibrarySummary } from "../shared/protocol/responses";
import {
  parseManagedAssetDrag,
  resolveDragDropMode,
  resolveManagedDropEffect,
  supportsManagedAssetDrag,
  type DragDropMode,
} from "./asset-drag-drop";
import {
  MANAGED_FOLDERS_DRAG_TYPE,
  parseManagedFolderDrag,
  resolveDraggedFolderIds,
  supportsManagedFolderDrag,
} from "./folder-drag-drop";
import {
  externalImportPayload,
  supportsExternalImportTransfer,
} from "./external-import-transfer";
import {
  inlineCreateRowIndex,
  inlineFolderEditDepth,
  type InlineFolderEditState,
} from "./inline-folder-edit";
import type { InlineSmartCollectionEditState } from "./inline-smart-collection-edit";
import {
  buildUnifiedDirectoryNavEntries,
  filterCollapsedDirectoryEntries,
  managedFolderIdsWithChildren,
} from "./unified-directory-nav";
import {
  isAllAssetsNavActive,
  isManagedFolderNavActive,
  isPluginSidebarViewNavActive,
  isRootFolderNavActive,
  isTagManagementNavActive,
  isTrashNavActive,
} from "./browse-nav-active";
import {
  loadNavTreePreferences,
  saveNavTreePreferences,
  withCollapsedFolderIds,
  withCollapsedCollectionIds,
  type NavTreePreferences,
} from "./nav-tree-preferences";
import { PaneSurface } from "./ui/surfaces";

// ---------------------------------------------------------------------------
// NavRow — local presentational row
// ---------------------------------------------------------------------------

function NavRow({
  icon,
  label,
  count,
  active,
  onClick,
  onContextMenu,
  onDragOver,
  onDrop,
  onDragEnter,
  onDragLeave,
  dropActive,
  depth = 0,
  disabled,
  draggable,
  onDragStart,
  iconColor,
  title,
  disclosure,
  navFolderId,
  navFolderKind,
  navCollectionId,
}: {
  icon: IconName;
  label: string;
  count?: number;
  active?: boolean;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDragOver?: (e: React.DragEvent<HTMLButtonElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLButtonElement>) => void;
  onDragEnter?: (e: React.DragEvent<HTMLButtonElement>) => void;
  onDragLeave?: (e: React.DragEvent<HTMLButtonElement>) => void;
  /** REQ-DND-001/002: asset-drag hover affordance (is-drop-target class). */
  dropActive?: boolean;
  depth?: number;
  disabled?: boolean;
  draggable?: boolean;
  onDragStart?: (event: React.DragEvent<HTMLButtonElement>) => void;
  iconColor?: string;
  title?: string;
  /** CU-D2: optional disclosure control rendered beside the row. */
  disclosure?: ReactNode;
  /** Serpent-vf8x: focus target for folder keyboard shortcuts. */
  navFolderId?: string;
  navFolderKind?: "managed" | "linked";
  /** Focus target for collection keyboard shortcuts. */
  navCollectionId?: string;
}) {
  // CU-D9: always expose the full label on hover; when a status title is also
  // provided (e.g. offline linked folder), append it after the name.
  const hoverTitle =
    title && title !== label ? `${label} — ${title}` : label;

  return (
    <div className="nav-tree-row" style={{ paddingLeft: depth * 14 }}>
      {disclosure ?? <span className="nav-disclosure-spacer" aria-hidden="true" />}
      <button
        className={`nav-row${active ? " is-active" : ""}${dropActive ? " is-drop-target" : ""}`}
        data-nav-folder-id={navFolderId}
        data-nav-folder-kind={navFolderKind}
        data-nav-collection-id={navCollectionId}
        disabled={disabled}
        draggable={draggable}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        style={{ paddingLeft: 7 }}
        title={hoverTitle}
        type="button"
      >
        <Icon name={icon} size={15} color={iconColor} />
        <span className="nav-row-label">{label}</span>
        {count !== undefined && (
          <span aria-hidden="true" className="nav-count">
            {count}
          </span>
        )}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InlineFolderEditRow — REQ-FOLDER-007 in-tree name edit row
// ---------------------------------------------------------------------------

/**
 * The single editing surface for 新建子文件夹 / 重命名… / 侧栏「+」: a folder
 * row whose label is an input. Enter commits, Escape cancels, and blur routes
 * through the same commit resolution (valid non-empty names submit, anything
 * else cancels); typed worker failures render inline under the row and keep
 * it open for correction. While the input is focused the global shortcut
 * handlers stay inert because they all bail out on editable targets.
 */
function InlineFolderEditRow({
  depth,
  state,
  onChange,
  onCommit,
  onCancel,
}: {
  depth: number;
  state: InlineFolderEditState;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const committingRef = useRef(false);

  const commitOnce = useCallback(() => {
    if (committingRef.current) return;
    committingRef.current = true;
    onCommit();
    // Keep the guard through the pointerdown → blur sequence. The parent owns
    // the actual async state transition and will unmount this row when done.
    window.setTimeout(() => {
      committingRef.current = false;
    }, 0);
  }, [onCommit]);

  // Focus with the whole name preselected: typing replaces the current
  // (rename) or default (create) name immediately, Enter accepts it as-is.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  // A blank area is not focusable, so Chromium does not always blur the input
  // when the user clicks there. Commit on the same outside interaction that
  // would normally cause blur, keeping Enter/Escape as the explicit keyboard
  // alternatives.
  useEffect(() => {
    const handleOutsidePointer = (event: PointerEvent) => {
      const input = inputRef.current;
      if (input && !input.contains(event.target as Node | null)) commitOnce();
    };
    document.addEventListener("pointerdown", handleOutsidePointer, true);
    return () =>
      document.removeEventListener("pointerdown", handleOutsidePointer, true);
  }, [commitOnce]);

  return (
    <div className="nav-tree-row" style={{ paddingLeft: depth * 14 }}>
      <span className="nav-disclosure-spacer" aria-hidden="true" />
      <div className="nav-inline-edit" style={{ paddingLeft: 7 }}>
      <Icon name="folder" size={15} />
      <input
        aria-invalid={state.error ? true : undefined}
        aria-label={
          state.kind === "create"
            ? t("nav.newFolderName")
            : t("nav.folderRename")
        }
        className="text-field"
        maxLength={80}
        onBlur={(event) => {
          if (shouldHoldDismissForIme({ focusEvent: event })) return;
          commitOnce();
        }}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (isImeKeyboardEvent(event)) return;
          if (event.key === "Enter") {
            event.preventDefault();
            commitOnce();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        ref={inputRef}
        value={state.value}
      />
      {state.error ? (
        <p className="nav-inline-edit-error" role="alert">
          {state.error}
        </p>
      ) : null}
      </div>
    </div>
  );
}

/** The collection equivalent of the folder in-tree create row. */
function InlineCollectionEditRow({
  depth,
  value,
  ariaLabel,
  placeholder,
  onChange,
  onCommit,
  onCancel,
}: {
  depth: number;
  value: string;
  ariaLabel?: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onCommit: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const committingRef = useRef(false);
  const blurCommitTimerRef = useRef<number | null>(null);

  const cancelScheduledBlurCommit = useCallback(() => {
    if (blurCommitTimerRef.current === null) return;
    window.clearTimeout(blurCommitTimerRef.current);
    blurCommitTimerRef.current = null;
  }, []);

  const commitOnce = useCallback(() => {
    cancelScheduledBlurCommit();
    if (committingRef.current) return;
    committingRef.current = true;
    void Promise.resolve(onCommit()).finally(() => {
      committingRef.current = false;
    });
  }, [cancelScheduledBlurCommit, onCommit]);

  // Context-menu dismissal and row insertion happen in the same interaction
  // for “new subcollection”. Layout focus handles the initial mount before
  // paint; the frame retry covers a menu teardown that briefly reclaims focus.
  useLayoutEffect(() => {
    const focusInput = () => {
      const input = inputRef.current;
      if (!input) return;
      input.focus({ preventScroll: true });
      input.select();
    };
    focusInput();
    const frame = window.requestAnimationFrame(() => {
      if (document.activeElement !== inputRef.current) focusInput();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    return () => {
      if (blurCommitTimerRef.current !== null) {
        window.clearTimeout(blurCommitTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleOutsidePointer = (event: PointerEvent) => {
      const input = inputRef.current;
      if (input && !input.contains(event.target as Node | null)) commitOnce();
    };
    document.addEventListener("pointerdown", handleOutsidePointer, true);
    return () =>
      document.removeEventListener("pointerdown", handleOutsidePointer, true);
  }, [commitOnce]);

  return (
    <div className="nav-tree-row" style={{ paddingLeft: depth * 14 }}>
      <span className="nav-disclosure-spacer" aria-hidden="true" />
      <div className="nav-inline-edit" style={{ paddingLeft: 7 }}>
        <Icon name="collection" size={15} />
        <input
          aria-label={ariaLabel ?? t("nav.newCollection")}
          className="text-field"
          maxLength={255}
          onBlur={(event) => {
            if (shouldHoldDismissForIme({ focusEvent: event })) return;
            cancelScheduledBlurCommit();
            blurCommitTimerRef.current = window.setTimeout(() => {
              blurCommitTimerRef.current = null;
              if (document.activeElement !== inputRef.current) commitOnce();
            }, 0);
          }}
          onChange={(event) => onChange(event.target.value)}
          onFocus={cancelScheduledBlurCommit}
          onKeyDown={(event) => {
            if (isImeKeyboardEvent(event)) return;
            if (event.key === "Enter") {
              event.preventDefault();
              commitOnce();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              onCancel();
            }
          }}
          placeholder={placeholder ?? t("nav.newCollection")}
          ref={inputRef}
          value={value}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InlineSmartCollectionEditRow — SMART-007 sidebar create row
// ---------------------------------------------------------------------------

/**
 * Name-edit row for the smart-collections section 「+」. Enter commits,
 * Escape cancels, blur routes through the same commit resolution; typed
 * failures (including missing discovery conditions) stay under the row.
 */
function InlineSmartCollectionEditRow({
  state,
  onChange,
  onCommit,
  onCancel,
}: {
  state: InlineSmartCollectionEditState;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const committingRef = useRef(false);

  const commitOnce = useCallback(() => {
    if (committingRef.current) return;
    committingRef.current = true;
    onCommit();
    window.setTimeout(() => {
      committingRef.current = false;
    }, 0);
  }, [onCommit]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  useEffect(() => {
    const handleOutsidePointer = (event: PointerEvent) => {
      const input = inputRef.current;
      if (input && !input.contains(event.target as Node | null)) commitOnce();
    };
    document.addEventListener("pointerdown", handleOutsidePointer, true);
    return () =>
      document.removeEventListener("pointerdown", handleOutsidePointer, true);
  }, [commitOnce]);

  return (
    <div className="nav-tree-row">
      <span className="nav-disclosure-spacer" aria-hidden="true" />
      <div className="nav-inline-edit" style={{ paddingLeft: 7 }}>
      <Icon name="smart" size={15} />
      <input
        aria-invalid={state.error ? true : undefined}
        aria-label={t("nav.newSmartCollectionName")}
        className="text-field"
        maxLength={80}
        onBlur={(event) => {
          if (shouldHoldDismissForIme({ focusEvent: event })) return;
          commitOnce();
        }}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (isImeKeyboardEvent(event)) return;
          if (event.key === "Enter") {
            event.preventDefault();
            commitOnce();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        ref={inputRef}
        value={state.value}
      />
      {state.error ? (
        <p className="nav-inline-edit-error" role="alert">
          {state.error}
        </p>
      ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section — local presentational wrapper
// ---------------------------------------------------------------------------

function Section({
  title,
  action,
  actionLabel,
  toggleAction,
  toggleActive,
  toggleLabel,
  secondaryAction,
  secondaryLabel,
  children,
}: {
  title: string;
  action?: () => void;
  /** Explicit primary tooltip; defaults to nav.addSection. */
  actionLabel?: string;
  toggleAction?: () => void;
  toggleActive?: boolean;
  toggleLabel?: string;
  secondaryAction?: () => void;
  secondaryLabel?: string;
  children: ReactNode;
}) {
  const t = useT();
  const primaryLabel = actionLabel ?? t("nav.addSection", { title });
  const linkLabel = secondaryLabel ?? t("nav.secondaryAction", { title });
  return (
    <section className="nav-section">
      <div className="nav-section-heading">
        <span>{title}</span>
        {(action || secondaryAction || toggleAction) && (
          <span className="nav-section-actions">
            {toggleAction && (
              <IconActionButton
                icon={toggleActive ? "eye" : "eye-off"}
                label={toggleLabel ?? t("nav.showIgnored")}
                onClick={toggleAction}
              />
            )}
            {action && (
              <IconActionButton
                icon="plus"
                label={primaryLabel}
                onClick={action}
              />
            )}
            {secondaryAction && (
              <IconActionButton
                icon="link"
                label={linkLabel}
                onClick={secondaryAction}
              />
            )}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// NavigationSidebar — props
// ---------------------------------------------------------------------------

export interface NavigationSidebarProps {
  // --- Library connection ---
  library: RendererLibrarySummary | null;

  // --- Navigation state ---
  assetScope: string;
  showTrash: boolean;
  showTagManagement: boolean;
  activePluginSidebarViewId?: string | null;
  pluginSidebarViews?: readonly { id: string; title: string }[];
  activeTagId: string | null;
  activeCollectionId: string | null;
  activeSmartCollectionId: string | null;
  showIgnoredItems: boolean;
  onToggleShowIgnoredItems: () => void;

  // --- Data ---
  allAssetCount: number;
  /** Assets stored directly under the library root (distinct from all assets). */
  rootAssetCount: number;
  trashedAssetCount: number;
  folders: ManagedFolderSummary[];
  collections: CollectionSummary[];
  collectionTree: Map<string | null, CollectionSummary[]>;
  smartCollections: SmartCollectionSummary[];
  linkedFolders: LinkedFolderSummary[];

  // --- Inline input state ---
  showCollectionInput: boolean;
  collectionInputValue: string;
  newCollectionParentId: string | null;
  inlineCollectionRename: {
    collectionId: string;
    value: string;
  } | null;
  // --- Collection drag state ---
  draggedCollectionId: string | null;
  onSetDraggedCollectionId: (id: string | null) => void;

  // --- Navigation callbacks ---
  onChooseAllAssets: () => void;
  onEnterTrash: () => void;
  onTrashContextMenu?: (event: React.MouseEvent) => void;
  onEnterTagManagement: () => void;
  onChoosePluginSidebarView?: (viewId: string) => void;
  onChooseFolder: (folderId: string) => void;
  onChooseCollection: (collectionId: string, recursive?: boolean) => void;
  onChooseSmartCollection: (collectionId: string) => void;

  // --- External drag/drop ---
  onExternalDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onExternalDrop: (
    event: React.DragEvent<HTMLElement>,
    targetFolderId: string | null | undefined,
    targetCollectionId: string | undefined,
  ) => void;
  /** Renderer-only fallback for a native drag whose custom payload was lost. */
  getManagedAssetDragIds?: () => readonly string[] | null;
  /** Resolve an Electron native file drop back to managed asset ids. */
  onResolveManagedAssetDrop?: (files: File[]) => Promise<string[]>;

  // --- Internal asset drag/drop (REQ-DND-001/002 + Serpent-aa3 copy mode) ---
  onAssetsDroppedOnFolder: (
    folderId: string | null,
    assetIds: string[],
    mode: DragDropMode,
  ) => void;
  onFoldersDroppedOnFolder: (
    targetFolderId: string | null,
    folderIds: string[],
  ) => void;
  /** Canvas/sidebar folder selection for folder drag (Serpent-nno6). */
  selectedFolderIds: readonly string[];
  onAssetsDroppedOnTrash: (assetIds: string[]) => void;
  onFoldersDroppedOnTrash: (folderIds: string[]) => void;
  onAssetsDroppedOnCollection: (
    collectionId: string,
    assetIds: string[],
    mode: DragDropMode,
  ) => void;
  /** Mid-drag Option/Alt flips; used to update the drag-preview "+" badge. */
  onManagedAssetCopyModeChange?: (copyMode: boolean) => void;

  // --- Linked folder actions ---
  onImportFolderAsLinked: () => void;
  onRelinkFolder: (folderId: string) => void;
  onConvertLinkedDialog: (dialog: {
    folderId: string;
    name: string;
    targetFolderId: string;
  }) => void;

  // --- Collection input ---
  onAddCollection: (parentId: string | null) => void;
  onSetShowCollectionInput: (show: boolean) => void;
  onSetCollectionInputValue: (value: string) => void;
  onSetNewCollectionParentId: (id: string | null) => void;
  onCollectionInputCommit: () => void | Promise<void>;
  onInlineCollectionRenameChange: (value: string) => void;
  onInlineCollectionRenameCommit: () => void | Promise<void>;
  onInlineCollectionRenameCancel: () => void;
  // --- Folder creation entry (sidebar 「+」; opens the inline edit row) ---
  onAddFolder: () => void;
  /** SMART-007: open sidebar inline smart-collection name row. */
  onAddSmartCollection: () => void;

  // --- Inline folder edit (REQ-FOLDER-007) ---
  inlineFolderEdit: InlineFolderEditState | null;
  onInlineFolderEditChange: (value: string) => void;
  onInlineFolderEditCommit: (
    onCreateSuccess?: (
      folderId: string,
      parentFolderId: string | null,
    ) => void,
  ) => void;
  onInlineFolderEditCancel: () => void;

  // --- Inline smart-collection create (SMART-007) ---
  inlineSmartCollectionEdit: InlineSmartCollectionEditState | null;
  onInlineSmartCollectionEditChange: (value: string) => void;
  onInlineSmartCollectionEditCommit: () => void;
  onInlineSmartCollectionEditCancel: () => void;

  // --- Context menu ---
  onOpenContextMenu: (
    descriptor: ContextMenuDescriptor,
    position: { x: number; y: number },
  ) => void;

  // --- Collection drag/drop ---
  onReorderCollection: (sourceId: string, targetId: string) => void;
  onImportDroppedFiles: (
    files: File[],
    targetFolderId: string | null | undefined,
    targetCollectionId: string | undefined,
    webPayload?: { html: string; uriList: string },
  ) => void;

  // --- Managed-to-linked copy ---
  onCopyManagedToLinked: (
    folder: LinkedFolderSummary,
    assetIds: string[],
  ) => void;
}

// ---------------------------------------------------------------------------
// NavigationSidebar — component
// ---------------------------------------------------------------------------

export function NavigationSidebar(props: NavigationSidebarProps) {
  const t = useT();
  const {
    library,
    assetScope,
    showTrash,
    showTagManagement,
    activePluginSidebarViewId = null,
    pluginSidebarViews = [],
    activeTagId,
    activeCollectionId,
    activeSmartCollectionId,
    showIgnoredItems,
    onToggleShowIgnoredItems,
    allAssetCount,
    rootAssetCount,
    trashedAssetCount,
    folders,
    collections,
    collectionTree,
    smartCollections,
    linkedFolders,
    showCollectionInput,
    collectionInputValue,
    newCollectionParentId,
    inlineCollectionRename,
    draggedCollectionId,
    onSetDraggedCollectionId,
    onChooseAllAssets,
    onEnterTrash,
    onTrashContextMenu,
    onEnterTagManagement,
    onChoosePluginSidebarView,
    onChooseFolder,
    onChooseCollection,
    onChooseSmartCollection,
    onExternalDragOver,
    onExternalDrop,
    getManagedAssetDragIds,
    onResolveManagedAssetDrop,
    onAssetsDroppedOnFolder,
    onFoldersDroppedOnFolder,
    selectedFolderIds,
    onAssetsDroppedOnTrash,
    onFoldersDroppedOnTrash,
    onAssetsDroppedOnCollection,
    onManagedAssetCopyModeChange,
    onImportFolderAsLinked,
    onRelinkFolder,
    onConvertLinkedDialog,
    onAddCollection,
    onSetShowCollectionInput,
    onSetCollectionInputValue,
    onSetNewCollectionParentId,
    onCollectionInputCommit,
    onInlineCollectionRenameChange,
    onInlineCollectionRenameCommit,
    onInlineCollectionRenameCancel,
    onAddFolder,
    onAddSmartCollection,
    inlineFolderEdit,
    onInlineFolderEditChange,
    onInlineFolderEditCommit,
    onInlineFolderEditCancel,
    inlineSmartCollectionEdit,
    onInlineSmartCollectionEditChange,
    onInlineSmartCollectionEditCommit,
    onInlineSmartCollectionEditCancel,
    onOpenContextMenu,
    onReorderCollection,
    onImportDroppedFiles,
    onCopyManagedToLinked,
  } = props;

  const browseNavFlags = {
    assetScope,
    showTrash,
    showTagManagement,
    activePluginSidebarViewId,
    activeTagId,
    activeCollectionId,
    activeSmartCollectionId,
  };

  // REQ-DND-001/002: which row is the current asset-drag hover target.
  // Cleared on leave/drop, and defensively on window dragend/drop so a drop
  // outside any row never leaves a stale highlight.
  const [assetDropTarget, setAssetDropTarget] = useState<string | null>(null);
  const [navTreePrefs, setNavTreePrefs] = useState<NavTreePreferences>(() =>
    loadNavTreePreferences(),
  );
  useEffect(() => {
    if (!assetDropTarget) return;
    const clear = () => setAssetDropTarget(null);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, [assetDropTarget]);

  const persistedCollapsedFolderIds = new Set(navTreePrefs.collapsedFolderIds);
  const collapsedFolderIds = new Set(persistedCollapsedFolderIds);
  // Creating under a collapsed parent must reveal the inline create row. Keep
  // this as derived view state: opening or cancelling an editor must not
  // mutate the user's persisted navigation preference.
  if (inlineFolderEdit?.kind === "create" && inlineFolderEdit.parentFolderId) {
    collapsedFolderIds.delete(inlineFolderEdit.parentFolderId);
  }

  function toggleFolderCollapsed(folderId: string) {
    const nextIds = persistedCollapsedFolderIds.has(folderId)
      ? navTreePrefs.collapsedFolderIds.filter((id) => id !== folderId)
      : [...navTreePrefs.collapsedFolderIds, folderId];
    const next = withCollapsedFolderIds(navTreePrefs, nextIds);
    setNavTreePrefs(next);
    saveNavTreePreferences(next);
  }

  // Serpent-c42eb1: collection subtree collapse, mirroring folder collapse.
  const persistedCollapsedCollectionIds = new Set(
    navTreePrefs.collapsedCollectionIds ?? [],
  );
  // Creating a sub-collection under a collapsed parent must reveal the inline
  // create row; keep this derived so opening/cancelling an editor never
  // mutates the persisted navigation preference.
  const collapsedCollectionIds = new Set(persistedCollapsedCollectionIds);
  if (
    showCollectionInput &&
    newCollectionParentId &&
    collapsedCollectionIds.has(newCollectionParentId)
  ) {
    collapsedCollectionIds.delete(newCollectionParentId);
  }

  function toggleCollectionCollapsed(collectionId: string) {
    const current = navTreePrefs.collapsedCollectionIds ?? [];
    const nextIds = persistedCollapsedCollectionIds.has(collectionId)
      ? current.filter((id) => id !== collectionId)
      : [...current, collectionId];
    const next = withCollapsedCollectionIds(navTreePrefs, nextIds);
    setNavTreePrefs(next);
    saveNavTreePreferences(next);
  }

  function revealCreatedFolderParent(
    _folderId: string,
    parentId: string | null,
  ) {
    if (!parentId) return;
    setNavTreePrefs((current) => {
      if (!current.collapsedFolderIds.includes(parentId)) return current;
      const next = withCollapsedFolderIds(
        current,
        current.collapsedFolderIds.filter((id) => id !== parentId),
      );
      saveNavTreePreferences(next);
      return next;
    });
  }

  function commitInlineFolderEditWithVisibleParent() {
    onInlineFolderEditCommit(revealCreatedFolderParent);
  }

  /**
   * Row wiring shared by the root row and managed folder rows: internal
   * asset drags resolve here; anything else falls through to the existing
   * external-import handlers unchanged.
   */
  function applyManagedAssetDragOver(
    event: React.DragEvent<HTMLElement>,
  ): DragDropMode {
    const mode = resolveDragDropMode({ altKey: event.altKey });
    event.preventDefault();
    event.dataTransfer.dropEffect = resolveManagedDropEffect(mode);
    onManagedAssetCopyModeChange?.(mode === "copy");
    return mode;
  }

  /**
   * Production Electron drags arrive as native `Files`; the E2E/in-window
   * fallback carries the managed-asset MIME type. Both represent an asset
   * drag for target highlighting, while only the latter can be parsed locally.
   */
  function supportsAssetDropTransfer(transfer: DataTransfer): boolean {
    return (
      supportsManagedAssetDrag(transfer) ||
      supportsExternalImportTransfer(transfer)
    );
  }

  function assetFolderDropHandlers(key: string, folderId: string | null) {
    return {
      dropActive: assetDropTarget === key,
      onDragEnter: (event: React.DragEvent<HTMLButtonElement>) => {
        if (supportsManagedFolderDrag(event.dataTransfer)) {
          setAssetDropTarget(key);
          return;
        }
        if (
          supportsManagedAssetDrag(event.dataTransfer) ||
          supportsExternalImportTransfer(event.dataTransfer)
        ) setAssetDropTarget(key);
      },
      onDragLeave: (event: React.DragEvent<HTMLButtonElement>) => {
        // BUG-DND-001: moving onto a row child (icon/label/count) fires
        // dragleave on the row; only a real exit clears the highlight.
        if (event.currentTarget.contains(event.relatedTarget as Node | null))
          return;
        setAssetDropTarget((current) => (current === key ? null : current));
      },
      onDragOver: (event: React.DragEvent<HTMLButtonElement>) => {
        if (supportsManagedFolderDrag(event.dataTransfer)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          return;
        }
        if (supportsManagedAssetDrag(event.dataTransfer)) {
          applyManagedAssetDragOver(event);
          return;
        }
        if (supportsExternalImportTransfer(event.dataTransfer)) {
          setAssetDropTarget(key);
        }
        onExternalDragOver(event);
      },
      onDrop: (event: React.DragEvent<HTMLButtonElement>) => {
        const folderIds = parseManagedFolderDrag(event.dataTransfer);
        setAssetDropTarget(null);
        if (folderIds && folderIds.length > 0) {
          event.preventDefault();
          onFoldersDroppedOnFolder(folderId, folderIds);
          return;
        }
        const ids =
          parseManagedAssetDrag(event.dataTransfer) ??
          (getManagedAssetDragIds
            ? [...(getManagedAssetDragIds() ?? [])]
            : null) ??
          null;
        setAssetDropTarget(null);
        if (ids && ids.length > 0) {
          event.preventDefault();
          onAssetsDroppedOnFolder(
            folderId,
            ids,
            resolveDragDropMode({ altKey: event.altKey }),
          );
          return;
        }
        const files = Array.from(event.dataTransfer.files);
        if (files.length > 0 && onResolveManagedAssetDrop) {
          event.preventDefault();
          event.stopPropagation();
          const payload = externalImportPayload(event.dataTransfer);
          void onResolveManagedAssetDrop(files).then((resolvedIds) => {
            if (resolvedIds.length > 0) {
              onAssetsDroppedOnFolder(
                folderId,
                resolvedIds,
                resolveDragDropMode({ altKey: event.altKey }),
              );
              return;
            }
            void onImportDroppedFiles(
              payload.files,
              folderId,
              undefined,
              payload,
            );
          });
          return;
        }
        onExternalDrop(event, folderId, undefined);
      },
    };
  }

  const directoryEntries = filterCollapsedDirectoryEntries(
    buildUnifiedDirectoryNavEntries(folders, linkedFolders),
    collapsedFolderIds,
  );
  const foldersWithChildren = managedFolderIdsWithChildren(
    buildUnifiedDirectoryNavEntries(folders, linkedFolders),
  );

  function renderDirectoryEntries(): ReactNode {
    if (directoryEntries.length === 0 && inlineFolderEdit?.kind !== "create") {
      return <p className="nav-empty">{t("nav.emptyManagedOrLinked")}</p>;
    }

    const rows: ReactNode[] = directoryEntries.map((entry) => {
      if (entry.kind === "managed") {
        // A rename session swaps the folder's own row for the edit row.
        if (
          inlineFolderEdit?.kind === "rename" &&
          inlineFolderEdit.folderId === entry.folderId
        ) {
          return (
            <InlineFolderEditRow
              depth={entry.depth}
              key={entry.folderId}
              onCancel={onInlineFolderEditCancel}
              onChange={onInlineFolderEditChange}
              onCommit={onInlineFolderEditCommit}
              state={inlineFolderEdit}
            />
          );
        }
        const hasChildren = foldersWithChildren.has(entry.folderId);
        const expanded = !collapsedFolderIds.has(entry.folderId);
        return (
          <NavRow
            active={isManagedFolderNavActive(browseNavFlags, entry.folderId)}
            count={entry.directAssetCount}
            depth={entry.depth}
            disclosure={
              hasChildren ? (
                <button
                  aria-expanded={expanded}
                  aria-label={
                    expanded
                      ? t("nav.collapseFolder", { name: entry.name })
                      : t("nav.expandFolder", { name: entry.name })
                  }
                  className={`nav-disclosure${expanded ? " is-expanded" : ""}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleFolderCollapsed(entry.folderId);
                  }}
                  type="button"
                >
                  <Icon name="chevron-right" size={12} />
                </button>
              ) : undefined
            }
            icon="folder"
            key={entry.folderId}
            label={entry.name}
            navFolderId={entry.folderId}
            navFolderKind="managed"
            onClick={() => void onChooseFolder(entry.folderId)}
            draggable
            onDragStart={(event) => {
              const ids = resolveDraggedFolderIds(
                entry.folderId,
                selectedFolderIds,
              );
              event.dataTransfer.setData(
                MANAGED_FOLDERS_DRAG_TYPE,
                JSON.stringify(ids),
              );
              event.dataTransfer.effectAllowed = "move";
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              onOpenContextMenu(
                {
                  type: "folder",
                  folderId: entry.folderId,
                  name: entry.name,
                  locationKind: "managed",
                },
                { x: event.clientX, y: event.clientY },
              );
            }}
            {...assetFolderDropHandlers(`folder:${entry.folderId}`, entry.folderId)}
          />
        );
      }

      const lf = linkedFolders.find(
        (folder) => folder.folderId === entry.folderId,
      );
      if (!lf) return null;
      // Linked directories are physical folders with virtual ids in the
      // library index.  Keep the same inline rename affordance as managed
      // folders instead of falling back to a dialog or hiding the action.
      if (
        inlineFolderEdit?.kind === "rename" &&
        inlineFolderEdit.folderId === entry.folderId
      ) {
        return (
          <InlineFolderEditRow
            depth={entry.depth}
            key={entry.folderId}
            onCancel={onInlineFolderEditCancel}
            onChange={onInlineFolderEditChange}
            onCommit={onInlineFolderEditCommit}
            state={inlineFolderEdit}
          />
        );
      }
      const offline = entry.status === "offline";
      const linkedAffordance = linkedFolderNavAffordance(entry.status);
      const hasChildren = foldersWithChildren.has(entry.folderId);
      const expanded = !collapsedFolderIds.has(entry.folderId);
      const linkedRootId = entry.linkedFolderId;
      return (
        <NavRow
          active={isManagedFolderNavActive(browseNavFlags, entry.folderId)}
          depth={entry.depth}
          disclosure={
            hasChildren ? (
              <button
                aria-expanded={expanded}
                aria-label={
                  expanded
                    ? t("nav.collapseFolder", { name: entry.name })
                    : t("nav.expandFolder", { name: entry.name })
                }
                className={`nav-disclosure${expanded ? " is-expanded" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleFolderCollapsed(entry.folderId);
                }}
                type="button"
              >
                <Icon name="chevron-right" size={12} />
              </button>
            ) : undefined
          }
          icon={linkedAffordance.icon}
          iconColor={linkedAffordance.iconColor}
          key={entry.folderId}
          label={entry.name}
          navFolderId={entry.folderId}
          navFolderKind="linked"
          count={entry.assetCount}
          title={linkedFolderHoverDetail(
            entry.status,
            lf.absoluteRootPath,
            {
              online: t("nav.linkedFolder"),
              offline: t("nav.linkedFolderOffline"),
              pathLabel: t("nav.linkedFolderPath"),
            },
          )}
          onClick={
            offline
              ? () => void onRelinkFolder(entry.folderId)
              : () => void onChooseFolder(entry.folderId)
          }
          onContextMenu={(event) => {
            event.preventDefault();
            // Shift+right-click keeps the legacy convert-to-managed shortcut;
            // a plain right-click opens the shared folder menu (REQ-MENU-006),
            // which also carries the linked-rules entry.
            if (event.shiftKey && entry.relativePath === "") {
              onConvertLinkedDialog({
                folderId: linkedRootId,
                name: lf.displayName,
                targetFolderId: "",
              });
              return;
            }
            onOpenContextMenu(
              {
                type: "folder",
                folderId: linkedRootId,
                name: entry.name,
                locationKind: "linked",
                status: entry.status,
                linkedRelativePath:
                  entry.relativePath === "" ? undefined : entry.relativePath,
              },
              { x: event.clientX, y: event.clientY },
            );
          }}
          dropActive={assetDropTarget === `linked:${entry.folderId}`}
          onDragEnter={(event) => {
            if (
              supportsManagedAssetDrag(event.dataTransfer) ||
              supportsExternalImportTransfer(event.dataTransfer)
            )
              setAssetDropTarget(`linked:${entry.folderId}`);
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null))
              return;
            setAssetDropTarget((current) =>
              current === `linked:${entry.folderId}` ? null : current,
            );
          }}
          onDragOver={(event) => {
            if (
              event.dataTransfer.types.includes(
                "application/x-serpent-managed-assets",
              )
            ) {
              // 与 managed 文件夹一致：普通拖=移动、Option 拖=复制
              // （Serpent-f6f779，链接文件夹不再强制复制）。
              applyManagedAssetDragOver(event);
              return;
            }
            if (supportsExternalImportTransfer(event.dataTransfer)) {
              event.preventDefault();
              setAssetDropTarget(`linked:${entry.folderId}`);
            }
          }}
          onDrop={(event) => {
            const serialized = event.dataTransfer.getData(
              "application/x-serpent-managed-assets",
            );
            const fallbackIds = getManagedAssetDragIds
              ? [...(getManagedAssetDragIds() ?? [])]
              : null;
            if (serialized || fallbackIds) {
              event.preventDefault();
              setAssetDropTarget(null);
              try {
                const ids = serialized
                  ? (JSON.parse(serialized) as string[])
                  : fallbackIds!;
                const mode = resolveDragDropMode({
                  altKey: event.altKey,
                });
                if (mode === "copy") {
                  // Option 拖：复制语义，managed 源保留原位。
                  // `lf` retains the virtual child relativePath.  Passing the
                  // root summary here silently copied into the linked root and
                  // made child folders appear to accept drops without effect.
                  void onCopyManagedToLinked(lf, ids);
                } else {
                  // 普通拖：与 managed 文件夹一致，走 moveAssets 的链接目标
                  // 分支（复制进链接目录 + 删除 managed 源），Serpent-f6f779。
                  void onAssetsDroppedOnFolder(entry.folderId, ids, "move");
                }
              } catch {
                // drag data invalid — silently ignore
              }
              return;
            }
            const files = Array.from(event.dataTransfer.files);
            if (files.length > 0 && onResolveManagedAssetDrop) {
              event.preventDefault();
              setAssetDropTarget(null);
              const payload = externalImportPayload(event.dataTransfer);
              void onResolveManagedAssetDrop(files).then((ids) => {
                if (ids.length > 0) {
                  void onCopyManagedToLinked(lf, ids);
                  return;
                }
                // A native file that is not indexed yet must be imported
                // directly into the selected linked directory.  Falling
                // through to the resolver alone made Explorer/Finder drops
                // appear to do nothing because no managed asset id existed.
                void onImportDroppedFiles(
                  payload.files,
                  lf.folderId,
                  undefined,
                  payload,
                );
              });
            }
          }}
        />
      );
    });

    // A create session adds a pending name-edit row as the parent's first
    // child (top of the list when creating at the library root). A collapsed
    // parent is expanded only as derived view state while the editor exists;
    // its persisted preference changes only after a successful create.
    if (inlineFolderEdit?.kind === "create") {
      rows.splice(
        inlineCreateRowIndex(directoryEntries, inlineFolderEdit.parentFolderId),
        0,
        <InlineFolderEditRow
          depth={inlineFolderEditDepth(inlineFolderEdit, directoryEntries)}
          key="inline-folder-create"
          onCancel={onInlineFolderEditCancel}
          onChange={onInlineFolderEditChange}
          onCommit={commitInlineFolderEditWithVisibleParent}
          state={inlineFolderEdit}
        />,
      );
    }
    return rows;
  }

  // Recursive collection node renderer
  function renderCollectionNodes(
    parentId: string | null,
    depth: number,
  ): ReactNode {
    const children = collectionTree.get(parentId) ?? [];
    const rows: ReactNode[] = [];
    if (showCollectionInput && newCollectionParentId === parentId) {
      rows.push(
        <InlineCollectionEditRow
          depth={depth}
          key={`inline-collection-create-${parentId ?? "root"}`}
          onCancel={() => {
            onSetShowCollectionInput(false);
            onSetCollectionInputValue("");
            onSetNewCollectionParentId(null);
          }}
          onChange={onSetCollectionInputValue}
          onCommit={onCollectionInputCommit}
          value={collectionInputValue}
        />,
      );
    }
    rows.push(...children.map((c) => (
      <div
        className="collection-drop-target"
        draggable={inlineCollectionRename?.collectionId !== c.collectionId}
        key={c.collectionId}
        onDragEnd={() => onSetDraggedCollectionId(null)}
        onDragEnter={(event) => {
          if (supportsAssetDropTransfer(event.dataTransfer)) {
            setAssetDropTarget(`collection:${c.collectionId}`);
          }
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null))
            return;
          setAssetDropTarget((current) =>
            current === `collection:${c.collectionId}` ? null : current,
          );
        }}
        onDragOver={(event) => {
          if (supportsManagedAssetDrag(event.dataTransfer)) {
            setAssetDropTarget(`collection:${c.collectionId}`);
            applyManagedAssetDragOver(event);
            return;
          }
          if (supportsExternalImportTransfer(event.dataTransfer)) {
            setAssetDropTarget(`collection:${c.collectionId}`);
            onExternalDragOver(event);
            return;
          }
          if (draggedCollectionId) {
            event.preventDefault();
          }
        }}
        onDragStart={(event) => {
          event.stopPropagation();
          onSetDraggedCollectionId(c.collectionId);
          event.dataTransfer.effectAllowed = "move";
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setAssetDropTarget(null);
          const assetIds =
            parseManagedAssetDrag(event.dataTransfer) ??
            (getManagedAssetDragIds
              ? [...(getManagedAssetDragIds() ?? [])]
              : null) ??
            null;
          if (assetIds && assetIds.length > 0) {
            onAssetsDroppedOnCollection(
              c.collectionId,
              assetIds,
              resolveDragDropMode({ altKey: event.altKey }),
            );
            return;
          }
          if (draggedCollectionId) {
            void onReorderCollection(draggedCollectionId, c.collectionId);
          } else if (
            event.dataTransfer.files.length > 0 &&
            onResolveManagedAssetDrop
          ) {
            const files = Array.from(event.dataTransfer.files);
            const payload = externalImportPayload(event.dataTransfer);
            void onResolveManagedAssetDrop(files).then((resolvedIds) => {
              if (resolvedIds.length > 0) {
                onAssetsDroppedOnCollection(
                  c.collectionId,
                  resolvedIds,
                  resolveDragDropMode({ altKey: event.altKey }),
                );
                return;
              }
              void onImportDroppedFiles(
                payload.files,
                undefined,
                c.collectionId,
                payload,
              );
            });
          } else if (supportsExternalImportTransfer(event.dataTransfer)) {
            const payload = externalImportPayload(event.dataTransfer);
            void onImportDroppedFiles(
              payload.files,
              undefined,
              c.collectionId,
              payload,
            );
          }
        }}
      >
        {inlineCollectionRename?.collectionId === c.collectionId ? (
          <InlineCollectionEditRow
            ariaLabel={t("nav.renameCollection")}
            depth={depth}
            onCancel={onInlineCollectionRenameCancel}
            onChange={onInlineCollectionRenameChange}
            onCommit={onInlineCollectionRenameCommit}
            placeholder={c.name}
            value={inlineCollectionRename.value}
          />
        ) : (
          <NavRow
            disclosure={
              (collectionTree.get(c.collectionId) ?? []).length > 0 ? (
                <button
                  aria-expanded={!collapsedCollectionIds.has(c.collectionId)}
                  aria-label={
                    collapsedCollectionIds.has(c.collectionId)
                      ? t("nav.expandCollection", { name: c.name })
                      : t("nav.collapseCollection", { name: c.name })
                  }
                  className={`nav-disclosure${
                    collapsedCollectionIds.has(c.collectionId) ? "" : " is-expanded"
                  }`}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleCollectionCollapsed(c.collectionId);
                  }}
                  type="button"
                >
                  <Icon name="chevron-right" size={12} />
                </button>
              ) : undefined
            }
            icon="collection"
            label={c.name}
            count={c.assetCount}
            active={activeCollectionId === c.collectionId && !activeTagId}
            depth={depth}
            navCollectionId={c.collectionId}
            dropActive={assetDropTarget === `collection:${c.collectionId}`}
            onDragEnter={(event) => {
              if (supportsAssetDropTransfer(event.dataTransfer)) {
                event.stopPropagation();
                setAssetDropTarget(`collection:${c.collectionId}`);
              }
            }}
            onDragLeave={(event) => {
              if (supportsAssetDropTransfer(event.dataTransfer)) {
                event.stopPropagation();
              }
              if (event.currentTarget.contains(event.relatedTarget as Node | null))
                return;
              setAssetDropTarget((current) =>
                current === `collection:${c.collectionId}` ? null : current,
              );
            }}
            onDragOver={(event) => {
              if (supportsManagedAssetDrag(event.dataTransfer)) {
                event.stopPropagation();
                applyManagedAssetDragOver(event);
              } else if (supportsExternalImportTransfer(event.dataTransfer)) {
                event.stopPropagation();
                setAssetDropTarget(`collection:${c.collectionId}`);
                // Native Electron asset drags arrive as Files. The child row
                // owns the event so the parent collection cannot steal the
                // highlight, therefore it must also accept the drop here.
                onExternalDragOver(event);
              }
            }}
            onDrop={(event) => {
              const assetIds = parseManagedAssetDrag(event.dataTransfer);
              if (!assetIds || assetIds.length === 0) return;
              event.preventDefault();
              event.stopPropagation();
              setAssetDropTarget(null);
              onAssetsDroppedOnCollection(
                c.collectionId,
                assetIds,
                resolveDragDropMode({ altKey: event.altKey }),
              );
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              onOpenContextMenu(
                {
                  type: "organization",
                  id: c.collectionId,
                  name: c.name,
                },
                { x: e.clientX, y: e.clientY },
              );
            }}
            onClick={() => void onChooseCollection(c.collectionId)}
          />
        )}
        {!collapsedCollectionIds.has(c.collectionId) &&
          renderCollectionNodes(c.collectionId, depth + 1)}
      </div>
    )));
    return rows;
  }

  return (
    <PaneSurface
      className="navigation-pane"
      data-ui-surface-variant="navigation"
    >
      <nav className="navigation-scroll">
        <NavRow
          active={library ? isAllAssetsNavActive(browseNavFlags) : true}
          count={library ? allAssetCount : undefined}
          disabled={!library}
          icon="grid"
          label={t("scope.allAssets")}
          onClick={() => void onChooseAllAssets()}
          {...(library
            ? assetFolderDropHandlers("root", null)
            : {
                onDragOver: onExternalDragOver,
                onDrop: (event: React.DragEvent<HTMLButtonElement>) =>
                  onExternalDrop(event, null, undefined),
            })}
        />
        <NavRow
          active={Boolean(library && isRootFolderNavActive(browseNavFlags))}
          count={library ? rootAssetCount : undefined}
          disabled={!library}
          icon="folder"
          label={t("scope.rootFolder")}
          onClick={() => void onChooseFolder("root")}
          {...(library
            ? assetFolderDropHandlers("root-assets", null)
            : {
                onDragOver: onExternalDragOver,
                onDrop: (event: React.DragEvent<HTMLButtonElement>) =>
                  onExternalDrop(event, null, undefined),
              })}
        />
        <NavRow
          active={Boolean(library && isTrashNavActive(browseNavFlags))}
          count={trashedAssetCount || undefined}
          disabled={!library}
          icon="trash"
          label={t("scope.trash")}
          onClick={() => void onEnterTrash()}
          onContextMenu={(event) => {
            if (!library) return;
            event.preventDefault();
            onTrashContextMenu?.(event);
          }}
          dropActive={assetDropTarget === "trash"}
          onDragEnter={(event) => {
            if (
              supportsManagedFolderDrag(event.dataTransfer) ||
              supportsManagedAssetDrag(event.dataTransfer) ||
              supportsExternalImportTransfer(event.dataTransfer)
            )
              setAssetDropTarget("trash");
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null))
              return;
            setAssetDropTarget((current) =>
              current === "trash" ? null : current,
            );
          }}
          onDragOver={(event) => {
            if (
              supportsManagedFolderDrag(event.dataTransfer) ||
              supportsManagedAssetDrag(event.dataTransfer)
            ) {
              // Trash is always a move/delete target; Option does not copy.
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              onManagedAssetCopyModeChange?.(false);
            } else if (supportsExternalImportTransfer(event.dataTransfer)) {
              // Native asset drags arrive as Files. Resolve them on drop and
              // keep the trash affordance consistent with the managed path.
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setAssetDropTarget("trash");
              onManagedAssetCopyModeChange?.(false);
            }
          }}
          onDrop={(event) => {
            const folderIds = parseManagedFolderDrag(event.dataTransfer);
            setAssetDropTarget(null);
            if (folderIds && folderIds.length > 0) {
              event.preventDefault();
              onFoldersDroppedOnTrash(folderIds);
              return;
            }
            const ids =
              parseManagedAssetDrag(event.dataTransfer) ??
              (getManagedAssetDragIds
                ? [...(getManagedAssetDragIds() ?? [])]
                : null) ??
              null;
            setAssetDropTarget(null);
            if (ids && ids.length > 0) {
              event.preventDefault();
              onAssetsDroppedOnTrash(ids);
              return;
            }
            const files = Array.from(event.dataTransfer.files);
            if (files.length > 0 && onResolveManagedAssetDrop) {
              event.preventDefault();
              void onResolveManagedAssetDrop(files).then((resolvedIds) => {
                if (resolvedIds.length > 0) onAssetsDroppedOnTrash(resolvedIds);
              });
            }
          }}
        />
        <NavRow
          active={Boolean(library && isTagManagementNavActive(browseNavFlags))}
          disabled={!library}
          icon="tag"
          label={t("nav.tagManagement")}
          onClick={() => onEnterTagManagement()}
        />
        {pluginSidebarViews.map((view) => (
          <NavRow
            active={Boolean(library && isPluginSidebarViewNavActive(browseNavFlags, view.id))}
            disabled={!library}
            icon="box"
            key={view.id}
            label={view.title}
            onClick={() => onChoosePluginSidebarView?.(view.id)}
          />
        ))}
        <Section
          title={t("nav.folders")}
          action={library ? onAddFolder : undefined}
          actionLabel={t("nav.addFolder")}
          toggleAction={library ? onToggleShowIgnoredItems : undefined}
          toggleActive={showIgnoredItems}
          toggleLabel={t("nav.showIgnored")}
          secondaryAction={library ? onImportFolderAsLinked : undefined}
          secondaryLabel={t("nav.importLinkedFolder")}
        >
          {library ? (
            <>
              {renderDirectoryEntries()}
            </>
          ) : (
            <p className="nav-empty">{t("nav.openLibraryFoldersHint")}</p>
          )}
        </Section>
        <Section
          title={t("nav.collections")}
          action={
            library
              ? () => onAddCollection(activeCollectionId)
              : undefined
          }
        >
          {library ? (
            <>
              {collections.length ? (
                renderCollectionNodes(null, 0)
              ) : (
                showCollectionInput && newCollectionParentId === null ? (
                  renderCollectionNodes(null, 0)
                ) : (
                  <p className="nav-empty">{t("nav.emptyCollections")}</p>
                )
              )}
            </>
          ) : (
            <p className="nav-empty">{t("nav.openLibraryHint")}</p>
          )}
        </Section>
        <Section
          action={library ? onAddSmartCollection : undefined}
          actionLabel={t("nav.addSmartCollection")}
          title={t("nav.smartCollections")}
        >
          {library ? (
            <>
              {inlineSmartCollectionEdit ? (
                <InlineSmartCollectionEditRow
                  key="inline-smart-collection-create"
                  onCancel={onInlineSmartCollectionEditCancel}
                  onChange={onInlineSmartCollectionEditChange}
                  onCommit={onInlineSmartCollectionEditCommit}
                  state={inlineSmartCollectionEdit}
                />
              ) : null}
              {smartCollections.length ? (
                smartCollections.map((sc) => (
                  <NavRow
                    active={activeSmartCollectionId === sc.collectionId}
                    count={sc.assetCount}
                    icon="smart"
                    key={sc.collectionId}
                    label={sc.name}
                    onClick={() => void onChooseSmartCollection(sc.collectionId)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      onOpenContextMenu(
                        {
                          type: "smart-collection",
                          id: sc.collectionId,
                          name: sc.name,
                        },
                        { x: event.clientX, y: event.clientY },
                      );
                    }}
                  />
                ))
              ) : inlineSmartCollectionEdit ? null : (
                <p className="nav-empty">{t("nav.emptySmartCollections")}</p>
              )}
            </>
          ) : (
            <p className="nav-empty">{t("nav.openLibrarySmartHint")}</p>
          )}
        </Section>
      </nav>
    </PaneSurface>
  );
}
