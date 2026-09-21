import { expect, test } from "vitest";

import { executeAssetMutationMainCommand } from "../../src/main/commands/asset-mutations";

const runtime = {
  createNativeDialogHost: () => ({
    getLocale: () => "en" as const,
    getMainWindow: () => null,
    isE2e: () => true,
  }),
  consumeRelinkPreview: () => undefined as string | undefined,
};

test("asset.trash maps selected asset ids", async () => {
  await expect(executeAssetMutationMainCommand(
    {
      type: "asset.trash.request",
      libraryId: "lib-1",
      assetIds: ["asset-1"],
    },
    runtime,
  )).resolves.toEqual({
    type: "asset.trash",
    libraryId: "lib-1",
    assetIds: ["asset-1"],
  });
});

test("relink-batch apply consumes the pending preview root", async () => {
  await expect(executeAssetMutationMainCommand(
    {
      type: "asset.relink-batch.apply.request",
      libraryId: "lib-1",
      previewId: "preview-1",
      keepMetadata: true,
    },
    {
      ...runtime,
      consumeRelinkPreview: () => "C:\\libraries\\relink-root",
    },
  )).resolves.toEqual({
    type: "asset.relink-batch.apply",
    libraryId: "lib-1",
    newRootPath: "C:\\libraries\\relink-root",
    keepMetadata: true,
  });
});

test("relink-batch cancel stays on the Main-owned preview store path", async () => {
  await expect(executeAssetMutationMainCommand(
    {
      type: "asset.relink-batch.cancel.request",
      libraryId: "lib-1",
      previewId: "preview-1",
    },
    runtime,
  )).resolves.toBeUndefined();
});
