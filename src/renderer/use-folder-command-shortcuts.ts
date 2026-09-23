import { useEffect } from "react";

import { createCommandRegistry } from "./commands/command-registry";
import {
  matchesShortcut,
  type CommandPlatform,
  type ShortcutSpec,
} from "./commands/command-types";
import {
  sidebarCommandDefinitions,
  type SidebarCommandDefinition,
} from "./commands/sidebar-commands";
import { shouldForwardBrowseShortcut } from "../shared/browse-shortcut-dedupe";
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
  event: KeyboardEvent,
  platform: CommandPlatform,
): boolean {
  const spec: ShortcutSpec | undefined =
    folderKeyboardCommandRegistry.get(commandId)?.shortcut;
  return (
    spec !== undefined && matchesShortcut(spec, event, platform)
  );
}

export type UseFolderCommandShortcutsArgs = {
  readonly enabled: boolean;
  readonly platform: CommandPlatform;
  readonly previewOpen: boolean;
  readonly browseManagedFolderId: string | null;
  readonly selectedFolderCardIds: readonly string[];
  readonly selectedAssetCount: number;
  readonly resolveManagedFolderName: (folderId: string) => string | undefined;
  readonly canRenameFolder?: (folderId: string) => boolean;
  readonly canOpenFolder?: (folderId: string) => boolean;
  readonly openFolderInFileManager: (folderId: string) => void;
  readonly createSubfolder: (parentFolderId: string | null) => void;
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
    canRenameFolder,
    createSubfolder,
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

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return;
      if (previewOpen) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;

      for (const commandId of FOLDER_SHORTCUT_COMMAND_IDS) {
        if (!matchFolderCommandShortcut(commandId, event, platform)) continue;

        const action = resolveFolderShortcutAction({
          commandId,
          focusedNav: readFocusedNavFolder(document.activeElement),
          browseManagedFolderId,
          selectedFolderCardIds,
          selectedAssetCount,
          resolveManagedFolderName,
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

    document.addEventListener("keydown", onKeyDown, platform === "windows");
    return () => document.removeEventListener("keydown", onKeyDown, platform === "windows");
  }, [
    enabled,
    platform,
    previewOpen,
    browseManagedFolderId,
    selectedFolderCardIds,
    selectedAssetCount,
    resolveManagedFolderName,
    canRenameFolder,
    createSubfolder,
    renameFolder,
    canOpenFolder,
    openFolderInFileManager,
    trashManagedFolder,
    deleteFolderFromDisk,
    trashFolders,
    deleteFolders,
  ]);
}
