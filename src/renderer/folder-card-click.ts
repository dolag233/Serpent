import type { SelectionPlatform } from "./selection-modifiers";
import { isToggleSelectionModifier } from "./selection-modifiers";

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
    };

export function resolveFolderCardClickIntent(options: {
  readonly folderId: string;
  readonly folderIds: readonly string[];
  readonly anchorId: string | null;
  readonly modifiers: FolderCardClickModifiers;
  readonly platform: SelectionPlatform;
  /** Non-zero means a non-left button started the gesture (suppress click). */
  readonly mouseButton: number;
}): FolderCardClickIntent {
  if (options.mouseButton !== 0) {
    return { kind: "ignore" };
  }

  const { folderId, modifiers, platform } = options;
  const additive = isToggleSelectionModifier(modifiers, platform);

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
