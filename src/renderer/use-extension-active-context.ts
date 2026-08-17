import { useEffect } from "react";

import type { SerpentLibraryApi } from "../shared/library-api";
import { resolveExtensionActiveContextTarget } from "./extension-active-context";

export type UseExtensionActiveContextArgs = {
  readonly api: SerpentLibraryApi | null;
  readonly libraryId: string | null;
  readonly showTrash: boolean;
  readonly activeTagId: string | null;
  readonly activeCollectionId: string | null;
  readonly activeSmartCollectionId: string | null;
  readonly assetScope: "all" | "root" | string;
};

/**
 * Keeps Main's extension-save routing in sync with the renderer browse scope.
 * Session restore and other paths that never call setActiveContext directly
 * still publish a library target for the browser extension.
 */
export function useExtensionActiveContext(
  args: UseExtensionActiveContextArgs,
): void {
  const {
    api,
    libraryId,
    showTrash,
    activeTagId,
    activeCollectionId,
    activeSmartCollectionId,
    assetScope,
  } = args;

  useEffect(() => {
    if (!api) return;
    const target = resolveExtensionActiveContextTarget({
      libraryId,
      showTrash,
      activeTagId,
      activeCollectionId,
      activeSmartCollectionId,
      assetScope,
    });
    api.setActiveContext(target.libraryId, target.selectedFolderId);
  }, [
    activeCollectionId,
    activeSmartCollectionId,
    activeTagId,
    api,
    assetScope,
    libraryId,
    showTrash,
  ]);
}
