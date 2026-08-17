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

// A larger fixture (more than TOP_TAG_SUGGESTION_LIMIT tags) so some tags
// fall outside the "top" section and can be exercised via "recent".
const manyTags = Array.from({ length: 10 }, (_, i) => ({
  tagId: `t${i}`,
  name: `Tag${i}`,
  assetCount: 10 - i,
}));

describe("buildTagFilterDefaultSections (REQ-FILTER-020)", () => {
  it("returns the most-used tags as the top section, sorted by count", () => {
    const { top } = buildTagFilterDefaultSections(tags, [], []);
    expect(top.map((tag) => tag.name)).toEqual([
      "Warm",
      "Wood",
      "Metal",
      "Glass",
      "SciFi",
      "Unused",
    ]);
  });

  it("caps the top section at TOP_TAG_SUGGESTION_LIMIT", () => {
    const { top } = buildTagFilterDefaultSections(manyTags, [], []);
    expect(top).toHaveLength(8);
    expect(top[0]?.name).toBe("Tag0");
    expect(top.map((tag) => tag.name)).not.toContain("Tag8");
  });

  it("puts recently-filtered tags in recent even when they are also top-used", () => {
    // Tag0 is the most-used; after filtering with it, it must appear under
    //「最近筛选」rather than being swallowed by「常用标签」(Serpent-e3e).
    const { top, recent } = buildTagFilterDefaultSections(
      manyTags,
      [],
      ["Tag9", "Tag0"],
    );
    expect(recent.map((tag) => tag.name)).toEqual(["Tag9", "Tag0"]);
    expect(top.some((tag) => tag.name === "Tag0")).toBe(false);
    expect(top.some((tag) => tag.name === "Tag9")).toBe(false);
    expect(top[0]?.name).toBe("Tag1");
  });

  it("surfaces recent section before relying on top-only lists", () => {
    const { recent } = buildTagFilterDefaultSections(tags, [], ["Glass"]);
    expect(recent.map((tag) => tag.name)).toEqual(["Glass"]);
  });

  it("excludes selected tags from both sections", () => {
    const { top, recent } = buildTagFilterDefaultSections(
      manyTags,
      ["Tag9"],
      ["Tag9"],
    );
    expect(top.some((tag) => tag.name === "Tag9")).toBe(false);
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
      top: [],
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

  it("caps results at the provided limit", () => {
    const results = buildTagFilterSearchResults(tags, [], "", 2);
    expect(results).toHaveLength(2);
  });
});
