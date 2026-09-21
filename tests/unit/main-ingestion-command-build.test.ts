import { expect, test, vi } from "vitest";

import {
  applyImportWorkerResult,
  maybeProbeImportSequences,
  tryBuildIngestionCommand,
  tryHandleIngestionOwnedRequest,
  type IngestionCommandRuntime,
} from "../../src/main/library-request/ingestion";

function runtime(overrides?: Partial<IngestionCommandRuntime>): IngestionCommandRuntime {
  return {
    isUnpackagedE2e: () => false,
    e2eEnv: () => undefined,
    workerAvailable: () => true,
    requestWorker: vi.fn(async () => ({
      ok: false as const,
      error: { code: "INTERNAL_ERROR" as const, message: "unused" },
    })),
    logInfo: vi.fn(),
    logError: vi.fn(),
    getPendingSequenceOffer: () => undefined,
    deletePendingSequenceOffer: vi.fn(),
    setPendingSequenceNextIndex: vi.fn(),
    tempPath: () => "C:\\libraries\\temp",
    now: () => new Date("2026-09-21T00:00:00.000Z"),
    createImageFromBuffer: () => {
      throw new Error("unused");
    },
    readFileBuffer: () => {
      throw new Error("unused");
    },
    clipboardImageDeps: {
      readImage: () => ({ isEmpty: () => true, toPNG: () => Buffer.alloc(0) }),
      readBuffer: () => Buffer.alloc(0),
      readHTML: () => "",
      createFromBuffer: () => ({ isEmpty: () => true, toPNG: () => Buffer.alloc(0) }),
    },
    clipboardAvailableFormats: () => [],
    readClipboardFilePaths: () => [],
    ...overrides,
  };
}

test("unrelated renderer requests fall through", async () => {
  await expect(tryBuildIngestionCommand(
    { type: "folder.list.request", libraryId: "lib-1" },
    runtime(),
  )).resolves.toBeUndefined();
});

test("asset.import-drop rejects a relative path selection", async () => {
  await expect(tryBuildIngestionCommand(
    {
      type: "asset.import-drop.request",
      libraryId: "lib-1",
      sourcePaths: ["relative.png"],
    },
    runtime(),
  )).resolves.toMatchObject({
    kind: "result",
    result: {
      ok: false,
      error: { code: "INVALID_DROP_SELECTION" },
    },
  });
});

test("asset.import-sequence.confirm returns IMPORT_NOT_FOUND when the offer expired", async () => {
  const deletePendingSequenceOffer = vi.fn();
  await expect(tryBuildIngestionCommand(
    {
      type: "asset.import-sequence.confirm",
      libraryId: "lib-1",
      offerId: "offer-1",
      action: "import-selected",
    },
    runtime({ deletePendingSequenceOffer }),
  )).resolves.toMatchObject({
    kind: "result",
    result: {
      ok: false,
      error: { code: "IMPORT_NOT_FOUND" },
    },
  });
  expect(deletePendingSequenceOffer).toHaveBeenCalledWith("offer-1");
});

test("folder.paste returns CLIPBOARD_FILES_NOT_FOUND when the clipboard is empty", async () => {
  await expect(tryBuildIngestionCommand(
    {
      type: "folder.paste.request",
      libraryId: "lib-1",
    },
    runtime(),
  )).resolves.toMatchObject({
    kind: "result",
    result: {
      ok: false,
      error: { code: "CLIPBOARD_FILES_NOT_FOUND" },
    },
  });
});

test("sequence probe skips drop imports", async () => {
  await expect(maybeProbeImportSequences(
    {
      type: "asset.import-drop.request",
      libraryId: "lib-1",
      sourcePaths: ["C:\\libraries\\a.png"],
    },
    {
      type: "asset.import.prepare",
      libraryId: "lib-1",
      sourceKind: "files",
      sourcePaths: ["C:\\libraries\\a.png"],
    },
    {
      isUnpackagedE2e: () => false,
      workerAvailable: () => true,
      requestWorker: vi.fn(async () => {
        throw new Error("probe should not run");
      }),
      rememberSequenceOffer: (offer) => offer,
    },
  )).resolves.toBeUndefined();
});

test("drop-invalid reports stay on the Main-owned error path", async () => {
  await expect(tryHandleIngestionOwnedRequest(
    { type: "asset.import-drop-invalid.report", libraryId: "lib-1" },
    { logError: vi.fn() },
  )).resolves.toMatchObject({
    ok: false,
    error: { code: "INVALID_DROP_SELECTION" },
  });
});

test("import.abandon drops the pending collection destination", async () => {
  const pendingImportCollections = new Map([["import-1", "col-1"]]);
  await expect(applyImportWorkerResult(
    { type: "asset.import.abandon", importId: "import-1" },
    { ok: false as const, error: { code: "INTERNAL_ERROR" as const, message: "unused" } },
    {
      pendingImportLibraries: new Map(),
      pendingImportCollections,
      logError: vi.fn(),
      requestWorker: vi.fn(async () => {
        throw new Error("unused");
      }),
      enqueueAutoAnalyzeAfterImport: vi.fn(),
    },
  )).resolves.toBeUndefined();
  expect(pendingImportCollections.size).toBe(0);
});
