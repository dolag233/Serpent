import { describe, expect, it } from "vitest";

import { resolveAutoGrowHeight } from "../../src/renderer/inspector-description-autogrow";

describe("resolveAutoGrowHeight (Serpent-qto)", () => {
  it("floors to the single-line minimum for empty/short content", () => {
    expect(resolveAutoGrowHeight(20, 32, 180)).toBe(32);
    expect(resolveAutoGrowHeight(0, 32, 180)).toBe(32);
  });

  it("grows to fit content once it exceeds the minimum", () => {
    expect(resolveAutoGrowHeight(64, 32, 180)).toBe(64);
    expect(resolveAutoGrowHeight(179, 32, 180)).toBe(179);
  });

  it("clamps to the maximum for very long content", () => {
    expect(resolveAutoGrowHeight(500, 32, 180)).toBe(180);
  });

  it("returns the minimum when max is misconfigured below min", () => {
    expect(resolveAutoGrowHeight(500, 100, 50)).toBe(100);
  });

  it("treats an unbounded maximum (Infinity) as no ceiling", () => {
    expect(resolveAutoGrowHeight(5000, 32, Number.POSITIVE_INFINITY)).toBe(
      5000,
    );
  });
});
