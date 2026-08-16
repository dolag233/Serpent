/**
 * Serpent-ws4k / Serpent-87pd: paginated browse/search loading controller.
 *
 * First page (BROWSE_PAGE_SIZE) paints immediately; the canvas is expanded to
 * `total` placeholder slots so the scrollbar matches the scope. Scroll jumps
 * fetch the window at that offset instead of appending 0, 100, 200… in order.
 * Select-all / invert still resolve the full scope id set on demand (idsOnly).
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
  browsePageOffsetsForRange,
  mergeBrowseWindow,
} from "./browse-window-slots";

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
  setSearchTotal: Dispatch<SetStateAction<number | null>>;
  setSearchOffset: Dispatch<SetStateAction<number>>;
  setSearchSnippets: Dispatch<SetStateAction<Map<string, string>>>;
  /** Called once when a current-generation page fetch fails (scope deleted mid-scroll). */
  onLoadMoreFailed?: () => void;
};

export type UseBrowsePaginationResult = {
  /** Register a brand-new query/scope; expands the canvas to `total` slots. */
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
    setSearchTotal,
    setSearchOffset,
    setSearchSnippets,
    onLoadMoreFailed,
  } = args;

  const definitionRef = useRef<BrowsePageDefinition | null>(null);
  const generationRef = useRef(0);
  const visibleRangeGenerationRef = useRef(0);
  const totalRef = useRef(0);
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
      visibleRangeGenerationRef.current += 1;
      inFlightOffsetsRef.current = new Set();
      deletedIdsRef.current = new Set();
      totalRef.current = firstPage.total;
      const filled = new Set<number>();
      filled.add(browsePageOffset(firstPage.offset, BROWSE_PAGE_SIZE));
      filledOffsetsRef.current = filled;
      setLoadingMore(false);
      setSearchOffset(firstPage.offset + firstPage.items.length);
      setSearchTotal(firstPage.total);
      refreshHasMore(firstPage.total, filled);
      applyTarget(definition)(
        mergeBrowseWindow({
          current: [],
          total: firstPage.total,
          offset: firstPage.offset,
          items: firstPage.items,
        }),
      );
    },
    [applyTarget, refreshHasMore, setSearchOffset, setSearchTotal],
  );

  const fetchPageAt = useCallback(
    async (offset: number, generation: number) => {
      const definition = definitionRef.current;
      if (!definition || !api) return;
      if (filledOffsetsRef.current.has(offset)) return;
      if (inFlightOffsetsRef.current.has(offset)) return;
      inFlightOffsetsRef.current.add(offset);
      setLoadingMore(true);
      try {
        const result =
          definition.kind === "smart-collection"
            ? await api.executeSmartCollection({
                libraryId: definition.libraryId,
                collectionId: definition.collectionId,
                limit: BROWSE_PAGE_SIZE,
                offset,
              })
            : await api.searchAssets({
                libraryId: definition.libraryId,
                query: definition.query,
                filters: definition.filters ?? undefined,
                scope: definition.scope ?? undefined,
                sort: definition.sort ?? undefined,
                showIgnored: definition.showIgnored,
                limit: BROWSE_PAGE_SIZE,
                offset,
              });
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
        filledOffsetsRef.current.add(offset);
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
          mergeBrowseWindow({
            current,
            total: totalRef.current,
            offset,
            items: liveItems,
          }),
        );
      } finally {
        inFlightOffsetsRef.current.delete(offset);
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
      visibleRangeGenerationRef.current += 1;
      const rangeGeneration = visibleRangeGenerationRef.current;
      const offsets = browsePageOffsetsForRange({
        startIndex,
        endIndex,
        total: totalRef.current,
        pageSize: BROWSE_PAGE_SIZE,
      }).filter((offset) => !filledOffsetsRef.current.has(offset));
      if (offsets.length === 0) return;
      for (const offset of offsets) {
        if (generation !== generationRef.current) return;
        if (rangeGeneration !== visibleRangeGenerationRef.current) return;
        await fetchPageAt(offset, generation);
        if (rangeGeneration !== visibleRangeGenerationRef.current) return;
      }
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
      setHasMorePages(
        [...filledOffsetsRef.current].length * BROWSE_PAGE_SIZE < totalRef.current,
      );
    },
    [],
  );

  const reset = useCallback(() => {
    definitionRef.current = null;
    generationRef.current += 1;
    visibleRangeGenerationRef.current += 1;
    totalRef.current = 0;
    filledOffsetsRef.current = new Set();
    inFlightOffsetsRef.current = new Set();
    setLoadingMore(false);
    setHasMorePages(false);
  }, []);

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
