import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { SerpentLibraryApi } from "../shared/library-api";
import type {
  TagSummary,
  CollectionSummary,
  LinkedFolderSummary,
  AssetSummary,
  ManagedFolderSummary,
} from "../shared/asset-types";

type RendererWindow = Window & {
  serpent?: {
    library?: SerpentLibraryApi;
    plugins?: SerpentPluginManagerApi;
  };
};
import {
  ContextMenu,
  ContextMenuBackdrop,
  ContextMenuItem,
  ContextMenuSection,
  ContextMenuSubmenu,
  useContextMenu,
  type ContextMenuDescriptor,
} from "./context-menu";
import { Icon } from "./Icons";
import { TagPickerEntry, TagPickerMenu } from "./TagPickerMenu";
import { CollectionPickerMenu } from "./CollectionPickerMenu";
import { ColorSpaceSubmenuItems } from "./ColorSpacePickerMenu";
import { isMacPlatform } from "./commands/command-types";
import { createCommandRegistry } from "./commands/command-registry";
import { useLocale, useT, type TranslateFn } from "./i18n";
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
import {
  indexMembershipsByCollection,
  resolveCollectionMenuForSelection,
  type CollectionMembershipRow,
} from "./collection-menu-membership";
import {
  buildMultiAssetMenuSkipReport,
  formatMultiAssetMenuSkipFooter,
} from "./menu-skip-report";
import type { SerpentPluginManagerApi } from "../shared/plugin-manager-api";
import type { PluginContributionContext } from "../plugins/plugin-context";
import {
  placePluginMenuItemsAroundHost,
  runPluginMenuCommand,
  usePluginMenuContributions,
  type PluginMenuHostPlacement,
  type PluginMenuDescriptor,
} from "./plugin-menu-contributions";
import { createPluginMenuContributionContext } from "./plugin-contribution-context";

const isMac = isMacPlatform(navigator.userAgent);

function pluginMenuGroupLabel(group: string, t: TranslateFn): string {
  if (group === "image-processing") {
    return t("contextMenu.pluginGroups.imageProcessing");
  }
  return group;
}

function PluginMenuCommandsSection(props: {
  items: readonly PluginMenuDescriptor[];
  onRun: (item: PluginMenuDescriptor) => void;
  label: string;
}) {
  const t = useT();
  if (props.items.length === 0) return null;
  const hasNamedGroup = props.items.some((item) => (item.group ?? "").length > 0);
  // Named plugin groups already provide the section title; avoid nesting them
  // under the generic "Plugin commands" header.
  if (hasNamedGroup) {
    return (
      <PluginMenuItems
        items={props.items}
        onRun={props.onRun}
        resolveGroupLabel={(group) => pluginMenuGroupLabel(group, t)}
        showGroupLabels
      />
    );
  }
  return (
    <ContextMenuSection label={props.label}>
      <PluginMenuItems items={props.items} onRun={props.onRun} />
    </ContextMenuSection>
  );
}

function PluginMenuItems(props: {
  items: readonly PluginMenuDescriptor[];
  onRun: (item: PluginMenuDescriptor) => void;
  showGroupLabels?: boolean;
  resolveGroupLabel?: (group: string) => string;
}) {
  if (props.items.length === 0) return null;
  const grouped = new Map<string, PluginMenuDescriptor[]>();
  for (const item of props.items) {
    const group = item.group ?? "";
    const current = grouped.get(group) ?? [];
    current.push(item);
    grouped.set(group, current);
  }
  const renderItem = (item: PluginMenuDescriptor): ReactNode => {
    if (item.children.length > 0) {
      return (
        <ContextMenuSubmenu
          icon={<Icon name="box" size={14} />}
          key={item.id}
          label={item.label}
          disabled={item.disabled}
        >
          {item.children.map(renderItem)}
        </ContextMenuSubmenu>
      );
    }
    if (item.commandId === undefined) return null;
    return (
      <ContextMenuItem
        key={item.id}
        icon={<Icon name="box" size={14} />}
        label={item.label}
        shortcut={item.shortcut}
        disabled={item.disabled}
        checked={item.checked}
        onAction={() => props.onRun(item)}
      />
    );
  };
  const hasNamedGroup = [...grouped.keys()].some((group) => group.length > 0);
  if (props.showGroupLabels !== true || !hasNamedGroup) {
    return <>{props.items.map(renderItem)}</>;
  }
  return (
    <>
      {[...grouped.entries()].map(([group, items]) => (
        <ContextMenuSection
          key={group || "default"}
          label={group
            ? (props.resolveGroupLabel?.(group) ?? group)
            : undefined}
        >
          {items.map(renderItem)}
        </ContextMenuSection>
      ))}
    </>
  );
}

type PluginHostMenuGroup = "open" | "organize" | "metadata" | "delete";

const HOST_MENU_ANCHORS: Record<PluginHostMenuGroup, readonly string[]> = {
  open: [
    "asset.view",
    "asset.open-external",
    "asset.reveal-in-folder",
    "folder.open-in-file-manager",
  ],
  organize: [
    "asset.remove-from-current-collection",
    "asset.relink",
    "asset.move-to-folder",
    "asset.copy",
    "asset.paste",
    "asset.copy-file-path",
    "asset.rename",
    "folder.create-subfolder",
    "folder.rename",
    "folder.linked-rules",
    "folder.copy",
    "folder.paste",
    "folder.clone",
    "folder.copy-path",
  ],
  metadata: ["asset.ai-analyze", "asset.clear-ai-content"],
  delete: [
    "asset.move-to-trash",
    "asset.delete-from-disk",
    "asset.delete-linked",
    "asset.delete-permanent",
    "folder.move-to-trash",
    "folder.delete-from-disk",
    "folder.remove-from-library",
  ],
};
const INLINE_HOST_ANCHORS = new Set(["asset.rename", "folder.rename"]);

function pluginItemsForHostGroup(
  placement: PluginMenuHostPlacement,
  group: PluginHostMenuGroup,
  edge: "before" | "after",
): PluginMenuDescriptor[] {
  return placement.groups.get(group)?.[edge] ?? [];
}

function pluginItemsAtHostAnchor(
  placement: PluginMenuHostPlacement,
  anchor: string,
  edge: "before" | "after",
): PluginMenuDescriptor[] {
  return placement.anchors.get(anchor)?.[edge] ?? [];
}

function pluginItemsOutsideHostGroups(
  placement: PluginMenuHostPlacement,
): PluginMenuDescriptor[] {
  return placement.outside;
}


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
      return `multi-asset:${descriptor.assetIds.join(",")}:${(descriptor.folderIds ?? []).join(",")}`;
    case "organization":
      return `organization:${descriptor.id}`;
    case "smart-collection":
      return `smart-collection:${descriptor.id}`;
    case "folder":
      return `folder:${descriptor.folderId}`;
    case "trash":
      return "trash";
    case "trashed-folder":
      return `trashed-folder:${descriptor.tombstoneId}`;
    case "workspace":
      return `workspace:${(descriptor.assetIds ?? []).join(",")}`;
  }
}

interface AssetContextMenuProps {
  libraryId?: string;
  busy?: boolean;
  pluginBrowseScope?: Partial<PluginContributionContext["browse"]>;
  pluginViewerState?: Partial<PluginContributionContext["viewer"]>;
  pluginApi?: SerpentPluginManagerApi;
  pluginContributionRefreshKey?: string | null;
  tags: TagSummary[];
  collections: CollectionSummary[];
  linkedFolders: LinkedFolderSummary[];
  managedFolders: ManagedFolderSummary[];
  activeCollectionId: string | null;
  assets: AssetSummary[];
  onRenameSmartCollection: (id: string, name: string) => void;
  onUpdateSmartCollection: (id: string) => void;
  onDeleteSmartCollection: (id: string, name: string) => void;
  onRenameOrganization: (id: string, name: string) => void;
  onCreateSubcollection: (collectionId: string) => void;
  onEditCollectionDetails: (collectionId: string) => void;
  onDeleteOrganization: (id: string, name: string) => void;
  onCreateSubfolder: (folderId: string) => void;
  onSetIgnore: (args: {
    locationKind: "managed" | "linked";
    linkedFolderId?: string | null;
    relativePath: string;
    pathKind: "asset" | "folder" | "extension";
    ignored: boolean;
    name: string;
  }) => void;
  onRenameFolder: (folderId: string, currentName: string) => void;
  onOpenFolderInFileManager: (folderId: string) => void;
  onCopyFolderPath: (folderId: string) => void;
  onCopyFolder: (folderId: string) => void;
  onPasteIntoFolder: (folderId: string | null) => void;
  onCloneFolder: (folderId: string) => void;
  onMoveFolder: (folderIds: string[]) => void;
  onOpenLinkedRules: (folder: LinkedFolderSummary) => void;
  onTrashManagedFolder: (folderId: string, name: string) => void;
  onDeleteFolderFromDisk: (args: {
    folderId: string;
    name: string;
    locationKind: "managed" | "linked";
    linkedRelativePath?: string;
  }) => void;
  onRemoveLinkedFolder: (folderId: string, name: string) => void;
  onTrashLinkedFolderSubtree: (
    linkedFolderId: string,
    relativePath: string,
    name: string,
  ) => void;
  onBatchAssignTag: (tagId: string, assetIds: string[]) => void;
  onBatchRemoveTag: (tagId: string, assetIds: string[]) => void;
  onBatchAddToCollection: (collectionId: string, assetIds: string[]) => void;
  onBatchRemoveFromCollection: (collectionId: string, assetIds: string[]) => void;
  onMoveToFolder: (assetIds: string[], folderIds?: readonly string[]) => void;
  onTrash: (assetIds: string[], folderIds?: readonly string[]) => void;
  onDeleteFromDisk: (assetIds: string[], folderIds?: readonly string[]) => void;
  onRestore: (assetIds: string[]) => void;
  onPermanentDelete: (assetIds: string[]) => void;
  onRelink: (assetId: string) => void;
  onDeleteLinked: (assetId: string, displayName: string, canDeleteSourceFile: boolean) => void;
  onAnalyze: (assetId: string, batchIds?: readonly string[]) => void;
  onClearAiContent: (assetIds: string[]) => void;
  canAnalyze: boolean;
  /** Serpent-rsbt: show link-off on AI analyze when connection is unavailable. */
  aiDisconnected: boolean;
  onCopyToLinked: (folder: LinkedFolderSummary, assetIds: string[]) => void;
  onClearSelection: () => void;
  onOpenExternal: (assetId: string) => void;
  onViewAsset: (assetId: string) => void;
  onSetAssetColorSpace: (assetId: string, colorSpace: string | null) => void;
  onCreateImageSequence: (assetIds: string[]) => void;
  onSetImageSequenceFps: (
    sequenceId: string,
    frameCount: number,
    fps: number,
  ) => void;
  onDissolveImageSequence: (sequenceId: string) => void;
  onDissolveImageSequences: (sequenceIds: string[]) => void;
  onRevealInFolder: (assetId: string) => void;
  onCopyFilePath: (assetId: string) => void;
  /** OS file clipboard copy (Finder/Explorer interoperable). */
  onCopyAssetFiles: (assetIds: string[]) => void;
  /**
   * Managed folder that receives OS clipboard paste from asset menus.
   * Typically the current browse folder; null hides paste.
   */
  pasteTargetFolderId: string | null | undefined;
  onRenameAssetFile: (assetId: string) => void;
  onRemoveFromCurrentCollection: (assetId: string) => void;
  onRemoveFromCollection: (assetId: string, collectionId: string) => void;
  onAssignTag: (assetId: string, tagId: string) => void;
  onAddToCollection: (assetId: string, collectionId: string) => void;
  /** CU-B4: load direct memberships for the menu selection. */
  onLoadCollectionMemberships: (
    assetIds: string[],
  ) => Promise<CollectionMembershipRow[]>;
  trashedAssetCount: number;
  /** Folder tombstones in trash (Serpent-b3kf / empty-trash enablement). */
  trashedFolderCount: number;
  onRestoreTrashedFolder: (tombstoneId: string, name: string) => void;
  onEmptyTrash: () => void;
}

export function AssetContextMenu(props: AssetContextMenuProps) {
  const { locale, t } = useLocale();
  const {
    tags,
    collections,
    linkedFolders,
    managedFolders,
    activeCollectionId,
    assets,
    onRenameSmartCollection,
    onUpdateSmartCollection,
    onDeleteSmartCollection,
    onRenameOrganization,
    onCreateSubcollection,
    onEditCollectionDetails,
    onDeleteOrganization,
    onCreateSubfolder,
    onSetIgnore,
    onRenameFolder,
    onOpenFolderInFileManager,
    onCopyFolderPath,
    onCopyFolder,
    onPasteIntoFolder,
    onCloneFolder,
    onMoveFolder,
    onOpenLinkedRules,
    onTrashManagedFolder,
    onDeleteFolderFromDisk,
    onRemoveLinkedFolder,
    onTrashLinkedFolderSubtree,
    onBatchAssignTag,
    onBatchRemoveTag,
    onBatchAddToCollection,
    onBatchRemoveFromCollection,
    onMoveToFolder,
    onTrash,
    onDeleteFromDisk,
    onRestore,
    onPermanentDelete,
    onRelink,
    onDeleteLinked,
    onAnalyze,
    onClearAiContent,
    canAnalyze,
    aiDisconnected,
    onCopyToLinked,
    onClearSelection,
    onOpenExternal,
    onViewAsset,
    onRevealInFolder,
    onCopyFilePath,
    onCopyAssetFiles,
    pasteTargetFolderId,
    onRenameAssetFile,
    onRemoveFromCurrentCollection,
    onRemoveFromCollection,
    onAssignTag,
    onAddToCollection,
    onLoadCollectionMemberships,
  } = props;

  const { active: activeContextMenu } = useContextMenu();
  const [tagPicker, setTagPicker] = useState<TagPickerState | null>(null);
  // null = memberships still loading (hide add/remove pairs until known).
  const [memberIdsByCollection, setMemberIdsByCollection] = useState<Map<
    string,
    Set<string>
  > | null>(null);

  // The picker swaps the menu body in place; never let it leak into the next
  // menu. Adjust during render (React-sanctioned derived-state pattern):
  // whenever the open menu changes descriptor or closes, drop the picker.
  const activeDescriptorKey = activeContextMenu
    ? descriptorKey(activeContextMenu.descriptor)
    : null;
  const pluginContributionContext = useMemo(() => {
    if (activeContextMenu === null) return undefined;
    return createPluginMenuContributionContext({
      descriptor: activeContextMenu.descriptor,
      assets: props.assets,
      libraryId: props.libraryId,
      busy: props.busy,
      locale,
      browse: props.pluginBrowseScope,
      viewer: props.pluginViewerState,
    });
  }, [
    activeContextMenu,
    locale,
    props.busy,
    props.assets,
    props.libraryId,
    props.pluginBrowseScope,
    props.pluginViewerState,
  ]);
  const [pickerMenuKey, setPickerMenuKey] = useState(activeDescriptorKey);
  if (pickerMenuKey !== activeDescriptorKey) {
    setPickerMenuKey(activeDescriptorKey);
    setTagPicker(null);
    setMemberIdsByCollection(null);
  }

  // 「AI分析未分析项」：多选菜单打开时预取选中里没有任何 AI 数据的资产
  //（运行时判断 ai_content 有无记录，不动数据库字段）。key 变化时在
  // render 期重置（与 pickerMenuKey 同模式），effect 只做异步查询。
  const [aiPendingKey, setAiPendingKey] = useState(activeDescriptorKey);
  const [aiPendingAssetIds, setAiPendingAssetIds] = useState<readonly string[]>([]);
  if (aiPendingKey !== activeDescriptorKey) {
    setAiPendingKey(activeDescriptorKey);
    setAiPendingAssetIds([]);
  }
  useEffect(() => {
    const descriptor = activeContextMenu?.descriptor;
    if (
      !descriptor ||
      descriptor.type !== "multi-asset" ||
      !props.libraryId
    ) {
      return;
    }
    const assetIds = [...descriptor.assetIds];
    if (assetIds.length === 0) {
      return;
    }
    let cancelled = false;
    void (window as RendererWindow).serpent?.library
      ?.pendingAiAssets({ libraryId: props.libraryId, assetIds })
      .then((result) => {
        if (!cancelled && result.ok) {
          setAiPendingAssetIds(result.value.assetIds);
        }
      })
      .catch(() => {
        if (!cancelled) setAiPendingAssetIds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeDescriptorKey, activeContextMenu, props.libraryId]);

  useEffect(() => {
    const descriptor = activeContextMenu?.descriptor;
    if (
      !descriptor ||
      (descriptor.type !== "asset" && descriptor.type !== "multi-asset")
    ) {
      return;
    }
    const assetIds =
      descriptor.type === "asset" ? [descriptor.assetId] : [...descriptor.assetIds];
    let cancelled = false;
    void onLoadCollectionMemberships(assetIds)
      .then((rows) => {
        if (!cancelled) {
          setMemberIdsByCollection(indexMembershipsByCollection(rows));
        }
      })
      .catch(() => {
        // Fail closed: unknown membership → treat as non-members (add only).
        if (!cancelled) setMemberIdsByCollection(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [activeDescriptorKey, activeContextMenu, onLoadCollectionMemberships]);

  const pluginAssetMenuItems = usePluginMenuContributions(
    props.pluginApi,
    props.libraryId,
    "menus.asset",
    activeContextMenu?.descriptor.type === "asset"
      || activeContextMenu?.descriptor.type === "multi-asset",
    `${props.pluginContributionRefreshKey ?? ""}:${activeDescriptorKey}`,
    pluginContributionContext,
  );
  const pluginFolderMenuItems = usePluginMenuContributions(
    props.pluginApi,
    props.libraryId,
    "menus.folder",
    activeContextMenu?.descriptor.type === "folder",
    `${props.pluginContributionRefreshKey ?? ""}:${activeDescriptorKey}`,
    pluginContributionContext,
  );
  const pluginAssetMenuPlacement = useMemo(
    () => placePluginMenuItemsAroundHost(
      pluginAssetMenuItems,
      HOST_MENU_ANCHORS,
      INLINE_HOST_ANCHORS,
    ),
    [pluginAssetMenuItems],
  );
  const pluginFolderMenuPlacement = useMemo(
    () => placePluginMenuItemsAroundHost(
      pluginFolderMenuItems,
      HOST_MENU_ANCHORS,
      INLINE_HOST_ANCHORS,
    ),
    [pluginFolderMenuItems],
  );
  const pluginCollectionMenuItems = usePluginMenuContributions(
    props.pluginApi,
    props.libraryId,
    "menus.collection",
    activeContextMenu?.descriptor.type === "organization",
    `${props.pluginContributionRefreshKey ?? ""}:${activeDescriptorKey}`,
    pluginContributionContext,
  );
  const pluginWorkspaceMenuItems = usePluginMenuContributions(
    props.pluginApi,
    props.libraryId,
    "menus.workspace",
    activeContextMenu?.descriptor.type === "workspace",
    `${props.pluginContributionRefreshKey ?? ""}:${activeDescriptorKey}`,
    pluginContributionContext,
  );

  const runPluginCommand = (
    item: PluginMenuDescriptor,
    context: {
      assetIds?: string[];
      folderIds?: string[];
      collectionIds?: string[];
    },
  ) => {
    if (!props.pluginApi || !props.libraryId) return;
    void runPluginMenuCommand(props.pluginApi, props.libraryId, item, {
      ...context,
      contributionContext: pluginContributionContext,
    });
  };

  if (!activeContextMenu) return null;

  const ariaLabel =
    activeContextMenu.descriptor.type === "multi-asset"
      ? t("menu.batchAssetOps", {
          count: activeContextMenu.descriptor.assetIds.length,
        })
      : activeContextMenu.descriptor.type === "asset"
        ? t("menu.assetOps", {
            name: activeContextMenu.descriptor.displayName,
          })
        : activeContextMenu.descriptor.type === "organization"
          ? t("menu.collectionOps", {
              name: activeContextMenu.descriptor.name,
            })
          : activeContextMenu.descriptor.type === "folder"
            ? t("menu.folderOps", {
                name: activeContextMenu.descriptor.name,
              })
            : activeContextMenu.descriptor.type === "workspace"
              ? t("scope.workspace")
            : activeContextMenu.descriptor.type === "trash"
              ? t("scope.trash")
              : activeContextMenu.descriptor.type === "trashed-folder"
                ? t("menu.folderOps", {
                    name: activeContextMenu.descriptor.name,
                  })
                : t("menu.smartCollectionOps", {
                  name: activeContextMenu.descriptor.name,
                });

  return (
    <ContextMenuBackdrop>
      <ContextMenu
        ariaLabel={
          tagPicker
            ? tagPicker.mode === "assign"
              ? t("batch.assignTag")
              : t("batch.removeTag")
            : ariaLabel
        }
        position={activeContextMenu.position}
      >
        {tagPicker ? (
          <TagPickerMenu
            mode={tagPicker.mode}
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
        {activeContextMenu.descriptor.type === "workspace" && (() => {
          const desc = activeContextMenu.descriptor;
          if (desc.type !== "workspace") return null;
          const assetIds = desc.assetIds;
          return (
            <PluginMenuCommandsSection
              items={pluginWorkspaceMenuItems}
              label={t("contextMenu.pluginCommands")}
              onRun={(item) => runPluginCommand(
                item,
                assetIds === undefined || assetIds.length === 0
                  ? {}
                  : { assetIds: [...assetIds] },
              )}
            />
          );
        })()}
        {activeContextMenu.descriptor.type === "trash" && (
          <ContextMenuSection label={t("command.group.delete")}>
            <ContextMenuItem
              danger
              disabled={
                props.trashedAssetCount === 0 &&
                props.trashedFolderCount === 0
              }
              disabledReason={
                props.trashedAssetCount === 0 &&
                props.trashedFolderCount === 0
                  ? t("empty.trashTitle")
                  : undefined
              }
              icon={<Icon name="trash" size={14} />}
              label={t("toolbar.emptyTrash")}
              onAction={() => {
                if (confirm(t("toast.emptyTrashConfirm"))) {
                  props.onEmptyTrash();
                }
              }}
            />
          </ContextMenuSection>
        )}
        {activeContextMenu.descriptor.type === "trashed-folder" && (
          <ContextMenuSection label={t("command.group.trashActions")}>
            <ContextMenuItem
              icon={<Icon name="refresh" size={14} />}
              label={t("menu.restoreTrashedFolder")}
              onAction={() => {
                const desc = activeContextMenu.descriptor;
                if (desc.type !== "trashed-folder") return;
                props.onRestoreTrashedFolder(desc.tombstoneId, desc.name);
              }}
            />
          </ContextMenuSection>
        )}
        {activeContextMenu.descriptor.type === "smart-collection" && (() => {
          const desc = activeContextMenu.descriptor;
          if (desc.type !== "smart-collection") return null;
          // 0015-D: 静态项的标题/可见性由注册表 resolveMenu 求值；删除确认
          // （window.confirm）保留在命令的 run 内，danger 样式仍在 JSX 声明。
          const commandContext: SidebarCommandContext = {
            surface: "sidebar",
            locale,
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
              copyFolder: onCopyFolder,
              pasteIntoFolder: onPasteIntoFolder,
              cloneFolder: onCloneFolder,
              moveFolder: onMoveFolder,
              trashManagedFolder: onTrashManagedFolder,
              deleteFolderFromDisk: (folderId, name) =>
                onDeleteFolderFromDisk({
                  folderId,
                  name,
                  locationKind: "managed",
                }),
              removeLinkedFolder: onRemoveLinkedFolder,
              trashLinkedFolderSubtree: onTrashLinkedFolderSubtree,
              renameOrganization: onRenameOrganization,
              createSubcollection: onCreateSubcollection,
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
                  shortcut={renameItem.shortcutLabel ?? undefined}
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
                  shortcut={deleteItem.shortcutLabel ?? undefined}
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
            locale,
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
              copyFolder: onCopyFolder,
              pasteIntoFolder: onPasteIntoFolder,
              cloneFolder: onCloneFolder,
              moveFolder: onMoveFolder,
              trashManagedFolder: onTrashManagedFolder,
              deleteFolderFromDisk: (folderId, name) =>
                onDeleteFolderFromDisk({
                  folderId,
                  name,
                  locationKind: "managed",
                }),
              removeLinkedFolder: onRemoveLinkedFolder,
              trashLinkedFolderSubtree: onTrashLinkedFolderSubtree,
              renameOrganization: onRenameOrganization,
              createSubcollection: onCreateSubcollection,
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
          const createSubcollectionItem = resolvedById.get(
            "collection.create-subcollection",
          );
          const editDetailsItem = resolvedById.get("collection.edit-details");
          const deleteItem = resolvedById.get("collection.delete");
          return (
            <>
              {createSubcollectionItem && (
                <ContextMenuItem
                  icon={<Icon name="collection" size={14} />}
                  label={createSubcollectionItem.label}
                  shortcut={createSubcollectionItem.shortcutLabel ?? undefined}
                  onAction={() =>
                    runSidebarCommand("collection.create-subcollection")
                  }
                />
              )}
              {renameItem && (
                <ContextMenuItem
                  icon={<Icon name="collection" size={14} />}
                  label={renameItem.label}
                  shortcut={renameItem.shortcutLabel ?? undefined}
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
                  shortcut={deleteItem.shortcutLabel ?? undefined}
                  danger
                  onAction={() => runSidebarCommand("collection.delete")}
                />
              )}
              <PluginMenuCommandsSection
                items={pluginCollectionMenuItems}
                label={t("contextMenu.pluginCommands")}
                onRun={(item) => runPluginCommand(item, { collectionIds: [desc.id] })}
              />
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
          const isLinkedChild =
            desc.locationKind === "linked" &&
            desc.linkedRelativePath !== undefined;
          const linkedFolder =
            desc.locationKind === "linked"
              ? linkedFolders.find((folder) => folder.folderId === desc.folderId)
              : undefined;
          const commandContext: SidebarCommandContext = {
            surface: "sidebar",
            locale,
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
            isLinkedRoot: desc.locationKind === "linked" ? !isLinkedChild : undefined,
            linkedRelativePath: desc.linkedRelativePath,
            actions: {
              openFolderInFileManager: onOpenFolderInFileManager,
              createSubfolder: onCreateSubfolder,
              renameFolder: onRenameFolder,
              openLinkedRules: onOpenLinkedRules,
              copyFolderPath: onCopyFolderPath,
              copyFolder: onCopyFolder,
              pasteIntoFolder: onPasteIntoFolder,
              cloneFolder: onCloneFolder,
              moveFolder: onMoveFolder,
              trashManagedFolder: onTrashManagedFolder,
              deleteFolderFromDisk: (folderId, name) =>
                onDeleteFolderFromDisk({
                  folderId,
                  name,
                  locationKind: desc.locationKind,
                  linkedRelativePath: desc.linkedRelativePath,
                }),
              removeLinkedFolder: onRemoveLinkedFolder,
              trashLinkedFolderSubtree: onTrashLinkedFolderSubtree,
              renameOrganization: onRenameOrganization,
              createSubcollection: onCreateSubcollection,
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
          const copyItem = resolvedById.get("folder.copy");
          const pasteItem = resolvedById.get("folder.paste");
          const cloneItem = resolvedById.get("folder.clone");
          const trashItem = resolvedById.get("folder.move-to-trash");
          const deleteFromDiskItem = resolvedById.get(
            "folder.delete-from-disk",
          );
          const removeFromLibraryItem = resolvedById.get(
            "folder.remove-from-library",
          );
          return (
            <>
              <ContextMenuSection label={t("command.group.open")}>
                <PluginMenuItems
                  items={pluginItemsForHostGroup(pluginFolderMenuPlacement, "open", "before")}
                  onRun={(item) => runPluginCommand(item, { folderIds: [desc.folderId] })}
                />
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
                <PluginMenuItems
                  items={pluginItemsForHostGroup(pluginFolderMenuPlacement, "open", "after")}
                  onRun={(item) => runPluginCommand(item, { folderIds: [desc.folderId] })}
                />
              </ContextMenuSection>
              <ContextMenuSection label={t("command.group.folders")}>
                <PluginMenuItems
                  items={pluginItemsForHostGroup(pluginFolderMenuPlacement, "organize", "before")}
                  onRun={(item) => runPluginCommand(item, { folderIds: [desc.folderId] })}
                />
                {createSubfolderItem && (
                  <ContextMenuItem
                    icon={<Icon name="folder" size={14} />}
                    label={createSubfolderItem.label}
                    shortcut={createSubfolderItem.shortcutLabel ?? undefined}
                    onAction={() =>
                      runSidebarCommand("folder.create-subfolder")
                    }
                  />
                )}
                {renameItem && (
                  <>
                    <PluginMenuItems
                      items={pluginItemsAtHostAnchor(pluginFolderMenuPlacement, "folder.rename", "before")}
                      onRun={(item) => runPluginCommand(item, { folderIds: [desc.folderId] })}
                    />
                    <ContextMenuItem
                      icon={<Icon name="edit" size={14} />}
                      label={renameItem.label}
                      shortcut={renameItem.shortcutLabel ?? undefined}
                      onAction={() => runSidebarCommand("folder.rename")}
                    />
                    <PluginMenuItems
                      items={pluginItemsAtHostAnchor(pluginFolderMenuPlacement, "folder.rename", "after")}
                      onRun={(item) => runPluginCommand(item, { folderIds: [desc.folderId] })}
                    />
                  </>
                )}
                {linkedRulesItem && (
                  <ContextMenuItem
                    icon={<Icon name="link" size={14} />}
                    label={linkedRulesItem.label}
                    onAction={() => runSidebarCommand("folder.linked-rules")}
                  />
                )}
                {copyItem && (
                  <ContextMenuItem
                    icon={<Icon name="clipboard" size={14} />}
                    label={copyItem.label}
                    disabled={copyItem.disabled}
                    disabledReason={copyItem.disabledReason ?? undefined}
                    shortcut={copyItem.shortcutLabel ?? undefined}
                    onAction={() => runSidebarCommand("folder.copy")}
                  />
                )}
                {pasteItem && (
                  <ContextMenuItem
                    icon={<Icon name="clipboard" size={14} />}
                    label={pasteItem.label}
                    shortcut={pasteItem.shortcutLabel ?? undefined}
                    onAction={() => runSidebarCommand("folder.paste")}
                  />
                )}
                {cloneItem && (
                  <ContextMenuItem
                    icon={<Icon name="folder" size={14} />}
                    label={cloneItem.label}
                    onAction={() => runSidebarCommand("folder.clone")}
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
                <PluginMenuItems
                  items={pluginItemsForHostGroup(pluginFolderMenuPlacement, "organize", "after")}
                  onRun={(item) => runPluginCommand(item, { folderIds: [desc.folderId] })}
                />
                <ContextMenuItem
                  icon={<Icon name="close" size={14} />}
                  label={t("menu.ignoreFolder")}
                  onAction={() => {
                    const managed = desc.locationKind === "managed"
                      ? managedFolders.find((folder) => folder.folderId === desc.folderId)
                      : undefined;
                    onSetIgnore({
                      locationKind: desc.locationKind,
                      linkedFolderId: desc.locationKind === "linked" ? desc.folderId : null,
                      relativePath: desc.locationKind === "linked"
                        ? desc.linkedRelativePath ?? ""
                        : managed?.relativePath ?? desc.name,
                      pathKind: "folder",
                      ignored: true,
                      name: desc.name,
                    });
                  }}
                />
              </ContextMenuSection>
              {(trashItem
                || deleteFromDiskItem
                || removeFromLibraryItem
                || pluginItemsForHostGroup(pluginFolderMenuPlacement, "delete", "before").length > 0
                || pluginItemsForHostGroup(pluginFolderMenuPlacement, "delete", "after").length > 0) && (
                <ContextMenuSection label={t("command.group.delete")}>
                  <PluginMenuItems
                    items={pluginItemsForHostGroup(pluginFolderMenuPlacement, "delete", "before")}
                    onRun={(item) => runPluginCommand(item, { folderIds: [desc.folderId] })}
                  />
                  {trashItem && (
                    <ContextMenuItem
                      icon={<Icon name="trash" size={14} />}
                      label={trashItem.label}
                      shortcut={trashItem.shortcutLabel ?? undefined}
                      danger
                      disabled={trashItem.disabled}
                      disabledReason={trashItem.disabledReason ?? undefined}
                      onAction={() => runSidebarCommand("folder.move-to-trash")}
                    />
                  )}
                  {deleteFromDiskItem && (
                    <ContextMenuItem
                      icon={<Icon name="trash" size={14} />}
                      label={deleteFromDiskItem.label}
                      shortcut={deleteFromDiskItem.shortcutLabel ?? undefined}
                      danger
                      disabled={deleteFromDiskItem.disabled}
                      disabledReason={
                        deleteFromDiskItem.disabledReason ?? undefined
                      }
                      onAction={() =>
                        runSidebarCommand("folder.delete-from-disk")
                      }
                    />
                  )}
                  {removeFromLibraryItem && (
                    <ContextMenuItem
                      icon={<Icon name="trash" size={14} />}
                      label={removeFromLibraryItem.label}
                      danger
                      onAction={() =>
                        runSidebarCommand("folder.remove-from-library")
                      }
                    />
                  )}
                  <PluginMenuItems
                    items={pluginItemsForHostGroup(pluginFolderMenuPlacement, "delete", "after")}
                    onRun={(item) => runPluginCommand(item, { folderIds: [desc.folderId] })}
                  />
                </ContextMenuSection>
              )}
              <PluginMenuCommandsSection
                items={pluginItemsOutsideHostGroups(pluginFolderMenuPlacement)}
                label={t("contextMenu.pluginCommands")}
                onRun={(item) => runPluginCommand(item, { folderIds: [desc.folderId] })}
              />
            </>
          );
        })()}
        {activeContextMenu.descriptor.type === "multi-asset" &&
          (() => {
            const descriptor = activeContextMenu.descriptor;
            const targetAssetIds = [...descriptor.assetIds];
            const addToCollectionLabel = t("menu.addToCollectionCount", {
              count: targetAssetIds.length,
            });
            const targetFolderIds = [...(descriptor.folderIds ?? [])];
            const targetIdSet = new Set(targetAssetIds);
            const targetAssets = assets.filter((asset) =>
              targetIdSet.has(asset.assetId),
            );
            // REQ-MENU-004 / Serpent-koy: process/skip counts + reasons from a
            // pure module (folders join trash/disk-delete; move skips them).
            const skipReport = buildMultiAssetMenuSkipReport(
              targetAssetIds,
              targetAssets,
              targetFolderIds,
            );
            const managedAssetIds = [...skipReport.trash.processAssetIds];
            const availableManagedAssetIds = [
              ...skipReport.move.processAssetIds,
            ];
            const availableAssetIds = targetAssets
              .filter((asset) => asset.availability === "available")
              .map((asset) => asset.assetId);
            const processFolderIds = [...skipReport.trash.processFolderIds];
            const moveFolderIds = [...skipReport.move.processFolderIds];
            const allTrashed = skipReport.allTrashed;
            const canCreateImageSequence =
              targetAssets.length >= 3 &&
              targetAssets.length === targetAssetIds.length &&
              targetAssets.every(
                (asset) =>
                  asset.mediaType === "image" &&
                  asset.availability === "available" &&
                  !asset.sequence,
              );
            const sequenceIdsToDissolve = targetAssets
              .map((asset) => asset.sequence?.sequenceId)
              .filter((sequenceId): sequenceId is string => sequenceId !== undefined);
            const canDissolveImageSequences =
              targetAssets.length === targetAssetIds.length &&
              targetAssets.length > 0 &&
              sequenceIdsToDissolve.length === targetAssets.length;
            const skipFooter = formatMultiAssetMenuSkipFooter(
              skipReport,
              locale,
            );

            // 0015-C: 静态项的标题/快捷键/可见性/禁用原因由注册表 resolveMenu
            // 求值；此处把每次打开时算出的集合与 props 组装成
            // AssetMultiCommandContext。动态行（批量合集、外部目录）保持内联；
            // 跳过报告由 menu-skip-report 生成简洁页脚。
            const commandContext: AssetMultiCommandContext = {
              surface: "asset-multi",
              locale,
              platform: isMac ? "mac" : "windows",
              selectedAssetIds: targetAssetIds,
              primaryAssetId: null,
              assetScope: "multi",
              trashMode: allTrashed,
              selectionCount: skipReport.selectionCount,
              aiPendingAssetIds,
              managedCount: managedAssetIds.length,
              availableManagedCount: availableManagedAssetIds.length,
              linkedCount: skipReport.linkedCount,
              folderCount: moveFolderIds.length,
              processFolderIds: moveFolderIds,
              trashedAll: allTrashed,
              managedAssetIds,
              availableManagedAssetIds,
              availableAssetIds,
              pasteTargetFolderId,
              actions: {
                openAssignTagPicker: (assetIds) =>
                  setTagPicker({ mode: "assign", assetIds, single: false }),
                openRemoveTagPicker: (assetIds) =>
                  setTagPicker({ mode: "remove", assetIds, single: false }),
                copyFiles: onCopyAssetFiles,
                pasteIntoFolder: onPasteIntoFolder,
                moveToFolder: onMoveToFolder,
                moveToTrash: (assetIds, folderIds) =>
                  onTrash(assetIds, folderIds ?? processFolderIds),
                deleteFromDisk: (assetIds, folderIds) =>
                  onDeleteFromDisk(assetIds, folderIds ?? processFolderIds),
                restore: onRestore,
                deletePermanent: onPermanentDelete,
                clearSelection: onClearSelection,
                aiAnalyze: (assetIds) => {
                  const primary = assetIds[0];
                  if (!primary) return;
                  onAnalyze(primary, assetIds);
                },
                clearAiContent: onClearAiContent,
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
            const aiAnalyzeMissingItem = resolvedById.get("assets.ai-analyze-pending");
            const aiAnalyzeItem = resolvedById.get("assets.ai-analyze");
            const clearAiContentItem = resolvedById.get("assets.clear-ai-content");
            const moveToFolderItem = resolvedById.get("assets.move-to-folder");
            const copyItem = resolvedById.get("assets.copy");
            const pasteItem = resolvedById.get("assets.paste");
            const moveToTrashItem = resolvedById.get("assets.move-to-trash");
            const deleteFromDiskItem = resolvedById.get(
              "assets.delete-from-disk",
            );
            const clearSelectionItem = resolvedById.get(
              "assets.clear-selection",
            );
            const addableCollectionIds = memberIdsByCollection
              ? new Set(
                  collections
                    .filter(
                      (collection) =>
                        resolveCollectionMenuForSelection(
                          targetAssetIds,
                          collection.collectionId,
                          memberIdsByCollection,
                        ).showAdd,
                    )
                    .map((collection) => collection.collectionId),
                )
              : null;
            const removableCollectionIds = memberIdsByCollection
              ? new Set(
                  collections
                    .filter(
                      (collection) =>
                        resolveCollectionMenuForSelection(
                          targetAssetIds,
                          collection.collectionId,
                          memberIdsByCollection,
                        ).showRemove,
                    )
                    .map((collection) => collection.collectionId),
                )
              : null;

            return (
              <>
                <div className="context-menu-selection-summary">
                  {t("common.selectedCount", {
                    count: skipReport.selectionCount,
                  })}
                </div>
                {allTrashed ? (
                  <ContextMenuSection label={t("command.group.trashActions")}>
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
                {skipFooter && (
                  <div className="context-menu-scope-note" role="note">
                    {skipFooter}
                  </div>
                )}
            {(targetAssetIds.length > 0 &&
              (aiAnalyzeMissingItem || aiAnalyzeItem || clearAiContentItem)) && (
              <ContextMenuSection label={t("command.group.metadata")}>
                {aiAnalyzeMissingItem && (
                  <ContextMenuItem
                    icon={<Icon name="smart" size={14} />}
                    label={
                      !canAnalyze
                        ? `${aiAnalyzeMissingItem.label}${t("command.reason.aiDisconnectedSuffix")}`
                        : aiAnalyzeMissingItem.label
                    }
                    disabled={aiAnalyzeMissingItem.disabled || !canAnalyze}
                    disabledReason={
                      !canAnalyze
                        ? t("command.reason.aiSetupHint")
                        : (aiAnalyzeMissingItem.disabledReason ?? undefined)
                    }
                    onAction={() => runMultiCommand("assets.ai-analyze-pending")}
                  />
                )}
                {aiAnalyzeItem && (
                  <ContextMenuItem
                    icon={
                      <Icon
                        name={aiDisconnected ? "link-off" : "smart"}
                        size={14}
                      />
                    }
                    label={
                      !canAnalyze
                        ? `${aiAnalyzeItem.label}${t("command.reason.aiDisconnectedSuffix")}`
                        : aiAnalyzeItem.label
                    }
                    disabled={aiAnalyzeItem.disabled || !canAnalyze}
                    disabledReason={
                      !canAnalyze
                        ? t("command.reason.aiSetupHint")
                        : (aiAnalyzeItem.disabledReason ?? undefined)
                    }
                    onAction={() => runMultiCommand("assets.ai-analyze")}
                  />
                )}
                {clearAiContentItem && (
                  <ContextMenuItem
                    icon={<Icon name="close" size={14} />}
                    label={clearAiContentItem.label}
                    disabled={clearAiContentItem.disabled}
                    disabledReason={clearAiContentItem.disabledReason ?? undefined}
                    onAction={() => runMultiCommand("assets.clear-ai-content")}
                  />
                )}
              </ContextMenuSection>
            )}
            {pluginItemsOutsideHostGroups(pluginAssetMenuPlacement).length > 0 && (
              <PluginMenuCommandsSection
                items={pluginItemsOutsideHostGroups(pluginAssetMenuPlacement)}
                label={t("contextMenu.pluginCommands")}
                onRun={(item) => runPluginCommand(item, { assetIds: targetAssetIds })}
              />
            )}
            {targetAssetIds.length > 0 && (
            <ContextMenuSection label={t("command.group.organize")}>
              <ContextMenuItem
                icon={<Icon name="collection" size={14} />}
                label={t("menu.createImageSequence")}
                disabled={!canCreateImageSequence}
                onAction={() => props.onCreateImageSequence(targetAssetIds)}
              />
              {canDissolveImageSequences && (
                <ContextMenuItem
                  icon={<Icon name="close" size={14} />}
                  label={t("menu.dissolveImageSequencesCount", {
                    count: sequenceIdsToDissolve.length,
                  })}
                  onAction={() => props.onDissolveImageSequences(sequenceIdsToDissolve)}
                />
              )}
            {tags.length > 0 && assignTagItem && removeTagItem && (
              <ContextMenuSection label={t("command.group.batchTags")}>
                <TagPickerEntry
                  icon={<Icon name="tag" size={14} />}
                  label={assignTagItem.label}
                >
                  {() => (
                    <TagPickerMenu
                      mode="assign"
                      onPick={(tagId) => onBatchAssignTag(tagId, targetAssetIds)}
                      tags={tags}
                    />
                  )}
                </TagPickerEntry>
                <TagPickerEntry
                  icon={<Icon name="close" size={14} />}
                  label={removeTagItem.label}
                >
                  {() => (
                    <TagPickerMenu
                      mode="remove"
                      onPick={(tagId) => onBatchRemoveTag(tagId, targetAssetIds)}
                      tags={tags}
                    />
                  )}
                </TagPickerEntry>
              </ContextMenuSection>
            )}
            {collections.length > 0 && memberIdsByCollection && (
              <ContextMenuSection label={t("command.group.batchCollections")}>
                {addableCollectionIds && addableCollectionIds.size > 0 && (
                  <ContextMenuSubmenu
                    icon={<Icon name="collection" size={14} />}
                    label={addToCollectionLabel}
                  >
                    <CollectionPickerMenu
                      collections={collections}
                      excludedCollectionIds={new Set(
                        collections
                          .filter(
                            (collection) =>
                              !addableCollectionIds.has(collection.collectionId),
                          )
                          .map((collection) => collection.collectionId),
                      )}
                      onPick={(collectionId) =>
                        onBatchAddToCollection(collectionId, targetAssetIds)
                      }
                      title={addToCollectionLabel}
                    />
                  </ContextMenuSubmenu>
                )}
                {removableCollectionIds && removableCollectionIds.size > 0 && (
                  <ContextMenuSubmenu
                    icon={<Icon name="close" size={14} />}
                    label={t("menu.removeFromCollection")}
                  >
                    <CollectionPickerMenu
                      collections={collections}
                      excludedCollectionIds={new Set(
                        collections
                          .filter(
                            (collection) =>
                              !removableCollectionIds.has(collection.collectionId),
                          )
                          .map((collection) => collection.collectionId),
                      )}
                      onPick={(collectionId) =>
                        onBatchRemoveFromCollection(collectionId, targetAssetIds)
                      }
                      title={t("menu.removeFromCollection")}
                    />
                  </ContextMenuSubmenu>
                )}
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
              <ContextMenuItem
                icon={<Icon name="close" size={14} />}
                label={t("menu.ignore")}
                onAction={() => {
                  targetAssets.forEach((asset) => onSetIgnore({
                    locationKind: asset.locationKind,
                    linkedFolderId: asset.linkedFolderId ?? null,
                    relativePath: asset.relativeFilePath,
                    pathKind: "asset",
                    ignored: true,
                    name: asset.displayName,
                  }));
                  targetFolderIds.forEach((folderId) => {
                    const folder = managedFolders.find((item) => item.folderId === folderId);
                    if (folder) onSetIgnore({
                      locationKind: "managed",
                      linkedFolderId: null,
                      relativePath: folder.relativePath,
                      pathKind: "folder",
                      ignored: true,
                      name: folder.name,
                    });
                  });
                }}
              />
                  {copyItem && (
                    <ContextMenuItem
                      icon={<Icon name="clipboard" size={14} />}
                      label={copyItem.label}
                      shortcut={copyItem.shortcutLabel ?? undefined}
                      disabled={copyItem.disabled}
                      disabledReason={copyItem.disabledReason ?? undefined}
                      onAction={() => runMultiCommand("assets.copy")}
                    />
                  )}
                  {pasteItem && (
                    <ContextMenuItem
                      icon={<Icon name="clipboard" size={14} />}
                      label={pasteItem.label}
                      shortcut={pasteItem.shortcutLabel ?? undefined}
                      onAction={() => runMultiCommand("assets.paste")}
                    />
                  )}
              {linkedFolders
                .filter((f) => f.status === "available")
                .map((folder) => (
                  <ContextMenuItem
                    key={`batch-link-${folder.folderId}`}
                    icon={<Icon name="link" size={14} />}
                    label={t("menu.copyToExternal", {
                      name: folder.displayName,
                    })}
                    disabled={availableManagedAssetIds.length === 0}
                    disabledReason={t("command.reason.noCopyableManaged")}
                    onAction={() =>
                      onCopyToLinked(
                        folder,
                        availableManagedAssetIds,
                      )
                    }
                  />
                ))}
            </ContextMenuSection>
            )}
            <ContextMenuSection label={t("command.group.delete")}>
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
              {deleteFromDiskItem && (
                <ContextMenuItem
                  icon={<Icon name="trash" size={14} />}
                  label={deleteFromDiskItem.label}
                  shortcut={deleteFromDiskItem.shortcutLabel ?? undefined}
                  danger
                  disabled={deleteFromDiskItem.disabled}
                  disabledReason={
                    deleteFromDiskItem.disabledReason ?? undefined
                  }
                  onAction={() => runMultiCommand("assets.delete-from-disk")}
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
            const singleAsset = assets.find((asset) => asset.assetId === assetId);
            const resolvedPasteTarget =
              pasteTargetFolderId ??
              (singleManaged ? singleAsset?.managedFolderId ?? null : null);
            // 0015-B: 静态项的标题/快捷键/可见性/禁用原因由注册表 resolveMenu
            // 求值；此处把 descriptor 与 props 组装成 AssetCommandContext。
            // 动态行（外部目录、合集、标签）与汇总/提示块保持内联不变。
            const commandContext: AssetCommandContext = {
              surface: "asset-single",
              locale,
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
              pasteTargetFolderId: resolvedPasteTarget,
              actions: {
                view: onViewAsset,
                openExternal: onOpenExternal,
                revealInFolder: onRevealInFolder,
                copyFiles: onCopyAssetFiles,
                pasteIntoFolder: onPasteIntoFolder,
                copyFilePath: onCopyFilePath,
                rename: onRenameAssetFile,
                aiAnalyze: onAnalyze,
                clearAiContent: onClearAiContent,
                moveToTrash: onTrash,
                deleteFromDisk: onDeleteFromDisk,
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
            const viewItem = resolvedById.get("asset.view");
            const revealInFolderItem = resolvedById.get(
              "asset.reveal-in-folder",
            );
            const removeFromCurrentCollectionItem = resolvedById.get(
              "asset.remove-from-current-collection",
            );
            const relinkItem = resolvedById.get("asset.relink");
            const moveToFolderItem = resolvedById.get("asset.move-to-folder");
            const copyItem = resolvedById.get("asset.copy");
            const pasteItem = resolvedById.get("asset.paste");
            const copyFilePathItem = resolvedById.get("asset.copy-file-path");
            const renameItem = resolvedById.get("asset.rename");
            const aiAnalyzeItem = resolvedById.get("asset.ai-analyze");
            const clearAiContentItem = resolvedById.get("asset.clear-ai-content");
            const moveToTrashItem = resolvedById.get("asset.move-to-trash");
            const deleteFromDiskItem = resolvedById.get(
              "asset.delete-from-disk",
            );
            const deleteLinkedItem = resolvedById.get("asset.delete-linked");
            const addableCollectionIds = memberIdsByCollection
              ? new Set(
                  collections
                    .filter(
                      (collection) =>
                        resolveCollectionMenuForSelection(
                          [assetId],
                          collection.collectionId,
                          memberIdsByCollection,
                        ).showAdd,
                    )
                    .map((collection) => collection.collectionId),
                )
              : null;
            const removableCollectionIds = memberIdsByCollection
              ? new Set(
                  collections
                    .filter(
                      (collection) =>
                        resolveCollectionMenuForSelection(
                          [assetId],
                          collection.collectionId,
                          memberIdsByCollection,
                        ).showRemove,
                    )
                    .map((collection) => collection.collectionId),
                )
              : null;
            return (
              <>
                <div className="context-menu-selection-summary">
                  {t("common.selectedCount", { count: 1 })}
                </div>
                {isDeleted ? (
                  <ContextMenuSection label={t("command.group.trashActions")}>
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
                <ContextMenuSection label={t("command.group.open")}>
                  <PluginMenuItems
                    items={pluginItemsForHostGroup(pluginAssetMenuPlacement, "open", "before")}
                    onRun={(item) => runPluginCommand(item, { assetIds: [assetId] })}
                  />
                  {viewItem && (
                    <ContextMenuItem
                      icon={<Icon name="file" size={14} />}
                      label={viewItem.label}
                      shortcut={viewItem.shortcutLabel ?? undefined}
                      disabled={viewItem.disabled}
                      disabledReason={viewItem.disabledReason ?? undefined}
                      onAction={() => runAssetCommand("asset.view")}
                    />
                  )}
                  {singleAsset && (singleAsset.mediaType === "image" || singleAsset.mediaType === "video") && (
                    <ContextMenuSubmenu
                      icon={<Icon name="sliders" size={14} />}
                      label={t("menu.colorSpace")}
                    >
                      <ColorSpaceSubmenuItems
                        onPick={(colorSpace) =>
                          props.onSetAssetColorSpace(assetId, colorSpace)
                        }
                      />
                    </ContextMenuSubmenu>
                  )}
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
                      shortcut={revealInFolderItem.shortcutLabel ?? undefined}
                      disabled={revealInFolderItem.disabled}
                      disabledReason={
                        revealInFolderItem.disabledReason ?? undefined
                      }
                      onAction={() =>
                        runAssetCommand("asset.reveal-in-folder")
                      }
                    />
                  )}
                  <PluginMenuItems
                    items={pluginItemsForHostGroup(pluginAssetMenuPlacement, "open", "after")}
                    onRun={(item) => runPluginCommand(item, { assetIds: [assetId] })}
                  />
                </ContextMenuSection>
                {pluginItemsOutsideHostGroups(pluginAssetMenuPlacement).length > 0 && (
                  <PluginMenuCommandsSection
                    items={pluginItemsOutsideHostGroups(pluginAssetMenuPlacement)}
                    label={t("contextMenu.pluginCommands")}
                    onRun={(item) => runPluginCommand(item, { assetIds: [assetId] })}
                  />
                )}
                <ContextMenuSection label={t("command.group.organize")}>
                  <PluginMenuItems
                    items={pluginItemsForHostGroup(pluginAssetMenuPlacement, "organize", "before")}
                    onRun={(item) => runPluginCommand(item, { assetIds: [assetId] })}
                  />
                  {singleAsset?.sequence ? (
                    <ContextMenuItem
                      icon={<Icon name="sliders" size={14} />}
                      label={t("menu.setImageSequenceFps")}
                      onAction={() =>
                        props.onSetImageSequenceFps(
                          singleAsset.sequence!.sequenceId,
                          singleAsset.sequence!.frameCount,
                          singleAsset.sequence!.fps,
                        )
                      }
                    />
                  ) : null}
                  {singleAsset?.sequence ? (
                    <ContextMenuItem
                      icon={<Icon name="close" size={14} />}
                      label={t("menu.dissolveImageSequence")}
                      onAction={() =>
                        props.onDissolveImageSequence(
                          singleAsset.sequence!.sequenceId,
                        )
                      }
                    />
                  ) : null}
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
                  {copyItem && (
                    <ContextMenuItem
                      icon={<Icon name="clipboard" size={14} />}
                      label={copyItem.label}
                      shortcut={copyItem.shortcutLabel ?? undefined}
                      disabled={copyItem.disabled}
                      disabledReason={copyItem.disabledReason ?? undefined}
                      onAction={() => runAssetCommand("asset.copy")}
                    />
                  )}
                  {pasteItem && (
                    <ContextMenuItem
                      icon={<Icon name="clipboard" size={14} />}
                      label={pasteItem.label}
                      shortcut={pasteItem.shortcutLabel ?? undefined}
                      onAction={() => runAssetCommand("asset.paste")}
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
                    <>
                    <PluginMenuItems
                      items={pluginItemsAtHostAnchor(pluginAssetMenuPlacement, "asset.rename", "before")}
                      onRun={(item) => runPluginCommand(item, { assetIds: [assetId] })}
                    />
                    <ContextMenuItem
                      icon={<Icon name="edit" size={14} />}
                      label={renameItem.label}
                      shortcut={renameItem.shortcutLabel ?? undefined}
                      disabled={renameItem.disabled}
                      disabledReason={renameItem.disabledReason ?? undefined}
                      onAction={() => runAssetCommand("asset.rename")}
                    />
                    <PluginMenuItems
                      items={pluginItemsAtHostAnchor(pluginAssetMenuPlacement, "asset.rename", "after")}
                      onRun={(item) => runPluginCommand(item, { assetIds: [assetId] })}
                    />
                    </>
                  )}
                  <ContextMenuItem
                    icon={<Icon name="close" size={14} />}
                    label={t("menu.ignore")}
                    onAction={() => {
                      const relativePath = singleAsset?.relativeFilePath;
                      if (!relativePath) return;
                      onSetIgnore({
                        locationKind,
                        linkedFolderId: singleAsset?.locationKind === "linked"
                          ? singleAsset.linkedFolderId
                          : null,
                        relativePath,
                        pathKind: "asset",
                        ignored: true,
                        name: displayName,
                      });
                    }}
                  />
                  {singleAsset?.relativeFilePath?.includes(".") && (
                    <ContextMenuItem
                      icon={<Icon name="close" size={14} />}
                      label={t("menu.ignoreExtension", {
                        extension: singleAsset.relativeFilePath.split(".").pop()?.toLowerCase() ?? "",
                      })}
                      onAction={() => {
                        const extension = singleAsset.relativeFilePath.split(".").pop()?.toLowerCase();
                        if (!extension) return;
                        onSetIgnore({
                          locationKind,
                          linkedFolderId: singleAsset.locationKind === "linked" ? singleAsset.linkedFolderId : null,
                          relativePath: extension,
                          pathKind: "extension",
                          ignored: true,
                          name: extension,
                        });
                      }}
                    />
                  )}
                  {linkedFolders
                    .filter((f) => f.status === "available")
                    .map((folder) => (
                      <ContextMenuItem
                        key={`single-link-${folder.folderId}`}
                        icon={<Icon name="link" size={14} />}
                        label={t("menu.copyToExternal", {
                          name: folder.displayName,
                        })}
                        disabled={!singleManaged || !isAvailable}
                        disabledReason={t("command.reason.cannotCopyExternal")}
                        onAction={() =>
                          onCopyToLinked(folder, [assetId])
                        }
                      />
                    ))}
                  {addableCollectionIds && addableCollectionIds.size > 0 && (
                    <ContextMenuSubmenu
                      icon={<Icon name="collection" size={14} />}
                      label={t("menu.addToCollection")}
                    >
                      <CollectionPickerMenu
                        collections={collections}
                        excludedCollectionIds={new Set(
                          collections
                            .filter(
                              (collection) =>
                                !addableCollectionIds.has(collection.collectionId),
                            )
                            .map((collection) => collection.collectionId),
                        )}
                        onPick={(collectionId) =>
                          onAddToCollection(assetId, collectionId)
                        }
                        title={t("menu.addToCollection")}
                      />
                    </ContextMenuSubmenu>
                  )}
                  {removableCollectionIds && removableCollectionIds.size > 0 && (
                    <ContextMenuSubmenu
                      icon={<Icon name="close" size={14} />}
                      label={t("menu.removeFromCollection")}
                    >
                      <CollectionPickerMenu
                        collections={collections}
                        excludedCollectionIds={new Set(
                          collections
                            .filter(
                              (collection) =>
                                !removableCollectionIds.has(collection.collectionId),
                            )
                            .map((collection) => collection.collectionId),
                        )}
                        onPick={(collectionId) =>
                          onRemoveFromCollection(assetId, collectionId)
                        }
                        title={t("menu.removeFromCollection")}
                      />
                    </ContextMenuSubmenu>
                  )}
                  {tags.length > 0 && (
                    <TagPickerEntry
                      icon={<Icon name="tag" size={14} />}
                      label={t("command.asset.addTags")}
                    >
                      {() => (
                        <TagPickerMenu
                          mode="assign"
                          onPick={(tagId) => onAssignTag(assetId, tagId)}
                          tags={tags}
                        />
                      )}
                    </TagPickerEntry>
                  )}
                  <PluginMenuItems
                    items={pluginItemsForHostGroup(pluginAssetMenuPlacement, "organize", "after")}
                    onRun={(item) => runPluginCommand(item, { assetIds: [assetId] })}
                  />
                </ContextMenuSection>
                <ContextMenuSection label={t("command.group.metadata")}>
                  <PluginMenuItems
                    items={pluginItemsForHostGroup(pluginAssetMenuPlacement, "metadata", "before")}
                    onRun={(item) => runPluginCommand(item, { assetIds: [assetId] })}
                  />
                  {aiAnalyzeItem && (
                    <ContextMenuItem
                      icon={
                        <Icon
                          name={aiDisconnected ? "link-off" : "smart"}
                          size={14}
                        />
                      }
                      label={
                        !canAnalyze
                          ? `${aiAnalyzeItem.label}${t("command.reason.aiDisconnectedSuffix")}`
                          : aiAnalyzeItem.label
                      }
                      disabled={aiAnalyzeItem.disabled || !canAnalyze}
                      disabledReason={
                        !canAnalyze
                          ? t("command.reason.aiSetupHint")
                          : (aiAnalyzeItem.disabledReason ?? undefined)
                      }
                      onAction={() => runAssetCommand("asset.ai-analyze")}
                    />
                  )}
                  {clearAiContentItem && (
                    <ContextMenuItem
                      icon={<Icon name="close" size={14} />}
                      label={clearAiContentItem.label}
                      disabled={clearAiContentItem.disabled}
                      disabledReason={clearAiContentItem.disabledReason ?? undefined}
                      onAction={() => runAssetCommand("asset.clear-ai-content")}
                    />
                  )}
                  <PluginMenuItems
                    items={pluginItemsForHostGroup(pluginAssetMenuPlacement, "metadata", "after")}
                    onRun={(item) => runPluginCommand(item, { assetIds: [assetId] })}
                  />
                </ContextMenuSection>
                <ContextMenuSection label={t("command.group.delete")}>
                  <PluginMenuItems
                    items={pluginItemsForHostGroup(pluginAssetMenuPlacement, "delete", "before")}
                    onRun={(item) => runPluginCommand(item, { assetIds: [assetId] })}
                  />
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
                  {deleteFromDiskItem && (
                    <ContextMenuItem
                      icon={<Icon name="trash" size={14} />}
                      label={deleteFromDiskItem.label}
                      shortcut={deleteFromDiskItem.shortcutLabel ?? undefined}
                      danger
                      disabled={deleteFromDiskItem.disabled}
                      disabledReason={
                        deleteFromDiskItem.disabledReason ?? undefined
                      }
                      onAction={() =>
                        runAssetCommand("asset.delete-from-disk")
                      }
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
                  <PluginMenuItems
                    items={pluginItemsForHostGroup(pluginAssetMenuPlacement, "delete", "after")}
                    onRun={(item) => runPluginCommand(item, { assetIds: [assetId] })}
                  />
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
