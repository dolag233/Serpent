// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const deferredHydrations = vi.hoisted(() => ({
  requests: [] as Array<{
    load: () => Promise<unknown>;
    signal?: AbortSignal;
    immediate: boolean;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
    run: () => Promise<void>;
  }>,
}));

vi.mock("../../src/renderer/browse/defer-navigation-hydration", () => ({
  deferNavigationHydration: vi.fn((
    load: () => Promise<unknown>,
    options?: { signal?: AbortSignal; immediate?: boolean },
  ) => new Promise<unknown>((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };
    const request = {
      load,
      signal: options?.signal,
      immediate: options?.immediate === true,
      resolve: (value: unknown) => settle(() => resolve(value)),
      reject: (error: unknown) => settle(() => reject(error)),
      run: async () => {
        if (settled) return;
        if (options?.signal?.aborted) {
          settle(() => resolve(undefined));
          return;
        }
        try {
          const value = await load();
          settle(() => resolve(value));
        } catch (error) {
          settle(() => reject(error));
        }
      },
    };
    deferredHydrations.requests.push(request);
    options?.signal?.addEventListener("abort", () => {
      settle(() => resolve(undefined));
    }, { once: true });
    if (options?.signal?.aborted) settle(() => resolve(undefined));
  })),
}));

import type { LinkedFolderDirectoryMutation, LinkedFolderSummary } from "../../src/shared/asset-types";
import { encodeLinkedVirtualFolderId } from "../../src/shared/linked-folder-tree";
import { FolderMutationProjectionGate } from "../../src/renderer/folder-mutation-projection";
import type { LibraryViewSessionToken } from "../../src/renderer/library-view-session";
import { useFolderMutationBridge } from "../../src/renderer/use-folder-mutation-bridge";
import { createWorkspaceNavHistory } from "../../src/renderer/workspace-nav-history";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const token1: LibraryViewSessionToken = { libraryId: "library", generation: 1 };
const rootId = "linked-root";
const oldParentId = encodeLinkedVirtualFolderId(rootId, "parent");
const newParentId = encodeLinkedVirtualFolderId(rootId, "renamed-parent");
const oldDescendantId = encodeLinkedVirtualFolderId(rootId, "parent/child/grandchild");
const newDescendantId = encodeLinkedVirtualFolderId(rootId, "renamed-parent/child/grandchild");

function linkedFolder(values: Partial<LinkedFolderSummary> & Pick<LinkedFolderSummary, "folderId">): LinkedFolderSummary {
  return {
    folderId: values.folderId,
    linkedFolderId: values.linkedFolderId ?? rootId,
    displayName: values.displayName ?? values.folderId,
    status: values.status ?? "available",
    assetCount: values.assetCount ?? 0,
    absoluteRootPath: values.absoluteRootPath ?? "fixture/source",
    relativePath: values.relativePath ?? "",
    parentFolderId: values.parentFolderId ?? null,
  };
}

function linkedRows(): LinkedFolderSummary[] {
  return [
    linkedFolder({ folderId: rootId, displayName: "Source", relativePath: "" }),
    linkedFolder({
      folderId: oldParentId,
      displayName: "parent",
      relativePath: "parent",
      parentFolderId: rootId,
    }),
    linkedFolder({
      folderId: encodeLinkedVirtualFolderId(rootId, "parent/child"),
      displayName: "child",
      relativePath: "parent/child",
      parentFolderId: oldParentId,
    }),
    linkedFolder({
      folderId: oldDescendantId,
      displayName: "grandchild",
      relativePath: "parent/child/grandchild",
      parentFolderId: encodeLinkedVirtualFolderId(rootId, "parent/child"),
    }),
  ];
}

const renameResult: LinkedFolderDirectoryMutation = {
  folderId: newParentId,
  linkedFolderId: rootId,
  parentFolderId: rootId,
  name: "renamed-parent",
  relativePath: "renamed-parent",
  status: "available",
};

type Snapshot = {
  linkedFolders: LinkedFolderSummary[];
  selectedFolderIds: string[];
  filteredCountRefreshToken: number;
};

describe("useFolderMutationBridge", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  let activeRefreshAbortRef: { current: AbortController | null } | undefined;

  afterEach(async () => {
    activeRefreshAbortRef?.current?.abort();
    if (root) await act(async () => root?.unmount());
    root = undefined;
    container?.remove();
    container = undefined;
    activeRefreshAbortRef = undefined;
    deferredHydrations.requests.length = 0;
    vi.restoreAllMocks();
  });

  async function mount(options?: {
    scope?: string;
    historyLocation?: { kind: "folder"; folderId: string };
    reload?: () => Promise<void>;
  }) {
    let currentToken = token1;
    const libraryRef = { current: { libraryId: token1.libraryId } };
    const refreshAbortRef: { current: AbortController | null } = { current: null };
    activeRefreshAbortRef = refreshAbortRef;
    const reload = options?.reload ?? vi.fn(async () => undefined);
    const reloadRef = { current: reload };
    const scopeRef = { current: options?.scope ?? oldDescendantId };
    const historyRef = {
      current: createWorkspaceNavHistory(
        options?.historyLocation ?? { kind: "folder", folderId: oldDescendantId },
      ),
    };
    const onScopeRemapped = vi.fn();
    const onHistoryChanged = vi.fn();
    let bridge!: ReturnType<typeof useFolderMutationBridge>;
    let snapshot!: Snapshot;
    const initialLinkedFolders = linkedRows();
    const projectionGate = new FolderMutationProjectionGate();

    function Harness() {
      const [linkedFolders, setLinkedFolders] = useState(initialLinkedFolders);
      const [selectedFolderIds, setSelectedFolderIds] = useState([oldDescendantId]);
      const [filteredCountRefreshToken, setFilteredCountRefreshToken] = useState(0);
      snapshot = { linkedFolders, selectedFolderIds, filteredCountRefreshToken };
      bridge = useFolderMutationBridge({
        libraryRef,
        isLibraryViewCurrent: (token) =>
          token.libraryId === currentToken.libraryId
          && token.generation === currentToken.generation,
        projectionGate,
        refreshAbortRef,
        reloadRef,
        scopeRef,
        historyRef,
        onScopeRemapped,
        onHistoryChanged,
        setFolders: () => undefined,
        setLinkedFolders,
        setSelectedFolderIds,
        setFilteredCountRefreshToken,
      });
      return null;
    }

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const rerender = async () => {
      await act(async () => root?.render(createElement(Harness)));
    };
    await rerender();

    return {
      get bridge() { return bridge; },
      get snapshot() { return snapshot; },
      currentToken: () => currentToken,
      setCurrentToken: (token: LibraryViewSessionToken) => {
        currentToken = token;
        libraryRef.current = { libraryId: token.libraryId };
      },
      libraryRef,
      refreshAbortRef,
      reload,
      reloadRef,
      scopeRef,
      historyRef,
      onScopeRemapped,
      onHistoryChanged,
      rerender,
    };
  }

  it("remaps an active descendant scope, linked subtree, selection, and history", async () => {
    const fixture = await mount();
    const mutation = {
      kind: "rename" as const,
      previousFolderId: oldParentId,
      folder: renameResult,
    };

    await act(async () => {
      fixture.bridge.onMutationCommitted(mutation, token1);
      expect(fixture.bridge.onRenameSuccess(renameResult, oldParentId, token1)).toBe(false);
    });

    expect(fixture.scopeRef.current).toBe(newDescendantId);
    expect(fixture.onScopeRemapped).toHaveBeenCalledWith(newDescendantId);
    expect(fixture.historyRef.current.current).toEqual({ kind: "folder", folderId: newDescendantId });
    expect(fixture.onHistoryChanged).toHaveBeenCalledOnce();
    expect(fixture.snapshot.selectedFolderIds).toEqual([newDescendantId]);
    expect(fixture.snapshot.linkedFolders.map((folder) => folder.folderId)).toContain(newDescendantId);
    expect(fixture.snapshot.linkedFolders.find((folder) => folder.folderId === newDescendantId))
      .toMatchObject({ relativePath: "renamed-parent/child/grandchild", displayName: "grandchild" });
  });

  it("refreshes using the remapped scope and leaves committed identity after read rejection", async () => {
    const observedScopes: string[] = [];
    const fixture = await mount({
      reload: vi.fn(async () => {
        observedScopes.push(fixture.scopeRef.current);
        throw new Error("browse refresh failed");
      }),
    });
    fixture.bridge.onRenameSuccess(renameResult, oldParentId, token1);
    let refresh!: Promise<void>;
    await act(async () => {
      refresh = fixture.bridge.scheduleRefreshAfterMutation(token1);
      await Promise.resolve();
    });
    const request = deferredHydrations.requests[0]!;
    expect(request.immediate).toBe(true);
    const rejected = expect(refresh).rejects.toThrow("browse refresh failed");
    await act(async () => request.run());
    await rejected;

    expect(observedScopes).toEqual([newDescendantId]);
    expect(fixture.scopeRef.current).toBe(newDescendantId);
    expect(fixture.historyRef.current.current).toEqual({ kind: "folder", folderId: newDescendantId });
  });

  it.each([
    { label: "library switch", next: { libraryId: "other-library", generation: 2 } },
    { label: "same-library reopen", next: { libraryId: "library", generation: 2 } },
  ])("rejects a late mutation after $label", async ({ next }) => {
    const fixture = await mount();
    const beforeFolders = fixture.snapshot.linkedFolders;
    fixture.setCurrentToken(next);
    await fixture.rerender();

    await act(async () => {
      fixture.bridge.onMutationCommitted({
        kind: "rename",
        previousFolderId: oldParentId,
        folder: renameResult,
      }, token1);
      expect(fixture.bridge.onRenameSuccess(renameResult, oldParentId, token1)).toBe(false);
    });

    expect(fixture.snapshot.linkedFolders).toBe(beforeFolders);
    expect(fixture.scopeRef.current).toBe(oldDescendantId);
    expect(fixture.historyRef.current.current).toEqual({ kind: "folder", folderId: oldDescendantId });
    expect(fixture.onScopeRemapped).not.toHaveBeenCalled();
    expect(fixture.onHistoryChanged).not.toHaveBeenCalled();
  });

  it("does not read after a queued refresh is aborted", async () => {
    const reload = vi.fn(async () => undefined);
    const fixture = await mount({ reload });
    let refresh!: Promise<void>;
    await act(async () => {
      refresh = fixture.bridge.scheduleRefreshAfterMutation(token1);
      await Promise.resolve();
    });
    const request = deferredHydrations.requests[0]!;
    expect(request.signal).toBe(fixture.refreshAbortRef.current?.signal);

    await act(async () => {
      fixture.refreshAbortRef.current?.abort();
      await refresh;
      await request.run();
    });

    expect(reload).not.toHaveBeenCalled();
  });
});
