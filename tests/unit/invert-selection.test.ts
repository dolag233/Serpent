import { describe, expect, it } from "vitest";

import { invertSelection } from "../../src/renderer/invert-selection";

describe("invertSelection (Serpent-5fq)", () => {
  it("selects all when nothing is selected", () => {
    expect(invertSelection(["a", "b", "c"], [])).toEqual(["a", "b", "c"]);
  });

  it("clears when everything visible is selected", () => {
    expect(invertSelection(["a", "b"], ["a", "b"])).toEqual([]);
  });

  it("returns the visible complement in visible order", () => {
    expect(invertSelection(["a", "b", "c", "d"], ["b", "d"])).toEqual([
      "a",
      "c",
    ]);
  });

  it("ignores selected ids that are not currently visible", () => {
    expect(invertSelection(["a", "b"], ["b", "hidden"])).toEqual(["a"]);
  });

  it("returns empty when the visible set is empty", () => {
    expect(invertSelection([], ["a"])).toEqual([]);
  });
});
