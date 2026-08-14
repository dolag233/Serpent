/**
 * Document-level select-all / invert / Escape-clear for the browse canvas
 * (Serpent-5fq; Escape extract from App for Serpent-uye wave).
 *
 * Asset open/trash/rename chords live in useBrowseCommandKeyboard.
 * This hook only owns selection set mutations so Escape/metadata/restore
 * can keep splitting independently.
 */

import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import type { CommandPlatform } from "./commands/command-types";
import {
  isEditableSelectionKeyboardTarget,
  matchSelectionKeyboardAction,
} from "./selection-keyboard";

export type UseSelectionKeyboardArgs = {
  readonly enabled: boolean;
  readonly platform: CommandPlatform;
  readonly previewOpen: boolean;
  /** Loaded browse-scope asset ids (Serpent-6w7n); gates select-all/invert on a non-empty scope. */
  readonly browseScopeAssetIds: readonly string[];
  readonly visibleAssetIds: readonly string[];
  readonly selectedAssetIds: readonly string[];
  readonly setSelectedAssetId: Dispatch<SetStateAction<string | undefined>>;
  readonly selectionAnchorRef: MutableRefObject<string | null>;
  readonly setAssetSelectionAnchor: (assetId: string | null) => void;
  readonly clearAssetSelection: () => void;
  /**
   * Serpent-ws4k: select-all / invert cover the *whole* browse scope, not just
   * the loaded page, so they resolve the full id set on demand (idsOnly).
   */
  readonly onSelectAll?: () => void;
  readonly onInvert?: () => void;
};

export function useSelectionKeyboard(args: UseSelectionKeyboardArgs): void {
  const {
    enabled,
    platform,
    previewOpen,
    browseScopeAssetIds,
    visibleAssetIds,
    selectedAssetIds,
    setSelectedAssetId,
    selectionAnchorRef,
    setAssetSelectionAnchor,
    clearAssetSelection,
    onSelectAll,
    onInvert,
  } = args;

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableSelectionKeyboardTarget(event.target)) return;
      if (previewOpen) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;

      const action = matchSelectionKeyboardAction(event, platform);
      if (action === null) return;

      if (action === "select-all") {
        if (browseScopeAssetIds.length === 0) return;
        event.preventDefault();
        onSelectAll?.();
        return;
      }

      if (action === "invert") {
        if (browseScopeAssetIds.length === 0) return;
        event.preventDefault();
        onInvert?.();
        return;
      }

      // clear (Escape)
      if (selectedAssetIds.length === 0) return;
      event.preventDefault();
      clearAssetSelection();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [
    enabled,
    platform,
    previewOpen,
    browseScopeAssetIds,
    visibleAssetIds,
    selectedAssetIds,
    setSelectedAssetId,
    selectionAnchorRef,
    setAssetSelectionAnchor,
    clearAssetSelection,
    onSelectAll,
    onInvert,
  ]);
}
