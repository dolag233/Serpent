import { useEffect, useRef, useState } from "react";

import type { SerpentLibraryApi } from "../shared/library-api";
import { textCardPreviewSnippet } from "../shared/text-media";
import { useT } from "./i18n";

const previewCache = new Map<string, string>();
const previewInFlight = new Map<string, Promise<string | null>>();
const previewGenerations = new Map<string, number>();

function cacheKey(libraryId: string, assetId: string, revisionId: string): string {
  return `${libraryId}:${assetId}:${revisionId}`;
}

export type TextAssetPreviewTileProps = {
  api: SerpentLibraryApi;
  libraryId: string;
  assetId: string;
  /** Busts cache when the text revision changes. */
  revisionId: string;
  className?: string;
  snippetClassName?: string;
  /** Inspector card-feel tilt host (experiment/card-feel-preview subset). */
  cardFeelTilt?: boolean;
};

/**
 * Shared 4:3 text preview tile for Inspector hero and browse cards.
 * Loads a capped UTF-8 prefix via Worker IPC and caches by revision.
 */
export function TextAssetPreviewTile({
  api,
  libraryId,
  assetId,
  revisionId,
  className = "text-asset-preview",
  snippetClassName = "text-asset-preview-snippet",
  cardFeelTilt = false,
}: TextAssetPreviewTileProps) {
  const t = useT();
  const tileRef = useRef<HTMLDivElement>(null);
  const key = cacheKey(libraryId, assetId, revisionId);
  const [snippet, setSnippet] = useState<string | null>(
    () => previewCache.get(key) ?? null,
  );

  useEffect(() => {
    const cached = previewCache.get(key);
    if (cached != null) {
      queueMicrotask(() => setSnippet(cached));
      return;
    }
    let cancelled = false;
    queueMicrotask(() => setSnippet(null));

    const load = (): void => {
      if (cancelled) return;
      const existing = previewInFlight.get(key);
      const generation = previewGenerations.get(key) ?? 0;
      if (!previewGenerations.has(key)) previewGenerations.set(key, generation);
      const request = existing ?? api
        .readTextAsset({ libraryId, assetId, maxBytes: 2048 })
        .then((result) => {
          if (!result.ok) return null;
          const next = textCardPreviewSnippet(result.value.content);
          if ((previewGenerations.get(key) ?? 0) !== generation) return null;
          previewCache.set(key, next);
          return next;
        })
        .catch(() => null);
      if (!existing) {
        previewInFlight.set(key, request);
        void request.finally(() => {
          if (previewInFlight.get(key) === request) previewInFlight.delete(key);
          if (!previewInFlight.has(key)) previewGenerations.delete(key);
        });
      }
      void request.then((next) => {
        if (!cancelled && next != null) setSnippet(next);
      });
    };

    const tile = tileRef.current;
    if (!tile || typeof IntersectionObserver === "undefined") {
      load();
      return () => {
        cancelled = true;
      };
    }
    // A browse response can contain hundreds of text assets. Do not enqueue a
    // Worker read for every mounted card; only cards entering the viewport
    // need a snippet. The Inspector hero is visible immediately and follows
    // the same path. This keeps text previews from competing with thumbnails,
    // search and viewer requests in the shared Worker queue (Serpent-29125f).
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        load();
      },
      { root: null, rootMargin: "240px" },
    );
    observer.observe(tile);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [api, assetId, key, libraryId]);

  return (
    <div
      className={className}
      ref={tileRef}
      {...(cardFeelTilt ? { "data-card-feel-tilt": "" } : {})}
    >
      <pre className={snippetClassName}>
        {snippet ?? t("preview.textLoading")}
      </pre>
    </div>
  );
}

/** Drop cached snippets after an in-app text save so cards refresh. */
export function invalidateTextAssetPreviewCache(
  libraryId: string,
  assetId: string,
): void {
  const prefix = `${libraryId}:${assetId}:`;
  for (const key of previewCache.keys()) {
    if (key.startsWith(prefix)) previewCache.delete(key);
  }
  for (const key of previewInFlight.keys()) {
    if (key.startsWith(prefix)) previewInFlight.delete(key);
  }
  for (const key of previewGenerations.keys()) {
    if (key.startsWith(prefix)) {
      previewGenerations.set(key, (previewGenerations.get(key) ?? 0) + 1);
    }
  }
}
