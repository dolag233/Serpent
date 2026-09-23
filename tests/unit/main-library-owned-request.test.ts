import { expect, test, vi } from "vitest";

import {
  tryBuildOpenRecentCommand,
  tryHandleLibraryOwnedRequest,
  type LibraryOwnedRequestRuntime,
} from "../../src/main/library-request/library";

function runtime(overrides?: Partial<LibraryOwnedRequestRuntime>): LibraryOwnedRequestRuntime {
  return {
    getActiveLibraryOpenCancellation: () => undefined,
    logInfo: vi.fn(),
    logError: vi.fn(),
    selectDirectory: vi.fn(async () => undefined),
    recentLibraryPath: () => "C:\\libraries\\recent-library.json",
    readRecentLibraryEntries: vi.fn(() => []),
    removeRecentLibrary: vi.fn(),
    refreshApplicationMenuRecentLibraries: vi.fn(),
    cleanupExternalSource: vi.fn(async () => undefined),
    getPendingEagleOpenSourcePath: vi.fn(() => undefined),
    setPendingEagleOpenSourcePath: vi.fn(),
    getPendingBillfishOpenSourcePath: vi.fn(() => undefined),
    setPendingBillfishOpenSourcePath: vi.fn(),
    ...overrides,
  };
}

test("unrelated renderer requests fall through", async () => {
  await expect(tryHandleLibraryOwnedRequest(
    { type: "folder.list.request", libraryId: "lib-1" },
    runtime(),
  )).resolves.toBeUndefined();
});

test("library.open-cancel marks the in-flight opening as cancelled", async () => {
  const cancellation = { cancelled: false };
  const logInfo = vi.fn();
  await expect(tryHandleLibraryOwnedRequest(
    { type: "library.open-cancel.request" },
    runtime({
      getActiveLibraryOpenCancellation: () => cancellation,
      logInfo,
    }),
  )).resolves.toEqual({
    ok: true,
    type: "library.open-cancelled",
  });
  expect(cancellation.cancelled).toBe(true);
  expect(logInfo).toHaveBeenCalledWith(
    "library.open.cancel-requested",
    "Library opening cancellation requested.",
  );
});

test("library.choose-path returns the selected directory", async () => {
  await expect(tryHandleLibraryOwnedRequest(
    { type: "library.choose-path.request" },
    runtime({
      selectDirectory: vi.fn(async () => "C:\\libraries"),
    }),
  )).resolves.toEqual({
    ok: true,
    type: "library.choose-path",
    path: "C:\\libraries",
  });
});

test("library.list-recent stays on the Main-owned store path", async () => {
  const libraries = [{
    path: "C:\\libraries\\studio",
    name: "Studio",
    lastOpenedAt: "2026-09-21T00:00:00.000Z",
  }];
  await expect(tryHandleLibraryOwnedRequest(
    { type: "library.list-recent.request" },
    runtime({
      readRecentLibraryEntries: () => libraries,
    }),
  )).resolves.toEqual({
    ok: true,
    type: "library.recent-list",
    libraries,
  });
});

test("library.open-recent rejects a path that is not in the recent store", () => {
  expect(tryBuildOpenRecentCommand(
    { type: "library.open-recent.request", libraryPath: "C:\\libraries\\missing" },
    runtime(),
  )).toEqual({
    kind: "result",
    result: {
      ok: false,
      error: expect.objectContaining({ code: "LIBRARY_NOT_FOUND" }),
    },
  });
});

test("library.open-recent maps a recent path onto library.open", () => {
  expect(tryBuildOpenRecentCommand(
    { type: "library.open-recent.request", libraryPath: "C:\\libraries\\studio" },
    runtime({
      readRecentLibraryEntries: () => [{
        path: "C:\\libraries\\studio",
        name: "Studio",
        lastOpenedAt: "2026-09-21T00:00:00.000Z",
      }],
    }),
  )).toEqual({
    kind: "command",
    command: {
      type: "library.open",
      selectedLibraryPath: "C:\\libraries\\studio",
    },
  });
});
