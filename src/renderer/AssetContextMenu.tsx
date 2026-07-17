import { Fragment, useState } from "react";
import type {
  TagSummary,
  CollectionSummary,
  LinkedFolderSummary,
  AssetSummary,
} from "../shared/asset-types";
import {
  ContextMenu,
  ContextMenuBackdrop,
  ContextMenuItem,
  ContextMenuSection,
  useContextMenu,
  type ContextMenuDescriptor,
} from "./context-menu";
import { Icon } from "./Icons";
import { TagPickerEntry, TagPickerMenu } from "./TagPickerMenu";
import { isMacPlatform } from "./commands/command-types";
import { createCommandRegistry } from "./commands/command-registry";
import {
  assetCommandDefinitions,
  type AssetCommandContext,
} from "./commands/asset-commands";
import {
  assetMultiCommandDefinitions,
  type AssetMultiCommandContext,
} from "./commands/asset-multi-commands";
import {
  sidebarCommandDefinitions,
  type SidebarCommandContext,
} from "./commands/sidebar-commands";

const isMac = isMacPlatform(navigator.userAgent);

// 0015-B: 单资产右键菜单的静态项由统一命令注册表驱动（REQ-COMMAND-001）；
// 注册表是纯数据，模块级构建一次即可。0015-C: 多资产分支同样接入。
// 0015-D: 文件夹 / 合集 / 智能合集三个侧边栏分支同样接入。
const assetCommandRegistry = createCommandRegistry(assetCommandDefinitions);
const assetMultiCommandRegistry = createCommandRegistry(
  assetMultiCommandDefinitions,
);
const sidebarCommandRegistry = createCommandRegistry(sidebarCommandDefinitions);

/** Which tag action the in-menu picker is performing, and on which assets. */
interface TagPickerState {
  mode: "assign" | "remove";
  assetIds: string[];
  /** Single-asset assign routes to onAssignTag; everything else is batch. */
  single: boolean;
}

/** Stable identity of the open menu, used to reset picker state on change. */
function descriptorKey(descriptor: ContextMenuDescriptor): string {
  switch (descriptor.type) {
    case "asset":
      return `asset:${descriptor.assetId}`;
    case "multi-asset":
      return `multi-asset:${descriptor.assetIds.join(",")}`;
    case "organization":
      return `organization:${descriptor.id}`;
    case "smart-collection":
      return `smart-collection:${descriptor.id}`;
    case "folder":
      return `folder:${descriptor.folderId}`;
  }
}

interface AssetContextMenuProps {
  tags: TagSummary[];
  collections: CollectionSummary[];
  linkedFolders: LinkedFolderSummary[];
  activeCollectionId: string | null;
  assets: AssetSummary[];
  onRenameSmartCollection: (id: string, name: string) => void;
  onUpdateSmartCollection: (id: string) => void;
  onDeleteSmartCollection: (id: string, name: string) => void;
  onRenameOrganization: (id: string, name: string) => void;
  onEditCollectionDetails: (collectionId: string) => void;
  onDeleteOrganization: (id: string, name: string) => void;
  onCreateSubfolder: (folderId: string) => void;
  onRenameFolder: (folderId: string, currentName: string) => void;
  onOpenFolderInFileManager: (folderId: string) => void;
  onCopyFolderPath: (folderId: string) => void;
  onOpenLinkedRules: (folder: LinkedFolderSummary) => void;
  onBatchAssignTag: (tagId: string, assetIds: string[]) => void;
  onBatchRemoveTag: (tagId: string, assetIds: string[]) => void;
  onBatchAddToCollection: (collectionId: string, assetIds: string[]) => void;
  onBatchRemoveFromCollection: (collectionId: string, assetIds: string[]) => void;
  onMoveToFolder: (assetIds: string[]) => void;
  onTrash: (assetIds: string[]) => void;
  onRestore: (assetIds: string[]) => void;
  onPermanentDelete: (assetIds: string[]) => void;
  onRelink: (assetId: string) => void;
  onDeleteLinked: (assetId: string, displayName: string, canDeleteSourceFile: boolean) => void;
  onAnalyze: (assetId: string) => void;
  canAnalyze: boolean;
  onCopyToLinked: (folder: LinkedFolderSummary, assetIds: string[]) => void;
  onClearSelection: () => void;
  onOpenExternal: (assetId: string) => void;
  onRevealInFolder: (assetId: string) => void;
  onCopyFilePath: (assetId: string) => void;
  onRenameAssetFile: (assetId: string) => void;
  onRemoveFromCurrentCollection: (assetId: string) => void;
  onRemoveFromCollection: (assetId: string, collectionId: string) => void;
  onAssignTag: (assetId: string, tagId: string) => void;
  onAddToCollection: (assetId: string, collectionId: string) => void;
}

export function AssetContextMenu(props: AssetContextMenuProps) {
  const {
    tags,
    collections,
    linkedFolders,
    activeCollectionId,
    assets,
    onRenameSmartCollection,
    onUpdateSmartCollection,
    onDeleteSmartCollection,
    onRenameOrganization,
    onEditCollectionDetails,
    onDeleteOrganization,
    onCreateSubfolder,
    onRenameFolder,
    onOpenFolderInFileManager,
    onCopyFolderPath,
    onOpenLinkedRules,
    onBatchAssignTag,
    onBatchRemoveTag,
    onBatchAddToCollection,
    onBatchRemoveFromCollection,
    onMoveToFolder,
    onTrash,
    onRestore,
    onPermanentDelete,
    onRelink,
    onDeleteLinked,
    onAnalyze,
    canAnalyze,
    onCopyToLinked,
    onClearSelection,
    onOpenExternal,
    onRevealInFolder,
    onCopyFilePath,
    onRenameAssetFile,
    onRemoveFromCurrentCollection,
    onRemoveFromCollection,
    onAssignTag,
    onAddToCollection,
  } = props;

  const { active: activeContextMenu } = useContextMenu();
  const [tagPicker, setTagPicker] = useState<TagPickerState | null>(null);

  // The picker swaps the menu body in place; never let it leak into the next
  // menu. Adjust during render (React-sanctioned derived-state pattern):
  // whenever the open menu changes descriptor or closes, drop the picker.
  const activeDescriptorKey = activeContextMenu
    ? descriptorKey(activeContextMenu.descriptor)
    : null;
  const [pickerMenuKey, setPickerMenuKey] = useState(activeDescriptorKey);
  if (pickerMenuKey !== activeDescriptorKey) {
    setPickerMenuKey(activeDescriptorKey);
    setTagPicker(null);
  }

  if (!activeContextMenu) return null;

  const ariaLabel =
    activeContextMenu.descriptor.type === "multi-asset"
      ? `批量资产操作：${activeContextMenu.descriptor.assetIds.length} 项`
      : activeContextMenu.descriptor.type === "asset"
        ? `资产操作：${activeContextMenu.descriptor.displayName}`
        : activeContextMenu.descriptor.type === "organization"
          ? `合集操作：${activeContextMenu.descriptor.name}`
          : activeContextMenu.descriptor.type === "folder"
            ? `文件夹操作：${activeContextMenu.descriptor.name}`
            : `智能合集操作：${activeContextMenu.descriptor.name}`;

  return (
    <ContextMenuBackdrop>
      <ContextMenu
        ariaLabel={
          tagPicker
            ? tagPicker.mode === "assign"
              ? "添加标签"
              : "移除标签"
            : ariaLabel
        }
        position={activeContextMenu.position}
      >
        {tagPicker ? (
          <TagPickerMenu
            mode={tagPicker.mode}
            onBack={() => {
              const entryLabel =
                tagPicker.mode === "assign" ? "添加标签…" : "移除标签…";
              setTagPicker(null);
              // The menu's initial-focus effect does not re-run when the body
              // swaps back; return keyboard focus to the entry that opened
              // the picker so arrow-key navigation keeps working.
              requestAnimationFrame(() => {
                document
                  .querySelector<HTMLElement>(
                    `.context-menu [role="menuitem"][aria-label="${entryLabel}"]`,
                  )
                  ?.focus();
              });
            }}
            onPick={(tagId) => {
              if (tagPicker.mode === "assign") {
                const [singleAssetId] = tagPicker.assetIds;
                if (tagPicker.single && singleAssetId) {
                  onAssignTag(singleAssetId, tagId);
                } else {
                  onBatchAssignTag(tagId, tagPicker.assetIds);
                }
              } else {
                onBatchRemoveTag(tagId, tagPicker.assetIds);
              }
            }}
            tags={tags}
          />
        ) : (
          <>
        {activeContextMenu.descriptor.type === "smart-collection" && (() => {
          const desc = activeContextMenu.descriptor;
          if (desc.type !== "smart-collection") return null;
          // 0015-D: 静态项的标题/可见性由注册表 resolveMenu 求值；删除确认
          // （window.confirm）保留在命令的 run 内，danger 样式仍在 JSX 声明。
          const commandContext: SidebarCommandContext = {
            surface: "sidebar",
            platform: isMac ? "mac" : "windows",
            selectedAssetIds: [],
            primaryAssetId: null,
            assetScope: "none",
            trashMode: false,
            menuKind: "smart-collection",
            subjectId: desc.id,
            subjectName: desc.name,
            linkedFolderResolved: false,
            actions: {
              openFolderInFileManager: onOpenFolderInFileManager,
              createSubfolder: onCreateSubfolder,
              renameFolder: onRenameFolder,
              openLinkedRules: onOpenLinkedRules,
              copyFolderPath: onCopyFolderPath,
              renameOrganization: onRenameOrganization,
              editCollectionDetails: onEditCollectionDetails,
              deleteOrganization: onDeleteOrganization,
              renameSmartCollection: onRenameSmartCollection,
              updateSmartCollection: onUpdateSmartCollection,
              deleteSmartCollection: onDeleteSmartCollection,
            },
          };
          const resolvedById = new Map(
            sidebarCommandRegistry
              .resolveMenu(commandContext)
              .map((item) => [item.id, item]),
          );
          const runSidebarCommand = (id: string) => {
            const item = resolvedById.get(id);
            if (!item || item.disabled) return;
            void sidebarCommandRegistry.get(id)?.run(commandContext);
          };
          const renameItem = resolvedById.get("smart-collection.rename");
          const updateQueryItem = resolvedById.get(
            "smart-collection.update-query",
          );
          const deleteItem = resolvedById.get("smart-collection.delete");
          return (
            <>
              {renameItem && (
                <ContextMenuItem
                  icon={<Icon name="smart" size={14} />}
                  label={renameItem.label}
                  onAction={() => runSidebarCommand("smart-collection.rename")}
                />
              )}
              {updateQueryItem && (
                <ContextMenuItem
                  icon={<Icon name="refresh" size={14} />}
                  label={updateQueryItem.label}
                  onAction={() =>
                    runSidebarCommand("smart-collection.update-query")
                  }
                />
              )}
              {deleteItem && (
                <ContextMenuItem
                  icon={<Icon name="trash" size={14} />}
                  label={deleteItem.label}
                  danger
                  onAction={() => runSidebarCommand("smart-collection.delete")}
                />
              )}
            </>
          );
        })()}
        {activeContextMenu.descriptor.type === "organization" && (() => {
          const desc = activeContextMenu.descriptor;
          if (desc.type !== "organization") return null;
          // 0015-D: 合集分支三项恒可见；删除确认（window.confirm）保留在
          // 命令的 run 内，danger 样式仍在 JSX 声明。
          const commandContext: SidebarCommandContext = {
            surface: "sidebar",
            platform: isMac ? "mac" : "windows",
            selectedAssetIds: [],
            primaryAssetId: null,
            assetScope: "none",
            trashMode: false,
            menuKind: "organization",
            subjectId: desc.id,
            subjectName: desc.name,
            linkedFolderResolved: false,
            actions: {
              openFolderInFileManager: onOpenFolderInFileManager,
              createSubfolder: onCreateSubfolder,
              renameFolder: onRenameFolder,
              openLinkedRules: onOpenLinkedRules,
              copyFolderPath: onCopyFolderPath,
              renameOrganization: onRenameOrganization,
              editCollectionDetails: onEditCollectionDetails,
              deleteOrganization: onDeleteOrganization,
              renameSmartCollection: onRenameSmartCollection,
              updateSmartCollection: onUpdateSmartCollection,
              deleteSmartCollection: onDeleteSmartCollection,
            },
          };
          const resolvedById = new Map(
            sidebarCommandRegistry
              .resolveMenu(commandContext)
              .map((item) => [item.id, item]),
          );
          const runSidebarCommand = (id: string) => {
            const item = resolvedById.get(id);
            if (!item || item.disabled) return;
            void sidebarCommandRegistry.get(id)?.run(commandContext);
          };
          const renameItem = resolvedById.get("collection.rename");
          const editDetailsItem = resolvedById.get("collection.edit-details");
          const deleteItem = resolvedById.get("collection.delete");
          return (
            <>
              {renameItem && (
                <ContextMenuItem
                  icon={<Icon name="collection" size={14} />}
                  label={renameItem.label}
                  onAction={() => runSidebarCommand("collection.rename")}
                />
              )}
              {editDetailsItem && (
                <ContextMenuItem
                  icon={<Icon name="info" size={14} />}
                  label={editDetailsItem.label}
                  onAction={() => runSidebarCommand("collection.edit-details")}
                />
              )}
              {deleteItem && (
                <ContextMenuItem
                  icon={<Icon name="trash" size={14} />}
                  label={deleteItem.label}
                  danger
                  onAction={() => runSidebarCommand("collection.delete")}
                />
              )}
            </>
          );
        })()}
        {activeContextMenu.descriptor.type === "folder" && (() => {
          const desc = activeContextMenu.descriptor;
          if (desc.type !== "folder") return null;
          // REQ-MENU-006: open/copy-path apply to managed and linked folders.
          // Offline linked roots disable the path actions, mirroring the
          // unavailable-asset convention (disabled + reason, not an error).
          // 0015-D: 标题/可见性/禁用原因由注册表 resolveMenu 求值；此处把
          // descriptor 与 linkedFolders 解析结果组装成 SidebarCommandContext。
          const linkedFolder =
            desc.locationKind === "linked"
              ? linkedFolders.find((folder) => folder.folderId === desc.folderId)
              : undefined;
          const commandContext: SidebarCommandContext = {
            surface: "sidebar",
            platform: isMac ? "mac" : "windows",
            selectedAssetIds: [],
            primaryAssetId: null,
            assetScope: "none",
            trashMode: false,
            menuKind: "folder",
            subjectId: desc.folderId,
            subjectName: desc.name,
            locationKind: desc.locationKind,
            status: desc.status,
            linkedFolderResolved: linkedFolder !== undefined,
            linkedFolder,
            actions: {
              openFolderInFileManager: onOpenFolderInFileManager,
              createSubfolder: onCreateSubfolder,
              renameFolder: onRenameFolder,
              openLinkedRules: onOpenLinkedRules,
              copyFolderPath: onCopyFolderPath,
              renameOrganization: onRenameOrganization,
              editCollectionDetails: onEditCollectionDetails,
              deleteOrganization: onDeleteOrganization,
              renameSmartCollection: onRenameSmartCollection,
              updateSmartCollection: onUpdateSmartCollection,
              deleteSmartCollection: onDeleteSmartCollection,
            },
          };
          const resolvedById = new Map(
            sidebarCommandRegistry
              .resolveMenu(commandContext)
              .map((item) => [item.id, item]),
          );
          const runSidebarCommand = (id: string) => {
            const item = resolvedById.get(id);
            if (!item || item.disabled) return;
            void sidebarCommandRegistry.get(id)?.run(commandContext);
          };
          const openInFileManagerItem = resolvedById.get(
            "folder.open-in-file-manager",
          );
          const createSubfolderItem = resolvedById.get(
            "folder.create-subfolder",
          );
          const renameItem = resolvedById.get("folder.rename");
          const linkedRulesItem = resolvedById.get("folder.linked-rules");
          const copyPathItem = resolvedById.get("folder.copy-path");
          return (
            <>
              <ContextMenuSection label="打开">
                {openInFileManagerItem && (
                  <ContextMenuItem
                    icon={<Icon name="folder" size={14} />}
                    label={openInFileManagerItem.label}
                    disabled={openInFileManagerItem.disabled}
                    disabledReason={
                      openInFileManagerItem.disabledReason ?? undefined
                    }
                    onAction={() =>
                      runSidebarCommand("folder.open-in-file-manager")
                    }
                  />
                )}
              </ContextMenuSection>
              <ContextMenuSection label="文件夹">
                {createSubfolderItem && (
                  <ContextMenuItem
                    icon={<Icon name="folder" size={14} />}
                    label={createSubfolderItem.label}
                    onAction={() =>
                      runSidebarCommand("folder.create-subfolder")
                    }
                  />
                )}
                {renameItem && (
                  <ContextMenuItem
                    icon={<Icon name="edit" size={14} />}
                    label={renameItem.label}
                    onAction={() => runSidebarCommand("folder.rename")}
                  />
                )}
                {linkedRulesItem && (
                  <ContextMenuItem
                    icon={<Icon name="link" size={14} />}
                    label={linkedRulesItem.label}
                    onAction={() => runSidebarCommand("folder.linked-rules")}
                  />
                )}
                {copyPathItem && (
                  <ContextMenuItem
                    icon={<Icon name="file" size={14} />}
                    label={copyPathItem.label}
                    disabled={copyPathItem.disabled}
                    disabledReason={copyPathItem.disabledReason ?? undefined}
                    onAction={() => runSidebarCommand("folder.copy-path")}
                  />
                )}
              </ContextMenuSection>
            </>
          );
        })()}
        {activeContextMenu.descriptor.type === "multi-asset" &&
          (() => {
            const descriptor = activeContextMenu.descriptor;
            const targetAssetIds = [...descriptor.assetIds];
            const targetIdSet = new Set(targetAssetIds);
            const targetAssets = assets.filter((asset) =>
              targetIdSet.has(asset.assetId),
            );
            const managedAssetIds = targetAssets
              .filter((asset) => asset.locationKind === "managed")
              .map((asset) => asset.assetId);
            const availableManagedAssetIds = targetAssets
              .filter(
                (asset) =>
                  asset.locationKind === "managed" &&
                  asset.availability === "available",
              )
              .map((asset) => asset.assetId);
            const linkedCount = targetAssets.filter(
              (asset) => asset.locationKind === "linked",
            ).length;
            const unavailableManagedCount = targetAssets.filter(
              (asset) =>
                asset.locationKind === "managed" &&
                asset.availability !== "available",
            ).length;
            const unresolvedCount = targetAssetIds.length - targetAssets.length;
            const allTrashed =
              targetAssets.length > 0 &&
              targetAssets.every((asset) => Boolean(asset.deletedAt));
            const moveSkipReasons = [
              linkedCount > 0
                ? `${linkedCount} 项链接资产不由资源库管理`
                : null,
              unavailableManagedCount > 0
                ? `${unavailableManagedCount} 项托管资产当前不可用`
                : null,
              unresolvedCount > 0
                ? `${unresolvedCount} 项资产已不在当前范围`
                : null,
            ].filter((reason): reason is string => reason !== null);
            const trashSkipReasons = [
              linkedCount > 0
                ? `${linkedCount} 项链接资产不由资源库管理`
                : null,
              unresolvedCount > 0
                ? `${unresolvedCount} 项资产已不在当前范围`
                : null,
            ].filter((reason): reason is string => reason !== null);

            // 0015-C: 静态项的标题/快捷键/可见性/禁用原因由注册表 resolveMenu
            // 求值；此处把每次打开时算出的集合与 props 组装成
            // AssetMultiCommandContext。动态行（批量合集、外部目录）与汇总/
            // 跳过原因提示块保持内联不变。
            const commandContext: AssetMultiCommandContext = {
              surface: "asset-multi",
              platform: isMac ? "mac" : "windows",
              selectedAssetIds: targetAssetIds,
              primaryAssetId: null,
              assetScope: "multi",
              trashMode: allTrashed,
              selectionCount: targetAssetIds.length,
              managedCount: managedAssetIds.length,
              availableManagedCount: availableManagedAssetIds.length,
              linkedCount,
              trashedAll: allTrashed,
              managedAssetIds,
              availableManagedAssetIds,
              actions: {
                openAssignTagPicker: (assetIds) =>
                  setTagPicker({ mode: "assign", assetIds, single: false }),
                openRemoveTagPicker: (assetIds) =>
                  setTagPicker({ mode: "remove", assetIds, single: false }),
                moveToFolder: onMoveToFolder,
                moveToTrash: onTrash,
                restore: onRestore,
                deletePermanent: onPermanentDelete,
                clearSelection: onClearSelection,
              },
            };
            const resolvedById = new Map(
              assetMultiCommandRegistry
                .resolveMenu(commandContext)
                .map((item) => [item.id, item]),
            );
            const runMultiCommand = (id: string) => {
              const item = resolvedById.get(id);
              if (!item || item.disabled) return;
              void assetMultiCommandRegistry.get(id)?.run(commandContext);
            };
            const restoreItem = resolvedById.get("assets.restore");
            const deletePermanentItem = resolvedById.get(
              "assets.delete-permanent",
            );
            const assignTagItem = resolvedById.get("assets.assign-tag");
            const removeTagItem = resolvedById.get("assets.remove-tag");
            const moveToFolderItem = resolvedById.get("assets.move-to-folder");
            const moveToTrashItem = resolvedById.get("assets.move-to-trash");
            const clearSelectionItem = resolvedById.get(
              "assets.clear-selection",
            );

            return (
              <>
                <div className="context-menu-selection-summary">
                  已选择 {targetAssetIds.length} 项
                </div>
                {allTrashed ? (
                  <ContextMenuSection label="回收站操作">
                    {restoreItem && (
                      <ContextMenuItem
                        icon={<Icon name="upload" size={14} />}
                        label={restoreItem.label}
                        onAction={() => runMultiCommand("assets.restore")}
                      />
                    )}
                    {deletePermanentItem && (
                      <ContextMenuItem
                        icon={<Icon name="trash" size={14} />}
                        label={deletePermanentItem.label}
                        danger
                        onAction={() =>
                          runMultiCommand("assets.delete-permanent")
                        }
                      />
                    )}
                  </ContextMenuSection>
                ) : (
                  <>
                {(moveSkipReasons.length > 0 || trashSkipReasons.length > 0) && (
                  <div className="context-menu-scope-note" role="note">
                    移动/复制处理 {availableManagedAssetIds.length} 项可用托管资产
                    {moveSkipReasons.length > 0
                      ? `，跳过${moveSkipReasons.join("、")}`
                      : ""}
                    ；回收站处理 {managedAssetIds.length} 项托管资产
                    {trashSkipReasons.length > 0
                      ? `，跳过${trashSkipReasons.join("、")}`
                      : ""}
                    。
                  </div>
                )}
            <ContextMenuSection label="组织">
            {tags.length > 0 && assignTagItem && removeTagItem && (
              <ContextMenuSection label="批量标签">
                <TagPickerEntry
                  icon={<Icon name="tag" size={14} />}
                  label={assignTagItem.label}
                  onOpen={() => runMultiCommand("assets.assign-tag")}
                />
                <TagPickerEntry
                  icon={<Icon name="close" size={14} />}
                  label={removeTagItem.label}
                  onOpen={() => runMultiCommand("assets.remove-tag")}
                />
              </ContextMenuSection>
            )}
            {collections.length > 0 && (
              <ContextMenuSection label="批量合集">
                {collections.map((collection) => (
                  <Fragment key={`batch-col-${collection.collectionId}`}>
                    <ContextMenuItem
                      icon={<Icon name="collection" size={14} />}
                      label={`加入合集：${collection.name}`}
                      onAction={() => {
                        onBatchAddToCollection(
                          collection.collectionId,
                          targetAssetIds,
                        );
                      }}
                    />
                    <ContextMenuItem
                      icon={<Icon name="close" size={14} />}
                      label={`移出合集：${collection.name}`}
                      onAction={() => {
                        onBatchRemoveFromCollection(
                          collection.collectionId,
                          targetAssetIds,
                        );
                      }}
                    />
                  </Fragment>
                ))}
              </ContextMenuSection>
            )}
              {moveToFolderItem && (
                <ContextMenuItem
                  icon={<Icon name="folder" size={14} />}
                  label={moveToFolderItem.label}
                  disabled={moveToFolderItem.disabled}
                  disabledReason={moveToFolderItem.disabledReason ?? undefined}
                  onAction={() => runMultiCommand("assets.move-to-folder")}
                />
              )}
              {linkedFolders
                .filter((f) => f.status === "available")
                .map((folder) => (
                  <ContextMenuItem
                    key={`batch-link-${folder.folderId}`}
                    icon={<Icon name="link" size={14} />}
                    label={`复制到外部目录：${folder.displayName}`}
                    disabled={availableManagedAssetIds.length === 0}
                    disabledReason="所选资产中没有可复制的托管资产"
                    onAction={() =>
                      onCopyToLinked(
                        folder,
                        availableManagedAssetIds,
                      )
                    }
                  />
                ))}
            </ContextMenuSection>
            <ContextMenuSection label="删除">
              {moveToTrashItem && (
                <ContextMenuItem
                  icon={<Icon name="trash" size={14} />}
                  label={moveToTrashItem.label}
                  shortcut={moveToTrashItem.shortcutLabel ?? undefined}
                  danger
                  disabled={moveToTrashItem.disabled}
                  disabledReason={moveToTrashItem.disabledReason ?? undefined}
                  onAction={() => runMultiCommand("assets.move-to-trash")}
                />
              )}
            </ContextMenuSection>
                  </>
                )}
            {clearSelectionItem && (
              <ContextMenuItem
                icon={<Icon name="close" size={14} />}
                label={clearSelectionItem.label}
                onAction={() => runMultiCommand("assets.clear-selection")}
              />
            )}
              </>
            );
          })()}
        {activeContextMenu.descriptor.type === "asset" &&
          (() => {
            const {
              assetId,
              displayName,
              locationKind,
              isAvailable,
              isDeleted,
            } = activeContextMenu.descriptor;
            const singleManaged = locationKind === "managed";
            // 0015-B: 静态项的标题/快捷键/可见性/禁用原因由注册表 resolveMenu
            // 求值；此处把 descriptor 与 props 组装成 AssetCommandContext。
            // 动态行（外部目录、合集、标签）与汇总/提示块保持内联不变。
            const commandContext: AssetCommandContext = {
              surface: "asset-single",
              platform: isMac ? "mac" : "windows",
              selectedAssetIds: [assetId],
              primaryAssetId: assetId,
              assetScope: "single",
              trashMode: isDeleted,
              locationKind,
              assetAvailable: isAvailable,
              assetDeleted: isDeleted,
              activeCollectionId,
              aiCanAnalyze: canAnalyze,
              assetDisplayName: displayName,
              actions: {
                openExternal: onOpenExternal,
                revealInFolder: onRevealInFolder,
                copyFilePath: onCopyFilePath,
                rename: onRenameAssetFile,
                aiAnalyze: onAnalyze,
                moveToTrash: onTrash,
                moveToFolder: onMoveToFolder,
                relink: onRelink,
                restore: onRestore,
                deletePermanent: onPermanentDelete,
                deleteLinked: onDeleteLinked,
                removeFromCurrentCollection: onRemoveFromCurrentCollection,
              },
            };
            const resolvedById = new Map(
              assetCommandRegistry
                .resolveMenu(commandContext)
                .map((item) => [item.id, item]),
            );
            const runAssetCommand = (id: string) => {
              const item = resolvedById.get(id);
              if (!item || item.disabled) return;
              void assetCommandRegistry.get(id)?.run(commandContext);
            };
            const restoreItem = resolvedById.get("asset.restore");
            const deletePermanentItem = resolvedById.get(
              "asset.delete-permanent",
            );
            const openExternalItem = resolvedById.get("asset.open-external");
            const revealInFolderItem = resolvedById.get(
              "asset.reveal-in-folder",
            );
            const removeFromCurrentCollectionItem = resolvedById.get(
              "asset.remove-from-current-collection",
            );
            const relinkItem = resolvedById.get("asset.relink");
            const moveToFolderItem = resolvedById.get("asset.move-to-folder");
            const copyFilePathItem = resolvedById.get("asset.copy-file-path");
            const renameItem = resolvedById.get("asset.rename");
            const aiAnalyzeItem = resolvedById.get("asset.ai-analyze");
            const moveToTrashItem = resolvedById.get("asset.move-to-trash");
            const deleteLinkedItem = resolvedById.get("asset.delete-linked");
            return (
              <>
                <div className="context-menu-selection-summary">
                  已选择 1 项
                </div>
                {isDeleted ? (
                  <ContextMenuSection label="回收站操作">
                    {restoreItem && (
                      <ContextMenuItem
                        icon={<Icon name="upload" size={14} />}
                        label={restoreItem.label}
                        onAction={() => runAssetCommand("asset.restore")}
                      />
                    )}
                    {deletePermanentItem && (
                      <ContextMenuItem
                        icon={<Icon name="trash" size={14} />}
                        label={deletePermanentItem.label}
                        danger
                        onAction={() =>
                          runAssetCommand("asset.delete-permanent")
                        }
                      />
                    )}
                  </ContextMenuSection>
                ) : (
                  <>
                {singleManaged && !isAvailable && (
                  <div className="context-menu-scope-note" role="note">
                    此托管资产当前不可用；文件操作将在资产恢复后可用。
                  </div>
                )}
                <ContextMenuSection label="打开">
                  {openExternalItem && (
                    <ContextMenuItem
                      icon={<Icon name="upload" size={14} />}
                      label={openExternalItem.label}
                      shortcut={openExternalItem.shortcutLabel ?? undefined}
                      disabled={openExternalItem.disabled}
                      disabledReason={
                        openExternalItem.disabledReason ?? undefined
                      }
                      onAction={() => runAssetCommand("asset.open-external")}
                    />
                  )}
                  {revealInFolderItem && (
                    <ContextMenuItem
                      icon={<Icon name="folder" size={14} />}
                      label={revealInFolderItem.label}
                      disabled={revealInFolderItem.disabled}
                      disabledReason={
                        revealInFolderItem.disabledReason ?? undefined
                      }
                      onAction={() =>
                        runAssetCommand("asset.reveal-in-folder")
                      }
                    />
                  )}
                </ContextMenuSection>
                <ContextMenuSection label="组织">
                  {removeFromCurrentCollectionItem && (
                    <ContextMenuItem
                      icon={<Icon name="close" size={14} />}
                      label={removeFromCurrentCollectionItem.label}
                      onAction={() =>
                        runAssetCommand("asset.remove-from-current-collection")
                      }
                    />
                  )}
                  {relinkItem && (
                    <ContextMenuItem
                      icon={<Icon name="search" size={14} />}
                      label={relinkItem.label}
                      onAction={() => runAssetCommand("asset.relink")}
                    />
                  )}
                  {moveToFolderItem && (
                    <ContextMenuItem
                      icon={<Icon name="folder" size={14} />}
                      label={moveToFolderItem.label}
                      onAction={() => runAssetCommand("asset.move-to-folder")}
                    />
                  )}
                  {copyFilePathItem && (
                    <ContextMenuItem
                      icon={<Icon name="file" size={14} />}
                      label={copyFilePathItem.label}
                      disabled={copyFilePathItem.disabled}
                      disabledReason={
                        copyFilePathItem.disabledReason ?? undefined
                      }
                      onAction={() => runAssetCommand("asset.copy-file-path")}
                    />
                  )}
                  {renameItem && (
                    <ContextMenuItem
                      icon={<Icon name="edit" size={14} />}
                      label={renameItem.label}
                      disabled={renameItem.disabled}
                      disabledReason={renameItem.disabledReason ?? undefined}
                      onAction={() => runAssetCommand("asset.rename")}
                    />
                  )}
                  {linkedFolders
                    .filter((f) => f.status === "available")
                    .map((folder) => (
                      <ContextMenuItem
                        key={`single-link-${folder.folderId}`}
                        icon={<Icon name="link" size={14} />}
                        label={`复制到外部目录：${folder.displayName}`}
                        disabled={!singleManaged || !isAvailable}
                        disabledReason="资产不可复制到外部目录"
                        onAction={() =>
                          onCopyToLinked(folder, [assetId])
                        }
                      />
                    ))}
                  {collections.map((collection) => (
                    <ContextMenuItem
                      key={`remove-collection-${collection.collectionId}`}
                      icon={<Icon name="close" size={14} />}
                      label={`移出合集：${collection.name}`}
                      onAction={() => {
                        onRemoveFromCollection(assetId, collection.collectionId);
                      }}
                    />
                  ))}
                  {tags.length > 0 && (
                    <TagPickerEntry
                      icon={<Icon name="tag" size={14} />}
                      label="添加标签…"
                      onOpen={() =>
                        setTagPicker({
                          mode: "assign",
                          assetIds: [assetId],
                          single: true,
                        })
                      }
                    />
                  )}
                  {collections.map((collection) => (
                    <ContextMenuItem
                      key={`collection-${collection.collectionId}`}
                      icon={<Icon name="collection" size={14} />}
                      label={`加入合集：${collection.name}`}
                      onAction={() => {
                        onAddToCollection(assetId, collection.collectionId);
                      }}
                    />
                  ))}
                </ContextMenuSection>
                <ContextMenuSection label="元数据">
                  {aiAnalyzeItem && (
                    <ContextMenuItem
                      icon={<Icon name="smart" size={14} />}
                      label={aiAnalyzeItem.label}
                      disabled={aiAnalyzeItem.disabled}
                      disabledReason={aiAnalyzeItem.disabledReason ?? undefined}
                      onAction={() => runAssetCommand("asset.ai-analyze")}
                    />
                  )}
                </ContextMenuSection>
                <ContextMenuSection label="删除">
                  {moveToTrashItem && (
                    <ContextMenuItem
                      icon={<Icon name="trash" size={14} />}
                      label={moveToTrashItem.label}
                      shortcut={moveToTrashItem.shortcutLabel ?? undefined}
                      danger
                      disabled={moveToTrashItem.disabled}
                      disabledReason={
                        moveToTrashItem.disabledReason ?? undefined
                      }
                      onAction={() => runAssetCommand("asset.move-to-trash")}
                    />
                  )}
                  {deleteLinkedItem && (
                    <ContextMenuItem
                      icon={<Icon name="link" size={14} />}
                      label={deleteLinkedItem.label}
                      danger
                      onAction={() => runAssetCommand("asset.delete-linked")}
                    />
                  )}
                </ContextMenuSection>
                  </>
                )}
              </>
            );
          })()}
          </>
        )}
      </ContextMenu>
    </ContextMenuBackdrop>
  );
}
