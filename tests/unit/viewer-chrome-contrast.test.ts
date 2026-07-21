import { describe, expect, it } from "vitest";

import {
  contrastFromLuminance,
  contrastForImageDataRegion,
  meanRelativeLuminance,
  relativeLuminance,
  resolveViewerChromeContrasts,
  sampleImageDataRegion,
} from "../../src/renderer/viewer-chrome-contrast";

function solidImageData(
  width: number,
  height: number,
  rgba: [number, number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgba[0];
    data[i + 1] = rgba[1];
    data[i + 2] = rgba[2];
    data[i + 3] = rgba[3];
  }
  return { width, height, data, colorSpace: "srgb" } as ImageData;
}

describe("viewer-chrome-contrast", () => {
  it("computes higher luminance for white than black", () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeGreaterThan(0.9);
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeLessThan(0.05);
  });

  it("maps dark samples to on-dark and light samples to on-light", () => {
    expect(contrastFromLuminance(0.1)).toBe("on-dark");
    expect(contrastFromLuminance(0.8)).toBe("on-light");
    expect(contrastFromLuminance(null)).toBe("on-dark");
  });

  it("ignores nearly transparent samples in the mean", () => {
    expect(
      meanRelativeLuminance([
        { r: 255, g: 255, b: 255, a: 0 },
        { r: 0, g: 0, b: 0, a: 255 },
      ]),
    ).toBeLessThan(0.05);
  });

  it("samples edge regions and classifies solid frames", () => {
    const dark = solidImageData(40, 40, [10, 10, 10, 255]);
    const light = solidImageData(40, 40, [245, 245, 245, 255]);
    expect(contrastForImageDataRegion(dark, "prev")).toBe("on-dark");
    expect(contrastForImageDataRegion(light, "close")).toBe("on-light");
    expect(sampleImageDataRegion(dark, "next").length).toBe(16);

    expect(resolveViewerChromeContrasts(light)).toEqual({
      prev: "on-light",
      next: "on-light",
      close: "on-light",
    });
    expect(resolveViewerChromeContrasts(null)).toEqual({
      prev: "on-dark",
      next: "on-dark",
      close: "on-dark",
    });
  });
});
