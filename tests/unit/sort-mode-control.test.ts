import { describe, expect, it } from "vitest";

import { PRIMARY_SORT_FIELDS } from "../../src/renderer/SortModeControl";

describe("sort mode primary fields", () => {
  it("exposes ticket-required sorts including resolution (long_edge)", () => {
    expect(PRIMARY_SORT_FIELDS).toContain("name");
    expect(PRIMARY_SORT_FIELDS).toContain("modified_at");
    expect(PRIMARY_SORT_FIELDS).toContain("byte_size");
    expect(PRIMARY_SORT_FIELDS).toContain("long_edge");
    expect(PRIMARY_SORT_FIELDS).toContain("duration");
  });
});
