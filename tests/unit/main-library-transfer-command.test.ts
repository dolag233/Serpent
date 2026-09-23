import { expect, test } from "vitest";

import { executeLibraryTransferMainCommand } from "../../src/main/commands/library-transfer";

const runtime = {
  createNativeDialogHost: () => ({
    getLocale: () => "en" as const,
    getMainWindow: () => null,
    isE2e: () => true,
  }),
  downloadsPath: () => "C:\\libraries\\downloads",
  pendingImportSources: new Map<string, string>(),
};

test("library.export.cancel maps the export id", async () => {
  await expect(executeLibraryTransferMainCommand(
    {
      type: "library.export.cancel.request",
      exportId: "export-1",
    },
    runtime,
  )).resolves.toEqual({
    type: "library.export-cancel",
    exportId: "export-1",
  });
});

test("library.import.open-in-place uses the pending source path", async () => {
  const pendingImportSources = new Map([["import-1", "C:\\libraries\\incoming"]]);
  await expect(executeLibraryTransferMainCommand(
    {
      type: "library.import.open-in-place.request",
      importId: "import-1",
    },
    { ...runtime, pendingImportSources },
  )).resolves.toEqual({
    type: "library.import-folder",
    sourceFolderPath: "C:\\libraries\\incoming",
  });
  expect(pendingImportSources.size).toBe(0);
});

test("asset.delete-cancel maps the operation id", async () => {
  await expect(executeLibraryTransferMainCommand(
    {
      type: "asset.delete-cancel.request",
      operationId: "op-1",
    },
    runtime,
  )).resolves.toEqual({
    type: "asset.delete-cancel",
    operationId: "op-1",
  });
});
