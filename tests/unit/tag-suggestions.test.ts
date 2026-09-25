import { describe, expect, it } from "vitest";

import {
  buildTagSuggestions,
  moveTagSuggestionIndex,
  namesFromTagInput,
  peelTagInput,
  splitTagNames,
} from "../../src/renderer/tag-suggestions";

const tags = [
  { tagId: "warm", name: "Warm", assetCount: 4 },
  { tagId: "wood", name: "Wood", assetCount: 2 },
  { tagId: "unused", name: "Unused", assetCount: 0 },
];

describe("buildTagSuggestions", () => {
  it("shows active unassigned tags for an empty query", () => {
    expect(buildTagSuggestions(tags, "", new Set(["warm"]))).toEqual([
      { kind: "assign", tagId: "wood", name: "Wood", assetCount: 2 },
    ]);
  });

  it("filters by name and offers creation only for a new name", () => {
    expect(buildTagSuggestions(tags, "wo", new Set())).toEqual([
      { kind: "assign", tagId: "wood", name: "Wood", assetCount: 2 },
      { kind: "create", name: "wo" },
    ]);
    expect(buildTagSuggestions(tags, "wood", new Set())).toEqual([
      { kind: "assign", tagId: "wood", name: "Wood", assetCount: 2 },
    ]);
  });

  it("does not surface an orphaned zero-use tag", () => {
    expect(buildTagSuggestions(tags, "unused", new Set())).toEqual([]);
  });

  it("matches suggestions against the fragment after the last comma", () => {
    expect(buildTagSuggestions(tags, "建筑，wo", new Set())).toEqual([
      { kind: "assign", tagId: "wood", name: "Wood", assetCount: 2 },
      { kind: "create", name: "wo" },
    ]);
  });
});

describe("splitTagNames", () => {
  it("splits on English and Chinese commas and drops blanks", () => {
    expect(splitTagNames(" 建筑，水乡, 现代, ")).toEqual(["建筑", "水乡", "现代"]);
    expect(splitTagNames("建筑")).toEqual(["建筑"]);
    expect(splitTagNames("，，")).toEqual([]);
  });

  it("keeps the first spelling of a repeated name", () => {
    expect(splitTagNames("Wood, wood，Warm")).toEqual(["Wood", "Warm"]);
  });
});

describe("peelTagInput", () => {
  it("keeps names before a comma and leaves the fragment being typed", () => {
    expect(peelTagInput("测试，火焰，水面")).toEqual({
      committed: ["测试", "火焰"],
      draft: "水面",
    });
    expect(peelTagInput("测试，火焰，")).toEqual({
      committed: ["测试", "火焰"],
      draft: "",
    });
    expect(peelTagInput("水面")).toEqual({ committed: [], draft: "水面" });
  });
});

describe("namesFromTagInput", () => {
  it("keeps names before the comma when a suggestion completes the last fragment", () => {
    expect(namesFromTagInput("建筑，wo", { name: "Wood" })).toEqual(["建筑", "Wood"]);
    expect(namesFromTagInput("建筑，水乡，现代", null)).toEqual(["建筑", "水乡", "现代"]);
  });
});

describe("moveTagSuggestionIndex", () => {
  it("enters from either edge and wraps in both directions", () => {
    expect(moveTagSuggestionIndex(-1, 1, 3)).toBe(0);
    expect(moveTagSuggestionIndex(-1, -1, 3)).toBe(2);
    expect(moveTagSuggestionIndex(2, 1, 3)).toBe(0);
    expect(moveTagSuggestionIndex(0, -1, 3)).toBe(2);
  });

  it("returns no selection for an empty list", () => {
    expect(moveTagSuggestionIndex(0, 1, 0)).toBe(-1);
  });
});
