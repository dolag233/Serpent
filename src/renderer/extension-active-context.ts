export type ExtensionActiveContextTarget = {
  readonly libraryId: string | null;
  readonly selectedFolderId?: string;
};

/**
 * Derives the browse target the browser extension should import into from the
 * current renderer scope. Non-folder scopes (trash, tags, collections, search)
 * fall back to the library root.
 */
export function resolveExtensionActiveContextTarget(input: {
  readonly libraryId: string | null;
  readonly showTrash: boolean;
  readonly activeTagId: string | null;
  readonly activeCollectionId: string | null;
  readonly activeSmartCollectionId: string | null;
  readonly assetScope: "all" | "root" | string;
}): ExtensionActiveContextTarget {
  if (!input.libraryId) {
    return { libraryId: null };
  }

  if (
    input.showTrash ||
    input.activeTagId ||
    input.activeCollectionId ||
    input.activeSmartCollectionId
  ) {
    return { libraryId: input.libraryId };
  }

  if (input.assetScope === "all" || input.assetScope === "root") {
    return { libraryId: input.libraryId };
  }

  return {
    libraryId: input.libraryId,
    selectedFolderId: input.assetScope,
  };
}
