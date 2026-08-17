import { describe, expect, it } from "vitest";

import {
  detectPbrTextureChannel,
  pbrTextureDisplayFilter,
} from "../../src/renderer/pbr-texture-channel";

describe("PBR texture channel detection", () => {
  it.each([
    ["hero_basecolor_4k.png", "base-color", "none"],
    ["hero_normal.png", "normal", "none"],
    ["hero_roughness.png", "roughness", "grayscale(1)"],
    ["hero_glossiness.png", "smoothness", "grayscale(1) invert(1)"],
    ["hero_metallic.png", "metallic", "grayscale(1)"],
    ["hero_displacement.exr", "height", "grayscale(1)"],
    ["hero_metallicRoughness.png", "metallic-roughness", "none"],
  ] as const)(
    "recognizes %s as %s with %s display",
    (fileName, channel, filter) => {
      const result = detectPbrTextureChannel(fileName);
      expect(result?.channel).toBe(channel);
      expect(result && pbrTextureDisplayFilter(result)).toBe(filter);
    },
  );

  it("does not classify an ordinary image by extension alone", () => {
    expect(detectPbrTextureChannel("hero-final.png")).toBeNull();
  });

  it("keeps the source file untouched while presenting smoothness as inverse roughness", () => {
    const result = detectPbrTextureChannel("character_smoothness.jpg");
    expect(result).toEqual({
      channel: "smoothness",
      displayMode: "inverted-scalar",
    });
    expect(result && pbrTextureDisplayFilter(result)).toBe(
      "grayscale(1) invert(1)",
    );
  });
});
