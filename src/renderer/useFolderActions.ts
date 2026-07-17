import { useCallback, useMemo, useState } from "react";

import type { ManagedFolderSummary } from "../shared/asset-types";
import type { SerpentLibraryApi } from "../shared/library-api";
import type { RendererLibrarySummary } from "../shared/protocol/responses";
import {
  LibraryOperationError,
  PUBLIC_ERROR_MESSAGES_ZH,
  toMessage,
} from "./error-utils";
import type { FolderRenameTarget } from "./FolderRenameDialog";

/**
 * REQ-MENU-005: state machine for the managed-folder dialogs (sidebar context
 * menu 新建子文件夹 / 重命名…). Extracted from App.tsx (acceptance rule 8),
 * mirroring useAssetRename: App only renders the dialogs and wires the menu
 * entries; the worker owns the real filesystem rename. This hook owns the
 * create-folder dialog's parent targeting, the rename dialog state, typed
 * error mapping through the shared PUBLIC_ERROR_MESSAGES_ZH table, and the
 * refresh convention after a successful operation.
 */

const FOLDER_RENAME_FALLBACK = "重命名失败，请重试。";

export interface UseFolderActionsParams {
  api: SerpentLibraryApi | null;
  library: RendererLibrarySummary | null;
  folders: ManagedFolderSummary[];
  /** Current folder scope, undefined when browsing 所有资产/根目录. */
  selectedFolderId: string | undefined;
  dialogValue: string;
  setDialogValue: (value: string) => void;
  setDialog: (
    dialog: "library" | "folder" | "tag" | "collection" | null,
  ) => void;
  setNotice: (message: string) => void;
  setError: (message: string | null) => void;
  setUiState: (state: "loading" | "ready") => void;
  reloadCurrentContent: () => Promise<void>;
}

export interface UseFolderActionsResult {
  /**
   * Marks the create-folder dialog as a subfolder flow; null is the sidebar
   * "+" flow (create under the selected folder). Every entry path sets it
   * explicitly, and dismiss paths clear it so a stale id can never leak into
   * a later dialog session.
   */
  folderDialogParentId: string | null;
  folderDialogParent: ManagedFolderSummary | undefined;
  folderRenameTarget: FolderRenameTarget | null;
  openFolderDialog: (parentFolderId: string | null) => void;
  dismissFolderDialogParent: () => void;
  openFolderRename: (target: FolderRenameTarget) => void;
  cancelFolderRename: () => void;
  createFolder: () => Promise<void>;
  /**
   * Returns null on success (the dialog closes) or the inline message the
   * dialog shows while staying open so the user can fix the name and retry.
   */
  renameFolder: (folderId: string, newName: string) => Promise<string | null>;
}

export function useFolderActions({
  api,
  library,
  folders,
  selectedFolderId,
  dialogValue,
  setDialogValue,
  setDialog,
  setNotice,
  setError,
  setUiState,
  reloadCurrentContent,
}: UseFolderActionsParams): UseFolderActionsResult {
  const [folderDialogParentId, setFolderDialogParentId] = useState<
    string | null
  >(null);
  const [folderRenameTarget, setFolderRenameTarget] =
    useState<FolderRenameTarget | null>(null);

  const folderDialogParent = useMemo(
    () =>
      folderDialogParentId
        ? folders.find((folder) => folder.folderId === folderDialogParentId)
        : undefined,
    [folders, folderDialogParentId],
  );

  // Single entry point for the create-folder dialog: null parentId is the
  // sidebar "+" flow (creates under the selected folder), a folderId is the
  // context-menu 新建子文件夹 flow targeting that folder.
  const openFolderDialog = useCallback(
    (parentFolderId: string | null) => {
      setFolderDialogParentId(parentFolderId);
      setDialogValue(parentFolderId ? "" : "新建文件夹");
      setDialog("folder");
    },
    [setDialog, setDialogValue],
  );

  const dismissFolderDialogParent = useCallback(() => {
    setFolderDialogParentId(null);
  }, []);

  const openFolderRename = useCallback((target: FolderRenameTarget) => {
    setFolderRenameTarget(target);
  }, []);

  const cancelFolderRename = useCallback(() => {
    setFolderRenameTarget(null);
  }, []);

  const createFolder = useCallback(async () => {
    if (!api || !library) return;
    setUiState("loading");
    try {
      const result = await api.createFolder({
        libraryId: library.libraryId,
        parentFolderId: folderDialogParentId ?? selectedFolderId,
        name: dialogValue.trim(),
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setDialog(null);
      setFolderDialogParentId(null);
      setNotice(`已创建文件夹"${result.value.name}"。`);
      await reloadCurrentContent();
    } catch (caught) {
      setError(toMessage(caught, "创建文件夹失败。"));
    } finally {
      setUiState("ready");
    }
  }, [
    api,
    library,
    folderDialogParentId,
    selectedFolderId,
    dialogValue,
    setDialog,
    setNotice,
    setError,
    setUiState,
    reloadCurrentContent,
  ]);

  const renameFolder = useCallback(
    async (folderId: string, newName: string): Promise<string | null> => {
      if (!api || !library) return FOLDER_RENAME_FALLBACK;
      try {
        const result = await api.renameFolder({
          libraryId: library.libraryId,
          folderId,
          newName,
        });
        if (!result.ok) {
          // Typed failures (invalid name, name conflict) surface inline so the
          // user can fix the name and retry; the dialog deliberately stays
          // open. The shared table is the single source for the wording.
          return (
            PUBLIC_ERROR_MESSAGES_ZH[result.error.code] ??
            FOLDER_RENAME_FALLBACK
          );
        }
        setFolderRenameTarget(null);
        setNotice(`已将文件夹重命名为“${result.value.name}”。`);
        // The folderId is unchanged, so the current selection survives the
        // refresh; no re-select is needed.
        await reloadCurrentContent();
        return null;
      } catch (caught) {
        return toMessage(caught, FOLDER_RENAME_FALLBACK);
      }
    },
    [api, library, setNotice, reloadCurrentContent],
  );

  return {
    folderDialogParentId,
    folderDialogParent,
    folderRenameTarget,
    openFolderDialog,
    dismissFolderDialogParent,
    openFolderRename,
    cancelFolderRename,
    createFolder,
    renameFolder,
  };
}
