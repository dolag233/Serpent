/**
 * PDF viewer page geometry (Serpent-8ca259).
 *
 * The page column is a vertical flex container. Default `flex-shrink: 1`
 * squeezed every page into the viewport as thin rounded strips ("venetian
 * blinds"). Aspect-ratio plus `min-height: 0` / `overflow: hidden` can still
 * collapse the used height, so each page gets an explicit pixel height.
 */

/** Matches `.pdf-viewer-pages` padding in styles.css. */
export const PDF_VIEWER_PAGE_PADDING_X_PX = 32;

/** Matches `.pdf-viewer-pages` gap in styles.css. */
export const PDF_VIEWER_PAGE_GAP_PX = 14;

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
