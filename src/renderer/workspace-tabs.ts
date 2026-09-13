import {
  createWorkspaceNavHistory,
  type WorkspaceNavHistory,
  type WorkspaceNavLocation,
} from "./workspace-nav-history";

export interface WorkspaceTabBrowseFilters {
  formatFilter: string;
  excludeFormatFilter: boolean;
  colorFilter: string;
  excludeColorFilter: boolean;
  tagFilter: string;
  excludeTagFilter: boolean;
  includeAiTagFilter: boolean;
  tagFilterMatch: "any" | "all";
  ratingFilter: string;
  excludeRatingFilter: boolean;
  includeAiRatingFilter: boolean;
  favoriteFilter: "any" | "yes" | "no";
  sourceUrlFilter: "any" | "yes" | "no";
  availabilityFilter: "any" | "available" | "missing";
  excludeAvailabilityFilter: boolean;
  widthRange: { min: string; max: string; exclude: boolean };
  heightRange: { min: string; max: string; exclude: boolean };
  aspectRatioRange: { min: string; max: string; exclude: boolean };
  aspectRatioRanges: Array<{ min: string; max: string }>;
  longEdgeRange: { min: string; max: string; exclude: boolean };
  durationRange: { min: string; max: string; exclude: boolean };
}

export interface WorkspaceTabBrowseState {
  searchValue: string;
  filters: WorkspaceTabBrowseFilters;
  sortField: "name" | "modified_at" | "created_at" | "byte_size" | "long_edge" | "duration" | "rating" | "color" | "author";
  sortOrder: "asc" | "desc";
  shuffleSeed: number | null;
  folderRecursive: boolean;
  collectionRecursive: boolean;
  showIgnoredItems: boolean;
}

export interface WorkspaceTabSession {
  readonly id: string;
  readonly history: WorkspaceNavHistory;
  selectedAssetIds: string[];
  selectedAssetId: string | null;
  browseState: WorkspaceTabBrowseState | null;
  cachedTitle: string | null;
}

export interface WorkspaceTabsState {
  readonly tabs: readonly WorkspaceTabSession[];
  readonly activeTabId: string;
}

export interface CloseWorkspaceTabResult {
  readonly state: WorkspaceTabsState;
  readonly removedTabIds: readonly string[];
  readonly shouldNavigateToAll: boolean;
}

export type WorkspaceTabIdFactory = () => string;

let fallbackId = 0;

export function createWorkspaceTabId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `workspace-tab-${Date.now().toString(36)}-${(++fallbackId).toString(36)}`;
}

function createTab(id: string, location: WorkspaceNavLocation = { kind: "all" }): WorkspaceTabSession {
  return {
    id,
    history: createWorkspaceNavHistory(location),
    selectedAssetIds: [],
    selectedAssetId: null,
    browseState: null,
    cachedTitle: null,
  };
}

export function createDefaultWorkspaceTabBrowseState(
  sortField: WorkspaceTabBrowseState["sortField"] = "name",
  sortOrder: WorkspaceTabBrowseState["sortOrder"] = "asc",
): WorkspaceTabBrowseState {
  const emptyRange = () => ({ min: "", max: "", exclude: false });
  return {
    searchValue: "",
    filters: {
      formatFilter: "",
      excludeFormatFilter: false,
      colorFilter: "",
      excludeColorFilter: false,
      tagFilter: "",
      excludeTagFilter: false,
      includeAiTagFilter: true,
      tagFilterMatch: "any",
      ratingFilter: "",
      excludeRatingFilter: false,
      includeAiRatingFilter: true,
      favoriteFilter: "any",
      sourceUrlFilter: "any",
      availabilityFilter: "any",
      excludeAvailabilityFilter: false,
      widthRange: emptyRange(),
      heightRange: emptyRange(),
      aspectRatioRange: emptyRange(),
      aspectRatioRanges: [],
      longEdgeRange: emptyRange(),
      durationRange: emptyRange(),
    },
    sortField,
    sortOrder,
    shuffleSeed: null,
    folderRecursive: false,
    collectionRecursive: true,
    showIgnoredItems: false,
  };
}

export function workspaceTabBrowseStateHasDiscoveryInput(
  state: WorkspaceTabBrowseState,
): boolean {
  const filters = state.filters;
  return Boolean(
    state.searchValue.trim() ||
    filters.colorFilter.trim() ||
    filters.formatFilter.trim() ||
    filters.tagFilter.trim() ||
    filters.ratingFilter.trim() ||
    filters.favoriteFilter !== "any" ||
    filters.sourceUrlFilter !== "any" ||
    filters.availabilityFilter !== "any" ||
    filters.widthRange.min || filters.widthRange.max ||
    filters.heightRange.min || filters.heightRange.max ||
    filters.aspectRatioRange.min || filters.aspectRatioRange.max ||
    filters.aspectRatioRanges.length > 0 ||
    filters.durationRange.min || filters.durationRange.max ||
    filters.longEdgeRange.min || filters.longEdgeRange.max ||
    state.sortField !== "name" ||
    state.sortOrder !== "asc"
  );
}

export function createWorkspaceTabs(
  idFactory: WorkspaceTabIdFactory = createWorkspaceTabId,
): WorkspaceTabsState {
  const first = createTab(idFactory());
  return { tabs: [first], activeTabId: first.id };
}

export function getWorkspaceTab(
  state: WorkspaceTabsState,
  tabId: string,
): WorkspaceTabSession | undefined {
  return state.tabs.find((tab) => tab.id === tabId);
}

export function addWorkspaceTab(
  state: WorkspaceTabsState,
  idFactory: WorkspaceTabIdFactory = createWorkspaceTabId,
): WorkspaceTabsState {
  const tab = createTab(idFactory());
  return { tabs: [...state.tabs, tab], activeTabId: tab.id };
}

export function selectWorkspaceTab(
  state: WorkspaceTabsState,
  tabId: string,
): WorkspaceTabsState {
  if (state.activeTabId === tabId || !state.tabs.some((tab) => tab.id === tabId)) {
    return state;
  }
  return { ...state, activeTabId: tabId };
}

/** Reorders tabs without touching tab identity, history, or the active tab. */
export function moveWorkspaceTab(
  state: WorkspaceTabsState,
  tabId: string,
  toIndex: number,
): WorkspaceTabsState {
  const fromIndex = state.tabs.findIndex((tab) => tab.id === tabId);
  if (fromIndex < 0) return state;
  const targetIndex = Math.max(
    0,
    Math.min(Math.trunc(toIndex), state.tabs.length - 1),
  );
  if (targetIndex === fromIndex) return state;
  const tabs = [...state.tabs];
  const [moved] = tabs.splice(fromIndex, 1);
  tabs.splice(targetIndex, 0, moved!);
  return { ...state, tabs };
}

/**
 * How much of the tab-width budget a tab may use at a given tab count. The
 * budget itself lives in CSS (an eight-character title plus the icon, paddings
 * and close chip, so it also follows the font-scale setting); few tabs get all
 * of it, and past three the share steps down so every title keeps a readable
 * run of text instead of every tab collapsing to an ellipsis.
 */
export const WORKSPACE_TAB_WIDTH_SCALES = [
  1, 1, 1, 0.94, 0.88, 0.82, 0.76, 0.75,
] as const;

export function workspaceTabWidthScale(tabCount: number): number {
  const index = Math.min(
    Math.max(Math.trunc(tabCount) - 1, 0),
    WORKSPACE_TAB_WIDTH_SCALES.length - 1,
  );
  return WORKSPACE_TAB_WIDTH_SCALES[index]!;
}

export function updateWorkspaceTabContext(
  state: WorkspaceTabsState,
  tabId: string,
  context: {
    selectedAssetIds?: readonly string[];
    selectedAssetId?: string | null;
    cachedTitle?: string;
  },
): WorkspaceTabsState {
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return state;
  const current = state.tabs[index]!;
  const nextTab: WorkspaceTabSession = {
    ...current,
    selectedAssetIds: context.selectedAssetIds
      ? [...context.selectedAssetIds]
      : current.selectedAssetIds,
    selectedAssetId: context.selectedAssetId === undefined
      ? current.selectedAssetId
      : context.selectedAssetId,
    cachedTitle: context.cachedTitle ?? current.cachedTitle,
  };
  const tabs = [...state.tabs];
  tabs[index] = nextTab;
  return { ...state, tabs };
}

export function updateWorkspaceTabBrowseState(
  state: WorkspaceTabsState,
  tabId: string,
  browseState: WorkspaceTabBrowseState,
): WorkspaceTabsState {
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return state;
  const tabs = [...state.tabs];
  tabs[index] = { ...tabs[index]!, browseState };
  return { ...state, tabs };
}

export function closeWorkspaceTab(
  state: WorkspaceTabsState,
  tabId: string,
): CloseWorkspaceTabResult {
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) {
    return { state, removedTabIds: [], shouldNavigateToAll: false };
  }

  if (state.tabs.length === 1) {
    const onlyTab = state.tabs[0]!;
    onlyTab.history.clear({ kind: "all" });
    onlyTab.selectedAssetIds = [];
    onlyTab.selectedAssetId = null;
    onlyTab.browseState = null;
    onlyTab.cachedTitle = null;
    return {
      state: { ...state, tabs: [...state.tabs] },
      removedTabIds: [],
      shouldNavigateToAll: true,
    };
  }

  const tabs = state.tabs.filter((tab) => tab.id !== tabId);
  const activeTabId = state.activeTabId === tabId
    ? tabs[Math.min(index, tabs.length - 1)]!.id
    : state.activeTabId;
  return {
    state: { tabs, activeTabId },
    removedTabIds: [tabId],
    shouldNavigateToAll: state.activeTabId === tabId,
  };
}

export function closeWorkspaceTabsExcept(
  state: WorkspaceTabsState,
  keepTabId: string,
): CloseWorkspaceTabResult {
  const keepTab = getWorkspaceTab(state, keepTabId);
  if (!keepTab) return { state, removedTabIds: [], shouldNavigateToAll: false };
  const removedTabIds = state.tabs.filter((tab) => tab.id !== keepTabId).map((tab) => tab.id);
  return {
    state: { tabs: [keepTab], activeTabId: keepTabId },
    removedTabIds,
    shouldNavigateToAll: state.activeTabId !== keepTabId,
  };
}
