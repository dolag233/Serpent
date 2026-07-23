import { describe, expect, it } from "vitest";

import { shuffleArray } from "../../src/renderer/client-shuffle";

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
});
