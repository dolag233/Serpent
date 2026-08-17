import { describe, expect, it } from "vitest";

import {
  buildPluginBrowseFilter,
  pluginViewerExtension,
  pluginViewerMimeType,
} from "../../src/renderer/plugin-context-state";

const range = (min = "", max = "", exclude = false) => ({ min, max, exclude });

describe("plugin context state", () => {
  it("serializes browse filters into a bounded summary", () => {
    expect(buildPluginBrowseFilter({
      colorFilter: "warm",
      excludeColorFilter: false,
      formatFilter: "png",
      excludeFormatFilter: false,
      tagFilter: "hero",
      excludeTagFilter: true,
      tagFilterMatch: "all",
      ratingFilter: "4",
      excludeRatingFilter: false,
      favoriteFilter: "yes",
      sourceUrlFilter: "any",
      availabilityFilter: "available",
      excludeAvailabilityFilter: false,
      widthRange: range("512"),
      heightRange: range("", "2048"),
      aspectRatioRange: range("1.7", "1.9"),
      aspectRatioRanges: [],
      longEdgeRange: range("1024", "4096"),
      durationRange: range(),
    })).toBe("color=warm&format=png&tag=!hero&tagMatch=all&rating=4&favorite=yes&availability=available&width=512-&height=-2048&aspectRatio=1.7-1.9&longEdge=1024-4096");
  });

  it("keeps viewer predicates normalized", () => {
    expect(pluginViewerExtension("Poster.JPEG")).toBe("jpeg");
    expect(pluginViewerMimeType("image")).toBe("image/*");
    expect(pluginViewerMimeType("other")).toBe("application/octet-stream");
  });
});
