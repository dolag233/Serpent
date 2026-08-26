import { useCallback, useRef } from "react";

import type {
  AssetSummary,
  BrowseGeometryBlock,
  BrowseLayoutEntry,
} from "../../shared/asset-types";
import type { SerpentLibraryApi } from "../../shared/library-api";
import {
  createVirtualBrowseLayout,
  evictVirtualGeometryBlock,
  evictVirtualSummaryPage,
  geometryPlaceholderId,
  isGeometryPlaceholder,
  materializeVirtualLoadedEntries,
  mergeVirtualGeometryBlock,
  mergeVirtualSummaryPage,
  removeVirtualLayoutEntries,
  virtualSummaryAssetIds,
  type VirtualBrowseLayout,
} from "./virtual-browse-layout";

/** Keep geometry requests small enough that a jump can be superseded cheaply. */
export const BROWSE_GEOMETRY_BLOCK_SIZE = 128;

/** Small scopes still use the mature full-layout path; large scopes do not. */
export const BROWSE_FULL_LAYOUT_THRESHOLD = 2_000;

/** Bound Renderer memory when a user drags through a very large library. */
export const BROWSE_GEOMETRY_BLOCK_CACHE_LIMIT = 24;

/** Full summaries are much heavier than geometry; keep only a small LRU. */
export const BROWSE_SUMMARY_PAGE_CACHE_LIMIT = 24;
const BROWSE_SUMMARY_PAGE_SIZE = 100;

export {
  geometryPlaceholderId,
  isGeometryPlaceholder,
  type VirtualBrowseLayout,
};

/** Align an index range to bounded geometry block starts, with one block overscan. */
export function geometryBlockStartsForRange(input: {
  startIndex: number;
  endIndex: number;
  total: number;
  blockSize?: number;
}): number[] {
  const blockSize = Math.max(1, Math.trunc(input.blockSize ?? BROWSE_GEOMETRY_BLOCK_SIZE));
  const total = Math.max(0, Math.trunc(input.total));
  if (total === 0) return [];
  const start = Math.max(0, Math.min(input.startIndex, input.endIndex));
  const end = Math.min(total - 1, Math.max(input.startIndex, input.endIndex));
  const first = Math.floor(start / blockSize) * blockSize;
  const last = Math.floor(end / blockSize) * blockSize;
  const starts: number[] = [];
  for (let value = first; value <= last; value += blockSize) starts.push(value);
  if (first > 0) starts.unshift(first - blockSize);
  if (last + blockSize < total) starts.push(last + blockSize);
  return [...new Set(starts)];
}

export class BrowseGeometryBlockCache {
  readonly #limit: number;
  readonly #blocks = new Map<number, BrowseGeometryBlock>();

  constructor(limit = BROWSE_GEOMETRY_BLOCK_CACHE_LIMIT) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error("BrowseGeometryBlockCache limit must be a positive integer.");
    }
    this.#limit = limit;
  }

  has(startIndex: number): boolean {
    return this.#blocks.has(startIndex);
  }

  get(startIndex: number): BrowseGeometryBlock | undefined {
    const block = this.#blocks.get(startIndex);
    if (!block) return undefined;
    this.#blocks.delete(startIndex);
    this.#blocks.set(startIndex, block);
    return block;
  }

  set(block: BrowseGeometryBlock): number | undefined {
    this.#blocks.delete(block.startIndex);
    this.#blocks.set(block.startIndex, block);
    let evicted: number | undefined;
    while (this.#blocks.size > this.#limit) {
      const oldest = this.#blocks.keys().next().value;
      if (oldest === undefined) break;
      this.#blocks.delete(oldest);
      evicted = oldest;
    }
    return evicted;
  }

  clear(): void {
    this.#blocks.clear();
  }

  get size(): number {
    return this.#blocks.size;
  }
}

export type VirtualBrowseSessionArgs = {
  api: SerpentLibraryApi | null;
  setBrowseLayout: (layout: BrowseLayoutEntry[]) => void;
  setVirtualBrowseLayout: (layout: VirtualBrowseLayout | null) => void;
};

/**
 * Owns the Renderer-side geometry window for one BrowseSession. Summary pages
 * and geometry blocks share the same generation fence; a stale geometry reply
 * can never overwrite the next folder/search layout.
 */
export function useVirtualBrowseSession({
  api,
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
  const cacheRef = useRef(new BrowseGeometryBlockCache());
  const inFlightRef = useRef(new Map<number, Promise<BrowseGeometryBlock | null>>());
  const summaryPagesRef = useRef(new Map<number, true>());

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
    const virtualized = Boolean(input.sessionId) && input.total > BROWSE_FULL_LAYOUT_THRESHOLD;
    sessionRef.current = {
      libraryId: input.libraryId,
      sessionId: input.sessionId ?? "",
      total: input.total,
      generation: input.generation,
      virtualized,
    };
    cacheRef.current.clear();
    inFlightRef.current.clear();
    summaryPagesRef.current.clear();
    const nextVirtualLayout = virtualized
      ? createVirtualBrowseLayout(input)
      : null;
    if (virtualized) registerSummaryPages(input.firstPage.offset, input.firstPage.items.length);
    virtualLayoutRef.current = nextVirtualLayout;
    layoutRef.current = virtualized
      ? materializeVirtualLoadedEntries(nextVirtualLayout!)
      : input.firstPage.items.map((asset) => ({
          assetId: asset.assetId,
          width: asset.width,
          height: asset.height,
          previewArtifactId: asset.thumbnailArtifactId,
          displayName: asset.displayName,
          relativeFilePath: asset.relativeFilePath,
          byteSize: asset.byteSize,
          modifiedAt: asset.modifiedAt,
          rating: asset.rating,
        }));
    setVirtualBrowseLayout(virtualLayoutRef.current);
    setBrowseLayout(layoutRef.current);
    return virtualized;
  }, [registerSummaryPages, setBrowseLayout, setVirtualBrowseLayout]);

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
    virtualLayoutRef.current = next;
    layoutRef.current = materializeVirtualLoadedEntries(next);
    setVirtualBrowseLayout(next);
    setBrowseLayout(layoutRef.current);
    return evicted;
  }, [registerSummaryPages, setBrowseLayout, setVirtualBrowseLayout]);

  const ensureRange = useCallback(async (input: {
    startIndex: number;
    endIndex: number;
    generation: number;
  }): Promise<void> => {
    const session = sessionRef.current;
    if (!api || !session?.virtualized || session.generation !== input.generation) return;
    touchSummaryPages(input.startIndex, input.endIndex);
    const starts = geometryBlockStartsForRange({
      startIndex: input.startIndex,
      endIndex: input.endIndex,
      total: session.total,
    }).filter((startIndex) => !cacheRef.current.has(startIndex));
    const requests = starts.map((startIndex) => {
      const inFlight = inFlightRef.current.get(startIndex);
      if (inFlight) return inFlight;
      const request = api.fetchBrowseSessionGeometry({
        libraryId: session.libraryId,
        sessionId: session.sessionId,
        startIndex,
        limit: BROWSE_GEOMETRY_BLOCK_SIZE,
      }).then((result) => {
        if (!result.ok || "stale" in result.value) return null;
        return result.value;
      }).catch(() => null);
      inFlightRef.current.set(startIndex, request);
      void request.finally(() => {
        if (inFlightRef.current.get(startIndex) === request) {
          inFlightRef.current.delete(startIndex);
        }
      });
      return request;
    });
    const blocks = (await Promise.all(requests)).filter(
      (block): block is BrowseGeometryBlock => block !== null,
    );
    if (
      blocks.length === 0 ||
      sessionRef.current?.generation !== input.generation ||
      sessionRef.current?.sessionId !== session.sessionId
    ) return;
    for (const block of blocks) {
      const evictedStart = cacheRef.current.set(block);
      const current = virtualLayoutRef.current;
      if (!current) continue;
      const afterEviction = evictedStart === undefined
        ? current
        : evictVirtualGeometryBlock(
            current,
            evictedStart,
            BROWSE_GEOMETRY_BLOCK_SIZE,
          );
      virtualLayoutRef.current = mergeVirtualGeometryBlock(afterEviction, block);
    }
    if (!virtualLayoutRef.current) return;
    layoutRef.current = materializeVirtualLoadedEntries(virtualLayoutRef.current);
    setVirtualBrowseLayout(virtualLayoutRef.current);
    setBrowseLayout(layoutRef.current);
  }, [api, setBrowseLayout, setVirtualBrowseLayout, touchSummaryPages]);

  const getLayout = useCallback(() => layoutRef.current, []);

  const getVirtualLayout = useCallback(() => virtualLayoutRef.current, []);

  const getLoadedSummaryAssetIds = useCallback(() => {
    const layout = virtualLayoutRef.current;
    return layout ? virtualSummaryAssetIds(layout) : null;
  }, []);

  const removeEntries = useCallback((assetIds: string[], removedCount: number) => {
    const current = virtualLayoutRef.current;
    if (!current) return;
    virtualLayoutRef.current = removeVirtualLayoutEntries(
      current,
      assetIds,
      removedCount,
    );
    layoutRef.current = materializeVirtualLoadedEntries(virtualLayoutRef.current);
    setVirtualBrowseLayout(virtualLayoutRef.current);
    setBrowseLayout(layoutRef.current);
  }, [setBrowseLayout, setVirtualBrowseLayout]);

  const isVirtualized = useCallback(() => sessionRef.current?.virtualized === true, []);

  const reset = useCallback(() => {
    sessionRef.current = null;
    cacheRef.current.clear();
    inFlightRef.current.clear();
    summaryPagesRef.current.clear();
    virtualLayoutRef.current = null;
    layoutRef.current = [];
    setVirtualBrowseLayout(null);
    setBrowseLayout([]);
  }, [setBrowseLayout, setVirtualBrowseLayout]);

  return {
    begin,
    applySummaryPage,
    ensureRange,
    getLayout,
    getVirtualLayout,
    getLoadedSummaryAssetIds,
    removeEntries,
    isVirtualized,
    reset,
  };
}
