import { describe, expect, it } from "vitest";

import {
  shuffleArray,
  shuffleBrowseItems,
  shuffledIndexOrder,
} from "../../src/renderer/client-shuffle";

describe("shuffleArray (Serpent-hm28)", () => {
  it("is deterministic for a seed and reshuffles with another", () => {
    const input = ["a", "b", "c", "d", "e", "f"];
    const once = shuffleArray(input, 42);
    const twice = shuffleArray(input, 42);
    expect(once).toEqual(twice);
    expect(once).not.toEqual(input);
    expect([...once].sort()).toEqual([...input].sort());
    expect(shuffleArray(input, 99)).not.toEqual(once);
  });

  it("handles empty and singleton lists", () => {
    expect(shuffleArray([], 1)).toEqual([]);
    expect(shuffleArray(["only"], 1)).toEqual(["only"]);
  });

  it("uses the same order for the browse layout index as for loaded assets", () => {
    const layout = [
      { assetId: "a", width: 1, height: 1 },
      { assetId: "b", width: 2, height: 1 },
      { assetId: "c", width: 1, height: 2 },
      { assetId: "d", width: 2, height: 2 },
    ];
    expect(shuffleBrowseItems(layout, 42).map((entry) => entry.assetId)).toEqual(
      shuffleArray(layout, 42).map((entry) => entry.assetId),
    );
    expect(shuffleBrowseItems(layout, null)).toEqual(layout);
    expect(shuffleBrowseItems(layout, 42, false)).toEqual(layout);
  });
});

describe("shuffledIndexOrder", () => {
  it("is a deterministic permutation of 0..n-1", () => {
    const once = shuffledIndexOrder(8, 42);
    const twice = shuffledIndexOrder(8, 42);
    expect(once).toEqual(twice);
    expect([...once].sort((left, right) => left - right)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(once).not.toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(shuffledIndexOrder(8, 99)).not.toEqual(once);
  });
});
