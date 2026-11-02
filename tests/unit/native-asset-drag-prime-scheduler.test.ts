import { afterEach, describe, expect, it, vi } from "vitest";

import { NativeAssetDragPrimeScheduler } from "../../src/main/native-asset-drag-prime";

afterEach(() => vi.useRealTimers());

/**
 * Serpent-8ee170: the drag-cache preheat must stay bounded when thousands of
 * media jobs finish. These tests pin the bound: requests scale with
 * `pending / chunkSize`, never with the number of events; duplicates collapse;
 * the per-library cap holds; and a library switch drops stale work instead of
 * applying entries to the wrong cache.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 50; index += 1) await Promise.resolve();
}

type Recorder = {
  scheduler: NativeAssetDragPrimeScheduler;
  requests: Array<{ libraryId: string; assetIds: readonly string[] }>;
  applied: Array<{ libraryId: string; entries: readonly unknown[]; mode: string }>;
};

function createScheduler(options: {
  gatedLibraryId?: string;
  gate?: Promise<readonly unknown[] | null>;
  chunkSize?: number;
  maxPendingPerLibrary?: number;
} = {}): Recorder {
  const requests: Recorder["requests"] = [];
  const applied: Recorder["applied"] = [];
  let firstRequestServed = false;
  const scheduler = new NativeAssetDragPrimeScheduler({
    fetchEntries: async (libraryId, assetIds) => {
      requests.push({ libraryId, assetIds: [...assetIds] });
      const shouldGate = options.gate !== undefined
        && !firstRequestServed
        && (options.gatedLibraryId === undefined || options.gatedLibraryId === libraryId);
      if (shouldGate) {
        firstRequestServed = true;
        return options.gate!;
      }
      return assetIds.map((assetId) => ({ assetId }));
    },
    applyEntries: (libraryId, entries, mode) => {
      applied.push({ libraryId, entries, mode });
    },
    chunkSize: options.chunkSize ?? 500,
    gapMs: 0,
    wait: async () => undefined,
    ...(options.maxPendingPerLibrary === undefined
      ? {}
      : { maxPendingPerLibrary: options.maxPendingPerLibrary }),
  });
  return { scheduler, requests, applied };
}

describe("NativeAssetDragPrimeScheduler", () => {
  it("bounds Worker requests by the chunk size, not by the number of events", async () => {
    const recorder = createScheduler({ chunkSize: 500 });
    // 2,000 completions arriving one at a time, exactly like thumbnail events.
    for (let index = 0; index < 2_000; index += 1) {
      recorder.scheduler.enqueue("library-1", [`asset-${index}`]);
    }
    await flush();

    // One request per chunk plus the already-claimed first batch; never one
    // request per event.
    expect(recorder.requests.length).toBeLessThanOrEqual(Math.ceil(2_000 / 500) + 1);
    expect(recorder.requests.every((request) => request.assetIds.length <= 500)).toBe(true);
    const fetchedIds = recorder.requests.flatMap((request) => request.assetIds);
    expect(new Set(fetchedIds).size).toBe(2_000);
    const stats = recorder.scheduler.stats();
    expect(stats.requests).toBe(recorder.requests.length);
    expect(stats.queuedAssets).toBe(2_000);
    expect(stats.droppedAssets).toBe(0);
    // The queue was reused for the burst instead of starting 2,000 drains.
    expect(stats.coalescedEnqueues).toBeGreaterThan(1_900);
    expect(recorder.applied).toHaveLength(recorder.requests.length);
  });

  it("deduplicates repeated ids instead of re-fetching them", async () => {
    const recorder = createScheduler();
    for (let index = 0; index < 5; index += 1) {
      recorder.scheduler.enqueue("library-1", ["asset-a"]);
    }
    recorder.scheduler.enqueue("library-1", ["asset-a", "asset-b"]);
    await flush();

    const fetchedIds = recorder.requests.flatMap((request) => request.assetIds);
    expect(fetchedIds).toEqual(["asset-a", "asset-b"]);
  });

  it("caps the pending set per library and reports the drops", async () => {
    const recorder = createScheduler({ chunkSize: 1, maxPendingPerLibrary: 10 });
    recorder.scheduler.enqueue("library-1", Array.from({ length: 25 }, (_, index) => `asset-${index}`));

    const stats = recorder.scheduler.stats();
    expect(stats.queuedAssets).toBe(10);
    expect(stats.droppedAssets).toBe(15);
    expect(stats.maxPending).toBeLessThanOrEqual(10);
    await flush();
  });

  it("keeps libraries isolated and drops a stale generation on invalidate", async () => {
    const gate = deferred<readonly unknown[] | null>();
    const recorder = createScheduler({ chunkSize: 10, gatedLibraryId: "library-1", gate: gate.promise });

    recorder.scheduler.enqueue("library-1", Array.from({ length: 30 }, (_, index) => `a-${index}`));
    recorder.scheduler.enqueue("library-2", ["b-1"]);
    await flush();
    expect(recorder.requests[0]!.libraryId).toBe("library-1");

    recorder.scheduler.invalidate("library-1");
    gate.resolve([{ assetId: "stale" }]);
    await flush();

    // The cancelled generation neither applied its entries nor fetched more.
    expect(recorder.applied.some((entry) => entry.libraryId === "library-1")).toBe(false);
    expect(recorder.requests.filter((request) => request.libraryId === "library-1")).toHaveLength(1);

    // The untouched library still hydrated.
    expect(recorder.applied.some((entry) => entry.libraryId === "library-2")).toBe(true);

    // A fresh enqueue after invalidation starts a new generation.
    recorder.scheduler.enqueue("library-1", ["a-new"]);
    await flush();
    expect(recorder.requests.filter((request) => request.libraryId === "library-1")).toHaveLength(2);
    expect(recorder.applied.at(-1)).toMatchObject({ libraryId: "library-1", mode: "upsert" });
  });

  it("primes a bounded visible set synchronously", async () => {
    const recorder = createScheduler();
    await recorder.scheduler.primeImmediately("library-1", ["asset-a", "asset-a", "asset-b"], "replace");
    expect(recorder.requests).toHaveLength(1);
    expect(recorder.requests[0]!.assetIds).toEqual(["asset-a", "asset-b"]);
    expect(recorder.applied).toEqual([
      { libraryId: "library-1", entries: [{ assetId: "asset-a" }, { assetId: "asset-b" }], mode: "replace" },
    ]);

    // An empty replace clears the cache for that library.
    await recorder.scheduler.primeImmediately("library-1", [], "replace");
    expect(recorder.applied.at(-1)).toEqual({ libraryId: "library-1", entries: [], mode: "replace" });
  });

  it("does not repopulate a closed library from an in-flight immediate primer", async () => {
    const gate = deferred<readonly unknown[] | null>();
    const recorder = createScheduler({ gate: gate.promise });
    const pending = recorder.scheduler.primeImmediately("library-1", ["asset-a"], "upsert");
    recorder.scheduler.invalidate("library-1");
    gate.resolve([{ assetId: "asset-a" }]);
    await pending;
    expect(recorder.applied).toEqual([]);
  });

  it("debounces real viewport priming and cancels a stale destination", async () => {
    vi.useFakeTimers();
    const recorder = createScheduler();
    recorder.scheduler.scheduleVisible("library-1", ["old"]);
    await vi.advanceTimersByTimeAsync(400);
    recorder.scheduler.scheduleVisible("library-1", ["new", "new"]);
    await vi.advanceTimersByTimeAsync(599);
    expect(recorder.requests).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(recorder.requests).toEqual([{ libraryId: "library-1", assetIds: ["new"] }]);

    recorder.scheduler.scheduleVisible("library-1", ["closed"]);
    recorder.scheduler.invalidate("library-1");
    await vi.advanceTimersByTimeAsync(600);
    expect(recorder.requests).toHaveLength(1);
  });

  it("publishes visible drag paths in bounded chunks and stops after destination changes", async () => {
    vi.useFakeTimers();
    const gate = deferred<readonly unknown[] | null>();
    const recorder = createScheduler({ gate: gate.promise });
    recorder.scheduler.scheduleVisible(
      "library-1",
      Array.from({ length: 20 }, (_, index) => `old-${index}`),
    );
    await vi.advanceTimersByTimeAsync(600);
    expect(recorder.requests).toHaveLength(1);
    expect(recorder.requests[0]!.assetIds).toHaveLength(8);
    recorder.scheduler.scheduleVisible("library-1", ["new"]);
    gate.resolve(recorder.requests[0]!.assetIds.map((assetId) => ({ assetId })));
    await flush();
    expect(recorder.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(recorder.requests.at(-1)?.assetIds).toEqual(["new"]);
  });

  it("drops queued work for every library on clear", async () => {
    const gate = deferred<readonly unknown[] | null>();
    const recorder = createScheduler({ chunkSize: 1, gatedLibraryId: "library-1", gate: gate.promise });
    recorder.scheduler.enqueue("library-1", ["a-1", "a-2", "a-3"]);
    recorder.scheduler.enqueue("library-2", ["b-1", "b-2"]);
    await flush();

    recorder.scheduler.clear();
    gate.resolve([{ assetId: "stale" }]);
    await flush();

    expect(recorder.applied.some((entry) => entry.libraryId === "library-1")).toBe(false);
    expect(recorder.requests.filter((request) => request.libraryId === "library-2").length)
      .toBeLessThanOrEqual(2);
  });
});
