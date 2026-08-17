/**
 * Serpent-ws4k / Serpent-sa65: virtualized browse/search loading controller.
 *
 * First page paints immediately; a compact full-scope identity/geometry index
 * owns scrollbar layout. Scroll jumps fetch only the contiguous real-summary
 * pages intersecting the viewport. No synthetic AssetSummary cards exist.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import type {
  AssetSummary,
  BrowseLayoutEntry,
  FilterClause,
  SearchQuery,
  SearchScope,
  SortDefinition,
} from "../shared/asset-types";
import type { SerpentLibraryApi } from "../shared/library-api";
import {
  browseLoadMoreObserverRoot,
  excludeLocallyDeletedAssets,
} from "./asset-browse-load-more";
import {
  browsePageOffset,
  contiguousBrowsePageRuns,
  mergeLoadedBrowsePage,
} from "./browse-window-slots";

const browseDiagnosticsEnabled = Boolean(
  (globalThis as typeof globalThis & {
    serpent?: { e2e?: unknown };
  }).serpent?.e2e,
);

/** Page size for browse/search first load and window fetches. */
export const BROWSE_PAGE_SIZE = 100;

export type BrowsePageDefinition =
  | {
      kind: "search";
      libraryId: string;
      query: SearchQuery | null;
      filters?: FilterClause[] | null;
      scope?: SearchScope | null;
      sort?: SortDefinition | null;
      showIgnored: boolean;
      target: "assets" | "trash";
    }
  | {
      kind: "smart-collection";
      libraryId: string;
      collectionId: string;
      target: "assets";
    };

export type BrowseFirstPage = {
  items: AssetSummary[];
  total: number;
  offset: number;
};

export type BeginBrowsePage = (
  definition: BrowsePageDefinition,
  firstPage: BrowseFirstPage,
) => void;

/**
 * Fetch the full-scope id set for select-all / invert (idsOnly). Pure helper —
 * the hook wraps it in a generation guard so a stale result is never applied.
 */
export async function fetchBrowseScopeIds(options: {
  api: SerpentLibraryApi;
  definition: BrowsePageDefinition;
}): Promise<string[] | null> {
  const { api, definition } = options;
  if (definition.kind === "smart-collection") {
    const result = await api.executeSmartCollection({
      libraryId: definition.libraryId,
      collectionId: definition.collectionId,
      idsOnly: true,
    });
    return result.ok ? (result.value.assetIds ?? []) : null;
  }
  const result = await api.searchAssets({
    libraryId: definition.libraryId,
    query: definition.query,
    filters: definition.filters ?? undefined,
    scope: definition.scope ?? undefined,
    sort: definition.sort ?? undefined,
    showIgnored: definition.showIgnored,
    idsOnly: true,
  });
  return result.ok ? (result.value.assetIds ?? []) : null;
}

/** Fetch only the full-scope identity + geometry index used by virtual layout. */
export async function fetchBrowseLayout(options: {
  api: SerpentLibraryApi;
  definition: BrowsePageDefinition;
}): Promise<BrowseLayoutEntry[] | null> {
  const { api, definition } = options;
  const result = definition.kind === "smart-collection"
    ? await api.executeSmartCollection({
        libraryId: definition.libraryId,
        collectionId: definition.collectionId,
        layoutOnly: true,
      })
    : await api.searchAssets({
        libraryId: definition.libraryId,
        query: definition.query,
        filters: definition.filters ?? undefined,
        scope: definition.scope ?? undefined,
        sort: definition.sort ?? undefined,
        showIgnored: definition.showIgnored,
        layoutOnly: true,
      });
  return result.ok && result.value.layout !== undefined
    ? result.value.layout
    : null;
}

/**
 * Guard a scope-id fetch against a superseded browse definition (Serpent-ws4k
 * review). The captured generation is compared again after the await: switching
 * folder/scope while the ids query is in flight bumps the controller
 * generation, so the stale id set is discarded instead of being applied to the
 * new scope's selection.
 *
 * Returns null both on failure and on staleness. Callers treat null/empty as a
 * no-op — they must not clear an existing selection: the synchronous
 * pre-pagination behavior only reached an empty id set through an empty scope,
 * where the keyboard/menu guards already no-op'd (see
 * dispatchSelectionKeyboardAction / hasBrowseAssets).
 */
export async function fetchBrowseScopeAssetIdsGuarded(options: {
  api: SerpentLibraryApi | null;
  definition: BrowsePageDefinition | null;
  currentGeneration: () => number;
  fetch?: (input: {
    api: SerpentLibraryApi;
    definition: BrowsePageDefinition;
  }) => Promise<string[] | null>;
}): Promise<string[] | null> {
  const { api, definition, currentGeneration } = options;
  const fetchImpl = options.fetch ?? fetchBrowseScopeIds;
  if (!api || !definition) return null;
  const generation = currentGeneration();
  const ids = await fetchImpl({ api, definition });
  if (generation !== currentGeneration()) return null;
  return ids;
}

export type BrowseSearchPageRegistration = {
  libraryId: string;
  query: SearchQuery | null;
  filters?: FilterClause[] | null;
  scope?: SearchScope | null;
  sort?: SortDefinition | null;
  showIgnored: boolean;
  target?: "assets" | "trash";
  items: AssetSummary[];
  total: number;
  offset: number;
};

/** Shared registration for every search-shaped first page (Serpent-ws4k). */
export function registerBrowseSearchPage(
  beginPage: BeginBrowsePage,
  input: BrowseSearchPageRegistration,
): void {
  beginPage(
    {
      kind: "search",
      libraryId: input.libraryId,
      query: input.query,
      filters: input.filters ?? null,
      scope: input.scope ?? null,
      sort: input.sort ?? null,
      showIgnored: input.showIgnored,
      target: input.target ?? "assets",
    },
    { items: input.items, total: input.total, offset: input.offset },
  );
}

export type BrowseSmartCollectionPageRegistration = {
  libraryId: string;
  collectionId: string;
  items: AssetSummary[];
  total: number;
  offset: number;
};

/** Shared registration for smart-collection first pages (Serpent-ws4k). */
export function registerBrowseSmartCollectionPage(
  beginPage: BeginBrowsePage,
  input: BrowseSmartCollectionPageRegistration,
): void {
  beginPage(
    {
      kind: "smart-collection",
      libraryId: input.libraryId,
      collectionId: input.collectionId,
      target: "assets",
    },
    { items: input.items, total: input.total, offset: input.offset },
  );
}

export type UseBrowsePaginationArgs = {
  api: SerpentLibraryApi | null;
  setAssets: Dispatch<SetStateAction<AssetSummary[]>>;
  setTrashedAssets: Dispatch<SetStateAction<AssetSummary[]>>;
  setBrowseLayout: Dispatch<SetStateAction<BrowseLayoutEntry[]>>;
  setSearchTotal: Dispatch<SetStateAction<number | null>>;
  setSearchOffset: Dispatch<SetStateAction<number>>;
  setSearchSnippets: Dispatch<SetStateAction<Map<string, string>>>;
  /** Called once when a current-generation page fetch fails (scope deleted mid-scroll). */
  onLoadMoreFailed?: () => void;
};

export type UseBrowsePaginationResult = {
  /** Register a brand-new query/scope and begin its compact layout fetch. */
  beginPage: (definition: BrowsePageDefinition, firstPage: BrowseFirstPage) => void;
  /** Fetch the page covering this index range (scrollbar jumps, not sequential). */
  ensureVisibleRange: (startIndex: number, endIndex: number) => Promise<void>;
  /** Fetch the next unfilled page (scroll sentinel fallback). */
  appendNextPage: () => Promise<void>;
  /** Full-scope asset ids for select-all / invert (idsOnly query). */
  fetchScopeAssetIds: () => Promise<string[] | null>;
  /**
   * Serpent-关联刷新: fold a local deletion into the pagination bookkeeping so
   * an in-flight/next append cannot resurrect deleted rows and the offset
   * counters stay consistent until the deferred full reconcile re-registers.
   */
  removeLocally: (assetIds: string[], removedCount: number) => void;
  /** Drop the current definition (library close / navigation to non-browse views). */
  reset: () => void;
  hasMorePages: boolean;
  loadingMore: boolean;
  sentinelRef: (node: HTMLDivElement | null) => void;
};

/**
 * Worker discards a superseded browse-window search by returning an empty
 * page (`items: []`, `total: 0`) instead of CANCELLED. Do not treat that as
 * an empty library or as a filled offset — especially offset 0, which the
 * older `offset > 0` guard would apply and then refuse to refetch.
 */
export function isDiscardedBrowseWindowPage(
  page: { items: readonly unknown[]; total: number },
  requestOffset: number,
  knownTotal: number,
): boolean {
  return (
    page.items.length === 0 &&
    page.total === 0 &&
    (requestOffset > 0 || knownTotal > 0)
  );
}

export function isIgnorableBrowseWindowFailure(code: string | undefined): boolean {
  return code === "CANCELLED";
}

export function useBrowsePagination(
  args: UseBrowsePaginationArgs,
): UseBrowsePaginationResult {
  const {
    api,
    setAssets,
    setTrashedAssets,
    setBrowseLayout,
    setSearchTotal,
    setSearchOffset,
    setSearchSnippets,
    onLoadMoreFailed,
  } = args;

  const definitionRef = useRef<BrowsePageDefinition | null>(null);
  const generationRef = useRef(0);
  const totalRef = useRef(0);
  const layoutRef = useRef<BrowseLayoutEntry[]>([]);
  const filledOffsetsRef = useRef<Set<number>>(new Set());
  const inFlightOffsetsRef = useRef<Set<number>>(new Set());
  const deletedIdsRef = useRef<Set<string>>(new Set());
  const [hasMorePages, setHasMorePages] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sentinelNode, setSentinelNode] = useState<HTMLDivElement | null>(null);

  const applyTarget = useCallback(
    (definition: BrowsePageDefinition) =>
      definition.target === "trash" ? setTrashedAssets : setAssets,
    [setAssets, setTrashedAssets],
  );

  const refreshHasMore = useCallback((total: number, filled: ReadonlySet<number>) => {
    for (let offset = 0; offset < total; offset += BROWSE_PAGE_SIZE) {
      if (!filled.has(offset)) {
        setHasMorePages(true);
        return;
      }
    }
    setHasMorePages(false);
  }, []);

  const beginPage = useCallback(
    (definition: BrowsePageDefinition, firstPage: BrowseFirstPage) => {
      definitionRef.current = definition;
      generationRef.current += 1;
      inFlightOffsetsRef.current = new Set();
      deletedIdsRef.current = new Set();
      totalRef.current = firstPage.total;
      const initialLayout = firstPage.items.map((asset) => ({
        assetId: asset.assetId,
        width: asset.width,
        height: asset.height,
        previewArtifactId: asset.thumbnailArtifactId,
      }));
      layoutRef.current = initialLayout;
      setBrowseLayout(initialLayout);
      const filled = new Set<number>();
      filled.add(browsePageOffset(firstPage.offset, BROWSE_PAGE_SIZE));
      filledOffsetsRef.current = filled;
      setLoadingMore(false);
      setSearchOffset(firstPage.offset + firstPage.items.length);
      setSearchTotal(firstPage.total);
      refreshHasMore(firstPage.total, filled);
      applyTarget(definition)([...firstPage.items]);
      const generation = generationRef.current;
      if (api) {
        void fetchBrowseLayout({ api, definition }).then((layout) => {
          // A superseded/failed layout response must never erase the compact
          // geometry that currently owns the scrollbar. An actually empty
          // scope is valid only when the first page also reported total=0.
          if (
            !layout
            || generation !== generationRef.current
            || (layout.length === 0 && totalRef.current > 0)
          ) return;
          layoutRef.current = layout;
          setBrowseLayout(layout);
          applyTarget(definition)((current) =>
            mergeLoadedBrowsePage({ current, items: [], layout }),
          );
        });
      }
    },
    [api, applyTarget, refreshHasMore, setBrowseLayout, setSearchOffset, setSearchTotal],
  );

  const fetchPageAt = useCallback(
    async (offset: number, generation: number, limit = BROWSE_PAGE_SIZE) => {
      const definition = definitionRef.current;
      if (!definition || !api) return;
      const coveredOffsets: number[] = [];
      for (
        let covered = offset;
        covered < Math.min(totalRef.current, offset + limit);
        covered += BROWSE_PAGE_SIZE
      ) {
        coveredOffsets.push(covered);
      }
      if (coveredOffsets.every((covered) => filledOffsetsRef.current.has(covered))) return;
      if (coveredOffsets.some((covered) => inFlightOffsetsRef.current.has(covered))) return;
      for (const covered of coveredOffsets) inFlightOffsetsRef.current.add(covered);
      setLoadingMore(true);
      try {
        const result =
          definition.kind === "smart-collection"
            ? await api.executeSmartCollection({
                libraryId: definition.libraryId,
                collectionId: definition.collectionId,
                limit,
                offset,
              })
            : await api.searchAssets({
                libraryId: definition.libraryId,
                query: definition.query,
                filters: definition.filters ?? undefined,
                scope: definition.scope ?? undefined,
                sort: definition.sort ?? undefined,
                showIgnored: definition.showIgnored,
                limit,
                offset,
              });
        if (browseDiagnosticsEnabled) {
          window.dispatchEvent(new CustomEvent("serpent:e2e-browse-result", {
            detail: {
              requestOffset: offset,
              requestLimit: limit,
              ok: result.ok,
              errorCode: result.ok ? null : result.error.code,
              currentGeneration: generationRef.current,
              requestGeneration: generation,
            },
          }));
        }
        if (generation !== generationRef.current) return;
        if (!result.ok) {
          if (isIgnorableBrowseWindowFailure(result.error.code)) return;
          setHasMorePages(false);
          onLoadMoreFailed?.();
          return;
        }
        const page = result.value as {
          items: AssetSummary[];
          total: number;
          offset: number;
          snippets?: Array<{ assetId: string; text: string }>;
        };
        if (browseDiagnosticsEnabled) {
          window.dispatchEvent(new CustomEvent("serpent:e2e-browse-page", {
            detail: {
              requestOffset: offset,
              requestLimit: limit,
              resultOffset: page.offset,
              itemCount: page.items.length,
              firstAssetId: page.items[0]?.assetId ?? null,
              lastAssetId: page.items.at(-1)?.assetId ?? null,
            },
          }));
        }
        if (isDiscardedBrowseWindowPage(page, offset, totalRef.current)) return;
        const liveItems = excludeLocallyDeletedAssets(
          page.items,
          deletedIdsRef.current,
        );
        if (offset === 0 && page.total > 0) {
          totalRef.current = page.total;
        } else if (page.total > totalRef.current) {
          totalRef.current = page.total;
        }
        for (let index = 0; index < page.items.length; index += BROWSE_PAGE_SIZE) {
          filledOffsetsRef.current.add(offset + index);
        }
        setSearchTotal(totalRef.current);
        setSearchOffset(offset + page.items.length);
        refreshHasMore(totalRef.current, filledOffsetsRef.current);
        const snippets = page.snippets ?? [];
        if (snippets.length > 0) {
          setSearchSnippets((current) => {
            const next = new Map(current);
            for (const snippet of snippets) {
              next.set(snippet.assetId, snippet.text);
            }
            return next;
          });
        }
        applyTarget(definition)((current) =>
          mergeLoadedBrowsePage({
            current,
            items: liveItems,
            layout: layoutRef.current,
          }),
        );
      } finally {
        for (const covered of coveredOffsets) {
          inFlightOffsetsRef.current.delete(covered);
        }
        if (inFlightOffsetsRef.current.size === 0) setLoadingMore(false);
      }
    },
    [
      api,
      applyTarget,
      onLoadMoreFailed,
      refreshHasMore,
      setSearchOffset,
      setSearchSnippets,
      setSearchTotal,
    ],
  );

  const ensureVisibleRange = useCallback(
    async (startIndex: number, endIndex: number) => {
      const definition = definitionRef.current;
      if (!definition || !api) return;
      const generation = generationRef.current;
      const firstOffset = browsePageOffset(
        Math.max(0, Math.min(startIndex, endIndex)),
        BROWSE_PAGE_SIZE,
      );
      const lastOffset = browsePageOffset(
        Math.min(totalRef.current - 1, Math.max(startIndex, endIndex)),
        BROWSE_PAGE_SIZE,
      );
      const offsets: number[] = [];
      for (let offset = firstOffset; offset <= lastOffset; offset += BROWSE_PAGE_SIZE) {
        if (
          !filledOffsetsRef.current.has(offset)
          && !inFlightOffsetsRef.current.has(offset)
        ) offsets.push(offset);
      }
      if (offsets.length === 0) return;
      // Do not let an older in-flight page block a new destination. Split the
      // missing pages around in-flight gaps, then request the contiguous run
      // nearest the viewport center. This keeps the latest search lane
      // serialized while still allowing a jump from page A to page B to make
      // progress when A is already being fetched.
      const runs = contiguousBrowsePageRuns(offsets, BROWSE_PAGE_SIZE);
      const center = (startIndex + endIndex) / 2;
      runs.sort((left, right) => {
        const leftCenter = ((left[0] ?? center) + (left.at(-1) ?? center)) / 2;
        const rightCenter = ((right[0] ?? center) + (right.at(-1) ?? center)) / 2;
        return Math.abs(leftCenter - center) - Math.abs(rightCenter - center);
      });
      const selectedRun = runs[0]!;
      const requestOffset = selectedRun[0]!;
      const requestLimit = Math.min(
        500,
        selectedRun.at(-1)! - requestOffset + BROWSE_PAGE_SIZE,
      );
      await fetchPageAt(requestOffset, generation, requestLimit);
    },
    [api, fetchPageAt],
  );

  const appendNextPage = useCallback(async () => {
    const total = totalRef.current;
    if (total <= 0) return;
    // The sentinel sits after the last slot. Fill the tail window — never the
    // first unfilled offset — so a jump to the end is not queued behind
    // pages 0, 100, 200…
    const last = Math.max(0, total - 1);
    await ensureVisibleRange(last, last);
  }, [ensureVisibleRange]);

  const fetchScopeAssetIds = useCallback(
    (): Promise<string[] | null> =>
      fetchBrowseScopeAssetIdsGuarded({
        api,
        definition: definitionRef.current,
        currentGeneration: () => generationRef.current,
      }),
    [api],
  );

  const removeLocally = useCallback(
    (assetIds: string[], removedCount: number) => {
      for (const assetId of assetIds) {
        deletedIdsRef.current.add(assetId);
      }
      totalRef.current = Math.max(0, totalRef.current - removedCount);
      const removed = new Set(assetIds);
      layoutRef.current = layoutRef.current.filter(
        (entry) => !removed.has(entry.assetId),
      );
      setBrowseLayout(layoutRef.current);
      refreshHasMore(totalRef.current, filledOffsetsRef.current);
    },
    [refreshHasMore, setBrowseLayout],
  );

  const reset = useCallback(() => {
    definitionRef.current = null;
    generationRef.current += 1;
    totalRef.current = 0;
    layoutRef.current = [];
    setBrowseLayout([]);
    filledOffsetsRef.current = new Set();
    inFlightOffsetsRef.current = new Set();
    setLoadingMore(false);
    setHasMorePages(false);
  }, [setBrowseLayout]);

  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    setSentinelNode(node);
  }, []);

  useEffect(() => {
    if (!sentinelNode) return;
    const root = browseLoadMoreObserverRoot(sentinelNode);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) void appendNextPage();
        }
      },
      { root, rootMargin: "800px 0px" },
    );
    observer.observe(sentinelNode);
    return () => observer.disconnect();
  }, [appendNextPage, sentinelNode]);

  return {
    beginPage,
    ensureVisibleRange,
    appendNextPage,
    fetchScopeAssetIds,
    removeLocally,
    reset,
    hasMorePages,
    loadingMore,
    sentinelRef,
  };
}
