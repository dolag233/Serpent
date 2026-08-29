import { describe, expect, it } from "vitest";
import {
  SOURCE_DIRECT_MAX_BYTES,
  SOURCE_DIRECT_MAX_LONG_EDGE_PX,
  SOURCE_DIRECT_MAX_PIXELS,
  isSourceDirectPreview,
} from "../../src/shared/preview-policy";

const base = {
  fileName: "paint.png",
  mediaType: "image" as const,
  byteSize: 1_000_000,
  width: 1600,
  height: 1200,
};

describe("isSourceDirectPreview", () => {
  it("accepts bounded native raster images", () => {
    expect(isSourceDirectPreview(base)).toBe(true);
    expect(isSourceDirectPreview({ ...base, fileName: "paint.JFIF" })).toBe(true);
  });

  it("accepts a low-pixel lossless image just above the old byte boundary", () => {
    expect(isSourceDirectPreview({
      ...base,
      fileName: "large-lossless.png",
      byteSize: Math.floor(1.5 * 1024 * 1024),
      width: 1024,
      height: 768,
    })).toBe(true);
  });

  it("rejects unknown or oversized dimensions and bytes", () => {
    expect(isSourceDirectPreview({ ...base, width: null })).toBe(false);
    expect(isSourceDirectPreview({ ...base, height: SOURCE_DIRECT_MAX_LONG_EDGE_PX + 1 })).toBe(false);
    expect(isSourceDirectPreview({ ...base, width: SOURCE_DIRECT_MAX_LONG_EDGE_PX, height: Math.ceil(SOURCE_DIRECT_MAX_PIXELS / SOURCE_DIRECT_MAX_LONG_EDGE_PX) + 1 })).toBe(false);
    expect(isSourceDirectPreview({ ...base, byteSize: SOURCE_DIRECT_MAX_BYTES + 1 })).toBe(false);
  });

  it("rejects non-native image containers and non-image media", () => {
    expect(isSourceDirectPreview({ ...base, fileName: "camera.tiff" })).toBe(false);
    expect(isSourceDirectPreview({ ...base, fileName: "vector.svg" })).toBe(false);
    expect(isSourceDirectPreview({ ...base, mediaType: "video" })).toBe(false);
  });
});
