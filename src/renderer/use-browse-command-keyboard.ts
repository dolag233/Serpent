/**
 * Browse-canvas command chords (Serpent-x78x / REQ-COMMAND-004).
 *
 * Asset actions from the command registry plus discovery toolbar (search
 * focus, F5 refresh). Selection mutations stay in useSelectionKeyboard.
 *
 * F2 / Delete apply to managed and linked assets alike (Serpent-g8u9). Linked
 * Delete sends source files to the OS recycle bin with no confirmation.
 */

import { useEffect, type RefObject } from "react";

import type { AssetSummary } from "../shared/asset-types";
import { clipboardSelectionIds } from './clipboard-selection';
import type { ShortcutEventLike } from "../shared/shortcut-resolution";
import { shouldForwardBrowseShortcut } from "../shared/browse-shortcut-dedupe";
import {
  canRenameAssetWithShortcut,
  planAssetDeleteShortcut,
} from "./browse-key-command";
import {
  matchAssetActionKeyboardCommand,
  isEditableAssetActionKeyboardTarget,
} from "./asset-action-keyboard";
import type { CommandPlatform } from "./commands/command-types";
import { listenForShortcutInputs, matchesRuntimeShortcut } from "./shortcut-runtime";
import {
  isLibrarySearchInput,
  matchFocusSearchShortcut,
} from "./workspace-discovery-shortcuts";

export type UseBrowseCommandKeyboardArgs = {
  readonly enabled: boolean;
  readonly platform: CommandPlatform;
  readonly previewOpen: boolean;
  readonly showTrash: boolean;
  readonly activeCollectionId: string | null;
  readonly libraryOpen: boolean;
  readonly busy: boolean;
  readonly selectedAsset: AssetSummary | undefined;
  readonly selectedAssets: readonly AssetSummary[];
  readonly selectedAssetIds?: readonly string[];
  readonly selectedFolderIds?: readonly string[];
  readonly pasteDestinationFolderId: string | null | undefined;
  readonly diskDeleteAssetIds: readonly string[];
  readonly diskDeleteFolderIds: readonly string[];
  readonly searchInputRef: RefObject<HTMLInputElement | null>;
  readonly onOpenExternal: (assetId: string) => void;
  readonly onTrashManaged: (assetIds: string[]) => void;
  readonly onRename: (assetId: string) => void;
  readonly onCutFiles?: (assetIds: string[], folderIds?: string[]) => void;
  readonly onCopyFiles: (assetIds: string[]) => void;
  readonly onCopyFilePath: (assetId: string) => void;
  readonly onPasteIntoFolder: (folderId: string | null) => void;
  readonly onRevealInFolder: (assetId: string) => void;
  readonly onShowInLibraryFolder: (assetId: string) => void;
  readonly onDiskDelete: (
    assetIds: readonly string[],
    folderIds: readonly string[],
  ) => void;
  readonly onPermanentDelete: (assetIds: readonly string[]) => void;
  readonly onRemoveFromCurrentCollection: (assetIds: readonly string[]) => void;
  readonly onRefreshDisk: () => void;
};

export function useBrowseCommandKeyboard(
  args: UseBrowseCommandKeyboardArgs,
): void {
  const {
    enabled,
    platform,
    previewOpen,
    showTrash,
    activeCollectionId,
    libraryOpen,
    busy,
    selectedAsset,
    selectedAssets,
    selectedAssetIds,
    selectedFolderIds,
    pasteDestinationFolderId,
    diskDeleteAssetIds,
    diskDeleteFolderIds,
    searchInputRef,
    onOpenExternal,
    onTrashManaged,
    onRename,
    onCopyFiles,
    onCutFiles,
    onCopyFilePath,
    onPasteIntoFolder,
    onRevealInFolder,
    onShowInLibraryFolder,
    onDiskDelete,
    onPermanentDelete,
    onRemoveFromCurrentCollection,
    onRefreshDisk,
  } = args;

  useEffect(() => {
    if (!enabled) return;

    const onShortcutInput = (shortcutInput: ShortcutEventLike, event: KeyboardEvent | MouseEvent) => {
      if (isEditableAssetActionKeyboardTarget(event.target)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (previewOpen) {
        const viewed = selectedAsset;
        if (!viewed || viewed.deletedAt) return;
        if (
          matchAssetActionKeyboardCommand("asset.copy-file-path", shortcutInput, platform) &&
          !showTrash &&
          viewed.availability === "available"
        ) {
          event.preventDefault();
          onCopyFilePath(viewed.assetId);
          return;
        }
        const bareDelete = shortcutInput.kind !== "mouse"
          && (shortcutInput.key === "Delete" || shortcutInput.key === "Backspace")
          && !event.metaKey
          && !event.ctrlKey
          && !event.altKey;
        const diskDelete = (bareDelete && event.shiftKey)
          || matchAssetActionKeyboardCommand("asset.delete-from-disk", shortcutInput, platform);
        const trashDelete = (bareDelete && !event.shiftKey)
          || matchAssetActionKeyboardCommand("asset.move-to-trash", shortcutInput, platform);
        if (diskDelete && !showTrash && libraryOpen) {
          if (!shouldForwardBrowseShortcut("disk-delete")) return;
          event.preventDefault();
          onDiskDelete([viewed.assetId], []);
          return;
        }
        if (trashDelete) {
          const plan = planAssetDeleteShortcut({
            showTrash,
            activeCollectionId,
            libraryOpen,
            selectedAssets: [viewed],
          });
          if (plan.type === "none" || plan.type === "trash-linked") return;
          if (!shouldForwardBrowseShortcut("trash")) return;
          event.preventDefault();
          if (plan.type === "permanent-delete") {
            onPermanentDelete([...plan.assetIds]);
            return;
          }
          if (plan.type === "remove-from-collection") {
            onRemoveFromCurrentCollection([...plan.assetIds]);
            return;
          }
          if (plan.type === "trash-managed") onTrashManaged([...plan.assetIds]);
        }
        return;
      }

      // Sidebar rows own their folder/collection shortcuts while focused.
      if (document.activeElement?.closest(".nav-tree-row")) {
        return;
      }

      if (
        matchFocusSearchShortcut(shortcutInput, platform) &&
        libraryOpen &&
        !isLibrarySearchInput(event.target)
      ) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (
        matchesRuntimeShortcut("canvas.refresh", shortcutInput, platform) === true &&
        libraryOpen &&
        !busy
      ) {
        event.preventDefault();
        onRefreshDisk();
        return;
      }

      if (
        matchAssetActionKeyboardCommand("asset.paste", shortcutInput, platform) &&
        !showTrash &&
        libraryOpen &&
        !busy &&
        pasteDestinationFolderId !== undefined
      ) {
        event.preventDefault();
        onPasteIntoFolder(pasteDestinationFolderId);
        return;
      }

      if (
        matchAssetActionKeyboardCommand(
          "asset.show-in-library-folder",
          shortcutInput,
          platform,
        ) &&
        !showTrash &&
        selectedAsset &&
        !selectedAsset.deletedAt
      ) {
        event.preventDefault();
        onShowInLibraryFolder(selectedAsset.assetId);
        return;
      }

      if (
        matchAssetActionKeyboardCommand(
          "asset.reveal-in-folder",
          shortcutInput,
          platform,
        ) &&
        !showTrash &&
        selectedAsset?.availability === "available" &&
        !selectedAsset.deletedAt
      ) {
        event.preventDefault();
        onRevealInFolder(selectedAsset.assetId);
        return;
      }

      if (
        matchAssetActionKeyboardCommand(
          "asset.delete-from-disk",
          shortcutInput,
          platform,
        ) &&
        !showTrash &&
        libraryOpen &&
        (diskDeleteAssetIds.length > 0 || diskDeleteFolderIds.length > 0)
      ) {
        if (!shouldForwardBrowseShortcut("disk-delete")) return;
        event.preventDefault();
        onDiskDelete(diskDeleteAssetIds, diskDeleteFolderIds);
        return;
      }

      if (
        matchAssetActionKeyboardCommand(
          "asset.move-to-trash",
          shortcutInput,
          platform,
        )
      ) {
        const plan = planAssetDeleteShortcut({
          showTrash,
          activeCollectionId,
          libraryOpen,
          selectedAssets,
        });
        if (plan.type !== "none") {
          if (!shouldForwardBrowseShortcut("trash")) return;
          event.preventDefault();
          if (plan.type === "permanent-delete") {
            onPermanentDelete([...plan.assetIds]);
            return;
          }
          if (plan.type === "remove-from-collection") {
            onRemoveFromCurrentCollection([...plan.assetIds]);
            return;
          }
          if (plan.type === "trash-managed") {
            onTrashManaged([...plan.assetIds]);
            return;
          }
          // 2026-09-15 用户决定：链接资产没有「移入回收站」——普通 Delete 对链接
          // 资产不再有任何动作（唯一的删除动作是 Shift+Delete 的强制从硬盘删除）。
          return;
        }
      }

      if (
        matchAssetActionKeyboardCommand(
          "asset.open-external",
          shortcutInput,
          platform,
        ) &&
        selectedAsset?.availability === "available" &&
        !selectedAsset.deletedAt
      ) {
        event.preventDefault();
        onOpenExternal(selectedAsset.assetId);
        return;
      }

      if (
        (matchAssetActionKeyboardCommand("asset.copy", shortcutInput, platform) || (onCutFiles && matchAssetActionKeyboardCommand("asset.cut", shortcutInput, platform))) &&
        !showTrash &&
        libraryOpen
      ) {
        const copyIds = clipboardSelectionIds(selectedAssetIds ?? selectedAssets.map(asset => asset.assetId), selectedAssets);
        if (copyIds.length > 0 || (onCutFiles && selectedFolderIds?.length && matchAssetActionKeyboardCommand("asset.cut", shortcutInput, platform))) {
          event.preventDefault();
          if (matchAssetActionKeyboardCommand('asset.cut', shortcutInput, platform)) onCutFiles?.(copyIds, [...(selectedFolderIds ?? [])]);
          else onCopyFiles(copyIds);
          return;
        }
      }

      if (
        matchAssetActionKeyboardCommand("asset.copy-file-path", shortcutInput, platform) &&
        !showTrash &&
        selectedAsset?.availability === "available" &&
        !selectedAsset.deletedAt
      ) {
        event.preventDefault();
        onCopyFilePath(selectedAsset.assetId);
        return;
      }

      if (
        matchAssetActionKeyboardCommand("asset.rename", shortcutInput, platform) &&
        canRenameAssetWithShortcut(selectedAsset)
      ) {
        if (!shouldForwardBrowseShortcut("rename")) return;
        event.preventDefault();
        onRename(selectedAsset.assetId);
      }
    };

    return listenForShortcutInputs(document, onShortcutInput, platform === "windows");
  }, [
    enabled,
    platform,
    previewOpen,
    showTrash,
    activeCollectionId,
    libraryOpen,
    busy,
    selectedAsset,
    selectedAssets,
    selectedAssetIds,
    selectedFolderIds,
    pasteDestinationFolderId,
    diskDeleteAssetIds,
    diskDeleteFolderIds,
    searchInputRef,
    onOpenExternal,
    onTrashManaged,
    onRename,
    onCopyFiles,
    onCutFiles,
    onCopyFilePath,
    onPasteIntoFolder,
    onRevealInFolder,
    onShowInLibraryFolder,
    onDiskDelete,
    onPermanentDelete,
    onRemoveFromCurrentCollection,
    onRefreshDisk,
  ]);
}
