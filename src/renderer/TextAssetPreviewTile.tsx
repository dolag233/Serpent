import { useEffect, useState } from "react";

import type { SerpentLibraryApi } from "../shared/library-api";
import { textCardPreviewSnippet } from "../shared/text-media";
import { useT } from "./i18n";

const previewCache = new Map<string, string>();

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
  const key = cacheKey(libraryId, assetId, revisionId);
  const [snippet, setSnippet] = useState<string | null>(
    () => previewCache.get(key) ?? null,
  );

  useEffect(() => {
    const cached = previewCache.get(key);
    if (cached != null) {
      setSnippet(cached);
      return;
    }
    let cancelled = false;
    setSnippet(null);
    void api
      .readTextAsset({ libraryId, assetId, maxBytes: 2048 })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) return;
        const next = textCardPreviewSnippet(result.value.content);
        previewCache.set(key, next);
        setSnippet(next);
      })
      .catch(() => {
        // Best-effort; keep loading/empty state.
      });
    return () => {
      cancelled = true;
    };
  }, [api, assetId, key, libraryId]);

  return (
    <div
      className={className}
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
}
