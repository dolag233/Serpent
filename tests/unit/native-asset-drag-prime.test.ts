import { describe, expect, it } from "vitest";

import { nativeDragAssetsForResult } from "../../src/main/native-asset-drag-prime";
import type { AssetSummary } from "../../src/shared/asset-types";

const asset = (assetId: string) => ({ assetId }) as AssetSummary;

describe("native asset drag cache priming", () => {
  it("primes assets returned by the paginated browse session", () => {
    const items = [asset("asset-1")];

    expect(
      nativeDragAssetsForResult({
        ok: true,
        type: "browse.session.opened",
        items,
      }),
    ).toBe(items);
    expect(
      nativeDragAssetsForResult({
        ok: true,
        type: "browse.session.page",
        items,
      }),
    ).toBe(items);
  });

  it("keeps legacy card-bearing responses eligible for priming", () => {
    const assets = [asset("asset-1")];

    expect(
      nativeDragAssetsForResult({
        ok: true,
        type: "asset.list",
        assets,
      }),
    ).toBe(assets);
    expect(
      nativeDragAssetsForResult({
        ok: true,
        type: "asset.search.result",
        items: assets,
      }),
    ).toBe(assets);
  });

  it("covers mutation and import responses carrying asset summaries", () => {
    const assets = [asset("asset-1")];
    const arrayResultTypes = [
      "asset.refreshed",
      "linked-folder.assets.copied",
      "linked-folder.converted",
      "asset.restored",
      "asset.moved",
      "asset.move-undone",
      "asset.trash-undone",
      "asset.copied",
      "asset.copy-undone",
      "asset.files-renamed",
      "asset.restored-if-original-vacant",
      "asset.relink-batch.applied",
    ];
    for (const type of arrayResultTypes) {
      expect(nativeDragAssetsForResult({ ok: true, type, assets })).toBe(assets);
    }

    for (const type of [
      "asset.sequence.created",
      "asset.file-renamed",
      "asset.text.saved",
      "asset.relinked",
      "extension.asset-saved",
    ]) {
      expect(nativeDragAssetsForResult({ ok: true, type, asset: assets[0] })).toEqual(
        assets,
      );
    }

    expect(
      nativeDragAssetsForResult({
        ok: true,
        type: "asset.import.completed",
        completion: { assets },
      }),
    ).toBe(assets);
    for (const type of [
      "asset.import-eagle.completed",
      "asset.import-billfish.completed",
    ]) {
      expect(nativeDragAssetsForResult({ ok: true, type, result: { assets } })).toBe(
        assets,
      );
    }
  });

  it("does not prime failed or non-card responses", () => {
    expect(
      nativeDragAssetsForResult({ ok: false, type: "browse.session.opened" }),
    ).toEqual([]);
    expect(
      nativeDragAssetsForResult({ ok: true, type: "browse.session.geometry" }),
    ).toEqual([]);
  });
});
