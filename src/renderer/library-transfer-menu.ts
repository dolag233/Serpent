/**
 * Library switcher «添加与传输» section: stable item order (Serpent-qm6w).
 *
 * Asset-level imports (folder / linked folder) precede whole-library
 * import/export. Import always precedes export for the same subject.
 * Import files and paste-image are intentionally omitted from this menu.
 */

export type LibraryTransferMenuActionId =
  | "import-folder"
  | "import-linked-folder"
  | "import-library"
  | "export-library";

/** Canonical menu order for the transfer section. */
export const LIBRARY_TRANSFER_MENU_ORDER: readonly LibraryTransferMenuActionId[] =
  [
    "import-folder",
    "import-linked-folder",
    "import-library",
    "export-library",
  ] as const;

export type LibraryTransferMenuHandlers = Partial<
  Record<LibraryTransferMenuActionId, () => void>
>;

export type LibraryTransferMenuItem = {
  id: LibraryTransferMenuActionId;
  labelKey: string;
  titleKey?: string;
  disabled: boolean;
  onSelect: () => void;
};

export function buildLibraryTransferMenuItems(input: {
  handlers: LibraryTransferMenuHandlers;
  libraryScopedDisabled: boolean;
  busy: boolean;
  importFolderCopy: { labelKey: string; titleKey: string };
  importLinkedFolderCopy: { labelKey: string; titleKey: string };
}): LibraryTransferMenuItem[] {
  const items: LibraryTransferMenuItem[] = [];

  for (const id of LIBRARY_TRANSFER_MENU_ORDER) {
    const handler = input.handlers[id];
    if (!handler) continue;

    switch (id) {
      case "import-folder":
        items.push({
          id,
          labelKey: input.importFolderCopy.labelKey,
          titleKey: input.importFolderCopy.titleKey,
          disabled: input.libraryScopedDisabled,
          onSelect: handler,
        });
        break;
      case "import-linked-folder":
        items.push({
          id,
          labelKey: input.importLinkedFolderCopy.labelKey,
          titleKey: input.importLinkedFolderCopy.titleKey,
          disabled: input.libraryScopedDisabled,
          onSelect: handler,
        });
        break;
      case "import-library":
        items.push({
          id,
          labelKey: "toolbar.importLibrary",
          disabled: input.busy,
          onSelect: handler,
        });
        break;
      case "export-library":
        items.push({
          id,
          labelKey: "toolbar.exportLibrary",
          disabled: input.libraryScopedDisabled,
          onSelect: handler,
        });
        break;
      default: {
        const _exhaustive: never = id;
        void _exhaustive;
      }
    }
  }

  return items;
}
