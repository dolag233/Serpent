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
import {
  assetCommandShortcut,
  isMacPlatform,
} from "./asset-command-shortcuts";
import { createCommandRegistry } from "./commands/command-registry";
import {
  assetCommandDefinitions,
  type AssetCommandContext,
} from "./commands/asset-commands";

const isMac = isMacPlatform(navigator.userAgent);

// 0015-B: 单资产右键菜单的静态项由统一命令注册表驱动（REQ-COMMAND-001）；
// 注册表是纯数据，模块级构建一次即可。多资产菜单后续切片再接入。
const assetCommandRegistry = createCommandRegistry(assetCommandDefinitions);

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
        {activeContextMenu.descriptor.type === "smart-collection" && (
          <>
            <ContextMenuItem
              icon={<Icon name="smart" size={14} />}
              label="重命名智能合集"
              onAction={() => {
                const desc = activeContextMenu.descriptor;
                if (desc.type !== "smart-collection") return;
                onRenameSmartCollection(desc.id, desc.name);
              }}
            />
            <ContextMenuItem
              icon={<Icon name="refresh" size={14} />}
              label="用当前条件更新"
              onAction={() => {
                const desc = activeContextMenu.descriptor;
                if (desc.type !== "smart-collection") return;
                onUpdateSmartCollection(desc.id);
              }}
            />
            <ContextMenuItem
              icon={<Icon name="trash" size={14} />}
              label="删除智能合集"
              danger
              onAction={() => {
                const desc = activeContextMenu.descriptor;
                if (desc.type !== "smart-collection") return;
                if (window.confirm(`删除智能合集"${desc.name}"？`))
                  onDeleteSmartCollection(desc.id, desc.name);
              }}
            />
          </>
        )}
        {activeContextMenu.descriptor.type === "organization" && (
          <>
            <ContextMenuItem
              icon={<Icon name="collection" size={14} />}
              label="重命名合集"
              onAction={() => {
                const desc = activeContextMenu.descriptor;
                if (desc.type !== "organization") return;
                onRenameOrganization(desc.id, desc.name);
              }}
            />
            <ContextMenuItem
              icon={<Icon name="info" size={14} />}
              label="编辑合集详情"
              onAction={() => {
                const desc = activeContextMenu.descriptor;
                if (desc.type !== "organization") return;
                onEditCollectionDetails(desc.id);
              }}
            />
            <ContextMenuItem
              icon={<Icon name="trash" size={14} />}
              label="删除合集"
              danger
              onAction={() => {
                const desc = activeContextMenu.descriptor;
                if (desc.type !== "organization") return;
                const confirmed = window.confirm(
                  `删除合集"${desc.name}"？\n（仅删除合集结构，不删除资产）`,
                );
                if (confirmed) {
                  onDeleteOrganization(desc.id, desc.name);
                }
              }}
            />
          </>
        )}
        {activeContextMenu.descriptor.type === "folder" && (() => {
          const desc = activeContextMenu.descriptor;
          if (desc.type !== "folder") return null;
          // REQ-MENU-006: open/copy-path apply to managed and linked folders.
          // Offline linked roots disable the path actions, mirroring the
          // unavailable-asset convention (disabled + reason, not an error).
          const isOfflineLinked =
            desc.locationKind === "linked" && desc.status === "offline";
          const linkedFolder =
            desc.locationKind === "linked"
              ? linkedFolders.find((folder) => folder.folderId === desc.folderId)
              : undefined;
          return (
            <>
              <ContextMenuSection label="打开">
                <ContextMenuItem
                  icon={<Icon name="folder" size={14} />}
                  label={isMac ? "在 Finder 中打开" : "在文件资源管理器中打开"}
                  disabled={isOfflineLinked}
                  disabledReason="链接文件夹当前离线"
                  onAction={() => onOpenFolderInFileManager(desc.folderId)}
                />
              </ContextMenuSection>
              <ContextMenuSection label="文件夹">
                {desc.locationKind === "managed" && (
                  <>
                    <ContextMenuItem
                      icon={<Icon name="folder" size={14} />}
                      label="新建子文件夹"
                      onAction={() => onCreateSubfolder(desc.folderId)}
                    />
                    <ContextMenuItem
                      icon={<Icon name="edit" size={14} />}
                      label="重命名…"
                      onAction={() => onRenameFolder(desc.folderId, desc.name)}
                    />
                  </>
                )}
                {desc.locationKind === "linked" && linkedFolder && (
                  <ContextMenuItem
                    icon={<Icon name="link" size={14} />}
                    label="链接规则…"
                    onAction={() => onOpenLinkedRules(linkedFolder)}
                  />
                )}
                <ContextMenuItem
                  icon={<Icon name="file" size={14} />}
                  label="复制文件夹路径"
                  disabled={isOfflineLinked}
                  disabledReason="链接文件夹当前离线"
                  onAction={() => onCopyFolderPath(desc.folderId)}
                />
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

            return (
              <>
                <div className="context-menu-selection-summary">
                  已选择 {targetAssetIds.length} 项
                </div>
                {allTrashed ? (
                  <ContextMenuSection label="回收站操作">
                    <ContextMenuItem
                      icon={<Icon name="upload" size={14} />}
                      label={`恢复所选（${targetAssetIds.length} 项）`}
                      onAction={() => onRestore(targetAssetIds)}
                    />
                    <ContextMenuItem
                      icon={<Icon name="trash" size={14} />}
                      label={`永久删除（${targetAssetIds.length} 项）`}
                      danger
                      onAction={() => onPermanentDelete(targetAssetIds)}
                    />
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
            {tags.length > 0 && (
              <ContextMenuSection label="批量标签">
                <TagPickerEntry
                  icon={<Icon name="tag" size={14} />}
                  label="添加标签…"
                  onOpen={() =>
                    setTagPicker({
                      mode: "assign",
                      assetIds: targetAssetIds,
                      single: false,
                    })
                  }
                />
                <TagPickerEntry
                  icon={<Icon name="close" size={14} />}
                  label="移除标签…"
                  onOpen={() =>
                    setTagPicker({
                      mode: "remove",
                      assetIds: targetAssetIds,
                      single: false,
                    })
                  }
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
              <ContextMenuItem
                icon={<Icon name="folder" size={14} />}
                label={`移动到文件夹…（${availableManagedAssetIds.length} 项）`}
                disabled={availableManagedAssetIds.length === 0}
                disabledReason="所选资产中没有可移动的托管资产"
                onAction={() =>
                  onMoveToFolder(availableManagedAssetIds)
                }
              />
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
              <ContextMenuItem
                icon={<Icon name="trash" size={14} />}
                label={`移入回收站（${managedAssetIds.length} 项）`}
                shortcut={assetCommandShortcut("move-to-trash", isMac)}
                danger
                disabled={managedAssetIds.length === 0}
                disabledReason="所选资产中没有托管资产"
                onAction={() =>
                  onTrash(managedAssetIds)
                }
              />
            </ContextMenuSection>
                  </>
                )}
            <ContextMenuItem
              icon={<Icon name="close" size={14} />}
              label={`清除选择（${targetAssetIds.length} 项）`}
              onAction={onClearSelection}
            />
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
