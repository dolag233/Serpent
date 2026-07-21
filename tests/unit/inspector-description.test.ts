import { describe, expect, it } from "vitest";

import { resolveInspectorDescription } from "../../src/renderer/inspector-description";

describe("resolveInspectorDescription", () => {
  it("prefers non-empty human description", () => {
    expect(resolveInspectorDescription(" human ", "ai text")).toEqual({
      value: " human ",
      fromAi: false,
    });
  });

  it("falls back to AI when human is blank", () => {
    expect(resolveInspectorDescription("  ", "from ai")).toEqual({
      value: "from ai",
      fromAi: true,
    });
    expect(resolveInspectorDescription(null, "from ai")).toEqual({
      value: "from ai",
      fromAi: true,
    });
  });

  it("returns empty when neither side has text", () => {
    expect(resolveInspectorDescription("", undefined)).toEqual({
      value: "",
      fromAi: false,
    });
    expect(resolveInspectorDescription(null, "  ")).toEqual({
      value: "",
      fromAi: false,
    });
  });
});
