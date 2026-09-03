import { describe, expect, it } from "vitest";

import {
  buildTagFilterDefaultSections,
  buildTagFilterSearchResults,
} from "../../src/renderer/tag-filter-suggestions";

const tags = [
  { tagId: "warm", name: "Warm", assetCount: 10 },
  { tagId: "wood", name: "Wood", assetCount: 8 },
  { tagId: "metal", name: "Metal", assetCount: 6 },
  { tagId: "glass", name: "Glass", assetCount: 4 },
  { tagId: "sci-fi", name: "SciFi", assetCount: 2 },
  { tagId: "unused", name: "Unused", assetCount: 0 },
];

// A larger fixture proves that the empty-query view keeps the complete tag
// collection instead of silently reducing it to a popular/top subset.
const manyTags = Array.from({ length: 10 }, (_, i) => ({
  tagId: `t${i}`,
  name: `Tag${i}`,
  assetCount: 10 - i,
}));

describe("buildTagFilterDefaultSections (REQ-FILTER-020)", () => {
  it("returns every available tag in the all section", () => {
    const { all } = buildTagFilterDefaultSections(tags, [], []);
    expect(all.map((tag) => tag.name)).toEqual([
      "Warm",
      "Wood",
      "Metal",
      "Glass",
      "SciFi",
      "Unused",
    ]);
  });

  it("does not cap the all section by usage count", () => {
    const { all } = buildTagFilterDefaultSections(manyTags, [], []);
    expect(all).toHaveLength(manyTags.length);
    expect(all.map((tag) => tag.name)).toEqual(manyTags.map((tag) => tag.name));
  });

  it("keeps recently-filtered tags as a separate quick-access section", () => {
    const { all, recent } = buildTagFilterDefaultSections(
      manyTags,
      [],
      ["Tag9", "Tag0"],
    );
    expect(recent.map((tag) => tag.name)).toEqual(["Tag9", "Tag0"]);
    expect(all.some((tag) => tag.name === "Tag0")).toBe(true);
    expect(all.some((tag) => tag.name === "Tag9")).toBe(true);
  });

  it("surfaces the recent section independently from all tags", () => {
    const { recent } = buildTagFilterDefaultSections(tags, [], ["Glass"]);
    expect(recent.map((tag) => tag.name)).toEqual(["Glass"]);
  });

  it("excludes selected tags from both sections", () => {
    const { all, recent } = buildTagFilterDefaultSections(
      manyTags,
      ["Tag9"],
      ["Tag9"],
    );
    expect(all.some((tag) => tag.name === "Tag9")).toBe(false);
    expect(recent.some((tag) => tag.name === "Tag9")).toBe(false);
  });

  it("drops recent names that no longer exist in the tag list", () => {
    const { recent } = buildTagFilterDefaultSections(
      manyTags,
      [],
      ["DeletedTag", "Tag9"],
    );
    expect(recent.map((tag) => tag.name)).toEqual(["Tag9"]);
  });

  it("returns empty sections when there are no tags", () => {
    expect(buildTagFilterDefaultSections([], [], ["anything"])).toEqual({
      all: [],
      recent: [],
    });
  });
});

describe("buildTagFilterSearchResults (REQ-FILTER-020)", () => {
  it("matches by case-insensitive substring, ranked by usage", () => {
    const results = buildTagFilterSearchResults(tags, [], "a");
    expect(results.map((tag) => tag.name)).toEqual(["Warm", "Metal", "Glass"]);
  });

  it("excludes already-selected tags", () => {
    const results = buildTagFilterSearchResults(tags, ["Warm"], "a");
    expect(results.map((tag) => tag.name)).toEqual(["Metal", "Glass"]);
  });

  it("returns all unselected tags sorted by count for an empty query", () => {
    const results = buildTagFilterSearchResults(tags, [], "   ");
    expect(results.map((tag) => tag.name)).toEqual([
      "Warm",
      "Wood",
      "Metal",
      "Glass",
      "SciFi",
      "Unused",
    ]);
  });

  it("does not cap the complete search result set by default", () => {
    const results = buildTagFilterSearchResults(manyTags, [], "tag");
    expect(results).toHaveLength(manyTags.length);
  });

  it("caps results at the provided limit", () => {
    const results = buildTagFilterSearchResults(tags, [], "", 2);
    expect(results).toHaveLength(2);
  });
});
