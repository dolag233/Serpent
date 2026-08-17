import { describe, expect, it } from "vitest";

import { buildInspectorSummaryMetadata } from "../../src/renderer/inspector-progressive-summary";

describe("Inspector progressive summary", () => {
  it("exposes only AssetSummary fields until full metadata arrives", () => {
    expect(
      buildInspectorSummaryMetadata({
        assetId: "asset-1",
        rating: 4,
        favorite: true,
        modifiedAt: "2026-08-15T00:00:00.000Z",
      }),
    ).toEqual({
      assetId: "asset-1",
      description: null,
      rating: 4,
      favorite: true,
      palette: null,
      automaticPalette: [],
      effectivePalette: [],
      paletteSource: null,
      sourcePageUrl: null,
      author: null,
      tags: [],
      entityVersion: 0,
      updatedAt: "2026-08-15T00:00:00.000Z",
    });
  });
});
