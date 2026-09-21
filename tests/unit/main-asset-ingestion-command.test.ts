import { expect, test, vi } from "vitest";

import {
  executeAssetIngestionMainCommand,
  type AssetIngestionCommandRuntime,
} from "../../src/main/commands/asset-ingestion";

function ingestionRuntime(
  overrides?: Partial<AssetIngestionCommandRuntime>,
): AssetIngestionCommandRuntime {
  return {
    selectImportSources: vi.fn(async () => undefined),
    createNativeDialogHost: vi.fn(() => ({
      getLocale: () => "en",
      getMainWindow: () => null,
      isE2e: () => true,
    })),
    materializeSelectedExternalLibrary: vi.fn(),
    rememberExternalSource: vi.fn((materialized) => materialized.sourceRootPath),
    fallbackDirectoryForLibraryId: vi.fn(() => undefined),
    isUnpackagedE2e: () => false,
    ...overrides,
  };
}

test("unrelated renderer requests fall through", async () => {
  await expect(executeAssetIngestionMainCommand(
    { type: "library.list.request" },
    ingestionRuntime(),
  )).resolves.toBeUndefined();
});

test("asset.import-files maps picker paths onto import.prepare", async () => {
  const selectImportSources = vi.fn(async () => ["C:\\libraries\\a.png"]);
  await expect(executeAssetIngestionMainCommand(
    {
      type: "asset.import-files.request",
      libraryId: "lib-1",
      targetFolderId: "folder-1",
    },
    ingestionRuntime({ selectImportSources, isUnpackagedE2e: () => true }),
  )).resolves.toEqual({
    type: "asset.import.prepare",
    libraryId: "lib-1",
    targetFolderId: "folder-1",
    sourceKind: "files",
    sourcePaths: ["C:\\libraries\\a.png"],
    expandImageSequences: true,
    imageSequenceFps: 30,
  });
  expect(selectImportSources).toHaveBeenCalledWith("files");
});

test("asset.import-drop stays on the Main classification path", async () => {
  await expect(executeAssetIngestionMainCommand(
    {
      type: "asset.import-drop.request",
      libraryId: "lib-1",
      sourcePaths: ["C:\\libraries\\a.png"],
    },
    ingestionRuntime(),
  )).resolves.toBeUndefined();
});

test("asset.import.resolve forwards duplicate and name decisions", async () => {
  await expect(executeAssetIngestionMainCommand(
    {
      type: "asset.import.resolve",
      importId: "import-1",
      suspectedDuplicate: "skip",
      nameConflict: "keep-both",
    },
    ingestionRuntime(),
  )).resolves.toEqual({
    type: "asset.import.resolve",
    importId: "import-1",
    suspectedDuplicate: "skip",
    nameConflict: "keep-both",
  });
});
