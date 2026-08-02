import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import type { SerpentPluginManagerApi } from '../shared/plugin-manager-api';
import {
  collectPendingLibraryPluginTrust,
  dismissPendingLibraryPluginTrust,
  filterUndismissedPendingLibraryPlugins,
  type PendingLibraryPluginTrust,
} from './plugin-trust-prompt';

export type UsePluginTrustPromptResult = {
  pending: PendingLibraryPluginTrust[] | null;
  busy: boolean;
  refresh: () => void;
  trustAll: () => Promise<void>;
  dismissLater: () => void;
  /** Hide the dialog without session-dismiss (e.g. hand off to Settings). */
  hidePrompt: () => void;
};

/**
 * Surfaces a calm trust prompt whenever library-scoped plugins appear that are
 * still untrusted on this device — library open, window focus (disk copy), or
 * an explicit refresh after package-manager mutations.
 */
export function usePluginTrustPrompt(options: {
  api: SerpentPluginManagerApi | undefined;
  libraryId: string | undefined;
  /** Skip prompting while the plugins settings page is already open. */
  suppressWhileSettingsOpen?: boolean;
}): UsePluginTrustPromptResult {
  const { api, libraryId, suppressWhileSettingsOpen = false } = options;
  const [pending, setPending] = useState<PendingLibraryPluginTrust[] | null>(null);
  const [busy, setBusy] = useState(false);
  const requestGeneration = useRef(0);

  const scan = useCallback(async () => {
    if (api === undefined || libraryId === undefined) {
      setPending(null);
      return;
    }
    if (suppressWhileSettingsOpen) return;
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    try {
      const response = await api.request({
        type: 'plugin-manager.list',
        libraryId,
      });
      if (generation !== requestGeneration.current) return;
      if (!response.ok || !('packages' in response)) {
        setPending(null);
        return;
      }
      const collected = collectPendingLibraryPluginTrust(response);
      const undismissed = filterUndismissedPendingLibraryPlugins(libraryId, collected);
      setPending(undismissed.length > 0 ? undismissed : null);
    } catch {
      if (generation !== requestGeneration.current) return;
      setPending(null);
    }
  }, [api, libraryId, suppressWhileSettingsOpen]);

  useEffect(() => {
    setPending(null);
    void scan();
  }, [scan]);

  useEffect(() => {
    if (api === undefined || libraryId === undefined) return undefined;
    const onFocus = (): void => {
      void scan();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void scan();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [api, libraryId, scan]);

  const dismissLater = useCallback(() => {
    if (libraryId === undefined || pending === null) {
      setPending(null);
      return;
    }
    dismissPendingLibraryPluginTrust(libraryId, pending);
    setPending(null);
  }, [libraryId, pending]);

  const trustAll = useCallback(async () => {
    if (api === undefined || libraryId === undefined || pending === null || pending.length === 0) {
      setPending(null);
      return;
    }
    setBusy(true);
    try {
      for (const plugin of pending) {
        const response = await api.request({
          type: 'plugin-manager.trust',
          scope: 'library',
          libraryId,
          pluginId: plugin.pluginId,
          packageHash: plugin.packageHash,
          decision: 'trusted',
        });
        if (!response.ok) break;
      }
    } finally {
      setBusy(false);
      setPending(null);
      void scan();
    }
  }, [api, libraryId, pending, scan]);

  return {
    pending,
    busy,
    refresh: () => {
      void scan();
    },
    trustAll,
    dismissLater,
    hidePrompt: () => {
      setPending(null);
    },
  };
}
