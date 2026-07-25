/**
 * Apply a saved browser session after library open (Serpent-uye extract).
 * App owns bootstrapping listOpen / default "all" load; this module owns the
 * session-scope branch + selected-asset recovery loops.
 */

import type {
  AssetSummary,
  FilterClause,
  SearchScope,
} from "../shared/asset-types";
import type { LibraryApiResult } from "../shared/library-api";
import type { RendererLibrarySummary } from "../shared/protocol/responses";
import type { StoredBrowserSession } from "./browser-session";
import { BROWSE_SCOPE_SEARCH } from "./browse-scope-search";
import { LibraryOperationError } from "./error-utils";
import type { WorkspaceNavLocation } from "./workspace-nav-history";

export type SessionAssetPage = {
  items: AssetSummary[];
  total: number;
  offset: number;
};

export type RestoreBrowserSessionApi = {
  searchAssets(input: {
    libraryId: string;
    query?: {
      clauses: {
        field: string | null;
        values: string[];
        exclude: boolean;
      }[];
    } | null;
    filters?: FilterClause[];
    scope?: SearchScope;
    scopeMode?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<LibraryApiResult<SessionAssetPage>>;
  executeSmartCollection(input: {
    libraryId: string;
    collectionId: string;
    scopeMode?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<LibraryApiResult<SessionAssetPage>>;
};

export type LoadContentForRestore = (
  activeLibrary: RendererLibrarySummary,
  scope: "all" | "root" | string,
  opts?: { trashMode?: boolean },
) => Promise<AssetSummary[] | undefined>;

export type RestoreBrowserSessionDeps = {
  api: RestoreBrowserSessionApi;
  library: RendererLibrarySummary;
  session: StoredBrowserSession;
  /** Items from the initial all-scope load before session apply. */
  initialItems: AssetSummary[];
  collectionRecursive: boolean;
  isFolderRecursiveEnabled: (libraryId: string, folderId: string) => boolean;
  loadContent: LoadContentForRestore;
  setShowTrash: (value: boolean) => void;
  setAssetScope: (scope: "all" | "root" | string) => void;
  setFolderRecursive: (enabled: boolean) => void;
  folderRecursiveRef: { current: boolean };
  setActiveTagId: (id: string | null) => void;
  setTagFilter: (name: string) => void;
  setActiveCollectionId: (id: string | null) => void;
  setActiveSmartCollectionId: (id: string | null) => void;
  setAssets: (
    update: AssetSummary[] | ((current: AssetSummary[]) => AssetSummary[]),
  ) => void;
  setTrashedAssets: (
    update: AssetSummary[] | ((current: AssetSummary[]) => AssetSummary[]),
  ) => void;
  setSearchTotal: (total: number | null) => void;
};

export type RestoreBrowserSessionResult = {
  restoredLocation: WorkspaceNavLocation;
  restoredAsset: AssetSummary | null;
};

/**
 * Recover the saved selection from the restored scope rows, or one extra
 * scope query / filename search when the asset is missing (Serpent-6w7n).
 */
export async function findSessionSelectedAsset(args: {
  api: RestoreBrowserSessionApi;
  libraryId: string;
  session: StoredBrowserSession;
  restoredItems: readonly AssetSummary[];
  searchScope?: SearchScope;
  searchFilters?: FilterClause[];
}): Promise<AssetSummary | undefined> {
  const { api, libraryId, session, restoredItems, searchScope, searchFilters } =
    args;

  const restoredAsset = restoredItems.find(
    (asset) => asset.assetId === session.selectedAssetId,
  );
  if (restoredAsset) return restoredAsset;

  if (session.scope.kind === "smart") {
    const result = await api.executeSmartCollection({
      libraryId,
      collectionId: session.scope.id,
      ...BROWSE_SCOPE_SEARCH,
    });
    if (!result.ok || result.value.items.length === 0) return undefined;
    return result.value.items.find(
      (asset) => asset.assetId === session.selectedAssetId,
    );
  }

  const result = await api.searchAssets({
    libraryId,
    query: {
      clauses: [
        {
          field: "filename",
          values: [session.selectedAssetName],
          exclude: false,
        },
      ],
    },
    filters: searchFilters,
    scope: searchScope,
    ...BROWSE_SCOPE_SEARCH,
  });
  if (!result.ok || result.value.items.length === 0) return undefined;
  return result.value.items.find(
    (asset) => asset.assetId === session.selectedAssetId,
  );
}

/**
 * Load the saved scope, then recover the selected asset into the grid.
 * On scope-load failure the caller should fall back to all-assets (App does).
 */
export async function applyStoredBrowserSession(
  deps: RestoreBrowserSessionDeps,
): Promise<RestoreBrowserSessionResult> {
  const {
    api,
    library,
    session,
    collectionRecursive,
    isFolderRecursiveEnabled,
    loadContent,
    setShowTrash,
    setAssetScope,
    setFolderRecursive,
    folderRecursiveRef,
    setActiveTagId,
    setTagFilter,
    setActiveCollectionId,
    setActiveSmartCollectionId,
    setAssets,
    setTrashedAssets,
    setSearchTotal,
  } = deps;

  let restoredItems = deps.initialItems;
  let restoredLocation: WorkspaceNavLocation = { kind: "all" };
  let searchScope: SearchScope | undefined;
  let searchFilters: FilterClause[] | undefined;

  if (session.scope.kind === "trash") {
    setShowTrash(true);
    setAssetScope("all");
    restoredItems =
      (await loadContent(library, "all", { trashMode: true })) ?? [];
    searchScope = { kind: "trash" };
    restoredLocation = { kind: "trash", tombstoneId: null };
  } else if (session.scope.kind === "root") {
    setAssetScope("root");
    restoredItems = (await loadContent(library, "root")) ?? [];
    searchScope = {
      kind: "folder",
      folderId: null,
      recursive: false,
    };
    restoredLocation = { kind: "root" };
  } else if (session.scope.kind === "folder") {
    setAssetScope(session.scope.id);
    const enabled = isFolderRecursiveEnabled(
      library.libraryId,
      session.scope.id,
    );
    folderRecursiveRef.current = enabled;
    setFolderRecursive(enabled);
    restoredItems = (await loadContent(library, session.scope.id)) ?? [];
    searchScope = {
      kind: "folder",
      folderId: session.scope.id,
      recursive: enabled,
    };
    restoredLocation = {
      kind: "folder",
      folderId: session.scope.id,
    };
  } else if (session.scope.kind === "tag" && session.scope.name) {
    searchFilters = [
      { field: "tag", values: [session.scope.name], exclude: false },
    ];
    const result = await api.searchAssets({
      libraryId: library.libraryId,
      query: null,
      filters: searchFilters,
      ...BROWSE_SCOPE_SEARCH,
    });
    if (!result.ok) throw new LibraryOperationError(result.error);
    setActiveTagId(session.scope.id);
    setTagFilter(session.scope.name);
    setAssets(result.value.items);
    setSearchTotal(result.value.total);
    restoredItems = result.value.items;
    restoredLocation = { kind: "tag", tagId: session.scope.id };
  } else if (session.scope.kind === "collection") {
    searchScope = {
      kind: "collection",
      collectionId: session.scope.id,
      recursive: collectionRecursive,
    };
    const result = await api.searchAssets({
      libraryId: library.libraryId,
      query: null,
      scope: searchScope,
      ...BROWSE_SCOPE_SEARCH,
    });
    if (!result.ok) throw new LibraryOperationError(result.error);
    setActiveCollectionId(session.scope.id);
    setAssets(result.value.items);
    setSearchTotal(result.value.total);
    restoredItems = result.value.items;
    restoredLocation = {
      kind: "collection",
      collectionId: session.scope.id,
      recursive: collectionRecursive,
    };
  } else if (session.scope.kind === "smart") {
    const result = await api.executeSmartCollection({
      libraryId: library.libraryId,
      collectionId: session.scope.id,
      ...BROWSE_SCOPE_SEARCH,
    });
    if (!result.ok) throw new LibraryOperationError(result.error);
    setActiveSmartCollectionId(session.scope.id);
    setAssets(result.value.items);
    setSearchTotal(result.value.total);
    restoredItems = result.value.items;
    restoredLocation = {
      kind: "smart-collection",
      collectionId: session.scope.id,
    };
  }

  const restoredAsset =
    (await findSessionSelectedAsset({
      api,
      libraryId: library.libraryId,
      session,
      restoredItems,
      searchScope,
      searchFilters,
    })) ?? null;

  if (restoredAsset) {
    if (session.scope.kind === "trash") {
      setTrashedAssets((current) =>
        current.some((asset) => asset.assetId === restoredAsset.assetId)
          ? current
          : [...current, restoredAsset],
      );
    } else {
      setAssets((current) =>
        current.some((asset) => asset.assetId === restoredAsset.assetId)
          ? current
          : [...current, restoredAsset],
      );
    }
  }

  return { restoredLocation, restoredAsset };
}
