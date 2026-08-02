import { useCallback, useState } from "react";

import type { SerpentLibraryApi } from "../shared/library-api";
import { LibraryOperationError, toMessage } from "./error-utils";
import { translateForLocale, type AppLocale } from "./i18n";
import {
  isDiskDeletePromptEnabled,
  setDiskDeletePromptEnabled,
} from "./disk-delete-confirm-preferences";
import {
  isBrowseScopeAffectedByFolderTrash,
  type FolderParentNode,
} from "./folder-trash-scope";

export type FolderDiskDeleteTarget =
  | {
      kind: "managed";
      folderId: string;
      name: string;
    }
  | {
      kind: "linked-child";
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
  setNotice: (message: string) => void;
  setError: (message: string | null) => void;
  setUiState: (state: "loading" | "ready") => void;
  closePreview: () => Promise<void>;
  reloadCurrentContent: () => Promise<void>;
  /** Navigate away when the current browse scope was deleted. */
  onDeletedCurrentScope: () => void;
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
  onDeletedCurrentScope,
}: UseFolderDeleteActionsParams) {
  const [diskDeleteTarget, setDiskDeleteTarget] =
    useState<FolderDiskDeleteTarget | null>(null);

  const afterFolderMutation = useCallback(
    async (deletedFolderIds: readonly string[]) => {
      if (
        isBrowseScopeAffectedByFolderTrash(assetScope, deletedFolderIds, folders)
      ) {
        onDeletedCurrentScope();
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
        );
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
    ],
  );

  const confirmDiskDelete = useCallback(
    async (target: FolderDiskDeleteTarget, dontShowAgain: boolean) => {
      if (!api || !libraryId) return;
      if (dontShowAgain) setDiskDeletePromptEnabled(false);
      setDiskDeleteTarget(null);
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
        await afterFolderMutation([]);
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
    ],
  );

  const openDiskDelete = useCallback(
    (target: FolderDiskDeleteTarget) => {
      if (!isDiskDeletePromptEnabled()) {
        void confirmDiskDelete(target, false);
        return;
      }
      setDiskDeleteTarget(target);
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
        await afterFolderMutation([]);
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
    diskDeleteTarget,
    cancelDiskDelete: () => setDiskDeleteTarget(null),
    confirmDiskDelete: (dontShowAgain: boolean) => {
      if (!diskDeleteTarget) return;
      void confirmDiskDelete(diskDeleteTarget, dontShowAgain);
    },
    trashManagedFolder,
    openDiskDelete,
    removeLinkedFolder,
    trashLinkedFolderSubtree,
  };
}
