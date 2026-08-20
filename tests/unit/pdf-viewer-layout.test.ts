import { describe, expect, it } from "vitest";

import {
  hitPdfPageColumn,
  layoutPdfPageColumn,
  pdfPageBoxCssHeightPx,
  pdfPageBoxesFromViewportRects,
  pdfPageColumnScrolls,
  pdfPageCssHeight,
  pdfPointerAnchoredScroll,
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

  it("does not treat later pages as origin-uniform scaled content when zooming", () => {
    const pageSizes = Array.from({ length: 8 }, () => ({ width: 612, height: 792 }));
    const column = {
      contentWidthAtFit: 800,
      paddingLeft: 16,
      paddingTop: 16,
      gap: 14,
      pageSizes,
    };
    const from = layoutPdfPageColumn({ ...column, zoom: 1 });
    const to = layoutPdfPageColumn({ ...column, zoom: 2 });
    const page = from[5];
    expect(page).toBeDefined();
    const fracX = 0.5;
    const fracY = 0.4;
    const pointerX = 400;
    const pointerY = 280;
    const scrollTop = page!.top + fracY * page!.height - pointerY;
    const scrollLeft = page!.left + fracX * page!.width - pointerX;
    const hit = hitPdfPageColumn(from, scrollLeft + pointerX, scrollTop + pointerY);
    expect(hit.pageIndex).toBe(5);
    expect(hit.fracX).toBeCloseTo(fracX, 5);
    expect(hit.fracY).toBeCloseTo(fracY, 5);

    const next = pdfPointerAnchoredScroll({
      pointerX,
      pointerY,
      page: to[hit.pageIndex]!,
      fracX: hit.fracX,
      fracY: hit.fracY,
    });
    expect(next.left + pointerX).toBeCloseTo(to[5]!.left + fracX * to[5]!.width, 5);
    expect(next.top + pointerY).toBeCloseTo(to[5]!.top + fracY * to[5]!.height, 5);

    // Previous formula: (scroll + pointer) * ratio - pointer. Flex gap and
    // padding are constant, so later pages miss the pointer by a large offset.
    const uniformTop = Math.max(0, (scrollTop + pointerY) * 2 - pointerY);
    expect(Math.abs(uniformTop - next.top)).toBeGreaterThan(50);
  });

  it("keeps the first-page local point close to origin-uniform scale", () => {
    const pageSizes = [{ width: 612, height: 792 }];
    const from = layoutPdfPageColumn({
      zoom: 1,
      contentWidthAtFit: 800,
      paddingLeft: 16,
      paddingTop: 16,
      gap: 14,
      pageSizes,
    });
    const to = layoutPdfPageColumn({
      zoom: 1.25,
      contentWidthAtFit: 800,
      paddingLeft: 16,
      paddingTop: 16,
      gap: 14,
      pageSizes,
    });
    const page = from[0]!;
    const pointerX = 200;
    const pointerY = 120;
    const fracX = 0.3;
    const fracY = 0.2;
    const scrollTop = page.top + fracY * page.height - pointerY;
    const next = pdfPointerAnchoredScroll({
      pointerX,
      pointerY,
      page: to[0]!,
      fracX,
      fracY,
    });
    const uniformTop = Math.max(0, (scrollTop + pointerY) * 1.25 - pointerY);
    expect(Math.abs(uniformTop - next.top)).toBeLessThan(8);
  });

  it("maps viewport rects into host scroll-content coordinates", () => {
    const boxes = pdfPageBoxesFromViewportRects(
      [{ left: 40, top: 80, width: 200, height: 300 }],
      { left: 10, top: 20, scrollLeft: 5, scrollTop: 400 },
    );
    expect(boxes).toEqual([{ left: 35, top: 460, width: 200, height: 300 }]);
  });
});
