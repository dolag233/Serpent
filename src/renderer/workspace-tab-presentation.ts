import type {
  AssetSummary,
  CollectionSummary,
  LinkedFolderSummary,
  ManagedFolderSummary,
  SmartCollectionSummary,
  TagSummary,
} from "../shared/asset-types";
import type { IconName } from "./Icons";
import type { TranslateFn } from "./i18n";
import type { PluginSidebarViewDescriptor } from "./plugin-sidebar-views";
import type { WorkspaceTabSession } from "./workspace-tabs";

export interface WorkspaceTabPresentation {
  id: string;
  title: string;
  icon: IconName;
  entity:
    | { kind: "folder"; id: string; name: string }
    | { kind: "collection"; id: string; name: string }
    | null;
}

export interface WorkspaceTabPresentationInput {
  folders: readonly ManagedFolderSummary[];
  linkedFolders: readonly LinkedFolderSummary[];
  collections: readonly CollectionSummary[];
  smartCollections: readonly SmartCollectionSummary[];
  tags: readonly TagSummary[];
  assets: readonly AssetSummary[];
  pluginViews: readonly PluginSidebarViewDescriptor[];
  t: TranslateFn;
}

/** Resolves labels from shared navigation data so inactive tabs stay meaningful. */
export function presentWorkspaceTab(
  tab: WorkspaceTabSession,
  input: WorkspaceTabPresentationInput,
): WorkspaceTabPresentation {
  const location = tab.history.current;
  switch (location.kind) {
    case "all":
      return { id: tab.id, title: input.t("scope.allAssets"), icon: "grid", entity: null };
    case "root":
      return { id: tab.id, title: input.t("scope.rootFolder"), icon: "folder", entity: null };
    case "folder": {
      const managed = input.folders.find((folder) => folder.folderId === location.folderId);
      const linked = input.linkedFolders.find((folder) => folder.folderId === location.folderId);
      const name = managed?.name ?? linked?.displayName ?? tab.cachedTitle ?? input.t("scope.workspace");
      return {
        id: tab.id,
        title: name,
        icon: linked ? "link" : "folder",
        entity: { kind: "folder", id: location.folderId, name },
      };
    }
    case "tag": {
      const name = input.tags.find((tag) => tag.tagId === location.tagId)?.name;
      return {
        id: tab.id,
        title: name ? input.t("scope.tagNamed", { name }) : (tab.cachedTitle ?? input.t("scope.tagFilter")),
        icon: "tag",
        entity: null,
      };
    }
    case "collection": {
      const name = input.collections.find(
        (collection) => collection.collectionId === location.collectionId,
      )?.name ?? tab.cachedTitle ?? input.t("scope.collectionView");
      return {
        id: tab.id,
        title: name,
        icon: "collection",
        entity: { kind: "collection", id: location.collectionId, name },
      };
    }
    case "smart-collection": {
      const name = input.smartCollections.find(
        (collection) => collection.collectionId === location.collectionId,
      )?.name ?? tab.cachedTitle ?? input.t("scope.smartCollections");
      return { id: tab.id, title: name, icon: "smart", entity: null };
    }
    case "trash":
      return { id: tab.id, title: input.t("scope.trash"), icon: "trash", entity: null };
    case "preview": {
      const name = input.assets.find((asset) => asset.assetId === location.assetId)?.displayName;
      return {
        id: tab.id,
        title: name ?? tab.cachedTitle ?? input.t("scope.workspace"),
        icon: "file",
        entity: null,
      };
    }
    case "tag-management":
      return { id: tab.id, title: input.t("scope.tagManagement"), icon: "tag", entity: null };
    case "plugin-sidebar": {
      const name = input.pluginViews.find((view) => view.id === location.viewId)?.title;
      return {
        id: tab.id,
        title: name ?? tab.cachedTitle ?? input.t("scope.workspace"),
        icon: "box",
        entity: null,
      };
    }
  }
}
