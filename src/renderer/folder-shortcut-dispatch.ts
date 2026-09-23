/**
 * Pure folder keyboard target resolution (Serpent-vf8x).
 *
 * Sidebar focus (data-nav-folder-*) wins for rename/trash; create also falls
 * back to the current managed browse scope (same as the sidebar "+" button).
 * When assets are selected, rename/trash defer to asset shortcuts.
 */

export type FolderShortcutCommandId =
  | "folder.create-subfolder"
  | "folder.open-in-file-manager"
  | "folder.rename"
  | "folder.move-to-trash"
  | "folder.delete-from-disk";

export type FocusedNavFolder = {
  readonly folderId: string;
  readonly locationKind: "managed" | "linked";
};

export type FolderShortcutAction =
  | { readonly type: "create-subfolder"; readonly parentFolderId: string | null }
  | { readonly type: "open-in-file-manager"; readonly folderId: string }
  | {
      readonly type: "rename";
      readonly folderId: string;
      readonly currentName: string;
    }
  | {
      readonly type: "move-to-trash";
      readonly folderId: string;
      readonly name: string;
    }
  | {
      readonly type: "delete-from-disk";
      readonly folderId: string;
      readonly name: string;
    }
  /** Serpent-d7acfa：多选文件夹卡片时，快捷键对全部选中项生效。 */
  | { readonly type: "trash-folders"; readonly folderIds: readonly string[] }
  | { readonly type: "delete-folders"; readonly folderIds: readonly string[] }
  | { readonly type: "none" };

export type FolderShortcutResolveInput = {
  readonly commandId: FolderShortcutCommandId;
  readonly focusedNav: FocusedNavFolder | null;
  /** Managed folder currently opened in the browse scope, else null. */
  readonly browseManagedFolderId: string | null;
  readonly selectedFolderCardIds: readonly string[];
  readonly selectedAssetCount: number;
  readonly resolveManagedFolderName: (folderId: string) => string | undefined;
  /** Optional availability guard for managed and linked folders. */
  readonly canRenameFolder?: (folderId: string) => boolean;
  /** Optional guard for opening a folder in the OS file manager. */
  readonly canOpenFolder?: (folderId: string) => boolean;
};

/**
 * Read the focused sidebar folder row from the active element, if any.
 * Duck-typed so unit tests can run in node without a DOM environment.
 */
export type NavFolderFocusHost = {
  readonly closest: (selector: string) => NavFolderFocusHost | null;
  readonly dataset?: {
    readonly navFolderId?: string;
    readonly navFolderKind?: string;
  };
};

export function readFocusedNavFolder(
  activeElement: NavFolderFocusHost | null,
): FocusedNavFolder | null {
  if (!activeElement || typeof activeElement.closest !== "function") {
    return null;
  }
  const row = activeElement.closest("[data-nav-folder-id]");
  const folderId = row?.dataset?.navFolderId?.trim();
  const locationKind = row?.dataset?.navFolderKind;
  if (!folderId) return null;
  if (locationKind !== "managed" && locationKind !== "linked") return null;
  return { folderId, locationKind };
}

/**
 * 画布文件夹卡片目标。多选时返回全部有名字的托管文件夹（Serpent-d7acfa）；
 * 重命名仍然只对单个目标生效，由调用方判断长度。
 */
function managedCardTargets(
  selectedFolderCardIds: readonly string[],
  resolveManagedFolderName: (folderId: string) => string | undefined,
): { folderId: string; name: string }[] {
  const targets: { folderId: string; name: string }[] = [];
  for (const folderId of selectedFolderCardIds) {
    const name = resolveManagedFolderName(folderId);
    if (name === undefined) continue;
    targets.push({ folderId, name });
  }
  return targets;
}

export function resolveFolderShortcutAction(
  input: FolderShortcutResolveInput,
): FolderShortcutAction {
  const {
    commandId,
    focusedNav,
    browseManagedFolderId,
    selectedFolderCardIds,
    selectedAssetCount,
    resolveManagedFolderName,
    canRenameFolder,
    canOpenFolder,
  } = input;

  if (commandId === "folder.open-in-file-manager") {
    return resolveOpenFolderShortcut(input, canOpenFolder);
  }

  if (commandId === "folder.create-subfolder") {
    if (focusedNav?.locationKind === "managed" || focusedNav?.locationKind === "linked") {
      return {
        type: "create-subfolder",
        parentFolderId: focusedNav.folderId,
      };
    }
    return {
      type: "create-subfolder",
      parentFolderId: browseManagedFolderId,
    };
  }

  // Rename / trash: assets keep priority when any asset is selected.
  if (selectedAssetCount > 0) return { type: "none" };

  // Serpent-d7acfa: a multi-folder selection (canvas cards or sidebar tree rows)
  // outranks the focused row — Delete / Shift+Delete then act on every selected
  // folder instead of only the one under focus.
  const selection = managedCardTargets(
    selectedFolderCardIds,
    resolveManagedFolderName,
  );
  if (selection.length > 1 && commandId !== "folder.rename") {
    return commandId === "folder.delete-from-disk"
      ? { type: "delete-folders", folderIds: selection.map((card) => card.folderId) }
      : { type: "trash-folders", folderIds: selection.map((card) => card.folderId) };
  }

  // Linked and managed folders use the same F2 / Delete / Shift+Delete
  // targeting. Delete goes to trash with no confirmation (Serpent-g8u9).
  if (focusedNav) {
    const name = resolveManagedFolderName(focusedNav.folderId);
    if (name === undefined) return { type: "none" };
    if (commandId === "folder.rename") {
      if (canRenameFolder && !canRenameFolder(focusedNav.folderId)) {
        return { type: "none" };
      }
      return {
        type: "rename",
        folderId: focusedNav.folderId,
        currentName: name,
      };
    }
    if (commandId === "folder.delete-from-disk") {
      return {
        type: "delete-from-disk",
        folderId: focusedNav.folderId,
        name,
      };
    }
    return {
      type: "move-to-trash",
      folderId: focusedNav.folderId,
      name,
    };
  }

  const cards = managedCardTargets(
    selectedFolderCardIds,
    resolveManagedFolderName,
  );
  if (cards.length > 0) {
    if (commandId === "folder.rename") {
      // 重命名一次只能改一个名字：多选时不猜目标。
      if (cards.length !== 1) return { type: "none" };
      const card = cards[0]!;
      if (canRenameFolder && !canRenameFolder(card.folderId)) {
        return { type: "none" };
      }
      return {
        type: "rename",
        folderId: card.folderId,
        currentName: card.name,
      };
    }
    if (commandId === "folder.delete-from-disk") {
      return cards.length === 1
        ? {
            type: "delete-from-disk",
            folderId: cards[0]!.folderId,
            name: cards[0]!.name,
          }
        : { type: "delete-folders", folderIds: cards.map((card) => card.folderId) };
    }
    return cards.length === 1
      ? {
          type: "move-to-trash",
          folderId: cards[0]!.folderId,
          name: cards[0]!.name,
        }
      : { type: "trash-folders", folderIds: cards.map((card) => card.folderId) };
  }

  // Fallback: rename/trash the folder currently open in browse (Serpent-l0ow).
  // Context menus steal DOM focus, so F2 after a right-click often has no
  // focused nav row — the open folder is still a clear rename target.
  if (browseManagedFolderId) {
    const name = resolveManagedFolderName(browseManagedFolderId);
    if (name !== undefined) {
      if (commandId === "folder.rename") {
        if (canRenameFolder && !canRenameFolder(browseManagedFolderId)) {
          return { type: "none" };
        }
        return {
          type: "rename",
          folderId: browseManagedFolderId,
          currentName: name,
        };
      }
      if (commandId === "folder.delete-from-disk") {
        return {
          type: "delete-from-disk",
          folderId: browseManagedFolderId,
          name,
        };
      }
      return {
        type: "move-to-trash",
        folderId: browseManagedFolderId,
        name,
      };
    }
  }

  return { type: "none" };
}

/**
 * Ctrl/Cmd+Shift+S opens one folder in the OS file manager.
 * A selected asset keeps the asset reveal chord. One focused row or one
 * selected folder card wins over the folder currently open in browse.
 */
function resolveOpenFolderShortcut(
  input: FolderShortcutResolveInput,
  canOpenFolder: ((folderId: string) => boolean) | undefined,
): FolderShortcutAction {
  if (input.selectedAssetCount > 0) return { type: "none" };
  const folderId = input.focusedNav
    ? input.focusedNav.folderId
    : input.selectedFolderCardIds.length === 1
      ? input.selectedFolderCardIds[0]
      : input.selectedFolderCardIds.length === 0
        ? input.browseManagedFolderId
        : null;
  if (!folderId) return { type: "none" };
  if (canOpenFolder && !canOpenFolder(folderId)) return { type: "none" };
  return { type: "open-in-file-manager", folderId };
}
