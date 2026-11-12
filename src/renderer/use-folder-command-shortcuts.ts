import { useEffect } from "react";

import { createCommandRegistry } from "./commands/command-registry";
import {
  matchesShortcut,
  type CommandPlatform,
  type ShortcutSpec,
} from "./commands/command-types";
import {
  asLegacyKeyboardShortcutEvent,
  listenForShortcutInputs,
  matchesRuntimeShortcut,
} from "./shortcut-runtime";
import type { ShortcutEventLike } from "../shared/shortcut-resolution";
import {
  sidebarCommandDefinitions,
  type SidebarCommandDefinition,
} from "./commands/sidebar-commands";
import { shouldForwardBrowseShortcut } from "../shared/browse-shortcut-dedupe";
import { matchAssetActionKeyboardCommand } from "./asset-action-keyboard";
import {
  readFocusedNavFolder,
  resolveFolderShortcutAction,
  type FolderShortcutCommandId,
} from "./folder-shortcut-dispatch";

const folderKeyboardCommandRegistry = createCommandRegistry(
  sidebarCommandDefinitions as readonly SidebarCommandDefinition[],
);

const FOLDER_SHORTCUT_COMMAND_IDS = [
  "folder.open-in-file-manager",
  "folder.create-subfolder",
  "folder.rename",
  "folder.cut",
  "folder.copy",
  "folder.copy-path",
  "folder.paste",
  "folder.move-to-trash",
  "folder.delete-from-disk",
] as const satisfies readonly FolderShortcutCommandId[];

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function matchFolderCommandShortcut(
  commandId: FolderShortcutCommandId,
  event: ShortcutEventLike,
  platform: CommandPlatform,
): boolean {
  const resolved = matchesRuntimeShortcut(commandId, event, platform);
  if (resolved !== null) return resolved;
  const spec: ShortcutSpec | undefined =
    folderKeyboardCommandRegistry.get(commandId)?.shortcut;
  const keyboardEvent = asLegacyKeyboardShortcutEvent(event);
  return keyboardEvent !== null && spec !== undefined && matchesShortcut(spec, keyboardEvent, platform);
}

export type UseFolderCommandShortcutsArgs = {
  readonly enabled: boolean;
  readonly platform: CommandPlatform;
  readonly previewOpen: boolean;
  readonly browseManagedFolderId: string | null;
  readonly selectedFolderCardIds: readonly string[];
  readonly selectedAssetCount: number;
  readonly resolveManagedFolderName: (folderId: string) => string | undefined;
  readonly canCutFolder?: (folderId: string) => boolean;
  readonly canRenameFolder?: (folderId: string) => boolean;
  readonly canOpenFolder?: (folderId: string) => boolean;
  readonly openFolderInFileManager: (folderId: string) => void;
  readonly createSubfolder: (parentFolderId: string | null) => void;
  readonly cutFolders?: (folderIds: string[]) => void;
  readonly copyFolder: (folderId: string) => void;
  readonly copyFolderPath: (folderId: string) => void;
  readonly pasteIntoFolder: (folderId: string | null) => void;
  readonly renameFolder: (folderId: string, currentName: string) => void;
  readonly trashManagedFolder: (folderId: string, name: string) => void;
  readonly deleteFolderFromDisk: (folderId: string, name: string) => void;
  /** Serpent-d7acfa：多选文件夹卡片的批量目标。 */
  readonly trashFolders?: (folderIds: readonly string[]) => void;
  readonly deleteFolders?: (folderIds: readonly string[]) => void;
};

/**
 * Document-level folder shortcuts (Serpent-vf8x). Skips editable targets,
 * open modals, and asset preview; defers rename/trash when assets are selected.
 */
export function useFolderCommandShortcuts(
  args: UseFolderCommandShortcutsArgs,
): void {
  const {
    enabled,
    platform,
    previewOpen,
    browseManagedFolderId,
    selectedFolderCardIds,
    selectedAssetCount,
    resolveManagedFolderName,
    canCutFolder,
    canRenameFolder,
    createSubfolder,
    cutFolders,
    copyFolder,
    copyFolderPath,
    pasteIntoFolder,
    renameFolder,
    canOpenFolder,
    openFolderInFileManager,
    trashManagedFolder,
    deleteFolderFromDisk,
    trashFolders,
    deleteFolders,
  } = args;

  useEffect(() => {
    if (!enabled) return;

    const onShortcutInput = (shortcutInput: ShortcutEventLike, event: KeyboardEvent | MouseEvent) => {
      if (isEditableKeyboardTarget(event.target)) return;
      if (previewOpen) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      // Collection rows own their own F2 / Delete / create shortcuts.
      if (document.activeElement?.closest("[data-nav-collection-id]")) return;

      for (const commandId of FOLDER_SHORTCUT_COMMAND_IDS) {
        if (!matchFolderCommandShortcut(commandId, shortcutInput, platform)) continue;
        if (
          commandId === "folder.copy-path" &&
          selectedAssetCount > 0 &&
          matchAssetActionKeyboardCommand("asset.copy-file-path", shortcutInput, platform)
        ) {
          continue;
        }

        const action = resolveFolderShortcutAction({
          commandId,
          focusedNav: readFocusedNavFolder(document.activeElement),
          browseManagedFolderId,
          selectedFolderCardIds,
          selectedAssetCount,
          resolveManagedFolderName,
          canCutFolder,
          canRenameFolder,
          canOpenFolder,
        });
        if (action.type === "none") continue;

        const browseAction =
          commandId === "folder.rename"
            ? "rename"
            : commandId === "folder.delete-from-disk"
              ? "disk-delete"
              : commandId === "folder.move-to-trash"
                ? "trash"
                : null;
        if (browseAction && !shouldForwardBrowseShortcut(browseAction)) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        if (action.type === "open-in-file-manager") {
          openFolderInFileManager(action.folderId);
          return;
        }
        if (action.type === "create-subfolder") {
          createSubfolder(action.parentFolderId);
          return;
        }
        if (action.type === 'cut-folders') {
          cutFolders?.(action.folderIds);
          return;
        }
        if (action.type === "copy-folder") {
          copyFolder(action.folderId);
          return;
        }
        if (action.type === "copy-folder-path") {
          copyFolderPath(action.folderId);
          return;
        }
        if (action.type === "paste-into-folder") {
          pasteIntoFolder(action.folderId);
          return;
        }
        if (action.type === "rename") {
          renameFolder(action.folderId, action.currentName);
          return;
        }
        if (action.type === "delete-from-disk") {
          deleteFolderFromDisk(action.folderId, action.name);
          return;
        }
        if (action.type === "trash-folders") {
          // 没有批量回调时退回逐个执行，行为与旧版单目标路径一致。
          if (trashFolders) {
            trashFolders(action.folderIds);
          } else {
            for (const folderId of action.folderIds) {
              const name = resolveManagedFolderName(folderId);
              if (name !== undefined) trashManagedFolder(folderId, name);
            }
          }
          return;
        }
        if (action.type === "delete-folders") {
          if (deleteFolders) {
            deleteFolders(action.folderIds);
          } else {
            for (const folderId of action.folderIds) {
              const name = resolveManagedFolderName(folderId);
              if (name !== undefined) deleteFolderFromDisk(folderId, name);
            }
          }
          return;
        }
        trashManagedFolder(action.folderId, action.name);
        return;
      }
    };

    return listenForShortcutInputs(document, onShortcutInput, platform === "windows");
  }, [
    enabled,
    platform,
    previewOpen,
    browseManagedFolderId,
    selectedFolderCardIds,
    selectedAssetCount,
    resolveManagedFolderName,
    canCutFolder,
    canRenameFolder,
    createSubfolder,
    cutFolders,
    copyFolder,
    copyFolderPath,
    pasteIntoFolder,
    renameFolder,
    canOpenFolder,
    openFolderInFileManager,
    trashManagedFolder,
    deleteFolderFromDisk,
    trashFolders,
    deleteFolders,
  ]);
}
