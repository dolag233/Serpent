import type { MutableRefObject } from 'react';
import { useEffect } from 'react';

import type { AssetSummary } from '../shared/asset-types';
import {
  presentIdsFromPendingReveal,
  type PendingAssetReveal,
} from './pending-asset-reveal';

/** Discovery debounce is 200ms; hold slightly longer so it cannot wipe reveal. */
export const PENDING_REVEAL_SETTLE_MS = 280;

export type UsePendingAssetRevealArgs = {
  pendingRevealRef: MutableRefObject<PendingAssetReveal | null>;
  assets: readonly AssetSummary[];
  setSelectedAssetIds: (assetIds: string[]) => void;
  setSelectedAssetId: (assetId: string | undefined) => void;
  setAssetSelectionAnchor: (assetId: string | null) => void;
  pendingRestoredFocusRef: MutableRefObject<string | null>;
};

/**
 * When imported/saved assets appear in the canvas list, select them and queue
 * scroll/focus. Keeps the pending token through the discovery debounce window
 * so a follow-up silent search cannot clear the selection.
 */
export function usePendingAssetReveal({
  pendingRevealRef,
  assets,
  setSelectedAssetIds,
  setSelectedAssetId,
  setAssetSelectionAnchor,
  pendingRestoredFocusRef,
}: UsePendingAssetRevealArgs): void {
  useEffect(() => {
    const pending = pendingRevealRef.current;
    if (!pending || pending.assetIds.length === 0) return;

    const present = presentIdsFromPendingReveal(pending, assets);
    if (present.length === 0) {
      // Asset may still be loading into the first page; drop the token if it
      // never appears so selection clearing is not blocked forever.
      const timer = window.setTimeout(() => {
        if (pendingRevealRef.current === pending) {
          pendingRevealRef.current = null;
        }
      }, PENDING_REVEAL_SETTLE_MS);
      return () => window.clearTimeout(timer);
    }

    const focusId = present.includes(pending.focusAssetId)
      ? pending.focusAssetId
      : present[0]!;

    const apply = () => {
      setSelectedAssetIds(present);
      setSelectedAssetId(focusId);
      setAssetSelectionAnchor(focusId);
      pendingRestoredFocusRef.current = focusId;
    };

    apply();

    const timer = window.setTimeout(() => {
      if (pendingRevealRef.current !== pending) return;
      apply();
      pendingRevealRef.current = null;
    }, PENDING_REVEAL_SETTLE_MS);

    return () => window.clearTimeout(timer);
  }, [
    assets,
    pendingRestoredFocusRef,
    pendingRevealRef,
    setAssetSelectionAnchor,
    setSelectedAssetId,
    setSelectedAssetIds,
  ]);
}
