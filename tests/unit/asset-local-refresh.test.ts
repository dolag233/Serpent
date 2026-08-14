import { describe, expect, it } from "vitest";

import {
  decrementScopeCount,
  removeAssetIdsLocally,
} from "../../src/renderer/asset-local-refresh";

interface Row {
  assetId: string;
  name: string;
}

function row(assetId: string, name = assetId): Row {
  return { assetId, name };
}

describe("removeAssetIdsLocally (Serpent-关联刷新)", () => {
  it("removes only the requested ids and keeps order", () => {
    const assets = [row("a"), row("b"), row("c"), row("d")];
    expect(
      removeAssetIdsLocally(assets, new Set(["b", "d"])).map((item) => item.assetId),
    ).toEqual(["a", "c"]);
  });

  it("returns the same reference when nothing is removed", () => {
    const assets = [row("a"), row("b")];
    expect(removeAssetIdsLocally(assets, new Set<string>())).toBe(assets);
    expect(removeAssetIdsLocally(assets, new Set(["zzz"]))).toBe(assets);
  });

  it("clears the whole list when every id is removed", () => {
    expect(
      removeAssetIdsLocally([row("a")], new Set(["a"])),
    ).toEqual([]);
  });
});

describe("decrementScopeCount (Serpent-关联刷新)", () => {
  it("subtracts and clamps at zero", () => {
    expect(decrementScopeCount(10, 3)).toBe(7);
    expect(decrementScopeCount(2, 5)).toBe(0);
  });

  it("keeps null and ignores negative deltas", () => {
    expect(decrementScopeCount(null, 3)).toBeNull();
    expect(decrementScopeCount(5, -2)).toBe(5);
  });
});
