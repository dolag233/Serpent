import { describe, expect, it } from "vitest";

import {
  mediaTypeSupportsAutoPalette,
  shouldShowAutoPaletteSection,
} from "../../src/shared/palette-visibility";

describe("palette-visibility (Serpent-uz1)", () => {
  it("allows image and video only", () => {
    expect(mediaTypeSupportsAutoPalette("image")).toBe(true);
    expect(mediaTypeSupportsAutoPalette("video")).toBe(true);
    expect(mediaTypeSupportsAutoPalette("audio")).toBe(false);
    expect(mediaTypeSupportsAutoPalette("text")).toBe(false);
    expect(mediaTypeSupportsAutoPalette("other")).toBe(false);
    expect(mediaTypeSupportsAutoPalette(null)).toBe(false);
    expect(mediaTypeSupportsAutoPalette(undefined)).toBe(false);
  });

  it("hides palette chrome for empty or non-AV selections", () => {
    expect(shouldShowAutoPaletteSection([])).toBe(false);
    expect(shouldShowAutoPaletteSection(["audio"])).toBe(false);
    expect(shouldShowAutoPaletteSection(["text"])).toBe(false);
    expect(shouldShowAutoPaletteSection(["other"])).toBe(false);
    expect(shouldShowAutoPaletteSection(["image", "audio"])).toBe(false);
    expect(shouldShowAutoPaletteSection(["video", null])).toBe(false);
  });

  it("shows palette chrome only when every selected kind is image or video", () => {
    expect(shouldShowAutoPaletteSection(["image"])).toBe(true);
    expect(shouldShowAutoPaletteSection(["video"])).toBe(true);
    expect(shouldShowAutoPaletteSection(["image", "video"])).toBe(true);
    expect(shouldShowAutoPaletteSection(["image", "image"])).toBe(true);
  });
});
