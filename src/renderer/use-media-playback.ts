import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssetSummary } from '../shared/asset-types';
import type { SerpentLibraryApi } from '../shared/library-api';
import { shuffleBrowseItems } from './client-shuffle';
import { LibraryOperationError, toMessage } from './error-utils';
import { useLocale, useT } from './i18n';
import { findNextSiblingMedia, loadMediaPlaybackMode, saveMediaPlaybackMode, type MediaPlaybackMode } from './media-playback-mode';

export function useMediaPlayback(input: {
  api: SerpentLibraryApi | null;
  libraryId: string | null;
  current: AssetSummary | null;
  shuffleSeed: number | null;
  getOrderedIds: () => Promise<string[] | null>;
  navigate: (asset: AssetSummary) => void;
  ensureLoaded?: (rank: number) => Promise<void>;
  setError: (message: string) => void;
}) {
  const [mode, setMode] = useState(loadMediaPlaybackMode);
  const generation = useRef(0);
  const inFlight = useRef<number | null>(null);
  const t = useT();
  const { locale } = useLocale();
  useEffect(() => {
    generation.current += 1;
    inFlight.current = null;
    return () => { generation.current += 1; };
  }, [input.current?.assetId, input.libraryId, input.shuffleSeed, mode]);

  const changeMode = useCallback((next: MediaPlaybackMode) => {
    setMode(next);
    saveMediaPlaybackMode(next);
  }, []);

  const ended = useCallback(async (assetId: string) => {
    const { api, libraryId, current } = input;
    if (mode !== 'sequential' || !api || !libraryId || current?.assetId !== assetId || inFlight.current !== null) return;
    const ticket = generation.current;
    inFlight.current = ticket;
    const isCurrent = () => generation.current === ticket;
    try {
      const ids = await input.getOrderedIds();
      if (!ids || !isCurrent()) return;
      const next = await findNextSiblingMedia({
        current,
        orderedIds: shuffleBrowseItems(ids, input.shuffleSeed),
        isCurrent,
        load: async (assetIds) => {
          const result = await api.listAssets({ libraryId, assetIds, recursive: true });
          if (!result.ok) throw new LibraryOperationError(result.error);
          return result.value;
        },
      });
      if (next && isCurrent()) {
        await input.ensureLoaded?.(ids.indexOf(next.assetId));
        if (isCurrent()) input.navigate(next);
      }
    } catch (error) {
      if (isCurrent()) input.setError(toMessage(error, t('toast.openExternalFailed'), locale));
    } finally {
      if (inFlight.current === ticket) inFlight.current = null;
    }
  }, [input, locale, mode, t]);

  return { mode, changeMode, ended };
}
