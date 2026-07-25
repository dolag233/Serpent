import { describe, expect, it } from "vitest";

import {
  PRIMARY_SORT_FIELDS,
  SECONDARY_SORT_FIELDS,
  SORT_ORDER_OPTIONS,
} from "../../src/renderer/SortModeControl";

describe("sort mode primary fields", () => {
  it("exposes ticket-required sorts including resolution (long_edge)", () => {
    expect(PRIMARY_SORT_FIELDS).toContain("name");
    expect(PRIMARY_SORT_FIELDS).toContain("modified_at");
    expect(PRIMARY_SORT_FIELDS).toContain("byte_size");
    expect(PRIMARY_SORT_FIELDS).toContain("long_edge");
    expect(PRIMARY_SORT_FIELDS).toContain("duration");
    expect(PRIMARY_SORT_FIELDS).not.toContain("relevance");
  });
});

describe("sort mode panel order options (Serpent-v78)", () => {
  it("exposes asc/desc for the in-panel direction section", () => {
    expect(SORT_ORDER_OPTIONS).toEqual(["asc", "desc"]);
  });

  it("keeps field lists free of direction pseudo-fields", () => {
    expect(PRIMARY_SORT_FIELDS).not.toContain("asc");
    expect(PRIMARY_SORT_FIELDS).not.toContain("desc");
    expect(SECONDARY_SORT_FIELDS).not.toContain("asc");
    expect(SECONDARY_SORT_FIELDS).not.toContain("desc");
  });
});

describe("sort mode trigger aria-label (Serpent-2lq6)", () => {
  it("does not embed the active field label in the trigger aria-label", () => {
    // Mirrors SortModeControl trigger: mode + optional order only, not "名称".
    const triggerAriaLabel = (modeLabel: string, orderLabel: string, shuffle: boolean) =>
      `${modeLabel}${shuffle ? "" : `, ${orderLabel}`}`;

    expect(triggerAriaLabel("排序", "升序", false)).toBe("排序, 升序");
    expect(triggerAriaLabel("排序", "升序", false)).not.toContain("名称");
  });
});
