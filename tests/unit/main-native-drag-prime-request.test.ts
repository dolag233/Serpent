import { expect, test, vi } from "vitest";

import { maybePrimeNativeDrag } from "../../src/main/library-request/native-drag";

test("card-bearing results prime the visible first screen", () => {
  const primeImmediately = vi.fn();
  maybePrimeNativeDrag(
    { type: "folder.list.request", libraryId: "lib-1" },
    {
      ok: true,
      type: "asset.list",
      assets: [
        { assetId: "asset-1" },
        {
          assetId: "seq-1",
          sequence: { frames: [{ assetId: "frame-1" }, { assetId: "frame-2" }] },
        },
      ],
    },
    {
      pendingImportLibraries: new Map(),
      primeImmediately,
    },
  );
  expect(primeImmediately).toHaveBeenCalledWith(
    "lib-1",
    ["asset-1", "frame-1", "frame-2"],
    "upsert",
  );
});

test("import conflict resolution uses the pending library map", () => {
  const primeImmediately = vi.fn();
  maybePrimeNativeDrag(
    {
      type: "asset.import.skip-source-failure",
      importId: "import-1",
      applyToRest: false,
    },
    { ok: true, type: "asset.list", assets: [{ assetId: "asset-1" }] },
    {
      pendingImportLibraries: new Map([["import-1", "lib-pending"]]),
      primeImmediately,
    },
  );
  expect(primeImmediately).toHaveBeenCalledWith("lib-pending", ["asset-1"], "upsert");
});

test("browse pages leave native drag priming to the reported viewport", () => {
  const primeImmediately = vi.fn();
  maybePrimeNativeDrag(
    { type: "browse.session.page.request", libraryId: "lib-1", sessionId: "session-1", offset: 100 },
    { ok: true, type: "browse.session.page", items: [{ assetId: "asset-1" }] },
    { pendingImportLibraries: new Map(), primeImmediately },
  );
  expect(primeImmediately).not.toHaveBeenCalled();
});
