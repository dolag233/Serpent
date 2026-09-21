import { expect, test, vi } from "vitest";

import { executeLibraryMainCommand, type LibraryCommandRuntime } from "../../src/main/commands/library";
import type { RendererRequest } from "../../src/shared/protocol/requests";

function libraryRequest(request: RendererRequest): RendererRequest {
  return request;
}

function libraryRuntime(overrides?: Partial<LibraryCommandRuntime>): LibraryCommandRuntime {
  return {
    selectDirectory: vi.fn(async () => undefined),
    createNativeDialogHost: vi.fn(() => ({
      getLocale: () => "en",
      getMainWindow: () => null,
      isE2e: () => true,
    })),
    cleanupExternalSource: vi.fn(async () => undefined),
    getPendingEagleOpenSourcePath: vi.fn(() => undefined),
    setPendingEagleOpenSourcePath: vi.fn(),
    getPendingBillfishOpenSourcePath: vi.fn(() => undefined),
    setPendingBillfishOpenSourcePath: vi.fn(),
    materializeSelectedExternalLibrary: vi.fn(),
    rememberExternalSource: vi.fn((materialized) => materialized.sourceRootPath),
    ...overrides,
  };
}

test("unrelated renderer requests fall through", async () => {
  await expect(executeLibraryMainCommand(
    libraryRequest({ type: "folder.list.request", libraryId: "lib-1" }),
    libraryRuntime(),
  )).resolves.toBeUndefined();
});

test("library.list maps to the worker catalog command", async () => {
  await expect(executeLibraryMainCommand(
    libraryRequest({ type: "library.list.request" }),
    libraryRuntime(),
  )).resolves.toEqual({ type: "library.list" });
});

test("library.create uses the selected parent directory", async () => {
  const selectDirectory = vi.fn(async () => "C:\\libraries");
  await expect(executeLibraryMainCommand(
    libraryRequest({ type: "library.create.request", displayName: "Studio" }),
    libraryRuntime({ selectDirectory }),
  )).resolves.toEqual({
    type: "library.create",
    displayName: "Studio",
    selectedParentPath: "C:\\libraries",
  });
  expect(selectDirectory).toHaveBeenCalledWith("createLibrary");
});

test("library.open uses an explicit library path without a picker", async () => {
  const selectDirectory = vi.fn();
  await expect(executeLibraryMainCommand(
    libraryRequest({
      type: "library.open.request",
      libraryPath: "C:\\libraries\\studio",
      replaceExisting: true,
    }),
    libraryRuntime({ selectDirectory }),
  )).resolves.toEqual({
    type: "library.open",
    selectedLibraryPath: "C:\\libraries\\studio",
    replaceExisting: true,
  });
  expect(selectDirectory).not.toHaveBeenCalled();
});

test("library.list-recent stays on the Main-owned store path", async () => {
  await expect(executeLibraryMainCommand(
    libraryRequest({ type: "library.list-recent.request" }),
    libraryRuntime(),
  )).resolves.toBeUndefined();
});

test("inspect-eagle cancel clears the pending source", async () => {
  const cleanupExternalSource = vi.fn(async () => undefined);
  const setPendingEagleOpenSourcePath = vi.fn();
  await expect(executeLibraryMainCommand(
    libraryRequest({ type: "library.inspect-eagle.cancel.request" }),
    libraryRuntime({
      cleanupExternalSource,
      getPendingEagleOpenSourcePath: () => "C:\\libraries\\eagle-source",
      setPendingEagleOpenSourcePath,
    }),
  )).resolves.toBeUndefined();
  expect(cleanupExternalSource).toHaveBeenCalledWith("C:\\libraries\\eagle-source");
  expect(setPendingEagleOpenSourcePath).toHaveBeenCalledWith(undefined);
});

test("history.undo forwards the expected entry id", async () => {
  await expect(executeLibraryMainCommand(
    libraryRequest({
      type: "history.undo.request",
      libraryId: "lib-1",
      expectedHistoryEntryId: "hist-1",
    }),
    libraryRuntime(),
  )).resolves.toEqual({
    type: "history.undo",
    libraryId: "lib-1",
    expectedHistoryEntryId: "hist-1",
  });
});
