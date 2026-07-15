import { Fragment } from "react";
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
} from "./context-menu";
import { Icon } from "./Icons";

interface AssetContextMenuProps {
  tags: TagSummary[];
  collections: CollectionSummary[];
  linkedFolders: LinkedFolderSummary[];
  activeCollectionId: string | null;
  assets: AssetSummary[];
  onRenameSmartCollection: (id: string, name: string) => void;
  onUpdateSmartCollection: (id: string) => void;
  onDeleteSmartCollection: (id: string, name: string) => void;
  onRenameOrganization: (kind: "tag" | "collection", id: string, name: string) => void;
  onEditCollectionDetails: (collectionId: string) => void;
  onDeleteOrganization: (kind: "tag" | "collection", id: string, name: string) => void;
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
    onRemoveFromCurrentCollection,
    onRemoveFromCollection,
    onAssignTag,
    onAddToCollection,
  } = props;

  const { active: activeContextMenu } = useContextMenu();

  if (!activeContextMenu) return null;

  const ariaLabel =
    activeContextMenu.descriptor.type === "multi-asset"
      ? `批量资产操作：${activeContextMenu.descriptor.assetIds.length} 项`
      : activeContextMenu.descriptor.type === "asset"
        ? `资产操作：${activeContextMenu.descriptor.displayName}`
        : activeContextMenu.descriptor.type === "organization"
          ? `${activeContextMenu.descriptor.orgKind === "tag" ? "标签" : "合集"}操作：${activeContextMenu.descriptor.name}`
          : `智能合集操作：${activeContextMenu.descriptor.name}`;

  return (
    <ContextMenuBackdrop>
      <ContextMenu
        ariaLabel={ariaLabel}
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
                onRenameOrganization(desc.orgKind, desc.id, desc.name);
              }}
            />
            {activeContextMenu.descriptor.orgKind === "collection" && (
              <ContextMenuItem
                icon={<Icon name="info" size={14} />}
                label="编辑合集详情"
                onAction={() => {
                  const desc = activeContextMenu.descriptor;
                  if (desc.type !== "organization") return;
                  onEditCollectionDetails(desc.id);
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
                const confirmed = window.confirm(
                  desc.orgKind === "tag"
                    ? `删除标签"${desc.name}"？`
                    : `删除合集"${desc.name}"？\n（仅删除合集结构，不删除资产）`,
                );
                if (confirmed) {
                  onDeleteOrganization(desc.orgKind, desc.id, desc.name);
                }
              }}
            />
          </>
        )}
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
            {tags.length > 0 && (
              <ContextMenuSection label="批量标签">
                {tags.map((tag) => (
                  <Fragment key={`batch-tag-${tag.tagId}`}>
                    <ContextMenuItem
                      icon={<Icon name="tag" size={14} />}
                      label={`添加标签：${tag.name}`}
                      onAction={() => {
                        onBatchAssignTag(tag.tagId, targetAssetIds);
                      }}
                    />
                    <ContextMenuItem
                      icon={<Icon name="close" size={14} />}
                      label={`移除标签：${tag.name}`}
                      onAction={() => {
                        onBatchRemoveTag(tag.tagId, targetAssetIds);
                      }}
                    />
                  </Fragment>
                ))}
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
            <ContextMenuSection label="批量文件操作">
              <ContextMenuItem
                icon={<Icon name="folder" size={14} />}
                label={`移动到文件夹…（${availableManagedAssetIds.length} 项）`}
                disabled={availableManagedAssetIds.length === 0}
                disabledReason="所选资产中没有可移动的托管资产"
                onAction={() =>
                  onMoveToFolder(availableManagedAssetIds)
                }
              />
              <ContextMenuItem
                icon={<Icon name="trash" size={14} />}
                label={`移入回收站（${managedAssetIds.length} 项）`}
                danger
                disabled={managedAssetIds.length === 0}
                disabledReason="所选资产中没有托管资产"
                onAction={() =>
                  onTrash(managedAssetIds)
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
            return (
              <>
                <div className="context-menu-selection-summary">
                  已选择 1 项
                </div>
                {isDeleted ? (
                  <ContextMenuSection label="回收站操作">
                    <ContextMenuItem
                      icon={<Icon name="upload" size={14} />}
                      label="恢复"
                      onAction={() => onRestore([assetId])}
                    />
                    <ContextMenuItem
                      icon={<Icon name="trash" size={14} />}
                      label="永久删除"
                      danger
                      onAction={() => onPermanentDelete([assetId])}
                    />
                  </ContextMenuSection>
                ) : (
                  <>
                {singleManaged && !isAvailable && (
                  <div className="context-menu-scope-note" role="note">
                    此托管资产当前不可用；文件操作将在资产恢复后可用。
                  </div>
                )}
                <ContextMenuItem
                  icon={<Icon name="upload" size={14} />}
                  label="使用外部应用打开"
                  disabled={!isAvailable}
                  disabledReason="资产当前不可用"
                  onAction={() => {
                    onOpenExternal(assetId);
                  }}
                />
                {activeCollectionId && (
                  <ContextMenuItem
                    icon={<Icon name="close" size={14} />}
                    label="从当前合集移除"
                    onAction={() => {
                      onRemoveFromCurrentCollection(assetId);
                    }}
                  />
                )}
                {singleManaged && !isAvailable && (
                  <ContextMenuItem
                    icon={<Icon name="search" size={14} />}
                    label="找回资产…"
                    onAction={() => onRelink(assetId)}
                  />
                )}
                {singleManaged && isAvailable && (
                  <ContextMenuItem
                    icon={<Icon name="folder" size={14} />}
                    label="移动到文件夹…"
                    onAction={() =>
                      onMoveToFolder([assetId])
                    }
                  />
                )}
                {singleManaged && (
                  <ContextMenuItem
                    icon={<Icon name="trash" size={14} />}
                    label="移入回收站"
                    danger
                    disabled={!isAvailable}
                    disabledReason="托管资产当前不可用，无法移入回收站"
                    onAction={() => onTrash([assetId])}
                  />
                )}
                {locationKind === "linked" && (
                  <ContextMenuItem
                    icon={<Icon name="link" size={14} />}
                    label="删除链接资产…"
                    danger
                    onAction={() =>
                      onDeleteLinked(assetId, displayName, isAvailable)
                    }
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
                {tags.map((tag) => (
                  <ContextMenuItem
                    key={`tag-${tag.tagId}`}
                    icon={<Icon name="tag" size={14} />}
                    label={`添加标签：${tag.name}`}
                    onAction={() => {
                      onAssignTag(assetId, tag.tagId);
                    }}
                  />
                ))}
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
                <ContextMenuItem
                  icon={<Icon name="smart" size={14} />}
                  label="AI 分析"
                  disabled={!canAnalyze || !isAvailable}
                  disabledReason={
                    !isAvailable ? "资产当前不可用" : "尚未配置 AI API Key"
                  }
                  onAction={() => onAnalyze(assetId)}
                />
                  </>
                )}
              </>
            );
          })()}
      </ContextMenu>
    </ContextMenuBackdrop>
  );
}
