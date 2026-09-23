import { expect, test, vi } from "vitest";

import {
  tryHandleMediaShellWorkerResult,
  type MediaShellResultRuntime,
} from "../../src/main/library-request/media-shell";

function runtime(overrides?: Partial<MediaShellResultRuntime>): MediaShellResultRuntime {
  return {
    logInfo: vi.fn(),
    logError: vi.fn(),
    openPath: vi.fn(async () => ""),
    showItemInFolder: vi.fn(),
    writeClipboardText: vi.fn(),
    writeClipboardFilePaths: vi.fn(() => true),
    openWith: vi.fn(async () => "opened" as const),
    ...overrides,
  };
}

test("unrelated worker results fall through", async () => {
  await expect(tryHandleMediaShellWorkerResult(
    { type: "folder.list.request", libraryId: "lib-1" },
    { ok: false as const, error: { code: "INTERNAL_ERROR" as const, message: "unused" } },
    runtime(),
  )).resolves.toBeUndefined();
});

test("asset.preview maps a source artifact onto a serpent URL", async () => {
  await expect(tryHandleMediaShellWorkerResult(
    {
      type: "asset.preview.request",
      libraryId: "lib-1",
      assetId: "asset-1",
      mode: "client",
    },
    {
      ok: true,
      type: "media.preview-artifact",
      assetId: "asset-1",
      mediaType: "video",
      status: "ready",
      kind: "webm_proxy",
      mimeType: "video/mp4",
      playbackMode: "source",
      sourceRevisionId: "rev-1",
    },
    runtime(),
  )).resolves.toMatchObject({
    ok: true,
    type: "asset.preview.resolved",
    assetId: "asset-1",
    url: "serpent://source/lib-1/asset-1?revision=rev-1",
    playbackToken: "asset-1:rev-1",
  });
});

test("asset.copy-file-path writes the Worker path to the clipboard", async () => {
  const writeClipboardText = vi.fn();
  await expect(tryHandleMediaShellWorkerResult(
    {
      type: "asset.copy-file-path.request",
      libraryId: "lib-1",
      assetId: "asset-1",
    },
    {
      ok: true,
      type: "media.asset-path",
      assetId: "asset-1",
      absolutePath: "C:\\libraries\\studio\\a.png",
    },
    runtime({ writeClipboardText }),
  )).resolves.toEqual({
    ok: true,
    type: "asset.copy-file-path.requested",
    assetId: "asset-1",
  });
  expect(writeClipboardText).toHaveBeenCalledWith("C:\\libraries\\studio\\a.png");
});
