/**
 * Browse-canvas command chords (Serpent-x78x / REQ-COMMAND-004).
 *
 * Asset actions from the command registry plus discovery toolbar (search
 * focus, F5 refresh). Selection mutations stay in useSelectionKeyboard.
 */

import { useEffect, type RefObject } from "react";

import type { AssetSummary } from "../shared/asset-types";
import {
  matchAssetActionKeyboardCommand,
  isEditableAssetActionKeyboardTarget,
} from "./asset-action-keyboard";
import type { CommandPlatform } from "./commands/command-types";
import { toolbarCommandRegistry } from "./commands/toolbar-commands";
import { matchesShortcut } from "./commands/command-types";
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
  readonly selectedManagedCount: number;
  readonly pasteDestinationFolderId: string | null | undefined;
  readonly diskDeleteAssetIds: readonly string[];
  readonly diskDeleteFolderIds: readonly string[];
  readonly searchInputRef: RefObject<HTMLInputElement | null>;
  readonly onOpenExternal: (assetId: string) => void;
  readonly onTrashManaged: (assetIds: string[]) => void;
  readonly onRename: (assetId: string) => void;
  readonly onCopyFiles: (assetIds: string[]) => void;
  readonly onCopyFilePath: (assetId: string) => void;
  readonly onPasteIntoFolder: (folderId: string | null) => void;
  readonly onRevealInFolder: (assetId: string) => void;
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
    selectedManagedCount,
    pasteDestinationFolderId,
    diskDeleteAssetIds,
    diskDeleteFolderIds,
    searchInputRef,
    onOpenExternal,
    onTrashManaged,
    onRename,
    onCopyFiles,
    onCopyFilePath,
    onPasteIntoFolder,
    onRevealInFolder,
    onDiskDelete,
    onPermanentDelete,
    onRemoveFromCurrentCollection,
    onRefreshDisk,
  } = args;

  useEffect(() => {
    if (!enabled) return;

    const refreshShortcut = toolbarCommandRegistry.get("canvas.refresh")
      ?.shortcut;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableAssetActionKeyboardTarget(event.target)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (previewOpen) return;

      if (
        matchFocusSearchShortcut(event, platform) &&
        libraryOpen &&
        !isLibrarySearchInput(event.target)
      ) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (
        refreshShortcut !== undefined &&
        matchesShortcut(refreshShortcut, event, platform) &&
        libraryOpen &&
        !busy
      ) {
        event.preventDefault();
        onRefreshDisk();
        return;
      }

      if (
        matchAssetActionKeyboardCommand("asset.paste", event, platform) &&
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
          "asset.reveal-in-folder",
          event,
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
        !showTrash &&
        activeCollectionId !== null &&
        matchAssetActionKeyboardCommand(
          "asset.move-to-trash",
          event,
          platform,
        ) &&
        selectedAssets.length > 0
      ) {
        event.preventDefault();
        onRemoveFromCurrentCollection(
          selectedAssets.map((asset) => asset.assetId),
        );
        return;
      }

      if (
        showTrash &&
        matchAssetActionKeyboardCommand(
          "asset.move-to-trash",
          event,
          platform,
        ) &&
        selectedAssets.length > 0
      ) {
        event.preventDefault();
        onPermanentDelete(selectedAssets.map((asset) => asset.assetId));
        return;
      }

      if (
        !showTrash &&
        matchAssetActionKeyboardCommand(
          "asset.delete-from-disk",
          event,
          platform,
        ) &&
        libraryOpen &&
        (diskDeleteAssetIds.length > 0 || diskDeleteFolderIds.length > 0)
      ) {
        event.preventDefault();
        onDiskDelete(diskDeleteAssetIds, diskDeleteFolderIds);
        return;
      }

      if (
        matchAssetActionKeyboardCommand(
          "asset.open-external",
          event,
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
        matchAssetActionKeyboardCommand("asset.copy", event, platform) &&
        !showTrash &&
        libraryOpen
      ) {
        const copyIds = selectedAssets
          .filter(
            (asset) =>
              asset.availability === "available" && !asset.deletedAt,
          )
          .map((asset) => asset.assetId);
        if (copyIds.length > 0) {
          event.preventDefault();
          onCopyFiles(copyIds);
          return;
        }
      }

      if (
        matchAssetActionKeyboardCommand("asset.copy-file-path", event, platform) &&
        !showTrash &&
        selectedAsset?.availability === "available" &&
        !selectedAsset.deletedAt
      ) {
        event.preventDefault();
        onCopyFilePath(selectedAsset.assetId);
        return;
      }

      if (
        matchAssetActionKeyboardCommand(
          "asset.move-to-trash",
          event,
          platform,
        ) &&
        !showTrash &&
        libraryOpen &&
        selectedManagedCount > 0
      ) {
        event.preventDefault();
        const managedIds = selectedAssets
          .filter((asset) => asset.locationKind === "managed")
          .map((asset) => asset.assetId);
        onTrashManaged(managedIds);
        return;
      }

      if (
        matchAssetActionKeyboardCommand("asset.rename", event, platform) &&
        selectedAsset?.availability === "available" &&
        !selectedAsset.deletedAt &&
        selectedAsset.locationKind === "managed"
      ) {
        event.preventDefault();
        onRename(selectedAsset.assetId);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
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
    selectedManagedCount,
    pasteDestinationFolderId,
    diskDeleteAssetIds,
    diskDeleteFolderIds,
    searchInputRef,
    onOpenExternal,
    onTrashManaged,
    onRename,
    onCopyFiles,
    onCopyFilePath,
    onPasteIntoFolder,
    onRevealInFolder,
    onDiskDelete,
    onPermanentDelete,
    onRemoveFromCurrentCollection,
    onRefreshDisk,
  ]);
}
