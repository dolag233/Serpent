import { useEffect, useMemo, useState } from "react";

import type { SerpentLibraryApi } from "../shared/library-api";
import {
  overlaySyncCardStatus,
  type SyncCardPersistedStatus,
  type SyncCardStatus,
} from "../shared/sync-card-status";

const STATUS_REQUEST_CAP = 300;

export function useSyncCardStatuses(input: {
  api: SerpentLibraryApi | null | undefined;
  libraryId: string | undefined;
  bound: boolean;
  showBadges: boolean;
  assetIds: readonly string[];
  syncing: boolean;
}): ReadonlyMap<string, SyncCardStatus> {
  const [persisted, setPersisted] = useState<Map<string, SyncCardPersistedStatus>>(
    () => new Map(),
  );
  const assetIdKey = useMemo(
    () => input.assetIds.slice(0, STATUS_REQUEST_CAP).join("\n"),
    [input.assetIds],
  );

  useEffect(() => {
    if (!input.api || !input.libraryId || !input.bound || !input.showBadges) {
      setPersisted(new Map());
      return;
    }
    const assetIds = assetIdKey.length === 0 ? [] : assetIdKey.split("\n");
    if (assetIds.length === 0) {
      setPersisted(new Map());
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    const load = () => {
      if (typeof input.api?.syncListCardStatuses !== "function") return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = undefined;
        void input.api!.syncListCardStatuses({
          libraryId: input.libraryId!,
          assetIds,
        }).then((result) => {
          if (cancelled || !result.ok) return;
          setPersisted(new Map(
            result.value.map((entry) => [entry.assetId, entry.status] as const),
          ));
        }).catch(() => undefined);
      }, 80);
    };
    load();
    const unsubscribe = input.api.onAssetsChanged((event) => {
      if (event.libraryId !== input.libraryId) return;
      load();
    });
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      unsubscribe();
    };
  }, [
    input.api,
    input.libraryId,
    input.bound,
    input.showBadges,
    input.syncing,
    assetIdKey,
  ]);

  return useMemo(() => {
    const next = new Map<string, SyncCardStatus>();
    for (const [assetId, status] of persisted) {
      const visible = overlaySyncCardStatus(status, input.syncing);
      if (visible) next.set(assetId, visible);
    }
    return next;
  }, [persisted, input.syncing]);
}
