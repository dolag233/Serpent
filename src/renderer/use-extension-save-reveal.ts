import type { MutableRefObject } from 'react';
import { useEffect } from 'react';

import type { SerpentLibraryApi } from '../shared/library-api';
import {
  pendingRevealFromAssets,
  type AssetBrowseScope,
  type PendingAssetReveal,
} from './pending-asset-reveal';

export type UseExtensionSaveRevealArgs = {
  api: SerpentLibraryApi | null;
  libraryId: string | undefined;
  chooseFolderRef: MutableRefObject<(scope: AssetBrowseScope) => Promise<void>>;
  pendingRevealRef: MutableRefObject<PendingAssetReveal | null>;
};

/** After an extension save, jump to the destination folder and queue selection. */
export function useExtensionSaveReveal({
  api,
  libraryId,
  chooseFolderRef,
  pendingRevealRef,
}: UseExtensionSaveRevealArgs): void {
  useEffect(() => {
    if (!api || !libraryId) return;

    return api.onExtensionSaveCompleted((event) => {
      if (event.libraryId !== libraryId) return;

      void (async () => {
        const reveal = pendingRevealFromAssets([event.asset]);
        if (!reveal) return;
        pendingRevealRef.current = reveal;

        const targetScope: AssetBrowseScope =
          event.asset.managedFolderId ?? 'root';
        // Always navigate through chooseFolder so discovery filters are cleared
        // and the saved asset is visible in the destination scope.
        await chooseFolderRef.current(targetScope);
      })();
    });
  }, [
    api,
    chooseFolderRef,
    libraryId,
    pendingRevealRef,
  ]);
}
