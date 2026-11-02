import { useEffect, useState } from 'react';

import type { SerpentLibraryApi } from '../shared/library-api';
import type { NativeDragReadinessEvent } from '../shared/native-drag-readiness';

const NO_READY_ASSETS: ReadonlySet<string> = new Set();

export function applyNativeDragReadiness(
  current: ReadonlyMap<string, ReadonlySet<string>>,
  event: NativeDragReadinessEvent,
): ReadonlyMap<string, ReadonlySet<string>> {
  const next = new Map(current);
  if (event.type === 'clear') {
    if (!next.has(event.libraryId)) return current;
    next.delete(event.libraryId);
  } else {
    if (event.assetIds.length === 0) return current;
    const ready = new Set(next.get(event.libraryId) ?? []);
    for (const assetId of event.assetIds) ready.add(assetId);
    next.set(event.libraryId, ready);
  }
  return next;
}

/** Paths stay in Main; Renderer only knows when the native drag cache is safe to use. */
export function useNativeDragReadyIds(
  api: SerpentLibraryApi | undefined,
  libraryId: string | undefined,
): ReadonlySet<string> {
  const [readyByLibrary, setReadyByLibrary] = useState<ReadonlyMap<string, ReadonlySet<string>>>(
    () => new Map(),
  );

  useEffect(() => {
    if (!api) return;
    return api.onNativeDragReadiness((event) => {
      setReadyByLibrary((current) => applyNativeDragReadiness(current, event));
    });
  }, [api]);

  return libraryId ? readyByLibrary.get(libraryId) ?? NO_READY_ASSETS : NO_READY_ASSETS;
}
