import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  PreviewResolution,
  SerpentLibraryApi,
} from "../shared/library-api";
import { resolveActivePreviewAssetId } from "./asset-card-hover-preview";

const DEFAULT_DEBOUNCE_MS = 200;

function resolutionKey(libraryId: string, assetId: string): string {
  return `${libraryId}\u0000${assetId}`;
}

export function useAssetCardHoverPreview(input: {
  api: SerpentLibraryApi | null | undefined;
  libraryId: string | undefined;
  primarySelectedAssetId: string | undefined;
  isPreviewable: (assetId: string) => boolean;
  debounceMs?: number;
}): {
  hoveredAssetId: string | null;
  setHoveredAssetId: (assetId: string | null) => void;
  clearHoveredAssetId: (assetId: string) => void;
  activePreviewAssetId: string | null;
  activeResolution: PreviewResolution | null;
} {
  const {
    api,
    libraryId,
    primarySelectedAssetId,
    isPreviewable,
    debounceMs = DEFAULT_DEBOUNCE_MS,
  } = input;

  const [hoveredState, setHoveredState] = useState<{
    libraryId: string | undefined;
    assetId: string | null;
  }>(() => ({ libraryId, assetId: null }));
  const [resolutionsByAssetId, setResolutionsByAssetId] = useState(
    () => new Map<string, PreviewResolution>(),
  );

  const requestSeqRef = useRef(0);
  const debounceTimerRef = useRef(0);

  const hoveredAssetId =
    hoveredState.libraryId === libraryId ? hoveredState.assetId : null;

  const setHoveredAssetId = useCallback(
    (assetId: string | null) => {
      setHoveredState({ libraryId, assetId });
    },
    [libraryId],
  );

  const clearHoveredAssetId = useCallback(
    (assetId: string) => {
      setHoveredState((current) =>
        current.libraryId === libraryId && current.assetId === assetId
          ? { libraryId, assetId: null }
          : current,
      );
    },
    [libraryId],
  );

  const activePreviewAssetId = useMemo(
    () =>
      resolveActivePreviewAssetId({
        hoveredAssetId,
        primarySelectedAssetId,
        isPreviewable,
      }),
    [hoveredAssetId, primarySelectedAssetId, isPreviewable],
  );

  const activeResolution = useMemo(() => {
    if (!activePreviewAssetId) return null;
    if (!libraryId) return null;
    const cached = resolutionsByAssetId.get(
      resolutionKey(libraryId, activePreviewAssetId),
    );
    return cached?.status === "ready" && cached.url ? cached : null;
  }, [activePreviewAssetId, libraryId, resolutionsByAssetId]);

  useEffect(() => {
    if (!api || !libraryId || !activePreviewAssetId) return;
    const cacheKey = resolutionKey(libraryId, activePreviewAssetId);
    if (resolutionsByAssetId.get(cacheKey)?.url) return;

    const sequence = ++requestSeqRef.current;
    const targetAssetId = activePreviewAssetId;
    window.clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await api.requestPreview({
            libraryId,
            assetId: targetAssetId,
            mode: "client",
            // Hover previews must stay lightweight: play the WebM proxy when
            // one exists, never the original source (REQ-VIEW-002 only
            // applies to the double-click viewer).
            intent: "hover",
          });
          if (sequence !== requestSeqRef.current) return;
          if (!result.ok) return;
          setResolutionsByAssetId((previous) => {
            const next = new Map(previous);
            next.set(cacheKey, result.value);
            return next;
          });
        } catch {
          // Leave cover visible; next hover/selection can retry.
        }
      })();
    }, debounceMs);

    return () => {
      window.clearTimeout(debounceTimerRef.current);
    };
  }, [
    api,
    libraryId,
    activePreviewAssetId,
    debounceMs,
    resolutionsByAssetId,
  ]);

  useEffect(
    () => () => {
      requestSeqRef.current += 1;
      window.clearTimeout(debounceTimerRef.current);
    },
    [],
  );

  // A preview resolution is scoped to the library that produced its URL.
  // Keeping the asset-id-only map across a library switch can reuse an old
  // serpent://source URL when two libraries contain the same asset id, and
  // the in-flight request can otherwise finish after the old library closes.
  useEffect(() => {
    requestSeqRef.current += 1;
    window.clearTimeout(debounceTimerRef.current);
  }, [libraryId]);

  return {
    hoveredAssetId,
    setHoveredAssetId,
    clearHoveredAssetId,
    activePreviewAssetId,
    activeResolution,
  };
}
