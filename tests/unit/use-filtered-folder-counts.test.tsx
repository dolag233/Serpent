// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useFilteredFolderCounts,
  type UseFilteredFolderCountsOptions,
} from "../../src/renderer/use-filtered-folder-counts";
import type { FilterClause } from "../../src/shared/asset-types";
import type { SerpentLibraryApi } from "../../src/shared/library-api";

type CountResult = Awaited<ReturnType<SerpentLibraryApi["listFilteredFolderCounts"]>>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createApi() {
  const requests: ReturnType<typeof deferred<CountResult>>[] = [];
  const listFilteredFolderCounts = vi.fn<SerpentLibraryApi["listFilteredFolderCounts"]>(() => {
    const request = deferred<CountResult>();
    requests.push(request);
    return request.promise;
  });
  return { api: { listFilteredFolderCounts }, requests };
}

function success(folderId = "matched", count = 1): CountResult {
  return { ok: true, value: { all: count + 2, root: 2, folders: [{ folderId, count }] } };
}

const favorite: FilterClause = { field: "favorite", values: [], exclude: false };

function options(
  api: UseFilteredFolderCountsOptions["api"],
  overrides: Partial<UseFilteredFolderCountsOptions> = {},
): UseFilteredFolderCountsOptions {
  return {
    api, libraryId: "library-a", filters: [favorite], showIgnored: false,
    enabled: true, refreshToken: 0, ...overrides,
  };
}

function Probe(props: UseFilteredFolderCountsOptions) {
  const counts = useFilteredFolderCounts(props);
  return <output>{JSON.stringify(counts && {
    all: counts.all, root: counts.root, folders: Object.fromEntries(counts.byFolderId),
  })}</output>;
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function render(props: UseFilteredFolderCountsOptions) {
  if (!container) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () => root?.render(<Probe {...props} />));
}

function displayedCounts() {
  return JSON.parse(container!.querySelector("output")!.textContent!);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  vi.unstubAllGlobals();
});

describe("useFilteredFolderCounts", () => {
  it.each<Partial<UseFilteredFolderCountsOptions>>([
    { api: null }, { api: undefined }, { libraryId: undefined },
    { filters: undefined }, { filters: [] }, { enabled: false },
  ])("does not request counts without an active filtered library: %j", async (overrides) => {
    const { api } = createApi();
    await render(options(api, overrides));
    expect(api.listFilteredFolderCounts).not.toHaveBeenCalled();
    expect(displayedCounts()).toBeNull();
  });

  const filterCases: FilterClause[] = [
    { field: "color", values: ["red"], exclude: false, similarity: 75, swatches: { red: "#ff0000" } },
    { field: "format", values: ["png", "jpg"], exclude: false },
    { field: "tag", values: ["中文", "A"], exclude: false, includeAi: false },
    { field: "rating", values: ["3", "5"], exclude: false, includeAi: true },
    favorite,
    { field: "source_url", values: [], exclude: false },
    { field: "availability", values: ["missing"], exclude: false },
    { field: "width", ranges: [{ min: 1920 }], exclude: false },
    { field: "height", ranges: [{ max: 1080 }], exclude: false },
    { field: "aspect_ratio", ranges: [{ min: 1, max: 1.5 }, { min: 2 }], exclude: false },
    { field: "long_edge", ranges: [{ min: 2240, max: 4480 }], exclude: false },
    { field: "duration_ms", ranges: [{ min: 1000, max: 60000 }], exclude: false },
  ];

  it.each(filterCases.flatMap((clause) => [clause, { ...clause, exclude: true }]))(
    "requests recursive counts for $field (exclude=$exclude), preserving the clause",
    async (clause) => {
      const { api, requests } = createApi();
      await render(options(api, { filters: [clause] }));
      expect(displayedCounts()).toBeNull();
      expect(api.listFilteredFolderCounts).toHaveBeenCalledExactlyOnceWith({
        libraryId: "library-a", filters: [clause], showIgnored: false,
      });
      await act(async () => requests[0]!.resolve(success("deep-child", 4)));
      expect(displayedCounts()).toEqual({ all: 6, root: 2, folders: { "deep-child": 4 } });
    },
  );

  it("passes combined clauses intact and does not refetch for equivalent new arrays", async () => {
    const { api, requests } = createApi();
    const filters = [
      ...filterCases,
      { field: "tag", values: ["required"], exclude: false, includeAi: true } satisfies FilterClause,
      { field: "tag", values: ["excluded"], exclude: true, includeAi: false } satisfies FilterClause,
    ];
    await render(options(api, { filters }));
    expect(api.listFilteredFolderCounts).toHaveBeenCalledWith({
      libraryId: "library-a", filters, showIgnored: false,
    });
    await act(async () => requests[0]!.resolve(success()));
    await render(options(api, { filters: structuredClone(filters) }));
    expect(api.listFilteredFolderCounts).toHaveBeenCalledTimes(1);
    expect(displayedCounts()).toEqual({ all: 3, root: 2, folders: { matched: 1 } });
  });

  it.each<Partial<UseFilteredFolderCountsOptions>>([
    { libraryId: "library-b" }, { showIgnored: true }, { refreshToken: 1 },
    { filters: [{ ...favorite, exclude: true }] },
  ])("invalidates successful counts immediately when request inputs change: %j", async (change) => {
    const { api, requests } = createApi();
    await render(options(api));
    await act(async () => requests[0]!.resolve(success("old")));
    await render(options(api, change));
    expect(displayedCounts()).toBeNull();
    expect(api.listFilteredFolderCounts).toHaveBeenCalledTimes(2);
    await act(async () => requests[1]!.resolve(success("new")));
    expect(displayedCounts().folders).toEqual({ new: 1 });
  });

  it("ignores an older filter response that arrives after the newer response", async () => {
    const { api, requests } = createApi();
    await render(options(api));
    await render(options(api, { filters: [{ field: "tag", values: ["new"], exclude: false }] }));
    await act(async () => requests[1]!.resolve(success("new")));
    await act(async () => requests[0]!.resolve(success("old")));
    expect(displayedCounts().folders).toEqual({ new: 1 });
  });

  it("ignores the previous API instance even for the same library and filters", async () => {
    const previous = createApi();
    const current = createApi();
    await render(options(previous.api));
    await render(options(current.api));
    await act(async () => current.requests[0]!.resolve(success("current-api")));
    await act(async () => previous.requests[0]!.resolve(success("previous-api")));
    expect(displayedCounts().folders).toEqual({ "current-api": 1 });
  });

  it.each<Partial<UseFilteredFolderCountsOptions>>([
    { enabled: false }, { filters: [] }, { libraryId: undefined }, { api: null },
  ])("requests fresh counts when re-entering the same filter after %j", async (departure) => {
    const { api, requests } = createApi();
    await render(options(api));
    await act(async () => requests[0]!.resolve(success("old")));
    await render(options(api, departure));
    expect(displayedCounts()).toBeNull();
    expect(api.listFilteredFolderCounts).toHaveBeenCalledTimes(1);
    await render(options(api));
    expect(api.listFilteredFolderCounts).toHaveBeenCalledTimes(2);
    expect(displayedCounts()).toBeNull();
    await act(async () => requests[1]!.resolve({ ok: true, value: { all: 0, root: 0, folders: [] } }));
    expect(displayedCounts()).toEqual({ all: 0, root: 0, folders: {} });
  });

  it.each(["error result", "rejection", "synchronous throw"])("returns null after %s and can refresh", async (failure) => {
    const { api, requests } = createApi();
    await render(options(api));
    await act(async () => requests[0]!.resolve(success("old")));
    if (failure === "synchronous throw") {
      api.listFilteredFolderCounts.mockImplementationOnce(() => { throw new Error("IPC unavailable"); });
    }
    await render(options(api, { refreshToken: 1 }));
    await act(async () => {
      if (failure === "rejection") requests[1]!.reject(new Error("IPC disconnected"));
      if (failure === "error result") requests[1]!.resolve({
        ok: false, error: { code: "LIBRARY_NOT_OPEN", message: "Library is not open." },
      });
    });
    expect(displayedCounts()).toBeNull();
    await render(options(api, { refreshToken: 2 }));
    await act(async () => requests.at(-1)!.resolve(success("recovered")));
    expect(displayedCounts().folders).toEqual({ recovered: 1 });
  });

  it.each(["error result", "rejection"])("does not clear newer counts after an obsolete %s", async (failure) => {
    const { api, requests } = createApi();
    await render(options(api));
    await render(options(api, { libraryId: "library-b" }));
    await act(async () => requests[1]!.resolve(success("library-b")));
    await act(async () => {
      if (failure === "rejection") requests[0]!.reject(new Error("old request failed"));
      else requests[0]!.resolve({ ok: false, error: { code: "LIBRARY_NOT_OPEN", message: "Library is not open." } });
    });
    expect(displayedCounts().folders).toEqual({ "library-b": 1 });
  });
});
