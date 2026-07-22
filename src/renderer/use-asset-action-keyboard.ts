/**
 * Document-level open-external / trash / rename chords for the browse canvas
 * (Serpent-uye wave: extract from App.tsx).
 *
 * Selection set mutations stay in useSelectionKeyboard; preview/dialog
 * navigation stays in App.
 */

import { useEffect } from "react";

import type { AssetSummary } from "../shared/asset-types";
import type { CommandPlatform } from "./commands/command-types";
import {
  isEditableAssetActionKeyboardTarget,
  matchAssetActionKeyboardCommand,
} from "./asset-action-keyboard";

export type UseAssetActionKeyboardArgs = {
  readonly enabled: boolean;
  readonly platform: CommandPlatform;
  readonly previewOpen: boolean;
  readonly showTrash: boolean;
  readonly libraryOpen: boolean;
  readonly selectedAsset: AssetSummary | undefined;
  readonly selectedAssets: readonly AssetSummary[];
  readonly selectedManagedCount: number;
  readonly onOpenExternal: (assetId: string) => void;
  readonly onTrashManaged: (assetIds: string[]) => void;
  readonly onRename: (assetId: string) => void;
  /** Serpent-166q: ⌘C / Ctrl+C copy available assets to the OS file clipboard. */
  readonly onCopyFiles: (assetIds: string[]) => void;
};

export function useAssetActionKeyboard(
  args: UseAssetActionKeyboardArgs,
): void {
  const {
    enabled,
    platform,
    previewOpen,
    showTrash,
    libraryOpen,
    selectedAsset,
    selectedAssets,
    selectedManagedCount,
    onOpenExternal,
    onTrashManaged,
    onRename,
    onCopyFiles,
  } = args;

  useEffect(() => {
    if (!enabled) return;

    const onSelectionKeyDown = (event: KeyboardEvent) => {
      if (isEditableAssetActionKeyboardTarget(event.target)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (previewOpen) return;

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

    document.addEventListener("keydown", onSelectionKeyDown);
    return () => document.removeEventListener("keydown", onSelectionKeyDown);
  }, [
    enabled,
    platform,
    previewOpen,
    showTrash,
    libraryOpen,
    selectedAsset,
    selectedAssets,
    selectedManagedCount,
    onOpenExternal,
    onTrashManaged,
    onRename,
    onCopyFiles,
  ]);
}
