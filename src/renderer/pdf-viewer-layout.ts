/**
 * PDF viewer page geometry (Serpent-8ca259).
 *
 * The page column is a vertical flex container. Default `flex-shrink: 1`
 * squeezed every page into the viewport as thin rounded strips ("venetian
 * blinds"). Aspect-ratio plus `min-height: 0` / `overflow: hidden` can still
 * collapse the used height, so each page gets an explicit pixel height.
 */

/** Matches `.pdf-viewer-pages` padding on one side in styles.css. */
export const PDF_VIEWER_PAGE_INSET_PX = 16;

/** Matches `.pdf-viewer-pages` horizontal padding (left + right). */
export const PDF_VIEWER_PAGE_PADDING_X_PX = PDF_VIEWER_PAGE_INSET_PX * 2;

/** Matches `.pdf-viewer-pages` gap in styles.css. */
export const PDF_VIEWER_PAGE_GAP_PX = 14;

export type PdfLaidOutPage = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type PdfPageHit = {
  pageIndex: number;
  fracX: number;
  fracY: number;
};

export type PdfZoomAnchor = PdfPageHit & {
  pointerX: number;
  pointerY: number;
};

export function pdfViewerContentWidth(hostClientWidth: number, paddingX = PDF_VIEWER_PAGE_PADDING_X_PX): number {
  return Math.max(1, hostClientWidth - paddingX);
}

/** CSS pixel height of one page that spans the viewer content width. */
export function pdfPageCssHeight(
  contentWidth: number,
  pageWidth: number,
  pageHeight: number,
): number {
  if (!(pageWidth > 0) || !(pageHeight > 0) || !(contentWidth > 0)) {
    return Math.max(0, pageHeight);
  }
  return contentWidth * (pageHeight / pageWidth);
}

export function pdfPageBoxCssHeightPx(
  contentWidth: number,
  pageWidth: number,
  pageHeight: number,
): number {
  return Math.max(1, Math.round(pdfPageCssHeight(contentWidth, pageWidth, pageHeight)));
}

/** Pin a page node to width-fill / proportional-height geometry. */
export function applyPdfPageBox(
  element: HTMLElement,
  contentWidth: number,
  pageWidth: number,
  pageHeight: number,
): number {
  const cssHeight = pdfPageBoxCssHeightPx(contentWidth, pageWidth, pageHeight);
  element.style.setProperty("--pdf-page-height", `${cssHeight}px`);
  if (pageWidth > 0 && pageHeight > 0) {
    element.style.aspectRatio = `${pageWidth} / ${pageHeight}`;
  }
  return cssHeight;
}

export function pdfPageColumnScrolls(
  hostClientHeight: number,
  pageCssHeight: number,
  pageCount: number,
  gap = PDF_VIEWER_PAGE_GAP_PX,
): boolean {
  if (pageCount <= 0 || pageCssHeight <= 0) return false;
  const column = pageCount * pageCssHeight + Math.max(0, pageCount - 1) * gap;
  return column > hostClientHeight;
}

/**
 * CSS boxes for the vertical page column at a zoom level.
 *
 * Page bitmaps scale with zoom; flex `gap` and host padding do not. Later
 * pages therefore do not move as if the whole scroll content scaled from the
 * origin — pointer-anchored zoom must use a page-local point, not
 * `(scroll + pointer) * ratio - pointer`.
 */
export function layoutPdfPageColumn(args: {
  zoom: number;
  contentWidthAtFit: number;
  paddingLeft: number;
  paddingTop: number;
  gap: number;
  pageSizes: readonly { width: number; height: number }[];
}): PdfLaidOutPage[] {
  const pageWidth = Math.max(1, Math.round(args.contentWidthAtFit * args.zoom));
  const left = args.paddingLeft + Math.max(0, args.contentWidthAtFit - pageWidth) / 2;
  const pages: PdfLaidOutPage[] = [];
  let top = args.paddingTop;
  for (const size of args.pageSizes) {
    const height = pdfPageBoxCssHeightPx(pageWidth, size.width, size.height);
    pages.push({ left, top, width: pageWidth, height });
    top += height + args.gap;
  }
  return pages;
}

/** Convert viewport page rects into scroll-content coordinates. */
export function pdfPageBoxesFromViewportRects(
  pages: readonly Pick<DOMRect, "left" | "top" | "width" | "height">[],
  host: Pick<DOMRect, "left" | "top"> & { scrollLeft: number; scrollTop: number },
): PdfLaidOutPage[] {
  return pages.map((page) => ({
    left: page.left - host.left + host.scrollLeft,
    top: page.top - host.top + host.scrollTop,
    width: page.width,
    height: page.height,
  }));
}

/**
 * Hit-test a content-space point against laid-out pages. Coordinates in a
 * flex gap belong to the preceding page (`fracY` may be > 1).
 */
export function hitPdfPageColumn(
  pages: readonly PdfLaidOutPage[],
  contentX: number,
  contentY: number,
): PdfPageHit {
  if (pages.length === 0) {
    return { pageIndex: 0, fracX: 0, fracY: 0 };
  }
  let pageIndex = 0;
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    if (page && page.top <= contentY) pageIndex = index;
    else break;
  }
  const page = pages[pageIndex] ?? pages[0];
  return {
    pageIndex,
    fracX: page && page.width > 0 ? (contentX - page.left) / page.width : 0,
    fracY: page && page.height > 0 ? (contentY - page.top) / page.height : 0,
  };
}

/** Scroll offsets that place a page-local point under the host pointer. */
export function pdfPointerAnchoredScroll(args: {
  pointerX: number;
  pointerY: number;
  page: PdfLaidOutPage;
  fracX: number;
  fracY: number;
}): { left: number; top: number } {
  return {
    left: Math.max(0, args.page.left + args.fracX * args.page.width - args.pointerX),
    top: Math.max(0, args.page.top + args.fracY * args.page.height - args.pointerY),
  };
}
