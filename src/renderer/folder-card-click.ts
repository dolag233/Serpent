/**
 * Pure folder-card click intent (Serpent-829 / FOLDER-010).
 *
 * Plain click selects; Cmd/Ctrl toggles; Shift extends a range. Entering a
 * folder is a separate double-click gesture handled by the caller.
 */

export type FolderCardClickModifiers = {
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
};

export type FolderCardClickIntent =
  | { readonly kind: "ignore" }
  | {
      readonly kind: "replace";
      readonly folderIds: readonly string[];
      readonly anchorId: string;
      /** Plain / Shift-replace clears asset selection so the card reads as the focus. */
      readonly clearAssets: true;
    }
  | {
      readonly kind: "toggle";
      readonly folderId: string;
      readonly anchorId: string;
      readonly clearAssets: false;
    }
  | {
      readonly kind: "additive-range";
      readonly folderIds: readonly string[];
      readonly clearAssets: false;
    };

export function resolveFolderCardClickIntent(options: {
  readonly folderId: string;
  readonly folderIds: readonly string[];
  readonly anchorId: string | null;
  readonly modifiers: FolderCardClickModifiers;
  /** Non-zero means a non-left button started the gesture (suppress click). */
  readonly mouseButton: number;
}): FolderCardClickIntent {
  if (options.mouseButton !== 0) {
    return { kind: "ignore" };
  }

  const { folderId, folderIds, anchorId, modifiers } = options;
  const additive = modifiers.metaKey || modifiers.ctrlKey;

  if (modifiers.shiftKey && anchorId) {
    const anchorIndex = folderIds.indexOf(anchorId);
    const targetIndex = folderIds.indexOf(folderId);
    if (anchorIndex >= 0 && targetIndex >= 0) {
      const range = folderIds.slice(
        Math.min(anchorIndex, targetIndex),
        Math.max(anchorIndex, targetIndex) + 1,
      );
      if (additive) {
        return { kind: "additive-range", folderIds: range, clearAssets: false };
      }
      return {
        kind: "replace",
        folderIds: range,
        anchorId,
        clearAssets: true,
      };
    }
  }

  if (additive) {
    return {
      kind: "toggle",
      folderId,
      anchorId: folderId,
      clearAssets: false,
    };
  }

  return {
    kind: "replace",
    folderIds: [folderId],
    anchorId: folderId,
    clearAssets: true,
  };
}
