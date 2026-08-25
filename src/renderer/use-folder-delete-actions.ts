import { useCallback } from "react";

import type { SerpentLibraryApi } from "../shared/library-api";
import { LibraryOperationError, toMessage } from "./error-utils";
import { translateForLocale, type AppLocale } from "./i18n";
import {
  isBrowseScopeAffectedByFolderTrash,
  type FolderParentNode,
} from "./folder-trash-scope";
import { linkedRevealFolderId } from "../shared/linked-folder-tree";

export type FolderDiskDeleteTarget =
  | {
      kind: "managed";
      folderId: string;
      name: string;
    }
  | {
      /** Linked root or virtual child; relativePath="" means the root. */
      kind: "linked-child";
      folderId: string;
      linkedFolderId: string;
      relativePath: string;
      name: string;
    };

interface UseFolderDeleteActionsParams {
  api: SerpentLibraryApi | null;
  libraryId: string | null;
  locale: AppLocale;
  assetScope: string;
  folders: readonly FolderParentNode[];
  setNotice: (message: string, historyEntryId?: string) => void;
  setError: (message: string | null) => void;
  setUiState: (state: "loading" | "ready") => void;
  closePreview: () => Promise<void>;
  reloadCurrentContent: () => Promise<void>;
  /** Keep managed-folder navigation rows in sync after a successful mutation. */
  onManagedFoldersTrashed: (deletedFolderIds: readonly string[]) => void;
  /** Navigate away when the current browse scope was deleted. */
  onDeletedCurrentScope: (deletedFolderIds: readonly string[]) => void;
}

export function useFolderDeleteActions({
  api,
  libraryId,
  locale,
  assetScope,
  folders,
  setNotice,
  setError,
  setUiState,
  closePreview,
  reloadCurrentContent,
  onManagedFoldersTrashed,
  onDeletedCurrentScope,
}: UseFolderDeleteActionsParams) {
  const afterFolderMutation = useCallback(
    async (deletedFolderIds: readonly string[]) => {
      const linkedScopeAffected = deletedFolderIds.some((deletedId) => {
        if (assetScope === deletedId) return true;
        if (deletedId.startsWith("lfv:")) {
          return assetScope.startsWith(`${deletedId}/`);
        }
        return assetScope.startsWith(`lfv:${deletedId}/`);
      });
      if (
        linkedScopeAffected ||
        isBrowseScopeAffectedByFolderTrash(assetScope, deletedFolderIds, folders)
      ) {
        onDeletedCurrentScope(deletedFolderIds);
        return;
      }
      await reloadCurrentContent();
    },
    [assetScope, folders, onDeletedCurrentScope, reloadCurrentContent],
  );

  const trashManagedFolder = useCallback(
    async (folderId: string, name: string) => {
      if (!api || !libraryId) return;
      setUiState("loading");
      try {
        const result = await api.trashFolder({ libraryId, folderId });
        if (!result.ok) throw new LibraryOperationError(result.error);
        setNotice(
          translateForLocale(locale, "toast.folderTrashed", {
            name,
            count: result.value.trashedAssetCount,
          }),
          result.value.historyEntryId,
        );
        onManagedFoldersTrashed([folderId]);
        await afterFolderMutation([folderId]);
      } catch (caught) {
        setError(
          toMessage(
            caught,
            translateForLocale(locale, "toast.folderTrashFailed"),
            locale,
          ),
        );
      } finally {
        setUiState("ready");
      }
    },
    [
      api,
      libraryId,
      locale,
      setUiState,
      setNotice,
      setError,
      afterFolderMutation,
      onManagedFoldersTrashed,
    ],
  );

  const confirmDiskDelete = useCallback(
    async (target: FolderDiskDeleteTarget) => {
      if (!api || !libraryId) return;
      await closePreview();
      setUiState("loading");
      try {
        if (target.kind === "managed") {
          const result = await api.deleteFolderFromDisk({
            libraryId,
            folderId: target.folderId,
          });
          if (!result.ok) throw new LibraryOperationError(result.error);
          setNotice(
            translateForLocale(locale, "toast.folderDeletedFromDisk", {
              name: target.name,
              count: result.value.deletedAssetCount,
            }),
          );
          onManagedFoldersTrashed([target.folderId]);
          await afterFolderMutation([target.folderId]);
          return;
        }
        const result = await api.deleteLinkedFolderSubtree({
          libraryId,
          linkedFolderId: target.linkedFolderId,
          relativePath: target.relativePath,
          deleteFromDisk: true,
        });
        if (!result.ok) throw new LibraryOperationError(result.error);
        setNotice(
          translateForLocale(locale, "toast.linkedSubtreeDeletedFromDisk", {
            name: target.name,
            count: result.value.deletedAssetCount,
          }),
        );
        await afterFolderMutation([target.folderId]);
      } catch (caught) {
        setError(
          toMessage(
            caught,
            translateForLocale(locale, "toast.folderDeleteFromDiskFailed"),
            locale,
          ),
        );
      } finally {
        setUiState("ready");
      }
    },
    [
      api,
      libraryId,
      locale,
      setUiState,
      setNotice,
      setError,
      closePreview,
      afterFolderMutation,
      onManagedFoldersTrashed,
    ],
  );

  const openDiskDelete = useCallback(
    (target: FolderDiskDeleteTarget) => {
      void confirmDiskDelete(target);
    },
    [confirmDiskDelete],
  );

  const removeLinkedFolder = useCallback(
    async (folderId: string, name: string) => {
      if (!api || !libraryId) return;
      const confirmed = window.confirm(
        translateForLocale(locale, "command.folder.removeFromLibraryConfirm", {
          name,
        }),
      );
      if (!confirmed) return;
      setUiState("loading");
      try {
        const result = await api.removeLinkedFolder({ libraryId, folderId });
        if (!result.ok) throw new LibraryOperationError(result.error);
        setNotice(
          translateForLocale(locale, "toast.linkedFolderRemoved", {
            name,
            count: result.value.removedAssetCount,
          }),
        );
        await afterFolderMutation([folderId]);
      } catch (caught) {
        setError(
          toMessage(
            caught,
            translateForLocale(locale, "toast.linkedFolderRemoveFailed"),
            locale,
          ),
        );
      } finally {
        setUiState("ready");
      }
    },
    [
      api,
      libraryId,
      locale,
      setUiState,
      setNotice,
      setError,
      afterFolderMutation,
    ],
  );

  const trashLinkedFolderSubtree = useCallback(
    async (linkedFolderId: string, relativePath: string, name: string) => {
      if (!api || !libraryId) return;
      setUiState("loading");
      try {
        const result = await api.deleteLinkedFolderSubtree({
          libraryId,
          linkedFolderId,
          relativePath,
          deleteFromDisk: false,
        });
        if (!result.ok) throw new LibraryOperationError(result.error);
        setNotice(
          translateForLocale(locale, "toast.linkedSubtreeTrashed", {
            name,
            count: result.value.deletedAssetCount,
          }),
        );
        await afterFolderMutation([
          linkedRevealFolderId(linkedFolderId, relativePath),
        ]);
      } catch (caught) {
        setError(
          toMessage(
            caught,
            translateForLocale(locale, "toast.folderTrashFailed"),
            locale,
          ),
        );
      } finally {
        setUiState("ready");
      }
    },
    [
      api,
      libraryId,
      locale,
      setUiState,
      setNotice,
      setError,
      afterFolderMutation,
    ],
  );

  return {
    trashManagedFolder,
    openDiskDelete,
    removeLinkedFolder,
    trashLinkedFolderSubtree,
  };
}
