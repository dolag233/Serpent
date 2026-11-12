import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assetClipboard } from '../../src/main/asset-clipboard';
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
    requestWorker: vi.fn(async (command) => command.type === 'folder.get-path'
      ? { ok: true as const, type: 'folder.path' as const, folderId: command.folderId, absolutePath: 'C:\\Target' }
      : { ok: false as const, error: { code: "INTERNAL_ERROR" as const, message: "unused" } }),
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

test('file-list paste takes precedence over a bitmap and keeps the complete cut batch', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-paste-command-'));
  try {
    const files = ['one.png', 'two.png'].map(name => path.join(root, name));
    files.forEach(file => writeFileSync(file, 'data'));
    const deps = runtime({ readClipboardFilePaths: () => files, readFileClipboard: () => ({ paths: files, operation: 'cut', sequence: 123 }) });
    expect(await tryBuildIngestionCommand({ type: 'asset.import-clipboard.request', libraryId: 'lib' }, deps)).toMatchObject({ kind: 'result', result: { ok: false, error: { code: 'CLIPBOARD_IMAGE_NOT_FOUND' } } });
    expect(await tryBuildIngestionCommand({ type: 'folder.paste.request', libraryId: 'lib', folderId: null }, deps)).toMatchObject({ kind: 'command', command: { type: 'asset.import.prepare', sourcePaths: files, moveSourceFiles: true } });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('internal paste preserves asset ids and dispatches copy/move rather than an import', async () => {
  const snapshot = { paths: ['C:\\one.png', 'C:\\two.png'], operation: 'copy' as const, sequence: 234 };
  const deps = runtime({ readFileClipboard: () => snapshot });
  for (const operation of ['copy', 'cut'] as const) {
    assetClipboard.remember('lib', ['one', 'two'], snapshot, operation);
    expect(await tryBuildIngestionCommand({ type: 'folder.paste.request', libraryId: 'lib', folderId: 'target' }, deps)).toMatchObject({ kind: 'command', command: { type: operation === 'cut' ? 'asset.move' : 'asset.copy', assetIds: ['one', 'two'], targetFolderId: 'target', conflictStrategy: 'keep-both' } });
  }
  assetClipboard.read({ paths: [], operation: 'copy', sequence: 235 });
});

test('cut state exposes only asset identities from the requested library and follows OS clipboard changes', async () => {
  const snapshot = { paths: ['C:\\source.png'], operation: 'cut' as const, sequence: 45 };
  assetClipboard.remember('lib', ['asset'], snapshot, 'cut');
  const deps = runtime({ readFileClipboard: () => snapshot });
  expect(await tryBuildIngestionCommand({ type: 'asset.clipboard-state.request', libraryId: 'lib' }, deps)).toEqual({ kind: 'result', result: { ok: true, type: 'asset.clipboard-state', cutAssetIds: ['asset'] } });
  expect(await tryBuildIngestionCommand({ type: 'asset.clipboard-state.request', libraryId: 'other' }, deps)).toMatchObject({ result: { cutAssetIds: [] } });
  expect(await tryBuildIngestionCommand({ type: 'asset.clipboard-state.request', libraryId: 'lib' }, runtime({ readFileClipboard: () => ({ paths: [], operation: 'copy', sequence: 46 }) }))).toMatchObject({ result: { cutAssetIds: [] } });
});

test('cut appearance polls the native change token without decoding the complete file list', async () => {
  const snapshot = { paths: ['C:\\source.png'], operation: 'cut' as const, sequence: 90 };
  assetClipboard.remember('lib', ['asset'], snapshot, 'cut');
  const readFileClipboard = vi.fn(() => snapshot);
  const deps = runtime({ readClipboardSequence: () => 90, readFileClipboard });
  expect(await tryBuildIngestionCommand({ type: 'asset.clipboard-state.request', libraryId: 'lib' }, deps)).toMatchObject({ result: { cutAssetIds: ['asset'] } });
  expect(readFileClipboard).not.toHaveBeenCalled();
  expect(await tryBuildIngestionCommand({ type: 'asset.clipboard-state.request', libraryId: 'lib' }, { ...deps, readClipboardSequence: () => 91 })).toMatchObject({ result: { cutAssetIds: [] } });
});
