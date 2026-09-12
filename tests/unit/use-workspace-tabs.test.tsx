// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  useWorkspaceTabsController,
  type UseWorkspaceTabsControllerOptions,
} from "../../src/renderer/use-workspace-tabs";
import { createDefaultWorkspaceTabBrowseState } from "../../src/renderer/workspace-tabs";
import type { WorkspaceRenderSnapshot } from "../../src/renderer/workspace-render-snapshot-cache";

describe("useWorkspaceTabsController", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
  });

  it("serializes rapid transitions and invalidates queued restores when the library resets", async () => {
    let releaseFirstRestore: (() => void) | undefined;
    const firstRestoreGate = new Promise<void>((resolve) => {
      releaseFirstRestore = resolve;
    });
    const restoreStates: boolean[] = [];
    const restoreTab = vi.fn<UseWorkspaceTabsControllerOptions["restoreTab"]>(
      async (_tab, isCurrent) => {
        if (restoreTab.mock.calls.length === 1) await firstRestoreGate;
        restoreStates.push(isCurrent());
      },
    );
    const captureContext = vi.fn(() => ({
      viewport: {
        scrollTop: 0,
        scrollProgress: 0,
        scrollExtent: 0,
      },
      selectedAssetIds: [],
      selectedAssetId: null,
      browseState: createDefaultWorkspaceTabBrowseState(),
      cachedTitle: "All assets",
      renderSnapshot: null,
    }));
    let controller: ReturnType<typeof useWorkspaceTabsController> | undefined;

    function Host() {
      controller = useWorkspaceTabsController({
        captureContext,
        restoreTab,
        restoreAll: async () => undefined,
        beginTransition: () => () => true,
        getDefaultBrowseState: createDefaultWorkspaceTabBrowseState,
        onHistoryChanged: () => undefined,
        persistTabs: () => undefined,
      });
      return null;
    }

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<Host />);
    });

    let firstAdd: Promise<void> | undefined;
    let queuedAdd: Promise<void> | undefined;
    await act(async () => {
      firstAdd = controller?.addTab();
      await Promise.resolve();
    });
    expect(restoreTab).toHaveBeenCalledTimes(1);

    await act(async () => {
      queuedAdd = controller?.addTab();
      controller?.resetTabs();
      releaseFirstRestore?.();
      await Promise.all([firstAdd, queuedAdd]);
    });

    expect(restoreTab).toHaveBeenCalledTimes(1);
    expect(restoreStates).toEqual([false]);
    expect(controller?.state.tabs).toHaveLength(1);
    expect(controller?.state.tabs[0]?.history.current).toEqual({ kind: "all" });
    expect(captureContext).toHaveBeenCalledTimes(1);
  });

  it("keeps active navigation current when only inactive tabs are closed", async () => {
    let controller: ReturnType<typeof useWorkspaceTabsController> | undefined;
    function Host() {
      controller = useWorkspaceTabsController({
        captureContext: () => ({
          viewport: { scrollTop: 0, scrollProgress: 0, scrollExtent: 0 },
          selectedAssetIds: [],
          selectedAssetId: null,
          browseState: createDefaultWorkspaceTabBrowseState(),
          cachedTitle: "All assets",
          renderSnapshot: null,
        }),
        restoreTab: async () => undefined,
        restoreAll: async () => undefined,
        beginTransition: () => () => true,
        getDefaultBrowseState: createDefaultWorkspaceTabBrowseState,
        onHistoryChanged: () => undefined,
        persistTabs: () => undefined,
      });
      return null;
    }

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<Host />));
    const originalTabId = controller!.state.activeTabId;
    await act(async () => controller?.addTab());
    const activeTabId = controller!.state.activeTabId;
    const activeNavigation = controller!.beginNavigation("none");

    await act(async () => controller?.closeTab(originalTabId));
    expect(controller!.isNavigationCurrent(activeNavigation)).toBe(true);

    await act(async () => controller?.closeOtherTabs(activeTabId));
    expect(controller!.isNavigationCurrent(activeNavigation)).toBe(true);
    expect(controller!.state.tabs.map((tab) => tab.id)).toEqual([activeTabId]);
  });

  it("preserves the cached tab context when a history replay makes capture unsafe", async () => {
    let pauseCapture = false;
    const cachedSnapshot: WorkspaceRenderSnapshot = {
      kind: "browse",
      location: { kind: "all" },
      items: [],
      layout: [],
      virtualLayout: null,
      total: 0,
      snippets: [],
      pageDescriptor: {
        sessionId: null,
        offset: 0,
        pageSize: 40,
        scopeKey: "all",
        queryKey: null,
      },
    };
    const captureContext = vi.fn<UseWorkspaceTabsControllerOptions["captureContext"]>(
      () => pauseCapture
        ? null
        : {
            viewport: { scrollTop: 0, scrollProgress: 0, scrollExtent: 0 },
            selectedAssetIds: [],
            selectedAssetId: null,
            browseState: createDefaultWorkspaceTabBrowseState(),
            cachedTitle: "All assets",
            renderSnapshot: cachedSnapshot,
          },
    );
    let controller: ReturnType<typeof useWorkspaceTabsController> | undefined;
    function Host() {
      controller = useWorkspaceTabsController({
        captureContext,
        restoreTab: async () => undefined,
        restoreAll: async () => undefined,
        beginTransition: () => () => true,
        getDefaultBrowseState: createDefaultWorkspaceTabBrowseState,
        onHistoryChanged: () => undefined,
        persistTabs: () => undefined,
      });
      return null;
    }

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<Host />));
    await act(async () => controller?.activateRenderSnapshotLibrary("test-library"));
    await act(async () => controller?.addTab());
    await act(async () => controller?.addTab());
    const secondTabId = controller!.state.tabs[1]!.id;
    const thirdTabId = controller!.state.tabs[2]!.id;
    await act(async () => controller?.selectTab(secondTabId));
    expect(controller!.getRenderSnapshot(secondTabId)).not.toBeNull();

    pauseCapture = true;
    await act(async () => controller?.selectTab(thirdTabId));

    expect(controller!.state.activeTabId).toBe(thirdTabId);
    expect(controller!.getRenderSnapshot(secondTabId)).not.toBeNull();
  });

  it("invalidates the old tab request and navigates when the active tab closes", async () => {
    let controller: ReturnType<typeof useWorkspaceTabsController> | undefined;
    function Host() {
      controller = useWorkspaceTabsController({
        captureContext: () => ({
          viewport: { scrollTop: 0, scrollProgress: 0, scrollExtent: 0 },
          selectedAssetIds: [],
          selectedAssetId: null,
          browseState: createDefaultWorkspaceTabBrowseState(),
          cachedTitle: "All assets",
          renderSnapshot: null,
        }),
        restoreTab: async () => undefined,
        restoreAll: async () => undefined,
        beginTransition: () => () => true,
        getDefaultBrowseState: createDefaultWorkspaceTabBrowseState,
        onHistoryChanged: () => undefined,
        persistTabs: () => undefined,
      });
      return null;
    }

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<Host />));
    const firstTabId = controller!.state.activeTabId;
    await act(async () => controller?.addTab());
    const closedTabId = controller!.state.activeTabId;
    const oldRequest = controller!.beginNavigation("push");

    await act(async () => controller?.closeTab(closedTabId));

    expect(controller!.state.activeTabId).toBe(firstTabId);
    expect(controller!.isNavigationCurrent(oldRequest)).toBe(false);
  });

  it("reorders tabs without changing identity, and never persists a teardown", async () => {
    const persistTabs = vi.fn();
    let controller: ReturnType<typeof useWorkspaceTabsController> | undefined;
    function Host() {
      controller = useWorkspaceTabsController({
        captureContext: () => null,
        restoreTab: async () => undefined,
        restoreAll: async () => undefined,
        beginTransition: () => () => true,
        getDefaultBrowseState: createDefaultWorkspaceTabBrowseState,
        onHistoryChanged: () => undefined,
        persistTabs,
      });
      return null;
    }

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<Host />));
    await act(async () => controller?.addTab());
    await act(async () => controller?.addTab());
    const [first, second, third] = controller!.state.tabs.map((tab) => tab.id);
    const activeTabId = controller!.state.activeTabId;
    persistTabs.mockClear();

    await act(async () => controller?.moveTab(third!, 0));

    expect(controller!.state.tabs.map((tab) => tab.id)).toEqual([
      third,
      first,
      second,
    ]);
    expect(controller!.state.activeTabId).toBe(activeTabId);
    expect(persistTabs).toHaveBeenCalledTimes(1);

    persistTabs.mockClear();
    await act(async () => controller?.resetTabs());
    expect(persistTabs).not.toHaveBeenCalled();
  });

  it("rebuilds a saved strip and keeps the saved active tab", async () => {
    const persistTabs = vi.fn();
    let controller: ReturnType<typeof useWorkspaceTabsController> | undefined;
    function Host() {
      controller = useWorkspaceTabsController({
        captureContext: () => null,
        restoreTab: async () => undefined,
        restoreAll: async () => undefined,
        beginTransition: () => () => true,
        getDefaultBrowseState: createDefaultWorkspaceTabBrowseState,
        onHistoryChanged: () => undefined,
        persistTabs,
      });
      return null;
    }

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<Host />));

    await act(async () =>
      controller?.restoreTabs({
        version: 1,
        activeTabId: "tab-b",
        tabs: [
          { id: "tab-a", location: { kind: "folder", folderId: "folder-1" } },
          { id: "tab-b", location: { kind: "all" } },
          { id: "tab-c", location: { kind: "trash", tombstoneId: null } },
        ],
      })
    );

    expect(controller!.state.tabs.map((tab) => tab.id)).toEqual([
      "tab-a",
      "tab-b",
      "tab-c",
    ]);
    expect(controller!.state.activeTabId).toBe("tab-b");
    expect(controller!.state.tabs[0]?.history.current).toEqual({
      kind: "folder",
      folderId: "folder-1",
    });
    // A restored location sits on an "all assets" base so Back works at once.
    expect(controller!.state.tabs[0]?.history.canBack).toBe(true);
    expect(controller!.state.tabs[1]?.history.canBack).toBe(false);
    // The startup restore writes the session itself, against the library id it
    // holds; the render-bound persist hook would still see the previous library.
    expect(persistTabs).not.toHaveBeenCalled();
  });
});
