import { describe, expect, it, vi } from "vitest";

import {
  browserSessionKey,
  buildBrowserSessionFromBrowseState,
  readBrowserSession,
  writeBrowserSession,
  type BrowserSessionStorage,
  type StoredBrowserSession,
} from "../../src/renderer/browser-session";
import {
  applyStoredBrowserSession,
  findSessionSelectedAsset,
  type RestoreBrowserSessionApi,
} from "../../src/renderer/restore-browser-session";
import type { AssetSummary } from "../../src/shared/asset-types";

function memoryStorage(
  initial: Record<string, string> = {},
): BrowserSessionStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      return data[key] ?? null;
    },
    setItem(key, value) {
      data[key] = value;
    },
  };
}

function asset(partial: Partial<AssetSummary> & { assetId: string }): AssetSummary {
  return {
    displayName: partial.displayName ?? partial.assetId,
    extension: ".png",
    mimeType: "image/png",
    byteSize: 1,
    width: 1,
    height: 1,
    durationMs: null,
    rating: 0,
    favorite: false,
    availability: "available",
    locationKind: "managed",
    folderId: null,
    linkedFolderId: null,
    linkedRelativePath: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    coverUrl: null,
    ...partial,
  } as AssetSummary;
}

describe("browser-session", () => {
  it("builds scope from browse UI state", () => {
    expect(
      buildBrowserSessionFromBrowseState({
        showTrash: true,
        activeTagId: "t1",
        activeTagName: "ignored-when-trash",
        activeCollectionId: "c1",
        activeSmartCollectionId: "s1",
        assetScope: "folder-x",
        selectedAssetId: "a1",
        selectedAssetName: "a.png",
      }).scope,
    ).toEqual({ kind: "trash" });

    expect(
      buildBrowserSessionFromBrowseState({
        showTrash: false,
        activeTagId: "t1",
        activeTagName: "hero",
        activeCollectionId: null,
        activeSmartCollectionId: null,
        assetScope: "all",
        selectedAssetId: "a1",
        selectedAssetName: "a.png",
      }).scope,
    ).toEqual({ kind: "tag", id: "t1", name: "hero" });

    expect(
      buildBrowserSessionFromBrowseState({
        showTrash: false,
        activeTagId: null,
        activeTagName: undefined,
        activeCollectionId: null,
        activeSmartCollectionId: null,
        assetScope: "folder-9",
        selectedAssetId: "a1",
        selectedAssetName: "a.png",
      }).scope,
    ).toEqual({ kind: "folder", id: "folder-9" });
  });

  it("round-trips valid sessions and rejects corrupt payloads", () => {
    const store = memoryStorage();
    const session: StoredBrowserSession = {
      version: 1,
      scope: { kind: "folder", id: "f1" },
      selectedAssetId: "a1",
      selectedAssetName: "shot.png",
    };
    writeBrowserSession("lib-1", session, store);
    expect(store.data[browserSessionKey("lib-1")]).toContain("shot.png");
    expect(readBrowserSession("lib-1", store)).toEqual(session);

    store.setItem(browserSessionKey("lib-1"), "{not-json");
    expect(readBrowserSession("lib-1", store)).toBeNull();

    store.setItem(
      browserSessionKey("lib-1"),
      JSON.stringify({ version: 1, selectedAssetId: "a1" }),
    );
    expect(readBrowserSession("lib-1", store)).toBeNull();

    store.setItem(
      browserSessionKey("lib-1"),
      JSON.stringify({
        version: 1,
        selectedAssetId: "a1",
        selectedAssetName: "x",
        scope: { kind: "folder" },
      }),
    );
    expect(readBrowserSession("lib-1", store)).toBeNull();
  });
});

describe("findSessionSelectedAsset", () => {
  it("returns the asset already in the first page", async () => {
    const found = await findSessionSelectedAsset({
      api: { searchAssets: vi.fn(), executeSmartCollection: vi.fn() },
      libraryId: "lib",
      session: {
        version: 1,
        scope: { kind: "all" },
        selectedAssetId: "a2",
        selectedAssetName: "b.png",
      },
      restoredItems: [asset({ assetId: "a1" }), asset({ assetId: "a2" })],
      pageSize: 50,
    });
    expect(found?.assetId).toBe("a2");
  });

  it("pages smart collections then filename search", async () => {
    const executeSmartCollection = vi.fn(async ({ offset }: { offset?: number }) => {
      if ((offset ?? 0) === 50) {
        return {
          ok: true as const,
          value: {
            items: [asset({ assetId: "deep" })],
            total: 51,
            offset: 50,
          },
        };
      }
      return {
        ok: true as const,
        value: { items: [], total: 51, offset: offset ?? 0 },
      };
    });
    const api: RestoreBrowserSessionApi = {
      executeSmartCollection,
      searchAssets: vi.fn(),
    };
    const found = await findSessionSelectedAsset({
      api,
      libraryId: "lib",
      session: {
        version: 1,
        scope: { kind: "smart", id: "sc1" },
        selectedAssetId: "deep",
        selectedAssetName: "deep.png",
      },
      restoredItems: [asset({ assetId: "page0" })],
      pageSize: 50,
    });
    expect(found?.assetId).toBe("deep");
    expect(executeSmartCollection).toHaveBeenCalled();
  });

  it("falls back to filename search outside smart scope", async () => {
    const searchAssets = vi.fn(async () => ({
      ok: true as const,
      value: {
        items: [asset({ assetId: "named", displayName: "hero.png" })],
        total: 1,
        offset: 0,
      },
    }));
    const found = await findSessionSelectedAsset({
      api: { searchAssets, executeSmartCollection: vi.fn() },
      libraryId: "lib",
      session: {
        version: 1,
        scope: { kind: "all" },
        selectedAssetId: "named",
        selectedAssetName: "hero.png",
      },
      restoredItems: [asset({ assetId: "other" })],
      pageSize: 50,
    });
    expect(found?.assetId).toBe("named");
    expect(searchAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          clauses: [
            { field: "filename", values: ["hero.png"], exclude: false },
          ],
        },
      }),
    );
  });
});

describe("applyStoredBrowserSession", () => {
  it("restores trash scope and appends missing selected asset", async () => {
    const setShowTrash = vi.fn();
    const setAssetScope = vi.fn();
    const setTrashedAssets = vi.fn(
      (update: AssetSummary[] | ((c: AssetSummary[]) => AssetSummary[])) => {
        if (typeof update === "function") update([]);
      },
    );
    const loadContent = vi.fn(async () => [
      asset({ assetId: "t1", deletedAt: "2026-01-02T00:00:00.000Z" }),
    ]);
    const result = await applyStoredBrowserSession({
      api: {
        searchAssets: vi.fn(),
        executeSmartCollection: vi.fn(),
      },
      library: {
        libraryId: "lib",
        name: "Lib",
        rootPath: "/tmp",
      } as never,
      session: {
        version: 1,
        scope: { kind: "trash" },
        selectedAssetId: "t1",
        selectedAssetName: "t1.png",
      },
      initialItems: [],
      pageSize: 50,
      collectionRecursive: false,
      isFolderRecursiveEnabled: () => false,
      loadContent,
      setShowTrash,
      setAssetScope,
      setFolderRecursive: vi.fn(),
      folderRecursiveRef: { current: false },
      setActiveTagId: vi.fn(),
      setTagFilter: vi.fn(),
      setActiveCollectionId: vi.fn(),
      setActiveSmartCollectionId: vi.fn(),
      setAssets: vi.fn(),
      setTrashedAssets,
      setSearchTotal: vi.fn(),
    });

    expect(setShowTrash).toHaveBeenCalledWith(true);
    expect(setAssetScope).toHaveBeenCalledWith("all");
    expect(loadContent).toHaveBeenCalledWith(
      expect.anything(),
      "all",
      { trashMode: true },
    );
    expect(result.restoredLocation).toEqual({ kind: "trash" });
    expect(result.restoredAsset?.assetId).toBe("t1");
    expect(setTrashedAssets).toHaveBeenCalled();
  });
});
