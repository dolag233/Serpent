import { describe, expect, it } from "vitest";

import {
  addWorkspaceTab,
  closeWorkspaceTab,
  closeWorkspaceTabsExcept,
  createDefaultWorkspaceTabBrowseState,
  createWorkspaceTabs,
  getWorkspaceTab,
  moveWorkspaceTab,
  selectWorkspaceTab,
  setWorkspaceTabLocation,
  setWorkspaceTabViewport,
  updateWorkspaceTabContext,
  updateWorkspaceTabBrowseState,
  workspaceTabBrowseStateHasDiscoveryInput,
  workspaceTabWidthScale,
} from "../../src/renderer/workspace-tabs";

function ids(...values: string[]) {
  let index = 0;
  return () => values[index++]!;
}

describe("workspace tabs", () => {
  it("detects browse state that will trigger an asynchronous discovery refresh", () => {
    const defaults = createDefaultWorkspaceTabBrowseState();
    expect(workspaceTabBrowseStateHasDiscoveryInput(defaults)).toBe(false);
    expect(workspaceTabBrowseStateHasDiscoveryInput({
      ...defaults,
      searchValue: "blue metal",
    })).toBe(true);
    expect(workspaceTabBrowseStateHasDiscoveryInput({
      ...defaults,
      filters: {
        ...defaults.filters,
        widthRange: { min: "1024", max: "", exclude: false },
      },
    })).toBe(true);
    expect(workspaceTabBrowseStateHasDiscoveryInput({
      ...defaults,
      sortOrder: "desc",
    })).toBe(true);
  });

  it("starts with one all-assets tab and creates a new all-assets tab only when requested", () => {
    let state = createWorkspaceTabs(ids("one"));
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabId).toBe("one");
    expect(state.tabs[0]?.location).toEqual({ kind: "all" });

    state = setWorkspaceTabLocation(state, "one", {
      kind: "folder",
      folderId: "folder-a",
    });
    state = addWorkspaceTab(state, ids("two"));
    expect(state.tabs).toHaveLength(2);
    expect(state.activeTabId).toBe("two");
    expect(getWorkspaceTab(state, "two")?.location).toEqual({ kind: "all" });
    expect(getWorkspaceTab(state, "one")?.location).toEqual({
      kind: "folder",
      folderId: "folder-a",
    });
  });

  it("keeps each tab's location, viewport and browse context isolated", () => {
    let state = createWorkspaceTabs(ids("one"));
    state = setWorkspaceTabViewport(state, "one", {
      scrollTop: 420,
      scrollProgress: 0.42,
      scrollExtent: 1_000,
    });
    state = updateWorkspaceTabContext(state, "one", {
      selectedAssetIds: ["asset-a", "asset-b"],
      selectedAssetId: "asset-a",
      cachedTitle: "Reference board.png",
    });
    state = updateWorkspaceTabBrowseState(state, "one", {
      searchValue: "blue metal",
      filters: {
        formatFilter: "png",
        excludeFormatFilter: false,
        colorFilter: "",
        excludeColorFilter: false,
        colorSimilarity: 70,
        tagFilter: "",
        excludeTagFilter: false,
        excludedTagFilter: "",
        includeAiTagFilter: true,
        tagFilterMatch: "any",
        ratingFilter: "",
        excludeRatingFilter: false,
        includeAiRatingFilter: true,
        favoriteFilter: "any",
        sourceUrlFilter: "any",
        availabilityFilter: "any",
        excludeAvailabilityFilter: false,
        widthRange: { min: "", max: "", exclude: false },
        heightRange: { min: "", max: "", exclude: false },
        aspectRatioRange: { min: "", max: "", exclude: false },
        aspectRatioRanges: [],
        longEdgeRange: { min: "", max: "", exclude: false },
        durationRange: { min: "", max: "", exclude: false },
      },
      sortField: "modified_at",
      sortOrder: "desc",
      shuffleSeed: null,
      folderRecursive: true,
      collectionRecursive: true,
      showIgnoredItems: false,
    });
    state = addWorkspaceTab(state, ids("two"));
    state = setWorkspaceTabLocation(state, "two", {
      kind: "collection",
      collectionId: "collection-a",
      recursive: true,
    });

    expect(getWorkspaceTab(state, "one")?.location).toEqual({ kind: "all" });
    expect(getWorkspaceTab(state, "one")).toMatchObject({
      selectedAssetIds: ["asset-a", "asset-b"],
      selectedAssetId: "asset-a",
      cachedTitle: "Reference board.png",
    });
    expect(getWorkspaceTab(state, "one")?.viewport).toMatchObject({
      scrollTop: 420,
      scrollProgress: 0.42,
    });
    expect(getWorkspaceTab(state, "one")?.browseState).toMatchObject({
      searchValue: "blue metal",
      sortField: "modified_at",
      folderRecursive: true,
    });
    // The second tab carries its own location, independent of tab one.
    expect(getWorkspaceTab(state, "two")?.location).toEqual({
      kind: "collection",
      collectionId: "collection-a",
      recursive: true,
    });
  });

  it("selects existing tabs and ignores unknown ids", () => {
    let state = createWorkspaceTabs(ids("one"));
    state = addWorkspaceTab(state, ids("two"));
    expect(selectWorkspaceTab(state, "one").activeTabId).toBe("one");
    expect(selectWorkspaceTab(state, "missing")).toBe(state);
  });

  it("closes an active tab by selecting its right neighbor, then the left at the end", () => {
    let state = createWorkspaceTabs(ids("one"));
    state = addWorkspaceTab(state, ids("two"));
    state = addWorkspaceTab(state, ids("three"));
    state = selectWorkspaceTab(state, "two");

    let result = closeWorkspaceTab(state, "two");
    expect(result.state.activeTabId).toBe("three");
    expect(result.removedTabIds).toEqual(["two"]);
    expect(result.shouldNavigateToAll).toBe(true);

    result = closeWorkspaceTab(result.state, "three");
    expect(result.state.activeTabId).toBe("one");
  });

  it("closing the only tab keeps one tab and resets it to all assets", () => {
    let state = createWorkspaceTabs(ids("one"));
    state = setWorkspaceTabLocation(state, "one", {
      kind: "folder",
      folderId: "folder-a",
    });
    state = setWorkspaceTabViewport(state, "one", {
      scrollTop: 800,
      scrollProgress: 0.8,
      scrollExtent: 1_000,
    });
    state = updateWorkspaceTabContext(state, "one", {
      selectedAssetIds: ["asset-a"],
      selectedAssetId: "asset-a",
    });

    const result = closeWorkspaceTab(state, "one");
    expect(result.state.tabs).toHaveLength(1);
    expect(result.state.activeTabId).toBe("one");
    expect(result.state.tabs[0]?.location).toEqual({ kind: "all" });
    expect(result.state.tabs[0]).toMatchObject({
      selectedAssetIds: [],
      selectedAssetId: null,
    });
    expect(result.state.tabs[0]?.viewport.scrollTop).toBe(0);
    expect(result.shouldNavigateToAll).toBe(true);
  });

  it("closes other tabs without selecting a closed tab", () => {
    let state = createWorkspaceTabs(ids("one"));
    state = addWorkspaceTab(state, ids("two"));
    state = addWorkspaceTab(state, ids("three"));
    state = addWorkspaceTab(state, ids("four"));
    state = selectWorkspaceTab(state, "four");

    const result = closeWorkspaceTabsExcept(state, "one");
    expect(result.state.tabs.map((tab) => tab.id)).toEqual(["one"]);
    expect(result.state.activeTabId).toBe("one");
    expect(result.shouldNavigateToAll).toBe(true);
  });

  it("reorders tabs without touching location or the active tab", () => {
    let state = createWorkspaceTabs(ids("one"));
    state = addWorkspaceTab(state, ids("two"));
    state = addWorkspaceTab(state, ids("three"));
    state = selectWorkspaceTab(state, "two");
    state = setWorkspaceTabLocation(state, "one", {
      kind: "folder",
      folderId: "folder-a",
    });

    const moved = moveWorkspaceTab(state, "three", 0);
    expect(moved.tabs.map((tab) => tab.id)).toEqual(["three", "one", "two"]);
    expect(moved.activeTabId).toBe("two");
    expect(getWorkspaceTab(moved, "one")?.location).toEqual({
      kind: "folder",
      folderId: "folder-a",
    });

    expect(moveWorkspaceTab(moved, "three", 0)).toBe(moved);
    expect(moveWorkspaceTab(moved, "missing", 0)).toBe(moved);
    expect(moveWorkspaceTab(moved, "three", 99).tabs.map((tab) => tab.id)).toEqual([
      "one",
      "two",
      "three",
    ]);
  });

  it("shrinks the tab width share as more tabs open", () => {
    expect(workspaceTabWidthScale(1)).toBe(1);
    expect(workspaceTabWidthScale(3)).toBe(1);
    expect(workspaceTabWidthScale(4)).toBe(0.94);
    expect(workspaceTabWidthScale(7)).toBe(0.76);
    expect(workspaceTabWidthScale(8)).toBe(0.75);
    expect(workspaceTabWidthScale(40)).toBe(0.75);
    expect(workspaceTabWidthScale(0)).toBe(1);
  });
});