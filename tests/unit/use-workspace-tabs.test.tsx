// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  useWorkspaceTabsController,
  type UseWorkspaceTabsControllerOptions,
} from "../../src/renderer/use-workspace-tabs";
import { createDefaultWorkspaceTabBrowseState } from "../../src/renderer/workspace-tabs";

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
});
