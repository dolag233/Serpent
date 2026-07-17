import type { CollectionSummary, LinkedFolderSummary, TagSummary } from "../shared/asset-types";
import type { SerpentLibraryApi } from "../shared/library-api";
import type { RendererLibrarySummary } from "../shared/protocol/responses";
import { LibraryOperationError, toMessage } from "./error-utils";
import { formatBatchTagNotice } from "./batch-tag-notice";
import { useLocale } from "./i18n";

export interface UseBatchActionsParams {
  api: SerpentLibraryApi | null;
  library: RendererLibrarySummary | null;
  setUiState: (state: "loading" | "importing" | "ready") => void;
  setTags: (tags: TagSummary[]) => void;
  setCollections: (collections: CollectionSummary[]) => void;
  setNotice: (msg: string) => void;
  setError: (msg: string | null) => void;
  reloadCurrentContent: () => Promise<void>;
  chooseTag: (tagId: string) => Promise<void>;
  chooseCollection: (collectionId: string, recursive?: boolean) => Promise<void>;
  clearAssetSelection: () => void;
  activeTagId: string | null;
  activeCollectionId: string | null;
}

export interface UseBatchActionsResult {
  batchAssignTagToSelection: (tagId: string, assetIds: string[]) => Promise<void>;
  batchRemoveTagFromSelection: (tagId: string, assetIds: string[]) => Promise<void>;
  batchAddSelectionToCollection: (collectionId: string, assetIds: string[]) => Promise<void>;
  batchRemoveSelectionFromCollection: (collectionId: string, assetIds: string[]) => Promise<void>;
  trashManagedAssets: (assetIds: string[]) => Promise<void>;
  copyManagedSelectionToLinked: (folder: LinkedFolderSummary, assetIds: string[]) => Promise<void>;
}

export function useBatchActions({
  api,
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
}: UseBatchActionsParams): UseBatchActionsResult {
  const { locale } = useLocale();

  async function batchAssignTagToSelection(tagId: string, assetIds: string[]) {
    if (!api || !library || assetIds.length === 0) return;
    setUiState("loading");
    try {
      const result = await api.assignTags({
        libraryId: library.libraryId,
        assetIds,
        tagIds: [tagId],
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      const tagResult = await api.listTags({ libraryId: library.libraryId });
      if (tagResult.ok) setTags(tagResult.value);
      setNotice(
        formatBatchTagNotice(
          "assign",
          assetIds.length - result.value.skipped.length,
          result.value.skipped,
          locale,
        ),
      );
    } catch (caught) {
      setError(toMessage(caught, "批量添加标签失败。", locale));
    } finally {
      setUiState("ready");
    }
  }

  async function batchRemoveTagFromSelection(tagId: string, assetIds: string[]) {
    if (!api || !library || assetIds.length === 0) return;
    setUiState("loading");
    try {
      const result = await api.removeTags({
        libraryId: library.libraryId,
        assetIds,
        tagIds: [tagId],
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      const tagResult = await api.listTags({ libraryId: library.libraryId });
      if (tagResult.ok) setTags(tagResult.value);
      if (activeTagId === tagId) {
        await chooseTag(tagId);
      }
      setNotice(
        formatBatchTagNotice(
          "remove",
          assetIds.length - result.value.skipped.length,
          result.value.skipped,
          locale,
        ),
      );
    } catch (caught) {
      setError(toMessage(caught, "批量移除标签失败。", locale));
    } finally {
      setUiState("ready");
    }
  }

  async function batchAddSelectionToCollection(collectionId: string, assetIds: string[]) {
    if (!api || !library || assetIds.length === 0) return;
    setUiState("loading");
    try {
      const result = await api.addCollectionAssets({
        libraryId: library.libraryId,
        collectionId,
        assetIds,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      const collectionResult = await api.listCollections({
        libraryId: library.libraryId,
      });
      if (collectionResult.ok) setCollections(collectionResult.value);
      setNotice(`已将 ${assetIds.length} 项资产加入合集。`);
    } catch (caught) {
      setError(toMessage(caught, "批量加入合集失败。"));
    } finally {
      setUiState("ready");
    }
  }

  async function batchRemoveSelectionFromCollection(collectionId: string, assetIds: string[]) {
    if (!api || !library || assetIds.length === 0) return;
    setUiState("loading");
    try {
      const directMembers = await api.listCollectionAssets({
        libraryId: library.libraryId,
        collectionId,
        recursive: false,
      });
      if (!directMembers.ok)
        throw new LibraryOperationError(directMembers.error);
      const directMemberIds = new Set(
        directMembers.value.map((asset) => asset.assetId),
      );
      const affectedAssetIds = assetIds.filter((assetId) =>
        directMemberIds.has(assetId),
      );
      if (affectedAssetIds.length === 0) {
        setError(
          "无需从目标合集移除：所选资产都不是该合集的直接成员。",
        );
        return;
      }
      const result = await api.removeCollectionAssets({
        libraryId: library.libraryId,
        collectionId,
        assetIds: affectedAssetIds,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      const collectionResult = await api.listCollections({
        libraryId: library.libraryId,
      });
      if (collectionResult.ok) setCollections(collectionResult.value);
      if (activeCollectionId === collectionId)
        await chooseCollection(collectionId);
      const skippedCount = assetIds.length - affectedAssetIds.length;
      setNotice(
        skippedCount > 0
          ? `已将 ${affectedAssetIds.length} 项直接成员移出合集；${skippedCount} 项不是该合集的直接成员，未改动。`
          : `已将 ${affectedAssetIds.length} 项资产移出合集。`,
      );
    } catch (caught) {
      setError(toMessage(caught, "批量移出合集失败。"));
    } finally {
      setUiState("ready");
    }
  }

  async function trashManagedAssets(assetIds: string[]) {
    if (!api || !library) return;
    setUiState("loading");
    try {
      const result = await api.trashAssets({
        libraryId: library.libraryId,
        assetIds,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setNotice(`${result.value.trashedCount} 项资产已移入回收站。`);
      clearAssetSelection();
      await reloadCurrentContent();
    } catch (caught) {
      setError(toMessage(caught, "删除失败。"));
    } finally {
      setUiState("ready");
    }
  }

  async function copyManagedSelectionToLinked(
    folder: LinkedFolderSummary,
    assetIds: string[],
  ) {
    if (!api || !library || assetIds.length === 0) return;
    if (
      !confirm(
        `将 ${assetIds.length} 项托管资产复制到外部目录"${folder.displayName}"？源托管文件不会移动。`,
      )
    )
      return;
    setUiState("importing");
    try {
      const result = await api.copyAssetsToLinkedFolder({
        libraryId: library.libraryId,
        folderId: folder.folderId,
        assetIds,
        conflictStrategy: "keep-both",
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setNotice(
        `已复制 ${result.value.copiedCount} 项到链接文件夹，跳过 ${result.value.skippedCount} 项。`,
      );
      await reloadCurrentContent();
    } catch (caught) {
      setError(toMessage(caught, "复制到链接文件夹失败。"));
    } finally {
      setUiState("ready");
    }
  }

  return {
    batchAssignTagToSelection,
    batchRemoveTagFromSelection,
    batchAddSelectionToCollection,
    batchRemoveSelectionFromCollection,
    trashManagedAssets,
    copyManagedSelectionToLinked,
  };
}
