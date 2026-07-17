import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icons";
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
  supportsManagedAssetDrag,
} from "./asset-drag-drop";
import {
  inlineCreateRowIndex,
  inlineFolderEditDepth,
  type InlineFolderEditState,
} from "./inline-folder-edit";
import { buildUnifiedDirectoryNavEntries } from "./unified-directory-nav";

// ---------------------------------------------------------------------------
// Small local helpers duplicated from App.tsx to avoid circular imports
// ---------------------------------------------------------------------------

function supportsExternalImportTransfer(transfer: DataTransfer): boolean {
  const types = Array.from(transfer.types);
  return (
    types.includes("Files") ||
    types.includes("text/html") ||
    types.includes("text/uri-list")
  );
}

function externalImportPayload(transfer: DataTransfer): {
  files: File[];
  html: string;
  uriList: string;
} {
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
}) {
  return (
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
      title={title}
      type="button"
    >
      <Icon name={icon} size={15} color={iconColor} />
      <span>{label}</span>
      {count !== undefined && <span className="nav-count">{count}</span>}
    </button>
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
  secondaryAction,
  secondaryLabel,
  children,
}: {
  title: string;
  action?: () => void;
  secondaryAction?: () => void;
  secondaryLabel?: string;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <section className="nav-section">
      <div className="nav-section-heading">
        <span>{title}</span>
        {(action || secondaryAction) && (
          <span className="nav-section-actions">
            {action && (
              <button
                aria-label={t("nav.addSection", { title })}
                className="tiny-action"
                onClick={action}
                type="button"
              >
                <Icon name="plus" size={13} />
              </button>
            )}
            {secondaryAction && (
              <button
                aria-label={
                  secondaryLabel ?? t("nav.secondaryAction", { title })
                }
                className="tiny-action"
                onClick={secondaryAction}
                type="button"
              >
                <Icon name="link" size={13} />
              </button>
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
  onChooseRootFolder: () => void;
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

  // --- Internal asset drag/drop (REQ-DND-001/002) ---
  onAssetsDroppedOnFolder: (folderId: string | null, assetIds: string[]) => void;
  onAssetsDroppedOnTrash: (assetIds: string[]) => void;

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

  // --- Inline folder edit (REQ-FOLDER-007) ---
  inlineFolderEdit: InlineFolderEditState | null;
  onInlineFolderEditChange: (value: string) => void;
  onInlineFolderEditCommit: () => void;
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
    onChooseRootFolder,
    onChooseFolder,
    onChooseCollection,
    onChooseSmartCollection,
    onExternalDragOver,
    onExternalDrop,
    onAssetsDroppedOnFolder,
    onAssetsDroppedOnTrash,
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
    inlineFolderEdit,
    onInlineFolderEditChange,
    onInlineFolderEditCommit,
    onInlineFolderEditCancel,
    onOpenContextMenu,
    onReorderCollection,
    onImportDroppedFiles,
    onCopyManagedToLinked,
  } = props;


  // REQ-DND-001/002: which row is the current asset-drag hover target.
  // Cleared on leave/drop, and defensively on window dragend/drop so a drop
  // outside any row never leaves a stale highlight.
  const [assetDropTarget, setAssetDropTarget] = useState<string | null>(null);
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

  /**
   * Row wiring shared by the root row and managed folder rows: internal
   * asset drags resolve here; anything else falls through to the existing
   * external-import handlers unchanged.
   */
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
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          return;
        }
        onExternalDragOver(event);
      },
      onDrop: (event: React.DragEvent<HTMLButtonElement>) => {
        const ids = parseManagedAssetDrag(event.dataTransfer);
        setAssetDropTarget(null);
        if (ids && ids.length > 0) {
          event.preventDefault();
          onAssetsDroppedOnFolder(folderId, ids);
          return;
        }
        onExternalDrop(event, folderId, undefined);
      },
    };
  }

  const directoryEntries = buildUnifiedDirectoryNavEntries(
    folders,
    linkedFolders,
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
        return (
          <NavRow
            active={
              assetScope === entry.folderId &&
              !activeTagId &&
              !activeCollectionId
            }
            depth={entry.depth}
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
      return (
        <NavRow
          active={
            assetScope === entry.folderId &&
            !activeTagId &&
            !activeCollectionId
          }
          depth={entry.depth}
          icon={offline ? "link-off" : "link"}
          iconColor={offline ? "#d96a6a" : "var(--accent)"}
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
            )
              event.preventDefault();
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
    // child (top of the list when creating at the library root). The tree has
    // no collapse state, so the row is always visible where it will land.
    if (inlineFolderEdit?.kind === "create") {
      rows.splice(
        inlineCreateRowIndex(directoryEntries, inlineFolderEdit.parentFolderId),
        0,
        <InlineFolderEditRow
          depth={inlineFolderEditDepth(inlineFolderEdit, directoryEntries)}
          key="inline-folder-create"
          onCancel={onInlineFolderEditCancel}
          onChange={onInlineFolderEditChange}
          onCommit={onInlineFolderEditCommit}
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
          label={t("scope.allAssets")}
          onClick={() => void onChooseAllAssets()}
          disabled={!library}
          onDragOver={onExternalDragOver}
          onDrop={(event) => onExternalDrop(event, null, undefined)}
        />
        <NavRow
          active={Boolean(
            library && showTrash && !activeTagId && !activeCollectionId,
          )}
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
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
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
          secondaryAction={library ? onImportFolderAsLinked : undefined}
          secondaryLabel={t("nav.importLinkedFolder")}
        >
          {library ? (
            <>
              <NavRow
                active={
                  assetScope === "root" && !activeTagId && !activeCollectionId
                }
                icon="folder"
                label={t("scope.rootFolder")}
                onClick={() => void onChooseRootFolder()}
                {...assetFolderDropHandlers("root", null)}
              />
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
        <Section title={t("nav.smartCollections")}>
          {library ? (
            smartCollections.length ? (
              smartCollections.map((sc) => (
                <NavRow
                  active={activeSmartCollectionId === sc.collectionId}
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
