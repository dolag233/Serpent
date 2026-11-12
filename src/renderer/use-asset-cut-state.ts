import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SerpentLibraryApi } from '../shared/library-api';

const EMPTY_IDS: readonly string[] = [];

/** Clipboard identity comes from Main, including changes made outside this window. */
export function useAssetCutState(api: SerpentLibraryApi | null, libraryId: string | null) {
  const [state, setState] = useState<{ libraryId: string | null; ids: readonly string[]; folderIds: readonly string[] }>({ libraryId: null, ids: EMPTY_IDS, folderIds: EMPTY_IDS });
  const requestVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    if (!api || !libraryId) return;
    try {
      const result = await api.getClipboardCutSelection({ libraryId });
      if (!result.ok || requestVersion.current !== version) return;
      setState(current => current.libraryId === libraryId &&
        current.ids.length === result.value.assetIds.length && current.ids.every((id, index) => id === result.value.assetIds[index])
        && current.folderIds.length === result.value.folderIds.length && current.folderIds.every((id, index) => id === result.value.folderIds[index])
        ? current : { libraryId, ids: result.value.assetIds, folderIds: result.value.folderIds });
    } catch { /* A busy clipboard keeps the previous appearance until the next read. */ }
  }, [api, libraryId]);

  const ids = state.libraryId === libraryId ? state.ids : EMPTY_IDS;
  const folderIds = state.libraryId === libraryId ? state.folderIds : EMPTY_IDS;
  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => { if (mounted) void refresh(); });
    return () => { mounted = false; requestVersion.current += 1; };
  }, [refresh]);

  useEffect(() => {
    if (!api || !libraryId) return;
    const onVisible = () => { if (!document.hidden) void refresh(); };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    // Poll only while showing a cut selection, so external copy/clear restores it.
    const timer = ids.length + folderIds.length > 0 ? window.setInterval(onVisible, 500) : undefined;
    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [api, ids.length, folderIds.length, libraryId, refresh]);

  return { cutFolderIds: useMemo(() => new Set(folderIds), [folderIds]), cutAssetIds: useMemo(() => new Set(ids), [ids]), refresh };
}
