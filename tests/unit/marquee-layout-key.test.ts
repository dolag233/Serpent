import { describe, expect, it } from "vitest";

import {
  buildMarqueeLayoutKey,
  type MarqueeLayoutKeyInput,
} from "../../src/renderer/marquee-layout-key";

const baseInput: MarqueeLayoutKeyInput = {
  viewMode: "grid",
  cardSize: 160,
  masonryGridWidth: 800,
  fields: {
    name: true,
    size: true,
    date: true,
    dimensions: true,
    badgeType: true,
    badgeDuration: true,
    badgeSource: true,
    badgeExtension: true,
  },
  assetIds: ["asset-1", "asset-2"],
  folderIds: ["folder-1"],
};

describe("buildMarqueeLayoutKey", () => {
  it("changes when card geometry-affecting preferences change", () => {
    const baseKey = buildMarqueeLayoutKey(baseInput);

    expect(
      buildMarqueeLayoutKey({ ...baseInput, viewMode: "masonry" }),
    ).not.toBe(baseKey);
    expect(
      buildMarqueeLayoutKey({ ...baseInput, cardSize: 220 }),
    ).not.toBe(baseKey);
    expect(
      buildMarqueeLayoutKey({
        ...baseInput,
        fields: { ...baseInput.fields, name: false },
      }),
    ).not.toBe(baseKey);
    expect(
      buildMarqueeLayoutKey({ ...baseInput, masonryGridWidth: 640 }),
    ).not.toBe(baseKey);
  });

  it("changes when visual card or folder order changes", () => {
    const baseKey = buildMarqueeLayoutKey(baseInput);

    expect(
      buildMarqueeLayoutKey({
        ...baseInput,
        assetIds: ["asset-2", "asset-1"],
      }),
    ).not.toBe(baseKey);
    expect(
      buildMarqueeLayoutKey({
        ...baseInput,
        folderIds: ["folder-2"],
      }),
    ).not.toBe(baseKey);
  });
});
