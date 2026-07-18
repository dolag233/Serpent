import { describe, expect, it } from "vitest";

import {
  indexMembershipsByCollection,
  resolveCollectionMembershipState,
  resolveCollectionMenuActions,
  resolveCollectionMenuForSelection,
} from "../../src/renderer/collection-menu-membership";

describe("resolveCollectionMembershipState", () => {
  it("returns none for an empty selection", () => {
    expect(resolveCollectionMembershipState([], new Set(["a"]))).toBe("none");
  });

  it("returns none when no selected asset is a member", () => {
    expect(
      resolveCollectionMembershipState(["a", "b"], new Set(["c"])),
    ).toBe("none");
  });

  it("returns all when every selected asset is a member", () => {
    expect(
      resolveCollectionMembershipState(["a", "b"], new Set(["a", "b", "c"])),
    ).toBe("all");
  });

  it("returns mixed when only some selected assets are members", () => {
    expect(
      resolveCollectionMembershipState(["a", "b"], new Set(["a"])),
    ).toBe("mixed");
  });
});

describe("resolveCollectionMenuActions", () => {
  it("shows only remove for uniform members", () => {
    expect(resolveCollectionMenuActions("all")).toEqual({
      showAdd: false,
      showRemove: true,
    });
  });

  it("shows only add for uniform non-members", () => {
    expect(resolveCollectionMenuActions("none")).toEqual({
      showAdd: true,
      showRemove: false,
    });
  });

  it("shows both for mixed membership (REQ-MENU-007 skip path)", () => {
    expect(resolveCollectionMenuActions("mixed")).toEqual({
      showAdd: true,
      showRemove: true,
    });
  });
});

describe("indexMembershipsByCollection", () => {
  it("groups asset ids by collection", () => {
    const indexed = indexMembershipsByCollection([
      { assetId: "a1", collectionId: "c1" },
      { assetId: "a2", collectionId: "c1" },
      { assetId: "a1", collectionId: "c2" },
    ]);
    expect([...indexed.get("c1")!].sort()).toEqual(["a1", "a2"]);
    expect([...indexed.get("c2")!]).toEqual(["a1"]);
    expect(indexed.has("c3")).toBe(false);
  });
});

describe("resolveCollectionMenuForSelection", () => {
  const members = indexMembershipsByCollection([
    { assetId: "a1", collectionId: "featured" },
    { assetId: "a2", collectionId: "featured" },
  ]);

  it("hides remove for a collection with no selected members", () => {
    expect(
      resolveCollectionMenuForSelection(["a1"], "other", members),
    ).toEqual({ showAdd: true, showRemove: false });
  });

  it("hides add when every selected asset is already a member", () => {
    expect(
      resolveCollectionMenuForSelection(["a1", "a2"], "featured", members),
    ).toEqual({ showAdd: false, showRemove: true });
  });

  it("keeps both when multi-select membership is mixed", () => {
    expect(
      resolveCollectionMenuForSelection(["a1", "a3"], "featured", members),
    ).toEqual({ showAdd: true, showRemove: true });
  });
});
