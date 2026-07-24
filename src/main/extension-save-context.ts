import type { ActiveContext } from "../shared/protocol/requests";

export type ExtensionSaveContext = {
  readonly libraryId: string;
  readonly selectedFolderId?: string;
};

/**
 * Picks which library/folder the browser extension should target.
 *
 * Focused-window routing matches multi-window expectations while Serpent is
 * frontmost. When the user saves from a browser tab, no Electron window is
 * focused — fall back to the last Serpent window that published context.
 */
export function resolveExtensionSaveContext(input: {
  readonly focusedWindowId: number | null;
  readonly contexts: ReadonlyMap<number, ActiveContext>;
  readonly lastTargetWindowId: number | null;
  readonly mainWindowId: number | null;
}): ExtensionSaveContext | null {
  const pick = (
    windowId: number | null | undefined,
  ): ExtensionSaveContext | null => {
    if (windowId == null) return null;
    const context = input.contexts.get(windowId);
    if (!context?.libraryId) return null;
    return {
      libraryId: context.libraryId,
      selectedFolderId: context.selectedFolderId,
    };
  };

  const focused = pick(input.focusedWindowId);
  if (focused) return focused;

  const lastTarget = pick(input.lastTargetWindowId);
  if (lastTarget) return lastTarget;

  return pick(input.mainWindowId);
}
