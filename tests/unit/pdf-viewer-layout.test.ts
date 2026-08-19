import { describe, expect, it } from "vitest";

import {
  pdfPageBoxCssHeightPx,
  pdfPageColumnScrolls,
  pdfPageCssHeight,
  pdfViewerContentWidth,
} from "../../src/renderer/pdf-viewer-layout";

describe("pdf viewer layout (Serpent-8ca259)", () => {
  it("lets each page span the host content width", () => {
    expect(pdfViewerContentWidth(1428, 32)).toBe(1396);
  });

  it("scales page height from width so a portrait page is taller than the viewport strip", () => {
    // ACM-like letter page (~8.5×11) filling a ~1400px-wide viewer.
    const height = pdfPageCssHeight(1396, 612, 792);
    expect(height).toBeGreaterThan(900);
    expect(height).toBeCloseTo(1396 * (792 / 612), 5);
  });

  it("requires scrolling once several full-size pages exceed the host", () => {
    const pageHeight = pdfPageCssHeight(1396, 612, 792);
    expect(pdfPageColumnScrolls(900, pageHeight, 17)).toBe(true);
    expect(pdfPageColumnScrolls(900, 20, 2)).toBe(false);
  });

  it("rounds the explicit page box height so CSS cannot collapse it", () => {
    expect(pdfPageBoxCssHeightPx(1396, 612, 792)).toBe(Math.round(1396 * (792 / 612)));
    expect(pdfPageBoxCssHeightPx(0, 612, 792)).toBeGreaterThanOrEqual(1);
  });
});
