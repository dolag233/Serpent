import { expect, it, vi } from "vitest";

import { createLibraryClosedHandler } from "../../src/renderer/library-closed-view-ownership";
import { createLibraryTransitionLock } from "../../src/renderer/library-transition-lock";
import {
  advanceLibraryViewSession,
  type LibraryViewSession,
} from "../../src/renderer/library-view-session";
import type { RendererLifecycleEvent } from "../../src/shared/protocol/responses";

type ClosedEvent = Extract<RendererLifecycleEvent, { type: "library.closed" }>;

function closeEvent(libraryId: string, source?: "mcp"): ClosedEvent {
  return source === undefined
    ? { type: "library.closed", libraryId }
    : { type: "library.closed", libraryId, source };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createHarness(initialView: LibraryViewSession) {
  let view = initialView;
  const transitionLock = createLibraryTransitionLock();
  const pending = new Map<string, ReadonlySet<number>>();
  const queuedTasks: Promise<void>[] = [];
  const closePreview = vi.fn(async (): Promise<void> => undefined);
  const applyClosedUi = vi.fn(() => {
    view = advanceLibraryViewSession(view, null);
  });
  const refreshRecentLibraries = vi.fn(async () => undefined);
  const setClosing = vi.fn();
  const setIdle = vi.fn();
  const reportFailure = vi.fn();

  const handle = createLibraryClosedHandler({
    snapshot: () => ({ libraryId: view.libraryId, view }),
    pendingCloseGenerations: (libraryId) => pending.get(libraryId),
    queue: (task) => {
      const queued = transitionLock(task);
      queuedTasks.push(queued);
      return queued;
    },
    closePreview,
    applyClosedUi,
    refreshRecentLibraries,
    setClosing,
    setIdle,
    reportFailure,
  });

  return {
    handle,
    transitionLock,
    queuedTasks,
    closePreview,
    applyClosedUi,
    refreshRecentLibraries,
    setClosing,
    setIdle,
    reportFailure,
    snapshot: () => ({ libraryId: view.libraryId, view }),
    advanceTo: (libraryId: string | null) => {
      view = advanceLibraryViewSession(view, libraryId);
      return view;
    },
    setPending: (libraryId: string, generations: ReadonlySet<number>) => {
      pending.set(libraryId, generations);
    },
    async settleQueued(): Promise<void> {
      await Promise.all(queuedTasks.splice(0));
    },
  };
}

const inLibrary = (libraryId: string): LibraryViewSession =>
  advanceLibraryViewSession({ libraryId: null, generation: 0 }, libraryId);

it("does not clear reopened A when close(A) arrives in B and waits behind return-to-A", async () => {
  const harness = createHarness(inLibrary("library-b"));
  const started = deferred<void>();
  const release = deferred<void>();
  const returnToA = harness.transitionLock(async () => {
    started.resolve(undefined);
    await release.promise;
    harness.advanceTo("library-a");
  });
  await started.promise;

  harness.setPending("library-a", new Set([harness.snapshot().view.generation]));
  harness.handle(closeEvent("library-a"));
  release.resolve(undefined);
  await returnToA;
  await harness.settleQueued();

  expect(harness.snapshot().libraryId).toBe("library-a");
  expect(harness.applyClosedUi).not.toHaveBeenCalled();
  expect(harness.refreshRecentLibraries).not.toHaveBeenCalled();
});

it("does not clear A when its close is queued before an A-to-B-to-A round trip", async () => {
  const harness = createHarness(inLibrary("library-a"));
  const started = deferred<void>();
  const release = deferred<void>();
  const roundTrip = harness.transitionLock(async () => {
    started.resolve(undefined);
    await release.promise;
    harness.advanceTo("library-b");
    harness.advanceTo("library-a");
  });
  await started.promise;

  harness.setPending("library-a", new Set([harness.snapshot().view.generation]));
  harness.handle(closeEvent("library-a"));
  release.resolve(undefined);
  await roundTrip;
  await harness.settleQueued();

  expect(harness.snapshot().libraryId).toBe("library-a");
  expect(harness.applyClosedUi).not.toHaveBeenCalled();
  expect(harness.refreshRecentLibraries).not.toHaveBeenCalled();
});

it("does not clear a reopened generation when the preview close was already awaiting", async () => {
  const harness = createHarness(inLibrary("library-a"));
  const previewStarted = deferred<void>();
  const releasePreview = deferred<void>();
  harness.closePreview.mockImplementation(() => {
    previewStarted.resolve(undefined);
    return releasePreview.promise;
  });
  harness.setPending("library-a", new Set([harness.snapshot().view.generation]));

  harness.handle(closeEvent("library-a"));
  await previewStarted.promise;
  const originalGeneration = harness.snapshot().view.generation;
  harness.advanceTo("library-a");
  expect(harness.snapshot().view.generation).not.toBe(originalGeneration);
  releasePreview.resolve(undefined);
  await harness.settleQueued();

  expect(harness.snapshot().libraryId).toBe("library-a");
  expect(harness.applyClosedUi).not.toHaveBeenCalled();
  expect(harness.refreshRecentLibraries).not.toHaveBeenCalled();
});

it("applies a current close once and refreshes recents before returning to idle", async () => {
  const harness = createHarness(inLibrary("library-a"));
  harness.setPending("library-a", new Set([harness.snapshot().view.generation]));

  harness.handle(closeEvent("library-a"));
  await harness.settleQueued();

  expect(harness.closePreview).toHaveBeenCalledTimes(1);
  expect(harness.setClosing).toHaveBeenCalledTimes(1);
  expect(harness.applyClosedUi).toHaveBeenCalledTimes(1);
  expect(harness.refreshRecentLibraries).toHaveBeenCalledTimes(1);
  expect(harness.setIdle).toHaveBeenCalledTimes(1);
  expect(harness.reportFailure).not.toHaveBeenCalled();
});

it("ignores a pending ordinary close from an old generation but applies current MCP close", async () => {
  const harness = createHarness(inLibrary("library-a"));
  const oldGeneration = harness.snapshot().view.generation;
  harness.advanceTo("library-a");
  harness.setPending("library-a", new Set([oldGeneration]));

  harness.handle(closeEvent("library-a"));
  expect(harness.queuedTasks).toHaveLength(0);
  expect(harness.setClosing).not.toHaveBeenCalled();

  harness.handle(closeEvent("library-a", "mcp"));
  await harness.settleQueued();
  expect(harness.applyClosedUi).toHaveBeenCalledTimes(1);
  expect(harness.refreshRecentLibraries).toHaveBeenCalledTimes(1);
  expect(harness.setIdle).toHaveBeenCalledTimes(1);
});

it("does not report preview failure after the close's view generation becomes stale", async () => {
  const harness = createHarness(inLibrary("library-a"));
  const previewStarted = deferred<void>();
  const rejectPreview = deferred<void>();
  harness.closePreview.mockImplementation(() => {
    previewStarted.resolve(undefined);
    return rejectPreview.promise;
  });
  harness.setPending("library-a", new Set([harness.snapshot().view.generation]));

  harness.handle(closeEvent("library-a"));
  await previewStarted.promise;
  harness.advanceTo("library-a");
  rejectPreview.reject(new Error("stale preview close failed"));
  await harness.settleQueued();

  expect(harness.reportFailure).not.toHaveBeenCalled();
  expect(harness.applyClosedUi).not.toHaveBeenCalled();
  expect(harness.refreshRecentLibraries).not.toHaveBeenCalled();
});
