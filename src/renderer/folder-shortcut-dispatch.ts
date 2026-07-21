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
  | "folder.move-to-trash";

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
  | { readonly type: "none" };

export type FolderShortcutResolveInput = {
  readonly commandId: FolderShortcutCommandId;
  readonly focusedNav: FocusedNavFolder | null;
  /** Managed folder currently opened in the browse scope, else null. */
  readonly browseManagedFolderId: string | null;
  readonly selectedFolderCardIds: readonly string[];
  readonly selectedAssetCount: number;
  readonly resolveManagedFolderName: (folderId: string) => string | undefined;
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
  } = input;

  if (commandId === "folder.create-subfolder") {
    if (focusedNav?.locationKind === "managed") {
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

  if (focusedNav?.locationKind === "managed") {
    const name = resolveManagedFolderName(focusedNav.folderId);
    if (name === undefined) return { type: "none" };
    if (commandId === "folder.rename") {
      return {
        type: "rename",
        folderId: focusedNav.folderId,
        currentName: name,
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
  if (!card) return { type: "none" };
  if (commandId === "folder.rename") {
    return {
      type: "rename",
      folderId: card.folderId,
      currentName: card.name,
    };
  }
  return {
    type: "move-to-trash",
    folderId: card.folderId,
    name: card.name,
  };
}
