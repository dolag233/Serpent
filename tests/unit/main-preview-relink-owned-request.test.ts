import { expect, test, vi } from "vitest";

import { tryHandlePreviewOwnedRequest } from "../../src/main/library-request/preview";
import {
  maybeRememberRelinkPreview,
  tryHandleRelinkOwnedRequest,
} from "../../src/main/library-request/relink";

test("asset.close-preview stays on the renderer UI path", async () => {
  await expect(tryHandlePreviewOwnedRequest(
    {
      type: "asset.close-preview.request",
      libraryId: "lib-1",
      assetId: "asset-1",
    },
    { logError: vi.fn() },
  )).resolves.toEqual({
    ok: true,
    type: "asset.preview.closed",
    assetId: "asset-1",
  });
});

test("asset.relink-batch.cancel drops the pending preview", async () => {
  const cancelRelinkPreview = vi.fn();
  await expect(tryHandleRelinkOwnedRequest(
    {
      type: "asset.relink-batch.cancel.request",
      libraryId: "lib-1",
      previewId: "preview-1",
    },
    { cancelRelinkPreview },
  )).resolves.toEqual({
    ok: true,
    type: "asset.relink-batch.cancelled",
    previewId: "preview-1",
  });
  expect(cancelRelinkPreview).toHaveBeenCalledWith("lib-1", "preview-1");
});

test("relink-batch preview is remembered before Worker dispatch", () => {
  const createPreview = vi.fn(() => "preview-1");
  expect(maybeRememberRelinkPreview(
    {
      type: "asset.relink-batch.request",
      libraryId: "lib-1",
      keepMetadata: true,
    },
    {
      type: "asset.relink-batch.preview",
      libraryId: "lib-1",
      newRootPath: "C:\\libraries\\root",
    },
    createPreview,
  )).toEqual({
    libraryId: "lib-1",
    previewId: "preview-1",
  });
  expect(createPreview).toHaveBeenCalledWith("lib-1", "C:\\libraries\\root");
});
