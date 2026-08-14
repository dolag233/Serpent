/**
 * Document-level select-all / invert / Escape-clear for the browse canvas
 * (Serpent-5fq; Escape extract from App for Serpent-uye wave).
 *
 * Asset open/trash/rename chords live in useBrowseCommandKeyboard.
 * This hook only owns selection set mutations so Escape/metadata/restore
 * can keep splitting independently.
 *
 * Serpent-ws4k: select-all / invert cover the *whole* browse scope, not just
 * the loaded page, so they resolve the full id set on demand (idsOnly) through
 * the onSelectAll / onInvert callbacks. The dispatch logic itself lives in
 * `dispatchSelectionKeyboardAction` (pure, unit-tested); this hook only wires
 * the DOM listener.
 */

import { useEffect } from "react";

import type { CommandPlatform } from "./commands/command-types";
import {
  dispatchSelectionKeyboardAction,
  isEditableSelectionKeyboardTarget,
  matchSelectionKeyboardAction,
} from "./selection-keyboard";

export type UseSelectionKeyboardArgs = {
  readonly enabled: boolean;
  readonly platform: CommandPlatform;
  readonly previewOpen: boolean;
  /** Loaded browse-scope asset ids (Serpent-6w7n); gates select-all/invert on a non-empty scope. */
  readonly browseScopeAssetIds: readonly string[];
  readonly selectedAssetIds: readonly string[];
  readonly clearAssetSelection: () => void;
  /** Serpent-ws4k: async select-all covering the whole browse scope (idsOnly). */
  readonly onSelectAll?: () => void;
  /** Serpent-ws4k: async invert covering the whole browse scope (idsOnly). */
  readonly onInvert?: () => void;
};

export function useSelectionKeyboard(args: UseSelectionKeyboardArgs): void {
  const {
    enabled,
    platform,
    previewOpen,
    browseScopeAssetIds,
    selectedAssetIds,
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
      const consumed = dispatchSelectionKeyboardAction(action, {
        browseScopeEmpty: browseScopeAssetIds.length === 0,
        selectionEmpty: selectedAssetIds.length === 0,
        onSelectAll,
        onInvert,
        onClear: clearAssetSelection,
      });
      if (consumed) event.preventDefault();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [
    enabled,
    platform,
    previewOpen,
    browseScopeAssetIds,
    selectedAssetIds,
    clearAssetSelection,
    onSelectAll,
    onInvert,
  ]);
}
