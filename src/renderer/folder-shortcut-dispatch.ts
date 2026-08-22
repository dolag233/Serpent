/**
 * Pure folder keyboard target resolution (Serpent-vf8x).
 *
 * Sidebar focus (data-nav-folder-*) wins for rename/trash; create also falls
 * back to the current managed browse scope (same as the sidebar "+" button).
 * When assets are selected, rename/trash defer to asset shortcuts.
 */

export type FolderShortcutCommandId =
  | "folder.create-subfolder"
  | "folder.rename"
  | "folder.move-to-trash"
  | "folder.delete-from-disk";

export type FocusedNavFolder = {
  readonly folderId: string;
  readonly locationKind: "managed" | "linked";
};

export type FolderShortcutAction =
  | { readonly type: "create-subfolder"; readonly parentFolderId: string | null }
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

function singleManagedCardTarget(
  selectedFolderCardIds: readonly string[],
  resolveManagedFolderName: (folderId: string) => string | undefined,
): { folderId: string; name: string } | null {
  if (selectedFolderCardIds.length !== 1) return null;
  const folderId = selectedFolderCardIds[0]!;
  const name = resolveManagedFolderName(folderId);
  if (name === undefined) return null;
  return { folderId, name };
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
  } = input;

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

  const card = singleManagedCardTarget(
    selectedFolderCardIds,
    resolveManagedFolderName,
  );
  if (card) {
    if (commandId === "folder.rename") {
      if (canRenameFolder && !canRenameFolder(card.folderId)) {
        return { type: "none" };
      }
      return {
        type: "rename",
        folderId: card.folderId,
        currentName: card.name,
      };
    }
    return commandId === "folder.delete-from-disk"
      ? { type: "delete-from-disk", folderId: card.folderId, name: card.name }
      : { type: "move-to-trash", folderId: card.folderId, name: card.name };
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
