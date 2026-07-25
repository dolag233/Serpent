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
import { invertSelection } from "./invert-selection";
import {
  isEditableSelectionKeyboardTarget,
  matchSelectionKeyboardAction,
} from "./selection-keyboard";

export type UseSelectionKeyboardArgs = {
  readonly enabled: boolean;
  readonly platform: CommandPlatform;
  readonly previewOpen: boolean;
  /** Full browse-scope asset ids (Serpent-6w7n); used for select-all / invert. */
  readonly browseScopeAssetIds: readonly string[];
  readonly visibleAssetIds: readonly string[];
  readonly selectedAssetIds: readonly string[];
  readonly setSelectedAssetIds: Dispatch<SetStateAction<string[]>>;
  readonly setSelectedAssetId: Dispatch<SetStateAction<string | undefined>>;
  readonly selectionAnchorRef: MutableRefObject<string | null>;
  readonly clearAssetSelection: () => void;
};

export function useSelectionKeyboard(args: UseSelectionKeyboardArgs): void {
  const {
    enabled,
    platform,
    previewOpen,
    browseScopeAssetIds,
    visibleAssetIds,
    selectedAssetIds,
    setSelectedAssetIds,
    setSelectedAssetId,
    selectionAnchorRef,
    clearAssetSelection,
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
        setSelectedAssetIds([...browseScopeAssetIds]);
        setSelectedAssetId(browseScopeAssetIds.at(-1));
        selectionAnchorRef.current = browseScopeAssetIds[0] ?? null;
        return;
      }

      if (action === "invert") {
        if (browseScopeAssetIds.length === 0) return;
        event.preventDefault();
        const next = invertSelection(browseScopeAssetIds, selectedAssetIds);
        setSelectedAssetIds(next);
        setSelectedAssetId(next.at(-1));
        selectionAnchorRef.current = next[0] ?? null;
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
    setSelectedAssetIds,
    setSelectedAssetId,
    selectionAnchorRef,
    clearAssetSelection,
  ]);
}
