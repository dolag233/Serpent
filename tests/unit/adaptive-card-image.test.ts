import { describe, expect, it } from "vitest";
import { coverNeedsMorePixels } from "../../src/renderer/adaptive-card-image";

describe("coverNeedsMorePixels", () => {
  const image = { sourceWidth: 4000, sourceHeight: 2000, coverWidth: 512, coverHeight: 256 };
  it("uses the contained image size and screen pixel ratio", () => {
    expect(coverNeedsMorePixels({ ...image, frameWidth: 200, frameHeight: 200, pixelRatio: 2 })).toBe(false);
    expect(coverNeedsMorePixels({ ...image, frameWidth: 300, frameHeight: 300, pixelRatio: 2 })).toBe(true);
    expect(coverNeedsMorePixels({ ...image, frameWidth: 300, frameHeight: 80, pixelRatio: 2 })).toBe(false);
  });
  it("never requires more pixels than the original", () => {
    expect(coverNeedsMorePixels({ frameWidth: 2000, frameHeight: 2000, pixelRatio: 3,
      sourceWidth: 400, sourceHeight: 200, coverWidth: 400, coverHeight: 200 })).toBe(false);
  });
  it("handles portrait pictures and missing measurements", () => {
    expect(coverNeedsMorePixels({ frameWidth: 200, frameHeight: 400, pixelRatio: 2,
      sourceWidth: 1000, sourceHeight: 4000, coverWidth: 128, coverHeight: 512 })).toBe(true);
    expect(coverNeedsMorePixels({ ...image, frameWidth: 0, frameHeight: 400, pixelRatio: 2 })).toBe(false);
  });
});
