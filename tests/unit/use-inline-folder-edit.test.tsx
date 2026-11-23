// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/renderer/i18n", () => ({
  lookupMessage: () => undefined,
  useLocale: () => ({ locale: "en" }),
  useT: () => (key: string) => key,
}));

import type { SerpentLibraryApi } from "../../src/shared/library-api";
import type { RendererLibrarySummary } from "../../src/shared/protocol/responses";
import type { LibraryViewSessionToken } from "../../src/renderer/library-view-session";
import type { FolderMutationResult } from "../../src/renderer/folder-mutation-projection";
import {
  useInlineFolderEdit,
  type UseInlineFolderEditResult,
} from "../../src/renderer/use-inline-folder-edit";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createdFolder(folderId = "created") {
  return {
    folderId,
    parentFolderId: null,
    name: "created",
    relativePath: "created",
    directAssetCount: 0,
    childFolderCount: 0,
    createdAt: "fixture-time",
    appearance: null,
  };
}

function renamedFolder(folderId = "folder") {
  return {
    folderId,
    parentFolderId: null,
    name: "renamed",
    relativePath: "renamed",
    directAssetCount: 0,
    childFolderCount: 0,
    createdAt: "fixture-time",
    appearance: null,
  };
}

describe("useInlineFolderEdit async session ownership", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  let current: UseInlineFolderEditResult | null = null;
  let currentViewToken: LibraryViewSessionToken = { libraryId: "library", generation: 1 };

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = undefined;
    container?.remove();
    container = undefined;
    current = null;
    vi.restoreAllMocks();
  });

  async function render(options?: {
    api?: Partial<SerpentLibraryApi>;
    libraryId?: string;
    token?: LibraryViewSessionToken;
    scheduleRefreshAfterMutation?: (token: LibraryViewSessionToken) => Promise<void>;
    onRenameSuccess?: (
      result: FolderMutationResult,
      previousFolderId: string,
      token: LibraryViewSessionToken,
    ) => Promise<boolean> | boolean;
  }): Promise<{
    api: SerpentLibraryApi;
    setNotice: ReturnType<typeof vi.fn>;
    onMutationCommitted: ReturnType<typeof vi.fn>;
    scheduleRefreshAfterMutation: ReturnType<typeof vi.fn>;
    onPostCommitError: ReturnType<typeof vi.fn>;
    rerender: () => Promise<void>;
  }> {
    const viewToken = options?.token ?? { libraryId: options?.libraryId ?? "library", generation: 1 };
    currentViewToken = viewToken;
    const setNotice = vi.fn();
    const onMutationCommitted = vi.fn();
    const scheduleRefreshAfterMutation = vi.fn(
      options?.scheduleRefreshAfterMutation ?? (() => Promise.resolve()),
    );
    const onPostCommitError = vi.fn();
    const api = {
      createFolder: vi.fn(),
      renameFolder: vi.fn(),
      createLinkedFolderDirectory: vi.fn(),
      renameLinkedFolderDirectory: vi.fn(),
      ...options?.api,
    } as unknown as SerpentLibraryApi;

    function Harness() {
      current = useInlineFolderEdit({
        api,
        library: { libraryId: currentViewToken.libraryId } as RendererLibrarySummary,
        setNotice,
        captureLibraryViewToken: (libraryId) =>
          currentViewToken.libraryId === libraryId ? currentViewToken : null,
        isLibraryViewCurrent: (token) =>
          token.libraryId === currentViewToken.libraryId
          && token.generation === currentViewToken.generation,
        onMutationCommitted,
        scheduleRefreshAfterMutation,
        onPostCommitError,
        onRenameSuccess: options?.onRenameSuccess,
      });
      return null;
    }

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const rerender = async () => {
      await act(async () => {
        root?.render(createElement(Harness));
      });
    };
    await act(async () => {
      root?.render(createElement(Harness));
    });
    return {
      api,
      setNotice,
      onMutationCommitted,
      scheduleRefreshAfterMutation,
      onPostCommitError,
      rerender,
    };
  }

  it("deduplicates Enter/blur submits and leaves a reopened same-parent editor alone", async () => {
    const write = deferred<{ ok: true; value: ReturnType<typeof createdFolder> }>();
    const { api, onMutationCommitted, setNotice } = await render({
      api: { createFolder: vi.fn(() => write.promise) as never },
    });
    await act(async () => current?.openInlineFolderCreate(null));
    await act(async () => current?.changeInlineFolderEdit("first"));

    let firstCommit!: Promise<void>;
    await act(() => {
      firstCommit = current!.commitInlineFolderEdit();
      void current!.commitInlineFolderEdit();
    });
    expect(api.createFolder).toHaveBeenCalledOnce();

    await act(async () => current?.openInlineFolderCreate(null));
    await act(async () => current?.changeInlineFolderEdit("second"));
    await act(async () => {
      write.resolve({ ok: true, value: createdFolder() });
      await firstCommit;
    });

    expect(current?.inlineFolderEdit).toMatchObject({ kind: "create", value: "second" });
    expect(onMutationCommitted).toHaveBeenCalledOnce();
    expect(setNotice).toHaveBeenCalledOnce();
  });

  it("does not route a post-commit refresh rejection into a new editor", async () => {
    const refresh = deferred<void>();
    const { api, onPostCommitError } = await render({
      api: {
        createFolder: vi.fn(async () => ({ ok: true as const, value: createdFolder() })) as never,
      },
      scheduleRefreshAfterMutation: () => refresh.promise,
    });
    await act(async () => current?.openInlineFolderCreate(null));
    await act(async () => current?.changeInlineFolderEdit("first"));
    let commit!: Promise<void>;
    await act(() => { commit = current!.commitInlineFolderEdit(); });
    await act(async () => { await commit; });
    expect(api.createFolder).toHaveBeenCalledOnce();

    await act(async () => current?.openInlineFolderCreate(null));
    await act(async () => current?.changeInlineFolderEdit("second"));
    await act(async () => {
      refresh.reject(new Error("refresh failed"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(current?.inlineFolderEdit).toMatchObject({ kind: "create", value: "second", error: null });
    expect(onPostCommitError).toHaveBeenCalledOnce();
  });

  it.each([
    { label: "library switch", next: { libraryId: "other-library", generation: 2 } },
    { label: "same-library reopen", next: { libraryId: "library", generation: 2 } },
  ])("ignores a late write after $label", async ({ next }) => {
    const write = deferred<{ ok: true; value: ReturnType<typeof createdFolder> }>();
    const { api, onMutationCommitted, scheduleRefreshAfterMutation, setNotice, rerender } = await render({
      api: { createFolder: vi.fn(() => write.promise) as never },
    });
    await act(async () => current?.openInlineFolderCreate(null));
    await act(async () => current?.changeInlineFolderEdit("first"));
    let commit!: Promise<void>;
    await act(() => { commit = current!.commitInlineFolderEdit(); });
    currentViewToken = next;
    await rerender();
    await act(async () => {
      write.resolve({ ok: true, value: createdFolder() });
      await commit;
    });

    expect(api.createFolder).toHaveBeenCalledOnce();
    expect(current?.inlineFolderEdit).toBeNull();
    expect(onMutationCommitted).not.toHaveBeenCalled();
    expect(scheduleRefreshAfterMutation).not.toHaveBeenCalled();
    expect(setNotice).not.toHaveBeenCalled();
  });

  it("keeps a new rename editor when the post-commit route callback rejects", async () => {
    const { api, onPostCommitError } = await render({
      api: {
        renameFolder: vi.fn(async () => ({ ok: true as const, value: renamedFolder() })) as never,
      },
      onRenameSuccess: async () => { throw new Error("route refresh failed"); },
    });
    await act(async () => current?.openInlineFolderRename("folder", "old"));
    await act(async () => current?.changeInlineFolderEdit("renamed"));
    let commit!: Promise<void>;
    await act(async () => {
      commit = current!.commitInlineFolderEdit();
      await commit;
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => current?.openInlineFolderRename("folder", "old"));
    await act(async () => {
      current?.changeInlineFolderEdit("new edit");
      await Promise.resolve();
    });

    expect(api.renameFolder).toHaveBeenCalledOnce();
    expect(current?.inlineFolderEdit).toMatchObject({ kind: "rename", value: "new edit", error: null });
    expect(onPostCommitError).toHaveBeenCalledOnce();
  });
});
