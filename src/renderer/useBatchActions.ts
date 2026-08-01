import type { CollectionSummary, LinkedFolderSummary, TagSummary } from "../shared/asset-types";
import type { SerpentLibraryApi } from "../shared/library-api";
import type { RendererLibrarySummary } from "../shared/protocol/responses";
import { LibraryOperationError, toMessage } from "./error-utils";
import { formatBatchTagNotice } from "./batch-tag-notice";
import { translateForLocale, useLocale } from "./i18n";

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
  deleteManagedAssetsFromDisk: (assetIds: string[]) => Promise<void>;
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

  async function refreshCollections() {
    if (!api || !library) return;
    const result = await api.listCollections({ libraryId: library.libraryId });
    if (result.ok) setCollections(result.value);
  }

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
      setError(
        toMessage(
          caught,
          translateForLocale(locale, "toast.batchAssignTagFailed"),
          locale,
        ),
      );
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
      setError(
        toMessage(
          caught,
          translateForLocale(locale, "toast.batchRemoveTagFailed"),
          locale,
        ),
      );
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
      setNotice(
        translateForLocale(locale, "toast.batchAddToCollection", {
          count: assetIds.length,
        }),
      );
    } catch (caught) {
      setError(
        toMessage(
          caught,
          translateForLocale(locale, "toast.batchAddToCollectionFailed"),
          locale,
        ),
      );
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
        setError(translateForLocale(locale, "toast.batchRemoveNotDirect"));
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
          ? translateForLocale(locale, "toast.batchRemovePartial", {
              count: affectedAssetIds.length,
              skipped: skippedCount,
            })
          : translateForLocale(locale, "toast.batchRemoveDone", {
              count: affectedAssetIds.length,
            }),
      );
    } catch (caught) {
      setError(
        toMessage(
          caught,
          translateForLocale(locale, "toast.batchRemoveFailed"),
          locale,
        ),
      );
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
      setNotice(
        translateForLocale(locale, "toast.batchTrashed", {
          count: result.value.trashedCount,
        }),
      );
      await refreshCollections();
      clearAssetSelection();
      await reloadCurrentContent();
    } catch (caught) {
      setError(
        toMessage(
          caught,
          translateForLocale(locale, "toast.batchDeleteFailed"),
          locale,
        ),
      );
    } finally {
      setUiState("ready");
    }
  }

  async function deleteManagedAssetsFromDisk(assetIds: string[]) {
    if (!api || !library || assetIds.length === 0) return;
    setUiState("loading");
    try {
      const result = await api.deleteAssetsFromDisk({
        libraryId: library.libraryId,
        assetIds,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setNotice(
        translateForLocale(locale, "toast.assetsDeletedFromDisk", {
          count: result.value.deletedCount,
        }),
      );
      await refreshCollections();
      clearAssetSelection();
      await reloadCurrentContent();
    } catch (caught) {
      setError(
        toMessage(
          caught,
          translateForLocale(locale, "toast.assetsDeleteFromDiskFailed"),
          locale,
        ),
      );
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
        translateForLocale(locale, "toast.copyToExternalConfirm", {
          count: assetIds.length,
          name: folder.displayName,
        }),
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
        translateForLocale(locale, "toast.copyToExternalDone", {
          count: result.value.copiedCount,
          skipped: result.value.skippedCount,
        }),
      );
      await reloadCurrentContent();
    } catch (caught) {
      setError(
        toMessage(
          caught,
          translateForLocale(locale, "toast.copyToExternalFailed"),
          locale,
        ),
      );
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
    deleteManagedAssetsFromDisk,
    copyManagedSelectionToLinked,
  };
}
