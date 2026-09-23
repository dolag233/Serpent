import { describe, expect, it } from "vitest";

import {
  CATEGORICAL_FILTER_VALUES_MAX,
  FORMAT_FILTER_VALUES_MAX,
  filterClauseSchema,
} from "../../src/shared/asset-types";
import { FORMAT_TEXT_TOKEN } from "../../src/shared/text-media";

describe("filterClauseSchema format values", () => {
  it("accepts the compact text token used by the format chip", () => {
    expect(
      filterClauseSchema.parse({
        field: "format",
        values: [FORMAT_TEXT_TOKEN],
        exclude: false,
      }),
    ).toMatchObject({ field: "format", values: [FORMAT_TEXT_TOKEN] });
  });

  it("accepts more than 32 format values so every format chip can be selected", () => {
    const values = Array.from(
      { length: CATEGORICAL_FILTER_VALUES_MAX + 23 },
      (_, index) => `ext${index}`,
    );
    expect(values.length).toBeGreaterThan(CATEGORICAL_FILTER_VALUES_MAX);
    const parsed = filterClauseSchema.parse({
      field: "format",
      values,
      exclude: false,
    });
    expect("values" in parsed).toBe(true);
    expect("values" in parsed ? parsed.values : []).toHaveLength(values.length);
  });

  it("still rejects more than 32 tag values", () => {
    expect(() =>
      filterClauseSchema.parse({
        field: "tag",
        values: Array.from(
          { length: CATEGORICAL_FILTER_VALUES_MAX + 1 },
          (_, index) => `tag-${index}`,
        ),
        exclude: false,
      }),
    ).toThrow();
  });

  it("rejects format lists past the format cap", () => {
    expect(() =>
      filterClauseSchema.parse({
        field: "format",
        values: Array.from(
          { length: FORMAT_FILTER_VALUES_MAX + 1 },
          (_, index) => `ext${index}`,
        ),
        exclude: false,
      }),
    ).toThrow();
  });
});
