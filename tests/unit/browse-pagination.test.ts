import { describe, expect, it, vi } from "vitest";

import type { AssetSummary } from "../../src/shared/asset-types";
import type { SerpentLibraryApi } from "../../src/shared/library-api";
import {
  fetchBrowseScopeAssetIdsGuarded,
  fetchBrowseScopeIds,
  fetchBrowseLayout,
  isDiscardedBrowseWindowPage,
  isIgnorableBrowseWindowFailure,
  registerBrowseSearchPage,
  registerBrowseSmartCollectionPage,
  type BrowsePageDefinition,
} from "../../src/renderer/use-browse-pagination";

function asset(assetId: string): AssetSummary {
  return {
    assetId,
    locationKind: "managed",
    managedFolderId: null,
    relativeFilePath: `${assetId}.png`,
    displayName: `${assetId}.png`,
    currentRevisionId: `${assetId}-rev`,
    byteSize: 1,
    modifiedAt: "2026-01-01T00:00:00.000Z",
    availability: "available",
    rating: 0,
    favorite: false,
    deletedAt: null,
    trashedFromPath: null,
    trashedFromTombstoneId: null,
    remainingDays: null,
    thumbnailStatus: null,
    thumbnailArtifactId: null,
    mediaType: "image",
    width: 1,
    height: 1,
    durationMs: null,
  };
}

const searchDefinition: BrowsePageDefinition = {
  kind: "search",
  libraryId: "lib-1",
  query: null,
  filters: null,
  scope: null,
  sort: null,
  showIgnored: false,
  target: "assets",
};

const smartDefinition: BrowsePageDefinition = {
  kind: "smart-collection",
  libraryId: "lib-1",
  collectionId: "sc-1",
  target: "assets",
};

describe("fetchBrowseScopeIds (Serpent-ws4k select-all id set)", () => {
  it("fetches idsOnly via searchAssets for search definitions", async () => {
    const searchAssets = vi.fn(async () => ({
      ok: true as const,
      value: { items: [], total: 2, offset: 0, assetIds: ["a", "b"] },
    }));
    const api = {
      searchAssets,
      executeSmartCollection: vi.fn(),
    } as unknown as SerpentLibraryApi;

    expect(await fetchBrowseScopeIds({ api, definition: searchDefinition })).toEqual([
      "a",
      "b",
    ]);
    expect(searchAssets).toHaveBeenCalledWith(
      expect.objectContaining({ libraryId: "lib-1", idsOnly: true }),
    );
  });

  it("fetches idsOnly via executeSmartCollection for smart definitions", async () => {
    const executeSmartCollection = vi.fn(async () => ({
      ok: true as const,
      value: { items: [], total: 1, offset: 0, assetIds: ["s1"] },
    }));
    const api = {
      searchAssets: vi.fn(),
      executeSmartCollection,
    } as unknown as SerpentLibraryApi;

    expect(await fetchBrowseScopeIds({ api, definition: smartDefinition })).toEqual([
      "s1",
    ]);
    expect(executeSmartCollection).toHaveBeenCalledWith(
      expect.objectContaining({ collectionId: "sc-1", idsOnly: true }),
    );
  });

  it("returns null when the ids fetch fails", async () => {
    const api = {
      searchAssets: vi.fn(async () => ({
        ok: false as const,
        error: { code: "FOLDER_NOT_FOUND", message: "gone" },
      })),
      executeSmartCollection: vi.fn(),
    } as unknown as SerpentLibraryApi;

    expect(await fetchBrowseScopeIds({ api, definition: searchDefinition })).toBeNull();
  });
});

describe("fetchBrowseLayout (Serpent-sa65 compact geometry index)", () => {
  it("requests layoutOnly without materializing AssetSummary rows", async () => {
    const layout = [{ assetId: "a", width: 1600, height: 900 }];
    const searchAssets = vi.fn(async () => ({
      ok: true as const,
      value: { items: [], total: 1, offset: 0, layout },
    }));
    const api = {
      searchAssets,
      executeSmartCollection: vi.fn(),
    } as unknown as SerpentLibraryApi;

    expect(await fetchBrowseLayout({ api, definition: searchDefinition })).toEqual(layout);
    expect(searchAssets).toHaveBeenCalledWith(
      expect.objectContaining({ libraryId: "lib-1", layoutOnly: true }),
    );
  });

  it("keeps the current layout when a response omits the layout field", async () => {
    const searchAssets = vi.fn(async () => ({
      ok: true as const,
      value: { items: [], total: 1, offset: 0 },
    }));
    const api = {
      searchAssets,
      executeSmartCollection: vi.fn(),
    } as unknown as SerpentLibraryApi;

    expect(await fetchBrowseLayout({ api, definition: searchDefinition })).toBeNull();
  });
});

describe("fetchBrowseScopeAssetIdsGuarded (Serpent-ws4k select-all race)", () => {
  it("discards the id set when the generation changes during await", async () => {
    let generation = 1;
    const fetch = vi.fn(async () => ["stale-a", "stale-b"]);
    const pending = fetchBrowseScopeAssetIdsGuarded({
      api: {} as SerpentLibraryApi,
      definition: searchDefinition,
      currentGeneration: () => generation,
      fetch,
    });
    // The user switched folder/scope while the ids query was in flight.
    generation = 2;
    expect(await pending).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns the id set when the generation is unchanged", async () => {
    const fetch = vi.fn(async () => ["a", "b"]);
    expect(
      await fetchBrowseScopeAssetIdsGuarded({
        api: {} as SerpentLibraryApi,
        definition: searchDefinition,
        currentGeneration: () => 1,
        fetch,
      }),
    ).toEqual(["a", "b"]);
  });

  it("returns null without a definition or api and never fetches", async () => {
    const fetch = vi.fn(async () => ["a"]);
    expect(
      await fetchBrowseScopeAssetIdsGuarded({
        api: null,
        definition: searchDefinition,
        currentGeneration: () => 1,
        fetch,
      }),
    ).toBeNull();
    expect(
      await fetchBrowseScopeAssetIdsGuarded({
        api: {} as SerpentLibraryApi,
        definition: null,
        currentGeneration: () => 1,
        fetch,
      }),
    ).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("registerBrowseSearchPage / registerBrowseSmartCollectionPage (Serpent-ws4k)", () => {
  it("registers a search page definition + first page through beginPage", () => {
    const beginPage = vi.fn();
    registerBrowseSearchPage(beginPage, {
      libraryId: "lib-1",
      query: null,
      filters: null,
      scope: null,
      sort: null,
      showIgnored: true,
      target: "trash",
      items: [asset("a")],
      total: 1,
      offset: 0,
    });
    expect(beginPage).toHaveBeenCalledWith(
      {
        kind: "search",
        libraryId: "lib-1",
        query: null,
        filters: null,
        scope: null,
        sort: null,
        showIgnored: true,
        target: "trash",
      },
      { items: [asset("a")], total: 1, offset: 0 },
    );
  });

  it("defaults search registration to the assets target and normalizes undefined fields", () => {
    const beginPage = vi.fn();
    registerBrowseSearchPage(beginPage, {
      libraryId: "lib-1",
      query: null,
      filters: undefined,
      scope: undefined,
      sort: undefined,
      showIgnored: false,
      items: [],
      total: 0,
      offset: 0,
    });
    expect(beginPage).toHaveBeenCalledWith(
      {
        kind: "search",
        libraryId: "lib-1",
        query: null,
        filters: null,
        scope: null,
        sort: null,
        showIgnored: false,
        target: "assets",
      },
      { items: [], total: 0, offset: 0 },
    );
  });

  it("registers a smart-collection page definition + first page through beginPage", () => {
    const beginPage = vi.fn();
    registerBrowseSmartCollectionPage(beginPage, {
      libraryId: "lib-1",
      collectionId: "sc-1",
      items: [asset("s1")],
      total: 1,
      offset: 0,
    });
    expect(beginPage).toHaveBeenCalledWith(
      {
        kind: "smart-collection",
        libraryId: "lib-1",
        collectionId: "sc-1",
        target: "assets",
      },
      { items: [asset("s1")], total: 1, offset: 0 },
    );
  });
});

describe("discarded browse-window pages (Serpent-87pd)", () => {
  it("ignores an empty total-0 response that would otherwise shrink a known scope", () => {
    expect(
      isDiscardedBrowseWindowPage({ items: [], total: 0 }, 500, 7000),
    ).toBe(true);
    expect(
      isDiscardedBrowseWindowPage({ items: [], total: 0 }, 0, 7000),
    ).toBe(true);
    expect(
      isDiscardedBrowseWindowPage({ items: [], total: 0 }, 0, 0),
    ).toBe(false);
    expect(
      isDiscardedBrowseWindowPage({ items: [asset("a")], total: 0 }, 100, 7000),
    ).toBe(false);
  });

  it("does not treat a cancelled window as a load-more failure", () => {
    expect(isIgnorableBrowseWindowFailure("CANCELLED")).toBe(true);
    expect(isIgnorableBrowseWindowFailure("FOLDER_NOT_FOUND")).toBe(false);
  });
});
