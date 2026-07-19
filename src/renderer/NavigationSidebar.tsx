import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icons";
import { IconActionButton } from "./icon-action-button";
import { linkedFolderNavAffordance } from "./availability-affordance";
import { useT } from "./i18n";
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
  externalImportPayload,
  supportsExternalImportTransfer,
} from "./external-import-transfer";
import {
  inlineCreateRowIndex,
  inlineFolderEditDepth,
  type InlineFolderEditState,
} from "./inline-folder-edit";
import {
  buildUnifiedDirectoryNavEntries,
  filterCollapsedDirectoryEntries,
  managedFolderIdsWithChildren,
} from "./unified-directory-nav";
import {
  isAllAssetsNavActive,
  isManagedFolderNavActive,
  isTrashNavActive,
} from "./browse-nav-active";
import {
  loadNavTreePreferences,
  saveNavTreePreferences,
  withCollapsedFolderIds,
  type NavTreePreferences,
} from "./nav-tree-preferences";

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
  iconColor,
  title,
  disclosure,
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
  iconColor?: string;
  title?: string;
  /** CU-D2: optional disclosure control rendered beside the row. */
  disclosure?: ReactNode;
}) {
  // CU-D9: always expose the full label on hover; when a status title is also
  // provided (e.g. offline linked folder), append it after the name.
  const hoverTitle =
    title && title !== label ? `${label} — ${title}` : label;

  return (
    <div className="nav-tree-row">
      {disclosure ?? <span className="nav-disclosure-spacer" aria-hidden="true" />}
      <button
        className={`nav-row${active ? " is-active" : ""}${dropActive ? " is-drop-target" : ""}`}
        disabled={disabled}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        style={{ paddingLeft: 7 + depth * 14 }}
        title={hoverTitle}
        type="button"
      >
        <Icon name={icon} size={15} color={iconColor} />
        <span className="nav-row-label">{label}</span>
        {count !== undefined && <span className="nav-count">{count}</span>}
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

  // Focus with the whole name preselected: typing replaces the current
  // (rename) or default (create) name immediately, Enter accepts it as-is.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  return (
    <div className="nav-inline-edit" style={{ paddingLeft: 7 + depth * 14 }}>
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
        onBlur={() => onCommit()}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onCommit();
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
  );
}

// ---------------------------------------------------------------------------
// Section — local presentational wrapper
// ---------------------------------------------------------------------------

function Section({
  title,
  action,
  actionLabel,
  secondaryAction,
  secondaryLabel,
  children,
}: {
  title: string;
  action?: () => void;
  /** Explicit primary tooltip; defaults to nav.addSection. */
  actionLabel?: string;
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
        {(action || secondaryAction) && (
          <span className="nav-section-actions">
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
  activeTagId: string | null;
  activeCollectionId: string | null;
  activeSmartCollectionId: string | null;

  // --- Data ---
  allAssetCount: number;
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
  collectionRecursive: boolean;
  collectionRecursiveRef: React.MutableRefObject<boolean>;

  // --- Collection drag state ---
  draggedCollectionId: string | null;
  onSetDraggedCollectionId: (id: string | null) => void;

  // --- Navigation callbacks ---
  onChooseAllAssets: () => void;
  onEnterTrash: () => void;
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

  // --- Internal asset drag/drop (REQ-DND-001/002 + Serpent-aa3 copy mode) ---
  onAssetsDroppedOnFolder: (
    folderId: string | null,
    assetIds: string[],
    mode: DragDropMode,
  ) => void;
  onAssetsDroppedOnTrash: (assetIds: string[]) => void;
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
  onCollectionInputKeyDown: (
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => void;
  onSetCollectionRecursive: (recursive: boolean) => void;

  // --- Folder creation entry (sidebar 「+」; opens the inline edit row) ---
  onAddFolder: () => void;
  /** REQ-SMART-001: focus discovery-bar smart-collection name field. */
  onAddSmartCollection: () => void;

  // --- Inline folder edit (REQ-FOLDER-007) ---
  inlineFolderEdit: InlineFolderEditState | null;
  onInlineFolderEditChange: (value: string) => void;
  onInlineFolderEditCommit: (
    onCreateSuccess?: (parentFolderId: string | null) => void,
  ) => void;
  onInlineFolderEditCancel: () => void;

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
    activeTagId,
    activeCollectionId,
    activeSmartCollectionId,
    allAssetCount,
    trashedAssetCount,
    folders,
    collections,
    collectionTree,
    smartCollections,
    linkedFolders,
    showCollectionInput,
    collectionInputValue,
    newCollectionParentId,
    collectionRecursive,
    collectionRecursiveRef,
    draggedCollectionId,
    onSetDraggedCollectionId,
    onChooseAllAssets,
    onEnterTrash,
    onChooseFolder,
    onChooseCollection,
    onChooseSmartCollection,
    onExternalDragOver,
    onExternalDrop,
    onAssetsDroppedOnFolder,
    onAssetsDroppedOnTrash,
    onAssetsDroppedOnCollection,
    onManagedAssetCopyModeChange,
    onImportFolderAsLinked,
    onRelinkFolder,
    onConvertLinkedDialog,
    onAddCollection,
    onSetShowCollectionInput,
    onSetCollectionInputValue,
    onSetNewCollectionParentId,
    onCollectionInputKeyDown,
    onSetCollectionRecursive,
    onAddFolder,
    onAddSmartCollection,
    inlineFolderEdit,
    onInlineFolderEditChange,
    onInlineFolderEditCommit,
    onInlineFolderEditCancel,
    onOpenContextMenu,
    onReorderCollection,
    onImportDroppedFiles,
    onCopyManagedToLinked,
  } = props;

  const browseNavFlags = {
    assetScope,
    showTrash,
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

  function revealCreatedFolderParent(parentId: string | null) {
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

  function assetFolderDropHandlers(key: string, folderId: string | null) {
    return {
      dropActive: assetDropTarget === key,
      onDragEnter: (event: React.DragEvent<HTMLButtonElement>) => {
        if (supportsManagedAssetDrag(event.dataTransfer)) setAssetDropTarget(key);
      },
      onDragLeave: (event: React.DragEvent<HTMLButtonElement>) => {
        // BUG-DND-001: moving onto a row child (icon/label/count) fires
        // dragleave on the row; only a real exit clears the highlight.
        if (event.currentTarget.contains(event.relatedTarget as Node | null))
          return;
        setAssetDropTarget((current) => (current === key ? null : current));
      },
      onDragOver: (event: React.DragEvent<HTMLButtonElement>) => {
        if (supportsManagedAssetDrag(event.dataTransfer)) {
          applyManagedAssetDragOver(event);
          return;
        }
        onExternalDragOver(event);
      },
      onDrop: (event: React.DragEvent<HTMLButtonElement>) => {
        const ids = parseManagedAssetDrag(event.dataTransfer);
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
            onClick={() => void onChooseFolder(entry.folderId)}
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
      const offline = entry.status === "offline";
      const linkedAffordance = linkedFolderNavAffordance(entry.status);
      return (
        <NavRow
          active={isManagedFolderNavActive(browseNavFlags, entry.folderId)}
          depth={entry.depth}
          icon={linkedAffordance.icon}
          iconColor={linkedAffordance.iconColor}
          key={entry.folderId}
          label={entry.name}
          count={entry.assetCount}
          title={
            offline
              ? t("nav.linkedFolderOffline")
              : t("nav.linkedFolder")
          }
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
            if (event.shiftKey) {
              onConvertLinkedDialog({
                folderId: lf.folderId,
                name: lf.displayName,
                targetFolderId: "",
              });
              return;
            }
            onOpenContextMenu(
              {
                type: "folder",
                folderId: entry.folderId,
                name: entry.name,
                locationKind: "linked",
                status: entry.status,
              },
              { x: event.clientX, y: event.clientY },
            );
          }}
          dropActive={assetDropTarget === `linked:${entry.folderId}`}
          onDragEnter={(event) => {
            if (supportsManagedAssetDrag(event.dataTransfer))
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
              // Linked-folder drops always copy files out; Option is a no-op
              // for effect (still report copy so the cursor matches).
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              onManagedAssetCopyModeChange?.(true);
            }
          }}
          onDrop={(event) => {
            const serialized = event.dataTransfer.getData(
              "application/x-serpent-managed-assets",
            );
            if (!serialized) return;
            event.preventDefault();
            setAssetDropTarget(null);
            try {
              const ids = JSON.parse(serialized) as string[];
              void onCopyManagedToLinked(lf, ids);
            } catch {
              // drag data invalid — silently ignore
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
    return children.map((c) => (
      <div
        className="collection-drop-target"
        draggable
        key={c.collectionId}
        onDragEnd={() => onSetDraggedCollectionId(null)}
        onDragOver={(event) => {
          if (supportsManagedAssetDrag(event.dataTransfer)) {
            applyManagedAssetDragOver(event);
            return;
          }
          if (
            draggedCollectionId ||
            supportsExternalImportTransfer(event.dataTransfer)
          )
            event.preventDefault();
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
          const assetIds = parseManagedAssetDrag(event.dataTransfer);
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
        <NavRow
          icon="collection"
          label={c.name}
          count={c.assetCount}
          active={activeCollectionId === c.collectionId && !activeTagId}
          depth={depth}
          dropActive={assetDropTarget === `collection:${c.collectionId}`}
          onDragEnter={(event) => {
            if (supportsManagedAssetDrag(event.dataTransfer)) {
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
              applyManagedAssetDragOver(event);
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
        {renderCollectionNodes(c.collectionId, depth + 1)}
      </div>
    ));
  }

  return (
    <aside className="navigation-pane">
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
          active={Boolean(library && isTrashNavActive(browseNavFlags))}
          count={trashedAssetCount || undefined}
          disabled={!library}
          icon="trash"
          label={t("scope.trash")}
          onClick={() => void onEnterTrash()}
          dropActive={assetDropTarget === "trash"}
          onDragEnter={(event) => {
            if (supportsManagedAssetDrag(event.dataTransfer))
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
            if (supportsManagedAssetDrag(event.dataTransfer)) {
              // Trash is always a move/delete target; Option does not copy.
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              onManagedAssetCopyModeChange?.(false);
            }
          }}
          onDrop={(event) => {
            const ids = parseManagedAssetDrag(event.dataTransfer);
            setAssetDropTarget(null);
            if (!ids || ids.length === 0) return;
            event.preventDefault();
            onAssetsDroppedOnTrash(ids);
          }}
        />
        <NavRow icon="archive" label={t("shell.recentLibraries")} disabled />
        <Section
          title={t("nav.folders")}
          action={library ? onAddFolder : undefined}
          actionLabel={t("nav.addFolder")}
          secondaryAction={library ? onImportFolderAsLinked : undefined}
          secondaryLabel={t("nav.importLinkedFolder")}
        >
          {library ? (
            <>
              {renderDirectoryEntries()}
              {linkedFolders.length > 0 && (
                <p className="nav-empty">
                  {t("nav.linkedFolderHint")}
                </p>
              )}
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
              {showCollectionInput && (
                <div className="nav-section">
                  <input
                    autoFocus
                    className="text-field"
                    maxLength={255}
                    onBlur={() => {
                      onSetShowCollectionInput(false);
                      onSetCollectionInputValue("");
                      onSetNewCollectionParentId(null);
                    }}
                    onChange={(e) => onSetCollectionInputValue(e.target.value)}
                    onKeyDown={onCollectionInputKeyDown}
                    placeholder={
                      newCollectionParentId
                        ? t("nav.subcollectionNamePlaceholder")
                        : t("nav.collectionNamePlaceholder")
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
                        onSetCollectionRecursive(recursive);
                        if (activeCollectionId)
                          void onChooseCollection(activeCollectionId, recursive);
                      }}
                      type="checkbox"
                    />
                    {t("nav.includeChildCollections")}
                  </label>
                </div>
              )}
              {collections.length ? (
                renderCollectionNodes(null, 0)
              ) : (
                <p className="nav-empty">{t("nav.emptyCollections")}</p>
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
            smartCollections.length ? (
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
            ) : (
              <p className="nav-empty">{t("nav.emptySmartCollections")}</p>
            )
          ) : (
            <p className="nav-empty">{t("nav.openLibrarySmartHint")}</p>
          )}
        </Section>
      </nav>
    </aside>
  );
}
