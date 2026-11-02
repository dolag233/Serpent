import { useCallback, useRef } from "react";

import type {
  AssetSummary,
  BrowseLayoutEntry,
} from "../../shared/asset-types";
import {
  createVirtualBrowseLayout,
  createVirtualBrowseLayoutFromIndex,
  evictVirtualSummaryPage,
  geometryPlaceholderId,
  isGeometryPlaceholder,
  materializeVirtualLoadedEntries,
  mergeVirtualSummaryPage,
  patchVirtualLayoutGeometry,
  patchVirtualLayoutPreviews,
  removeVirtualLayoutEntries,
  virtualIndexMatchesFirstPage,
  virtualSummaryAssetIds,
  type VirtualBrowseLayout,
} from "./virtual-browse-layout";
import { captureVirtualScrollAnchorsBeforeGeometryChange } from "./virtual-scroll-anchor-signal";

/**
 * Largest scope whose complete compact index is fetched in one request.
 *
 * CANVAS-038 pulls one `layoutOnly` index so geometry commits exactly once. That
 * is right for ordinary libraries, but the cost scales linearly with COUNT: the
 * payload, the Zod validation on both sides of the IPC boundary, the four index
 * maps and the compact array are all O(scope), and they run on the renderer's
 * main thread. Switching to a very large library stalled the app behind the
 * loading overlay, so above this bound the index is no longer fetched in one
 * shot: identity and geometry fill in from the already bounded (100-row) summary
 * pages as the user scrolls. Slots stay keyed by index, so nothing remounts —
 * only the still-unmeasured tail keeps its estimated height.
 */
export const BROWSE_FULL_INDEX_MAX_ASSETS = 5_000;

/** True when a scope may load its complete compact index in one request. */
export function shouldFetchCompleteBrowseIndex(total: number): boolean {
  const safeTotal = Math.max(0, Math.trunc(total));
  return safeTotal <= BROWSE_FULL_INDEX_MAX_ASSETS;
}

/**
 * True when COUNT is larger than the first painted page. Those scopes must keep
 * a stable full-range canvas from the first frame: publishing only the loaded
 * prefix makes the scrollbar track the loaded subset (100, 200, …) and then jump.
 */
export function shouldUseVirtualBrowseLayout(input: {
  sessionId?: string;
  total: number;
  firstPageCount: number;
}): boolean {
  if (!input.sessionId) return false;
  const total = Math.max(0, Math.trunc(input.total));
  const firstPageCount = Math.max(0, Math.trunc(input.firstPageCount));
  return total > 0 && firstPageCount < total;
}

/** Full summaries are much heavier than geometry; keep only a small LRU. */
export const BROWSE_SUMMARY_PAGE_CACHE_LIMIT = 24;
const BROWSE_SUMMARY_PAGE_SIZE = 100;

export {
  geometryPlaceholderId,
  isGeometryPlaceholder,
  type VirtualBrowseLayout,
};

export type VirtualBrowseSessionArgs = {
  setBrowseLayout: (layout: BrowseLayoutEntry[]) => void;
  setVirtualBrowseLayout: (layout: VirtualBrowseLayout | null) => void;
};

export type VirtualBrowseSessionLocalSnapshot = {
  layout: BrowseLayoutEntry[];
  virtualLayout: VirtualBrowseLayout | null;
};

/**
 * Owns the Renderer-side geometry index for one BrowseSession.
 *
 * CANVAS-038: geometry is committed exactly once per scope, from the complete
 * compact index, and never revised afterwards. The previous design fetched
 * 128-row geometry blocks as the user scrolled, so every arrival rewrote heights
 * and identities mid-scroll — the scrollbar thumb tracked loaded blocks and
 * each revision re-sliced the window, unmounting and re-requesting visible
 * covers. Summary pages remain paged and LRU-bounded; they only patch fields.
 */
export function useVirtualBrowseSession({
  setBrowseLayout,
  setVirtualBrowseLayout,
}: VirtualBrowseSessionArgs) {
  const sessionRef = useRef<{
    libraryId: string;
    sessionId: string;
    total: number;
    generation: number;
    virtualized: boolean;
  } | null>(null);
  const layoutRef = useRef<BrowseLayoutEntry[]>([]);
  const virtualLayoutRef = useRef<VirtualBrowseLayout | null>(null);
  const summaryPagesRef = useRef(new Map<number, true>());
  /**
   * Set when the published compact array no longer matches the virtual index.
   * `getLayout()` rebuilds on demand instead of every patch rebuilding eagerly:
   * a scope-sized rebuild plus a shell re-render on each summary page measured as
   * 4–30 extra page-request waves per scroll jump at 20k (CANVAS-038).
   */
  const layoutDirtyRef = useRef(false);

  const touchSummaryPages = useCallback((startIndex: number, endIndex = startIndex) => {
    const first = Math.max(0, Math.floor(Math.min(startIndex, endIndex) / BROWSE_SUMMARY_PAGE_SIZE) * BROWSE_SUMMARY_PAGE_SIZE);
    const last = Math.max(first, Math.floor(Math.max(startIndex, endIndex) / BROWSE_SUMMARY_PAGE_SIZE) * BROWSE_SUMMARY_PAGE_SIZE);
    for (let pageStart = first; pageStart <= last; pageStart += BROWSE_SUMMARY_PAGE_SIZE) {
      if (!summaryPagesRef.current.has(pageStart)) continue;
      summaryPagesRef.current.delete(pageStart);
      summaryPagesRef.current.set(pageStart, true);
    }
  }, []);

  const registerSummaryPages = useCallback((offset: number, itemCount: number) => {
    const first = Math.max(0, Math.floor(Math.max(0, offset) / BROWSE_SUMMARY_PAGE_SIZE) * BROWSE_SUMMARY_PAGE_SIZE);
    const last = Math.max(
      first,
      Math.floor(Math.max(0, offset + Math.max(0, itemCount - 1)) / BROWSE_SUMMARY_PAGE_SIZE) * BROWSE_SUMMARY_PAGE_SIZE,
    );
    for (let pageStart = first; pageStart <= last; pageStart += BROWSE_SUMMARY_PAGE_SIZE) {
      summaryPagesRef.current.delete(pageStart);
      summaryPagesRef.current.set(pageStart, true);
    }
  }, []);

  const begin = useCallback((input: {
    libraryId: string;
    sessionId?: string;
    total: number;
    generation: number;
    firstPage: { items: readonly AssetSummary[]; offset: number };
  }) => {
    const virtualized = shouldUseVirtualBrowseLayout({
      sessionId: input.sessionId,
      total: input.total,
      firstPageCount: input.firstPage.items.length,
    });
    sessionRef.current = {
      libraryId: input.libraryId,
      sessionId: input.sessionId ?? "",
      total: input.total,
      generation: input.generation,
      virtualized,
    };
    const previous = virtualLayoutRef.current;
    // A refresh of the same scope must not throw away the committed index: the
    // unresolved tail would fall back to estimated heights and move the
    // scrollbar (CANVAS-038). The fresh index overwrites this in a moment.
    const reusable = virtualized
      && previous !== null
      && previous.total === input.total
      && virtualIndexMatchesFirstPage(previous, input.firstPage);
    if (!reusable) summaryPagesRef.current.clear();
    const nextVirtualLayout = virtualized
      ? (reusable ? previous : createVirtualBrowseLayout(input))
      : null;
    if (virtualized && !reusable) {
      registerSummaryPages(input.firstPage.offset, input.firstPage.items.length);
    }
    virtualLayoutRef.current = nextVirtualLayout;
    // Serpent-9cfc8c: a first window of 100 is not the full geometry index.
    // Publishing it as layout made Masonry/Justified clip the canvas to those
    // 100 cards. Scopes that fit in one page keep that compact array; larger
    // sessions use VirtualBrowseLayout.total for scrollbar height until the
    // complete index commits a moment later.
    const firstPageCoversScope = input.firstPage.items.length >= input.total;
    layoutRef.current = virtualized
      ? materializeVirtualLoadedEntries(nextVirtualLayout!)
      : firstPageCoversScope
        ? input.firstPage.items.map((asset) => ({
            assetId: asset.assetId,
            width: asset.width,
            height: asset.height,
            previewArtifactId: asset.thumbnailArtifactId,
            displayName: asset.displayName,
            relativeFilePath: asset.relativeFilePath,
            byteSize: asset.byteSize,
            modifiedAt: asset.modifiedAt,
            rating: asset.rating,
            mediaType: asset.mediaType,
          }))
        : [];
    setVirtualBrowseLayout(virtualLayoutRef.current);
    setBrowseLayout(layoutRef.current);
    layoutDirtyRef.current = false;
    return virtualized;
  }, [registerSummaryPages, setBrowseLayout, setVirtualBrowseLayout]);

  /**
   * Commit the complete compact index for this scope in one step. Positions the
   * index did not cover (a scope above BROWSE_SCOPE_MAX_ASSETS) stay geometry
   * placeholders; they resolve from summary pages without changing slot identity.
   */
  const seedIndex = useCallback((input: {
    total: number;
    entries: readonly BrowseLayoutEntry[];
  }): boolean => {
    const session = sessionRef.current;
    if (!session?.virtualized) return false;
    const next = createVirtualBrowseLayoutFromIndex(input);
    captureVirtualScrollAnchorsBeforeGeometryChange();
    // The seeded index replaces every loaded entry, so the previous summary-page
    // LRU no longer describes what is loaded; keeping it would let eviction drop
    // pages that were never registered against the new index.
    summaryPagesRef.current.clear();
    const firstPageCount = Math.min(next.total, Math.max(0, input.entries.length));
    if (firstPageCount > 0) registerSummaryPages(0, firstPageCount);
    virtualLayoutRef.current = next;
    layoutRef.current = materializeVirtualLoadedEntries(next);
    layoutDirtyRef.current = false;
    setVirtualBrowseLayout(next);
    setBrowseLayout(layoutRef.current);
    return true;
  }, [registerSummaryPages, setBrowseLayout, setVirtualBrowseLayout]);

  /** Keep the visible summary pages at the hot end of the LRU while scrolling. */
  const noteVisibleRange = useCallback((startIndex: number, endIndex: number) => {
    if (sessionRef.current?.virtualized !== true) return;
    touchSummaryPages(startIndex, endIndex);
  }, [touchSummaryPages]);

  const applySummaryPage = useCallback((input: {
    offset: number;
    items: readonly AssetSummary[];
  }): number[] => {
    const session = sessionRef.current;
    if (!session?.virtualized) return [];
    const current = virtualLayoutRef.current;
    if (!current) return [];
    registerSummaryPages(input.offset, input.items.length);
    let next = mergeVirtualSummaryPage(
      current,
      input.offset,
      input.items,
    );
    const evicted: number[] = [];
    while (summaryPagesRef.current.size > BROWSE_SUMMARY_PAGE_CACHE_LIMIT) {
      const oldest = summaryPagesRef.current.keys().next().value;
      if (oldest === undefined) break;
      summaryPagesRef.current.delete(oldest);
      next = evictVirtualSummaryPage(next, oldest, BROWSE_SUMMARY_PAGE_SIZE);
      evicted.push(oldest);
    }
    if (next.geometryRevision !== current.geometryRevision) {
      captureVirtualScrollAnchorsBeforeGeometryChange();
    }
    virtualLayoutRef.current = next;
    // Rendering always follows the virtual index.
    setVirtualBrowseLayout(next);
    // Slot identity is the only thing the compact array's consumers act on
    // (selection, shuffle, index lookup), and `mergeLayoutEntries` rebuilds
    // `assetIdsByIndex` exactly when an identity changed. Publishing state only
    // then avoids re-rendering the shell for caption/artifact-only patches.
    if (next.assetIdsByIndex !== current.assetIdsByIndex) {
      layoutRef.current = materializeVirtualLoadedEntries(next);
      layoutDirtyRef.current = false;
      setBrowseLayout(layoutRef.current);
    } else if (next.entries !== current.entries) {
      // Content-only change (summary fields, or eviction rewriting entries in
      // place with an unchanged size): imperative readers must not observe a
      // stale copy, so mark dirty and let `getLayout()` rebuild on demand. This
      // is what makes the size-based shortcut unsafe and the identity-based one
      // correct.
      layoutDirtyRef.current = true;
    }
    return evicted;
  }, [registerSummaryPages, setBrowseLayout, setVirtualBrowseLayout]);

  /** Compact array for legacy consumers; rebuilt lazily when a patch marked it dirty. */
  const getLayout = useCallback(() => {
    if (layoutDirtyRef.current && virtualLayoutRef.current) {
      layoutRef.current = materializeVirtualLoadedEntries(virtualLayoutRef.current);
      layoutDirtyRef.current = false;
    }
    return layoutRef.current;
  }, []);

  const getVirtualLayout = useCallback(() => virtualLayoutRef.current, []);

  const snapshotLocalState = useCallback((): VirtualBrowseSessionLocalSnapshot => ({
    layout: getLayout(),
    virtualLayout: virtualLayoutRef.current,
  }), [getLayout]);

  const restoreLocalState = useCallback((snapshot: VirtualBrowseSessionLocalSnapshot) => {
    layoutRef.current = snapshot.layout;
    virtualLayoutRef.current = snapshot.virtualLayout;
    layoutDirtyRef.current = false;
    setVirtualBrowseLayout(snapshot.virtualLayout);
    setBrowseLayout(snapshot.layout);
  }, [setBrowseLayout, setVirtualBrowseLayout]);

  const getLoadedSummaryAssetIds = useCallback(() => {
    const layout = virtualLayoutRef.current;
    return layout ? virtualSummaryAssetIds(layout) : null;
  }, []);

  const removeEntries = useCallback((assetIds: string[], removedCount: number) => {
    const current = virtualLayoutRef.current;
    if (!current) return;
    captureVirtualScrollAnchorsBeforeGeometryChange();
    virtualLayoutRef.current = removeVirtualLayoutEntries(
      current,
      assetIds,
      removedCount,
    );
    layoutRef.current = materializeVirtualLoadedEntries(virtualLayoutRef.current);
    layoutDirtyRef.current = false;
    setVirtualBrowseLayout(virtualLayoutRef.current);
    setBrowseLayout(layoutRef.current);
  }, [setBrowseLayout, setVirtualBrowseLayout]);

  const isVirtualized = useCallback(() => sessionRef.current?.virtualized === true, []);

  const applyGeometryPatches = useCallback((
    patches: ReadonlyMap<string, { width: number; height: number }>,
  ) => {
    if (patches.size === 0) return;
    const current = virtualLayoutRef.current;
    if (!current || sessionRef.current?.virtualized !== true) return;
    const next = patchVirtualLayoutGeometry(current, patches);
    if (next === current) return;
    captureVirtualScrollAnchorsBeforeGeometryChange();
    virtualLayoutRef.current = next;
    layoutRef.current = materializeVirtualLoadedEntries(next);
    layoutDirtyRef.current = false;
    setVirtualBrowseLayout(next);
    setBrowseLayout(layoutRef.current);
  }, [setBrowseLayout, setVirtualBrowseLayout]);

  const applyPreviewPatches = useCallback((
    patches: ReadonlyMap<string, {
      previewKind: 'source' | null;
      previewRevisionId: string | null;
    }>,
  ) => {
    if (patches.size === 0) return;
    const current = virtualLayoutRef.current;
    if (!current || sessionRef.current?.virtualized !== true) return;
    const next = patchVirtualLayoutPreviews(current, patches);
    if (next === current) return;
    virtualLayoutRef.current = next;
    layoutRef.current = materializeVirtualLoadedEntries(next);
    layoutDirtyRef.current = false;
    setVirtualBrowseLayout(next);
    setBrowseLayout(layoutRef.current);
  }, [setBrowseLayout, setVirtualBrowseLayout]);

  const reset = useCallback(() => {
    sessionRef.current = null;
    summaryPagesRef.current.clear();
    virtualLayoutRef.current = null;
    layoutRef.current = [];
    layoutDirtyRef.current = false;
    setVirtualBrowseLayout(null);
    setBrowseLayout([]);
  }, [setBrowseLayout, setVirtualBrowseLayout]);

  return {
    begin,
    seedIndex,
    noteVisibleRange,
    applySummaryPage,
    getLayout,
    getVirtualLayout,
    snapshotLocalState,
    restoreLocalState,
    getLoadedSummaryAssetIds,
    removeEntries,
    applyGeometryPatches,
    applyPreviewPatches,
    isVirtualized,
    reset,
  };
}
