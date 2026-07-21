import { describe, expect, it } from "vitest";

import {
  applyDimensionSelectionClick,
  formatTokensHas,
  toggleFormatToken,
} from "../../src/renderer/dimension-filter-selection";

describe("applyDimensionSelectionClick (REQ-FILTER-025)", () => {
  it("default click on an empty selection selects only the clicked value", () => {
    expect(applyDimensionSelectionClick([], "red", false)).toEqual(["red"]);
  });

  it("default click covers/replaces an existing different selection", () => {
    expect(applyDimensionSelectionClick(["red"], "blue", false)).toEqual([
      "blue",
    ]);
    expect(
      applyDimensionSelectionClick(["red", "blue"], "green", false),
    ).toEqual(["green"]);
  });

  it("default click on the sole active value clears the selection", () => {
    expect(applyDimensionSelectionClick(["red"], "red", false)).toEqual([]);
  });

  it("default click on a value that is active but not sole still covers to just that value", () => {
    expect(applyDimensionSelectionClick(["red", "blue"], "red", false)).toEqual(
      ["red"],
    );
  });

  it("shift click OR-accumulates a new value into the existing selection", () => {
    expect(applyDimensionSelectionClick(["red"], "blue", true)).toEqual([
      "red",
      "blue",
    ]);
  });

  it("shift click on an already-selected value removes just that value", () => {
    expect(
      applyDimensionSelectionClick(["red", "blue"], "blue", true),
    ).toEqual(["red"]);
  });

  it("shift click on an empty selection behaves like default click", () => {
    expect(applyDimensionSelectionClick([], "red", true)).toEqual(["red"]);
  });
});

describe("formatTokensHas", () => {
  it("is case-insensitive and ignores a leading dot", () => {
    expect(formatTokensHas("PNG, .jpg", "png")).toBe(true);
    expect(formatTokensHas("PNG, .jpg", "JPG")).toBe(true);
    expect(formatTokensHas("png", "mp4")).toBe(false);
  });
});

describe("toggleFormatToken (REQ-FILTER-025)", () => {
  it("default click on an empty field selects only the clicked extension", () => {
    expect(toggleFormatToken("", "png", false)).toBe("png");
  });

  it("default click covers a differing selection", () => {
    expect(toggleFormatToken("png", "mp4", false)).toBe("mp4");
    expect(toggleFormatToken("png, jpg", "mp4", false)).toBe("mp4");
  });

  it("default click on the sole active extension clears the field", () => {
    expect(toggleFormatToken("png", "png", false)).toBe("");
    expect(toggleFormatToken("PNG", "png", false)).toBe("");
  });

  it("shift click OR-accumulates an extension, preserving prior casing", () => {
    expect(toggleFormatToken("png", "mp4", true)).toBe("png, mp4");
  });

  it("shift click on an already-active extension removes just that token", () => {
    expect(toggleFormatToken("png, mp4", "mp4", true)).toBe("png");
  });

  it("supports the unified text format token (Serpent-4l7)", () => {
    expect(toggleFormatToken("", "text", false)).toBe("text");
    expect(formatTokensHas("text", "text")).toBe(true);
    expect(toggleFormatToken("png", "text", true)).toBe("png, text");
    expect(toggleFormatToken("text", "text", false)).toBe("");
  });
});
