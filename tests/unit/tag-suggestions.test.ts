import { describe, expect, it } from "vitest";

import {
  buildTagSuggestions,
  moveTagSuggestionIndex,
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
