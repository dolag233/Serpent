import { type ReactNode } from "react";
import { Icon, type IconName } from "./Icons";
import type {
  CollectionSummary,
  LinkedFolderSummary,
  ManagedFolderSummary,
  SmartCollectionSummary,
  TagSummary,
} from "../shared/asset-types";
import type { ContextMenuDescriptor } from "./context-menu";
import type { RendererLibrarySummary } from "../shared/protocol/responses";

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
  depth = 0,
  disabled,
  iconColor,
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
  iconColor?: string;
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
      <Icon name={icon} size={15} color={iconColor} />
      <span>{label}</span>
      {count !== undefined && <span className="nav-count">{count}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Section — local presentational wrapper
// ---------------------------------------------------------------------------

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
  tags: TagSummary[];
  collections: CollectionSummary[];
  collectionTree: Map<string | null, CollectionSummary[]>;
  smartCollections: SmartCollectionSummary[];
  linkedFolders: LinkedFolderSummary[];

  // --- Inline input state ---
  showTagInput: boolean;
  tagInputValue: string;
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
  onChooseTag: (tagId: string) => void;
  onChooseCollection: (collectionId: string, recursive?: boolean) => void;
  onChooseSmartCollection: (collectionId: string) => void;

  // --- External drag/drop ---
  onExternalDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onExternalDrop: (
    event: React.DragEvent<HTMLElement>,
    targetFolderId: string | null | undefined,
    targetCollectionId: string | undefined,
  ) => void;

  // --- Linked folder actions ---
  onImportFolderAsLinked: () => void;
  onRelinkFolder: (folderId: string) => void;
  onOpenLinkedRules: (folder: LinkedFolderSummary) => void;
  onConvertLinkedDialog: (dialog: {
    folderId: string;
    name: string;
    targetFolderId: string;
  }) => void;

  // --- Tag input ---
  onAddTag: () => void;
  onSetShowTagInput: (show: boolean) => void;
  onSetTagInputValue: (value: string) => void;
  onTagInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;

  // --- Collection input ---
  onAddCollection: (parentId: string | null) => void;
  onSetShowCollectionInput: (show: boolean) => void;
  onSetCollectionInputValue: (value: string) => void;
  onSetNewCollectionParentId: (id: string | null) => void;
  onCollectionInputKeyDown: (
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => void;
  onSetCollectionRecursive: (recursive: boolean) => void;

  // --- Folder dialog ---
  onAddFolder: () => void;

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
    tags,
    collections,
    collectionTree,
    smartCollections,
    linkedFolders,
    showTagInput,
    tagInputValue,
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
    onChooseTag,
    onChooseCollection,
    onChooseSmartCollection,
    onExternalDragOver,
    onExternalDrop,
    onImportFolderAsLinked,
    onRelinkFolder,
    onOpenLinkedRules,
    onConvertLinkedDialog,
    onAddTag,
    onSetShowTagInput,
    onSetTagInputValue,
    onTagInputKeyDown,
    onAddCollection,
    onSetShowCollectionInput,
    onSetCollectionInputValue,
    onSetNewCollectionParentId,
    onCollectionInputKeyDown,
    onSetCollectionRecursive,
    onAddFolder,
    onOpenContextMenu,
    onReorderCollection,
    onImportDroppedFiles,
    onCopyManagedToLinked,
  } = props;

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
                orgKind: "collection",
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
      <div className="pane-header">
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
          label="回收站"
          onClick={() => void onEnterTrash()}
        />
        <NavRow icon="archive" label="最近使用" disabled />
        <Section
          title="文件夹"
          action={library ? onAddFolder : undefined}
        >
          {library ? (
            <>
              <NavRow
                active={
                  assetScope === "root" && !activeTagId && !activeCollectionId
                }
                icon="folder"
                label="资源库根目录"
                onClick={() => void onChooseRootFolder()}
                onDragOver={onExternalDragOver}
                onDrop={(event) => onExternalDrop(event, null, undefined)}
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
                  onClick={() => void onChooseFolder(folder.folderId)}
                  onDragOver={onExternalDragOver}
                  onDrop={(event) =>
                    onExternalDrop(event, folder.folderId, undefined)
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
              ? onAddTag
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
                      onSetShowTagInput(false);
                      onSetTagInputValue("");
                    }}
                    onChange={(e) => onSetTagInputValue(e.target.value)}
                    onKeyDown={onTagInputKeyDown}
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
                      onOpenContextMenu(
                        {
                          type: "organization",
                          orgKind: "tag",
                          id: tag.tagId,
                          name: tag.name,
                        },
                        { x: e.clientX, y: e.clientY },
                      );
                    }}
                    onClick={() => void onChooseTag(tag.tagId)}
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
                        onSetCollectionRecursive(recursive);
                        if (activeCollectionId)
                          void onChooseCollection(activeCollectionId, recursive);
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
              <p className="nav-empty">尚无智能合集</p>
            )
          ) : (
            <p className="nav-empty">打开资源库后显示智能合集</p>
          )}
        </Section>
        <Section
          title="链接文件夹"
          action={library ? onImportFolderAsLinked : undefined}
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
                  icon={lf.status === "offline" ? "link-off" : "link"}
                  iconColor={
                    lf.status === "offline" ? "#d96a6a" : "var(--accent)"
                  }
                  key={lf.folderId}
                  label={lf.displayName}
                  count={lf.assetCount}
                  onClick={
                    lf.status === "offline"
                      ? () => void onRelinkFolder(lf.folderId)
                      : () => void onChooseFolder(lf.folderId)
                  }
                  onContextMenu={(event) => {
                    event.preventDefault();
                    if (event.shiftKey)
                      onConvertLinkedDialog({
                        folderId: lf.folderId,
                        name: lf.displayName,
                        targetFolderId: "",
                      });
                    else void onOpenLinkedRules(lf);
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
                      void onCopyManagedToLinked(lf, ids);
                    } catch {
                      // drag data invalid — silently ignore
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
      </div>
    </aside>
  );
}
