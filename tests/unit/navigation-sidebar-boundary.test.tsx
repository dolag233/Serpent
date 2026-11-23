// @vitest-environment happy-dom
import {
  act,
  createElement,
  Fragment,
  startTransition,
  Suspense,
  useState,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSidebar = vi.hoisted(() => ({
  render: vi.fn(),
  props: [] as unknown[],
}));

vi.mock("../../src/renderer/NavigationSidebar", async () => {
  const { createElement: h } = await import("react");
  return {
    NavigationSidebar: (props: unknown) => {
      mockSidebar.render();
      mockSidebar.props.push(props);
      return h("div", { "data-sidebar-mock": "true" });
    },
  };
});

import { NavigationSidebarBoundary } from "../../src/renderer/navigation-sidebar-boundary";
import type { NavigationSidebarProps } from "../../src/renderer/NavigationSidebar";

let container: HTMLDivElement | undefined;
let root: Root | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

function mountRoot(): void {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
}

function createSidebarProps(
  overrides: Partial<NavigationSidebarProps> = {},
): NavigationSidebarProps {
  const noop = vi.fn();
  return {
    library: {
      libraryId: "library-a",
      displayName: "Example library",
      displayPath: "example-library",
    },
    assetScope: "root",
    showTrash: false,
    showTagManagement: false,
    activeTagId: null,
    activeCollectionId: null,
    activeSmartCollectionId: null,
    showIgnoredItems: false,
    onToggleShowIgnoredItems: noop,
    allAssetCount: 7,
    rootAssetCount: 2,
    trashedAssetCount: 0,
    folders: [],
    collections: [],
    collectionTree: new Map(),
    smartCollections: [],
    linkedFolders: [],
    showCollectionInput: false,
    collectionInputValue: "",
    newCollectionParentId: null,
    inlineCollectionRename: null,
    draggedCollectionId: null,
    onSetDraggedCollectionId: noop,
    onChooseAllAssets: noop,
    onEnterTrash: noop,
    onEnterTagManagement: noop,
    onChooseFolder: noop,
    onChooseCollection: noop,
    onChooseSmartCollection: noop,
    onExternalDragOver: noop,
    onExternalDrop: noop,
    onAssetsDroppedOnFolder: noop,
    onFoldersDroppedOnFolder: noop,
    selectedFolderIds: [],
    onToggleFolderSelection: noop,
    onAssetsDroppedOnTrash: noop,
    onFoldersDroppedOnTrash: noop,
    onAssetsDroppedOnCollection: noop,
    onImportFolderAsLinked: noop,
    onRelinkFolder: noop,
    onConvertLinkedDialog: noop,
    onAddCollection: noop,
    onSetShowCollectionInput: noop,
    onSetCollectionInputValue: noop,
    onSetNewCollectionParentId: noop,
    onCollectionInputCommit: noop,
    onInlineCollectionRenameChange: noop,
    onInlineCollectionRenameCommit: noop,
    onInlineCollectionRenameCancel: noop,
    onAddFolder: noop,
    onAddSmartCollection: noop,
    inlineFolderEdit: null,
    onInlineFolderEditChange: noop,
    onInlineFolderEditCommit: noop,
    onInlineFolderEditCancel: noop,
    inlineSmartCollectionEdit: null,
    onInlineSmartCollectionEditChange: noop,
    onInlineSmartCollectionEditCommit: noop,
    onInlineSmartCollectionEditCancel: noop,
    onOpenContextMenu: noop,
    onNestCollection: noop,
    onMoveCollectionToRoot: noop,
    onImportDroppedFiles: noop,
    onCopyManagedToLinked: noop,
    ...overrides,
  };
}

function lastSidebarProps(): NavigationSidebarProps {
  return mockSidebar.props.at(-1) as NavigationSidebarProps;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  mockSidebar.render.mockClear();
  mockSidebar.props = [];
  vi.unstubAllGlobals();
});

describe("NavigationSidebarBoundary", () => {
  it("keeps stable inner props while dispatching through the latest committed callbacks", async () => {
    mountRoot();
    const firstChoose = vi.fn();
    const latestChoose = vi.fn();
    const base = createSidebarProps();

    await act(async () => {
      root?.render(createElement(NavigationSidebarBoundary, {
        ...base,
        onChooseFolder: firstChoose,
      }));
    });
    const stableWrapper = lastSidebarProps().onChooseFolder;

    await act(async () => {
      root?.render(createElement(NavigationSidebarBoundary, {
        ...base,
        onChooseFolder: latestChoose,
      }));
    });

    expect(mockSidebar.render).toHaveBeenCalledTimes(1);
    stableWrapper("folder-x");
    expect(firstChoose).not.toHaveBeenCalled();
    expect(latestChoose).toHaveBeenCalledWith("folder-x");
  });

  it("rerenders the inner sidebar when a data reference or primitive changes", async () => {
    mountRoot();
    const base = createSidebarProps();
    await act(async () => {
      root?.render(createElement(NavigationSidebarBoundary, base));
    });
    expect(mockSidebar.render).toHaveBeenCalledTimes(1);

    await act(async () => {
      root?.render(createElement(NavigationSidebarBoundary, {
        ...base,
        folders: [...base.folders],
      }));
    });
    expect(mockSidebar.render).toHaveBeenCalledTimes(2);

    await act(async () => {
      root?.render(createElement(NavigationSidebarBoundary, {
        ...base,
        allAssetCount: base.allAssetCount + 1,
      }));
    });
    expect(mockSidebar.render).toHaveBeenCalledTimes(3);
  });

  it("fences stale callbacks after a library switch and after returning to the same library", async () => {
    mountRoot();
    const firstAChoose = vi.fn();
    const latestAChoose = vi.fn();
    const bChoose = vi.fn();
    const firstAResolve = vi.fn(async () => ["old-asset"]);
    const firstAAssetDragIds = vi.fn(() => ["old-asset"]);
    const firstAFolderDragIds = vi.fn(() => ["old-folder"]);
    const firstAInternalDrag = vi.fn(() => true);
    const base = createSidebarProps({
      onChooseFolder: firstAChoose,
      onResolveManagedAssetDrop: firstAResolve,
      getManagedAssetDragIds: firstAAssetDragIds,
      getManagedFolderDragIds: firstAFolderDragIds,
      isInternalAssetDrag: firstAInternalDrag,
    });

    await act(async () => {
      root?.render(createElement(NavigationSidebarBoundary, base));
    });
    const firstAWrapper = lastSidebarProps().onChooseFolder;
    const firstAResolveWrapper = lastSidebarProps().onResolveManagedAssetDrop;
    const firstAAssetDragIdsWrapper = lastSidebarProps().getManagedAssetDragIds;
    const firstAFolderDragIdsWrapper = lastSidebarProps().getManagedFolderDragIds;
    const firstAInternalDragWrapper = lastSidebarProps().isInternalAssetDrag;

    await act(async () => {
      root?.render(createElement(NavigationSidebarBoundary, {
        ...base,
        library: { ...base.library!, libraryId: "library-b" },
        onChooseFolder: bChoose,
      }));
    });
    firstAWrapper("stale-before-return");
    expect(firstAChoose).not.toHaveBeenCalled();
    expect(bChoose).not.toHaveBeenCalled();
    await expect(firstAResolveWrapper?.([])).resolves.toEqual([]);
    expect(firstAAssetDragIdsWrapper?.()).toBeNull();
    expect(firstAFolderDragIdsWrapper?.()).toBeNull();
    expect(firstAInternalDragWrapper?.()).toBe(false);
    expect(firstAResolve).not.toHaveBeenCalled();
    expect(firstAAssetDragIds).not.toHaveBeenCalled();
    expect(firstAFolderDragIds).not.toHaveBeenCalled();
    expect(firstAInternalDrag).not.toHaveBeenCalled();

    await act(async () => {
      root?.render(createElement(NavigationSidebarBoundary, {
        ...base,
        onChooseFolder: latestAChoose,
      }));
    });
    const returnedAWrapper = lastSidebarProps().onChooseFolder;

    firstAWrapper("stale-after-return");
    expect(firstAChoose).not.toHaveBeenCalled();
    expect(latestAChoose).not.toHaveBeenCalled();
    returnedAWrapper("current-a");
    expect(latestAChoose).toHaveBeenCalledWith("current-a");
    expect(bChoose).not.toHaveBeenCalled();
  });

  it("forwards optional callbacks when present and safely drops them when removed", async () => {
    mountRoot();
    const base = createSidebarProps();
    const choosePlugin = vi.fn();
    await act(async () => {
      root?.render(createElement(NavigationSidebarBoundary, base));
    });
    expect(lastSidebarProps().onChoosePluginSidebarView).toBeUndefined();

    await act(async () => {
      root?.render(createElement(NavigationSidebarBoundary, {
        ...base,
        onChoosePluginSidebarView: choosePlugin,
      }));
    });
    const previousOptionalWrapper = lastSidebarProps().onChoosePluginSidebarView;
    previousOptionalWrapper?.("plugin-x");
    expect(choosePlugin).toHaveBeenCalledWith("plugin-x");

    await act(async () => {
      root?.render(createElement(NavigationSidebarBoundary, base));
    });
    expect(lastSidebarProps().onChoosePluginSidebarView).toBeUndefined();
    expect(previousOptionalWrapper?.("removed-plugin")).toBeUndefined();
    expect(choosePlugin).toHaveBeenCalledTimes(1);
    expect(mockSidebar.render).toHaveBeenCalledTimes(3);
  });

  it("does not publish callbacks from a suspended transition until that candidate commits", async () => {
    mountRoot();
    const firstChoose = vi.fn();
    const candidateChoose = vi.fn();
    const gate = deferred<void>();
    let gateResolved = false;
    void gate.promise.then(() => { gateResolved = true; });
    let setCandidate!: (candidate: boolean) => void;
    const base = createSidebarProps();

    function PendingCandidate(): null {
      if (!gateResolved) throw gate.promise;
      return null;
    }

    function Harness() {
      const [candidate, set] = useState(false);
      setCandidate = set;
      return createElement(Suspense, { fallback: createElement("div", null, "waiting") },
        createElement(Fragment, null,
          createElement(NavigationSidebarBoundary, {
            ...base,
            onChooseFolder: candidate ? candidateChoose : firstChoose,
          }),
          candidate ? createElement(PendingCandidate) : null,
        ),
      );
    }

    await act(async () => {
      root?.render(createElement(Harness));
    });
    const stableWrapper = lastSidebarProps().onChooseFolder;

    act(() => {
      startTransition(() => setCandidate(true));
    });
    stableWrapper("while-suspended");
    expect(firstChoose).toHaveBeenCalledWith("while-suspended");
    expect(candidateChoose).not.toHaveBeenCalled();

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    stableWrapper("after-commit");
    expect(candidateChoose).toHaveBeenCalledWith("after-commit");
    expect(firstChoose).toHaveBeenCalledTimes(1);
    expect(mockSidebar.render).toHaveBeenCalledTimes(1);
  });

  it("keeps the committed library scope when a suspended switch is abandoned", async () => {
    mountRoot();
    const chooseA = vi.fn();
    const chooseB = vi.fn();
    const gate = deferred<void>();
    let gateResolved = false;
    void gate.promise.then(() => { gateResolved = true; });
    let setLibraryB!: (value: boolean) => void;
    const base = createSidebarProps({ onChooseFolder: chooseA });
    function PendingSwitch(): null {
      if (!gateResolved) throw gate.promise;
      return null;
    }
    function Harness() {
      const [libraryB, set] = useState(false);
      setLibraryB = set;
      return createElement(Suspense, { fallback: null }, createElement(Fragment, null,
        createElement(NavigationSidebarBoundary, libraryB ? {
          ...base, library: { ...base.library!, libraryId: "library-b" }, onChooseFolder: chooseB,
        } : base),
        libraryB ? createElement(PendingSwitch) : null,
      ));
    }
    await act(async () => root?.render(createElement(Harness)));
    const committedA = lastSidebarProps().onChooseFolder;
    act(() => { startTransition(() => setLibraryB(true)); });
    committedA("during-candidate");
    expect(chooseA).toHaveBeenCalledExactlyOnceWith("during-candidate");
    expect(chooseB).not.toHaveBeenCalled();
    await act(async () => setLibraryB(false));
    committedA("after-abandon");
    expect(chooseA).toHaveBeenLastCalledWith("after-abandon");
    expect(chooseB).not.toHaveBeenCalled();
    await act(async () => { gate.resolve(); await gate.promise; });
  });
});
