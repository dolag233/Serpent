import { describe, expect, it } from "vitest";

import {
  COLOR_PRESETS,
  colorFilterSql,
  parseColorFilterIds,
} from "../../src/shared/color-filter-presets";

describe("color-filter-presets", () => {
  it("parses known ids and drops unknown tokens", () => {
    expect(parseColorFilterIds("red, blue, nope")).toEqual(["red", "blue"]);
  });

  it("covers the full hue circle without gaps between neighbors", () => {
    const covered = new Array(360).fill(false);
    for (const preset of COLOR_PRESETS) {
      for (const span of preset.hues) {
        for (let hue = span.min; hue < span.max; hue += 1) {
          covered[hue] = true;
        }
      }
    }
    expect(covered.every(Boolean)).toBe(true);
  });

  it("builds inclusive match SQL and null-safe exclude SQL", () => {
    const match = colorFilterSql("h", ["blue"], false);
    expect(match?.sql).toContain("IS NOT NULL");
    expect(match?.params).toEqual([195, 255]);

    const exclude = colorFilterSql("h", ["red"], true);
    expect(exclude?.sql).toContain("IS NULL OR NOT");
    expect(exclude?.params).toEqual([345, 360, 0, 15]);
  });
});
