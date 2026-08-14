import { describe, expect, it } from "vitest";

import {
  appendAssetPage,
  countNewlyAddedAssets,
  resolveSearchTotalAfterAppend,
} from "../../src/renderer/asset-browse-load-more";

describe("resolveSearchTotalAfterAppend (Serpent-r94b)", () => {
  it("keeps the server total when the page adds new rows", () => {
    expect(
      resolveSearchTotalAfterAppend({
        requestOffset: 50,
        serverTotal: 200,
        pageItemCount: 50,
        newlyAddedCount: 50,
      }),
    ).toBe(200);
  });

  it("clamps to the request offset on an empty page", () => {
    expect(
      resolveSearchTotalAfterAppend({
        requestOffset: 100,
        serverTotal: 200,
        pageItemCount: 0,
        newlyAddedCount: 0,
      }),
    ).toBe(100);
  });

  it("clamps when the page is all duplicates", () => {
    expect(
      resolveSearchTotalAfterAppend({
        requestOffset: 50,
        serverTotal: 200,
        pageItemCount: 50,
        newlyAddedCount: 0,
      }),
    ).toBe(50);
  });
});

describe("countNewlyAddedAssets", () => {
  it("counts only ids not already present", () => {
    expect(
      countNewlyAddedAssets(
        [{ assetId: "a" }, { assetId: "b" }],
        [{ assetId: "b" }, { assetId: "c" }, { assetId: "a" }],
      ),
    ).toBe(1);
  });
});

describe("appendAssetPage (Serpent-ws4k)", () => {
  it("appends the page in worker order at the tail", () => {
    expect(
      appendAssetPage(
        [{ assetId: "a" }, { assetId: "b" }],
        [{ assetId: "c" }, { assetId: "d" }],
      ).map((item) => item.assetId),
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("drops page ids already present (scope shifted between pages)", () => {
    expect(
      appendAssetPage(
        [{ assetId: "a" }, { assetId: "b" }],
        [{ assetId: "b" }, { assetId: "c" }, { assetId: "a" }],
      ).map((item) => item.assetId),
    ).toEqual(["a", "b", "c"]);
  });

  it("returns a copy even for an empty page", () => {
    const current = [{ assetId: "a" }];
    const next = appendAssetPage(current, []);
    expect(next).toEqual(current);
    expect(next).not.toBe(current);
  });
});
