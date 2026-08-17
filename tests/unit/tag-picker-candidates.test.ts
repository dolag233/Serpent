import { describe, expect, it } from "vitest";

import {
  buildTagAssignCandidates,
  buildTagRemoveCandidates,
} from "../../src/renderer/tag-picker-candidates";

const tags = [
  { tagId: "warm", name: "Warm", assetCount: 4 },
  { tagId: "wood", name: "Wood", assetCount: 2 },
  { tagId: "unused", name: "Unused", assetCount: 0 },
  { tagId: "wool", name: "Wool", assetCount: 1 },
];

describe("buildTagAssignCandidates", () => {
  it("keeps non-zero-use tags and drops excluded ids", () => {
    expect(
      buildTagAssignCandidates(tags, "", new Set(["warm"])).map(
        (tag) => tag.tagId,
      ),
    ).toEqual(["wood", "wool"]);
  });

  it("matches by case-insensitive substring and trims the query", () => {
    expect(
      buildTagAssignCandidates(tags, "  wo ", new Set()).map(
        (tag) => tag.tagId,
      ),
    ).toEqual(["wood", "wool"]);
    expect(buildTagAssignCandidates(tags, "WOOL", new Set())).toEqual([
      { tagId: "wool", name: "Wool", assetCount: 1 },
    ]);
  });

  it("excludes zero-use tags by default so Inspector suggestions stay clean", () => {
    expect(buildTagAssignCandidates(tags, "unused", new Set())).toEqual([]);
    expect(buildTagAssignCandidates(tags, "", new Set())).not.toContainEqual(
      expect.objectContaining({ tagId: "unused" }),
    );
  });

  it("offers zero-use tags when the menu assign picker includes unused tags", () => {
    expect(
      buildTagAssignCandidates(tags, "", new Set(), {
        includeUnusedTags: true,
      }).map((tag) => tag.tagId),
    ).toEqual(["warm", "wood", "unused", "wool"]);
    expect(
      buildTagAssignCandidates(tags, "unused", new Set(), {
        includeUnusedTags: true,
      }).map((tag) => tag.tagId),
    ).toEqual(["unused"]);
    expect(
      buildTagAssignCandidates(tags, "", new Set(["unused"]), {
        includeUnusedTags: true,
      }),
    ).not.toContainEqual(expect.objectContaining({ tagId: "unused" }));
  });
});

describe("buildTagRemoveCandidates", () => {
  it("lists every non-zero-use tag for an empty query", () => {
    expect(buildTagRemoveCandidates(tags, "").map((tag) => tag.tagId)).toEqual([
      "warm",
      "wood",
      "wool",
    ]);
  });

  it("filters by query without excluding any tag id", () => {
    expect(
      buildTagRemoveCandidates(tags, "warm").map((tag) => tag.tagId),
    ).toEqual(["warm"]);
    expect(buildTagRemoveCandidates(tags, "missing")).toEqual([]);
  });
});
