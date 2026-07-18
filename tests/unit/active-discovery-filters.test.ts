import { describe, expect, it } from "vitest";

import {
  buildActiveFilterChips,
  type DiscoveryFilterSnapshot,
} from "../../src/renderer/active-discovery-filters";

const empty: DiscoveryFilterSnapshot = {
  colorFilter: "",
  excludeColorFilter: false,
  formatFilter: "",
  excludeFormatFilter: false,
  tagFilter: "",
  excludeTagFilter: false,
  ratingFilter: "",
  excludeRatingFilter: false,
  favoriteFilter: "any",
  sourceUrlFilter: "any",
  availabilityFilter: "any",
  excludeAvailabilityFilter: false,
  widthRange: { min: "", max: "", exclude: false },
  heightRange: { min: "", max: "", exclude: false },
  aspectRatioRange: { min: "", max: "", exclude: false },
  longEdgeRange: { min: "", max: "", exclude: false },
  durationRange: { min: "", max: "", exclude: false },
};

describe("buildActiveFilterChips", () => {
  it("returns no chips when discovery filters are idle", () => {
    expect(buildActiveFilterChips(empty)).toEqual([]);
  });

  it("lists tag, format, rating, and aspect chips with details", () => {
    const chips = buildActiveFilterChips({
      ...empty,
      formatFilter: "png, jpg",
      excludeFormatFilter: true,
      tagFilter: "hero",
      ratingFilter: "4, 5",
      aspectRatioRange: { min: "1.52", max: "1.68", exclude: false },
      favoriteFilter: "yes",
    });
    expect(chips.map((chip) => chip.id)).toEqual([
      "format",
      "tag",
      "rating",
      "favorite",
      "aspect_ratio",
    ]);
    expect(chips[0]?.detail).toBe("−png, jpg");
    expect(chips[4]?.detail).toBe("1.52–1.68");
  });
});
