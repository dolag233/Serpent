/**
 * Serpent-ws4k: paginated browse/search loading controller.
 *
 * The browse canvas used to fetch up to 50k AssetSummary rows in one Worker
 * query (scopeMode) and replace the whole list atomically. This hook splits
 * the fetch into pages: the first page (BROWSE_PAGE_SIZE) is applied by the
 * caller, a scroll sentinel appends the next page via an IntersectionObserver,
 * and select-all / invert resolve the full scope id set on demand (idsOnly).
 *
 * Every replace-path (folder switch, search, tag/collection/smart navigation,
 * session restore) re-registers the current definition through `beginPage`.
 * A stale in-flight page from a superseded definition is dropped by the
 * generation guard, mirroring searchRequestGenerationRef for first pages.
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
  appendAssetPage,
  browseLoadMoreObserverRoot,
  resolveSearchTotalAfterAppend,
} from "./asset-browse-load-more";

/** Page size for browse/search first load and scroll append (200–500). */
export const BROWSE_PAGE_SIZE = 300;

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
  /** Register a brand-new query/scope; the caller has already applied its first page. */
  beginPage: (definition: BrowsePageDefinition, firstPage: BrowseFirstPage) => void;
  /** Fetch and append the next page for the current definition (scroll sentinel). */
  appendNextPage: () => Promise<void>;
  /** Full-scope asset ids for select-all / invert (idsOnly query). */
  fetchScopeAssetIds: () => Promise<string[] | null>;
  /** Drop the current definition (library close / navigation to non-browse views). */
  reset: () => void;
  hasMorePages: boolean;
  loadingMore: boolean;
  sentinelRef: (node: HTMLDivElement | null) => void;
};

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
  const loadedRef = useRef(0);
  const totalRef = useRef(0);
  const loadedIdsRef = useRef<Set<string>>(new Set());
  const loadingRef = useRef(false);
  const [hasMorePages, setHasMorePages] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sentinelNode, setSentinelNode] = useState<HTMLDivElement | null>(null);

  const beginPage = useCallback(
    (definition: BrowsePageDefinition, firstPage: BrowseFirstPage) => {
      definitionRef.current = definition;
      generationRef.current += 1;
      loadingRef.current = false;
      setLoadingMore(false);
      loadedRef.current = firstPage.offset + firstPage.items.length;
      totalRef.current = firstPage.total;
      loadedIdsRef.current = new Set(firstPage.items.map((item) => item.assetId));
      setSearchOffset(loadedRef.current);
      setHasMorePages(loadedRef.current < firstPage.total);
    },
    [setSearchOffset],
  );

  const appendNextPage = useCallback(async () => {
    const definition = definitionRef.current;
    if (!definition || loadingRef.current) return;
    if (loadedRef.current >= totalRef.current) return;
    if (!api) return;
    const generation = generationRef.current;
    const requestOffset = loadedRef.current;
    loadingRef.current = true;
    setLoadingMore(true);
    try {
      const result =
        definition.kind === "smart-collection"
          ? await api.executeSmartCollection({
              libraryId: definition.libraryId,
              collectionId: definition.collectionId,
              limit: BROWSE_PAGE_SIZE,
              offset: requestOffset,
            })
          : await api.searchAssets({
              libraryId: definition.libraryId,
              query: definition.query,
              filters: definition.filters ?? undefined,
              scope: definition.scope ?? undefined,
              sort: definition.sort ?? undefined,
              showIgnored: definition.showIgnored,
              limit: BROWSE_PAGE_SIZE,
              offset: requestOffset,
            });
      if (generation !== generationRef.current) return;
      if (!result.ok) {
        // A failed page (e.g. the scope was deleted mid-scroll) stops the
        // sentinel from thrashing forever; the list keeps the rows it has.
        setHasMorePages(false);
        onLoadMoreFailed?.();
        return;
      }
      // searchAssets and executeSmartCollection share this page shape; only
      // the former carries snippets.
      const page = result.value as {
        items: AssetSummary[];
        total: number;
        offset: number;
        snippets?: Array<{ assetId: string; text: string }>;
      };
      const existingIds = loadedIdsRef.current;
      let newlyAdded = 0;
      for (const item of page.items) {
        if (!existingIds.has(item.assetId)) newlyAdded += 1;
      }
      const total = resolveSearchTotalAfterAppend({
        requestOffset,
        serverTotal: page.total,
        pageItemCount: page.items.length,
        newlyAddedCount: newlyAdded,
      });
      loadedRef.current = requestOffset + page.items.length;
      for (const item of page.items) existingIds.add(item.assetId);
      totalRef.current = total;
      setSearchTotal(total);
      setSearchOffset(loadedRef.current);
      setHasMorePages(loadedRef.current < total);
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
      const apply = definition.target === "trash" ? setTrashedAssets : setAssets;
      apply((current) => appendAssetPage(current, page.items));
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, [
    api,
    onLoadMoreFailed,
    setAssets,
    setSearchOffset,
    setSearchSnippets,
    setSearchTotal,
    setTrashedAssets,
  ]);

  const fetchScopeAssetIds = useCallback(async (): Promise<string[] | null> => {
    const definition = definitionRef.current;
    if (!definition || !api) return null;
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
  }, [api]);

  const reset = useCallback(() => {
    definitionRef.current = null;
    generationRef.current += 1;
    loadingRef.current = false;
    loadedRef.current = 0;
    totalRef.current = 0;
    loadedIdsRef.current = new Set();
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
    appendNextPage,
    fetchScopeAssetIds,
    reset,
    hasMorePages,
    loadingMore,
    sentinelRef,
  };
}
