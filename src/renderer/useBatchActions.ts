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
  setNotice: (msg: string, historyEntryId?: string) => void;
  setError: (msg: string | null) => void;
  reloadCurrentContent: () => Promise<void>;
  /**
   * Serpent-关联刷新: remove the deleted asset ids from the visible list and
   * adjust scope counts locally, deferring the expensive full reload to the
   * background. Deleting a linked asset used to wait for a whole searchAssets
   * round trip (~10s on large libraries) before the card disappeared.
   */
  applyLocalAssetRemoval: (
    assetIds: string[],
    options?: { removedCount?: number; libraryId?: string },
  ) => () => void;
  /** Prevent late read/UI callbacks from an old library crossing a switch. */
  isCurrentLibrary: (libraryId: string) => boolean;
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
  trashManagedAssets: (assetIds: string[]) => Promise<string | undefined>;
  trashLinkedAssets: (assetIds: string[]) => Promise<void>;
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
  applyLocalAssetRemoval,
  isCurrentLibrary,
  chooseTag,
  chooseCollection,
  clearAssetSelection,
  activeTagId,
  activeCollectionId,
}: UseBatchActionsParams): UseBatchActionsResult {
  const { locale } = useLocale();

  async function refreshCollections(libraryId?: string) {
    if (!api || !library) return;
    const targetLibraryId = libraryId ?? library.libraryId;
    const result = await api.listCollections({ libraryId: targetLibraryId });
    if (result.ok && isCurrentLibrary(targetLibraryId)) setCollections(result.value);
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
        result.value.historyEntryId,
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
      // Serpent-ws4k review: tag removals do not broadcast asset.changed, and
      // the tag-filter overlay keeps its filter after the removal — reload the
      // current content so a filtered scope empties immediately instead of
      // showing stale cards until the next navigation.
      await reloadCurrentContent();
      setNotice(
        formatBatchTagNotice(
          "remove",
          assetIds.length - result.value.skipped.length,
          result.value.skipped,
          locale,
        ),
        result.value.historyEntryId,
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
        result.value.historyEntryId,
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
        result.value.historyEntryId,
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

  const LINKED_DELETE_CHUNK = 20;

  async function trashLinkedAssets(assetIds: string[]) {
    if (!api || !library || assetIds.length === 0) return;
    const operationLibraryId = library.libraryId;
    setUiState("loading");
    try {
      let deletedCount = 0;
      let failedCount = 0;
      const failures: Array<{ reason: string }> = [];
      for (let offset = 0; offset < assetIds.length; offset += LINKED_DELETE_CHUNK) {
        const chunk = assetIds.slice(offset, offset + LINKED_DELETE_CHUNK);
        const result = await api.deleteLinkedAssets({
          libraryId: library.libraryId,
          assetIds: chunk,
          deleteSourceFile: true,
        });
        if (!result.ok) throw new LibraryOperationError(result.error);
        deletedCount += result.value.deletedCount;
        failedCount += result.value.failedCount;
        failures.push(...result.value.failures);
      }
      if (failedCount > 0) {
        const reasons = [
          ...new Set(
            failures.map(({ reason }) =>
              translateForLocale(locale, `error.reason.${reason}`),
            ),
          ),
        ];
        setError(
          translateForLocale(locale, "toast.deleteLinkedPartial", {
            deleted: deletedCount,
            failed: failedCount,
            reasons: reasons.join("；"),
          }),
        );
      } else {
        setError(null);
        setNotice(
          translateForLocale(locale, "toast.deleteLinkedWithTrash", {
            count: deletedCount,
          }),
        );
      }
      if (deletedCount > 0) {
        if (!isCurrentLibrary(operationLibraryId)) return;
        clearAssetSelection();
        await refreshCollections(operationLibraryId);
        if (!isCurrentLibrary(operationLibraryId)) return;
        applyLocalAssetRemoval(assetIds, {
          removedCount: deletedCount,
          libraryId: operationLibraryId,
        });
      }
    } catch (caught) {
      setError(
        toMessage(
          caught,
          translateForLocale(locale, "toast.deleteLinkedFailed"),
          locale,
        ),
      );
    } finally {
      setUiState("ready");
    }
  }

  async function trashManagedAssets(assetIds: string[]) {
    if (!api || !library) return undefined;
    const operationLibraryId = library.libraryId;
    // Serpent-a711e8: the Worker must still finish the durable trash/history
    // transaction before we report success, but the visible cards do not need
    // to wait for that round trip.  Remove them optimistically and reconcile
    // immediately if the mutation fails; otherwise large-library deletes can
    // leave the user staring at cards for several seconds.
    const optimisticallyRemoved = assetIds.length > 0;
    let restoreLocalRemoval: (() => void) | undefined;
    setUiState("loading");
    if (optimisticallyRemoved) {
      clearAssetSelection();
      restoreLocalRemoval = applyLocalAssetRemoval(assetIds, {
        libraryId: operationLibraryId,
      });
    }
    try {
      const result = await api.trashAssets({
        libraryId: library.libraryId,
        assetIds,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      if (!isCurrentLibrary(operationLibraryId)) {
        return result.value.historyEntryId;
      }
      setNotice(
        translateForLocale(locale, "toast.batchTrashed", {
          count: result.value.trashedCount,
        }),
        result.value.historyEntryId,
      );
      await refreshCollections(operationLibraryId);
      // A concurrent mutation can make the durable count smaller than the
      // optimistic selection.  Re-read the current scope in that uncommon
      // case instead of leaving an under-counted view until navigation.
      if (
        isCurrentLibrary(operationLibraryId) &&
        result.value.trashedCount !== assetIds.length
      ) {
        await reloadCurrentContent();
      }
      if (!isCurrentLibrary(operationLibraryId)) return result.value.historyEntryId;
      return result.value.historyEntryId;
    } catch (caught) {
      if (optimisticallyRemoved && isCurrentLibrary(operationLibraryId)) {
        // Restore cards/counts when the durable operation failed.  The
        // background reconcile scheduled by applyLocalAssetRemoval is safe to
        // leave in place and will converge the view once more.
        try {
          await reloadCurrentContent();
        } catch {
          // A failed reload must not leave the optimistic removal silently in
          // place. Restore the exact pre-delete snapshot and surface both
          // failures so the user knows the view is authoritative again.
          restoreLocalRemoval?.();
        }
      }
      if (isCurrentLibrary(operationLibraryId)) {
        setError(
          toMessage(
            caught,
            translateForLocale(locale, "toast.batchDeleteFailed"),
            locale,
          ),
        );
      }
      return undefined;
    } finally {
      if (isCurrentLibrary(operationLibraryId)) setUiState("ready");
    }
  }

  async function deleteManagedAssetsFromDisk(assetIds: string[]) {
    if (!api || !library || assetIds.length === 0) return;
    const operationLibraryId = library.libraryId;
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
      await refreshCollections(operationLibraryId);
      if (!isCurrentLibrary(operationLibraryId)) return;
      clearAssetSelection();
      applyLocalAssetRemoval(assetIds, {
        removedCount: result.value.deletedCount,
        libraryId: operationLibraryId,
      });
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
        folderId: folder.linkedFolderId ?? folder.folderId,
        ...(folder.relativePath ? { relativePath: folder.relativePath } : {}),
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
    trashLinkedAssets,
    deleteManagedAssetsFromDisk,
    copyManagedSelectionToLinked,
  };
}
