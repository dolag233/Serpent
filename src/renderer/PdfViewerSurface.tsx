import { useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

import type { SerpentLibraryApi } from "../shared/library-api";
import { isMacPlatform } from "./commands/command-types";
import {
  matchGlobalZoomShortcut,
  shouldIgnoreGlobalZoomShortcut,
} from "./global-zoom-shortcuts";
import { useT } from "./i18n";
import { applyPdfPageBox, pdfViewerContentWidth } from "./pdf-viewer-layout";

export type PdfViewerSurfaceProps = {
  api: SerpentLibraryApi;
  libraryId: string;
  assetId: string;
  sourceUrl: string;
  isFullscreen: boolean;
};

/** Zoom bounds (1 = fit viewer width). */
const PDF_ZOOM_MIN = 0.25;
const PDF_ZOOM_MAX = 8;
/** Wheel/toolbar step — one notch per gesture, unlike image's continuous zoom. */
const PDF_ZOOM_STEP = 1.25;

function hostPaddingX(host: HTMLElement): number {
  const style = getComputedStyle(host);
  return (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
}

type PdfPageSize = { width: number; height: number };

function clampZoom(zoom: number): number {
  return Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, Math.round(zoom * 100) / 100));
}

/**
 * Serpent-8ca259: PDF viewer that renders every page into a vertical,
 * scrollable column with pdfjs-dist (browser build). Pages keep their
 * aspect ratio, span the viewer width, and never flex-shrink into strips.
 *
 * Zoom/pan follows the image/video viewer interaction model (Serpent 工单):
 * - Cmd/Ctrl+= / - / 0 zoom at the viewport center, 0 resets to fit width
 *   (global-zoom-shortcuts, same chords as images/videos);
 * - Ctrl+wheel / pinch zooms; the plain wheel scrolls the column (page
 *   flipping stays native — documents must scroll);
 * - zooming keeps the pointer-anchored content in place (re-render model);
 * - when zoomed past the viewport, drag with the left button to pan, or
 *   scroll both axes.
 */
export function PdfViewerSurface({
  sourceUrl,
  isFullscreen,
}: PdfViewerSurfaceProps) {
  const t = useT();
  const hostRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [loadedPages, setLoadedPages] = useState<number>(0);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [zoom, setZoom] = useState(1);
  /**
   * Scroll position to restore after the pages re-render on a zoom change.
   * Pointer-anchored zooming computes the target scroll in the old geometry;
   * rebuilding the column resets scrolling, so the render effect applies this
   * once the new pages exist (keeps the pointer-anchored content stationary).
   */
  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null);

  // Load the document once per source; rendering reacts to pdfDoc/zoom below.
  // The parent keys the surface by asset, so a source change remounts this
  // component and the state below starts fresh — no synchronous reset needed.
  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        // Bundle the pdf.js worker locally (vite emits it as a static asset);
        // the CSP (script-src 'self') forbids CDN/blob worker sources.
        pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;
        loadingTask = pdfjs.getDocument({ url: sourceUrl });
        const pdf = await loadingTask.promise;
        if (!cancelled) {
          setPageCount(pdf.numPages);
          setPdfDoc(pdf);
        }
      } catch {
        if (!cancelled) {
          setError(t("viewer.pdfLoadFailed"));
        }
      }
    })();
    return () => {
      cancelled = true;
      void loadingTask?.destroy();
    };
  }, [sourceUrl, t]);

  // Render the page column. Re-runs when the document loads or the zoom
  // changes; the loaded document is reused so zooming never re-fetches.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !pdfDoc) return;
    let cancelled = false;
    let observer: IntersectionObserver | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let hostWidthObserver: ResizeObserver | null = null;
    const rendered = new Set<number>();
    const pageNodes: HTMLElement[] = [];
    const pageSizes = new Map<number, PdfPageSize>();

    const contentWidth = () => pdfViewerContentWidth(host.clientWidth, hostPaddingX(host)) * zoom;

    const waitForHostWidth = async () => {
      if (host.clientWidth > 48) return;
      await new Promise<void>((resolve) => {
        hostWidthObserver = new ResizeObserver(() => {
          if (cancelled || host.clientWidth > 48) {
            hostWidthObserver?.disconnect();
            hostWidthObserver = null;
            resolve();
          }
        });
        hostWidthObserver.observe(host);
        if (cancelled || host.clientWidth > 48) {
          hostWidthObserver?.disconnect();
          hostWidthObserver = null;
          resolve();
        }
      });
    };

    const layoutNode = (element: HTMLElement, size: PdfPageSize) => {
      applyPdfPageBox(element, contentWidth(), size.width, size.height);
      // The wrap CSS pins width:100% to the viewport; an explicit width lets
      // zoomed pages overflow and unlocks horizontal scrolling (Serpent P2).
      element.style.width = `${Math.round(contentWidth())}px`;
    };

    const relayoutPages = () => {
      for (const [index, node] of pageNodes.entries()) {
        if (!node.isConnected) continue;
        const size = pageSizes.get(index + 1);
        if (size) layoutNode(node, size);
      }
    };

    void (async () => {
      try {
        await waitForHostWidth();
        if (cancelled) return;
        const renderPage = async (pageNumber: number) => {
          if (rendered.has(pageNumber) || cancelled) return;
          rendered.add(pageNumber);
          let page: PDFPageProxy | undefined;
          try {
            page = await pdfDoc.getPage(pageNumber);
            if (cancelled) return;
            const unscaled = page.getViewport({ scale: 1 });
            const size = { width: unscaled.width, height: unscaled.height };
            pageSizes.set(pageNumber, size);
            const dpr = Math.max(1, window.devicePixelRatio || 1);
            const cssScale = unscaled.width > 0 ? contentWidth() / unscaled.width : 1;
            const viewport = page.getViewport({ scale: cssScale * dpr });
            const canvas = document.createElement("canvas");
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            canvas.className = "pdf-viewer-page";
            const context = canvas.getContext("2d");
            if (!context) {
              rendered.delete(pageNumber);
              return;
            }
            const wrap = document.createElement("div");
            wrap.className = "pdf-viewer-page-wrap";
            layoutNode(wrap, size);
            wrap.append(canvas);
            const placeholder = pageNodes[pageNumber - 1];
            if (placeholder?.isConnected) {
              observer?.unobserve(placeholder);
              placeholder.replaceWith(wrap);
            } else {
              host.append(wrap);
            }
            pageNodes[pageNumber - 1] = wrap;
            await page.render({ canvas, canvasContext: context, viewport }).promise;
            if (!cancelled) setLoadedPages((count) => count + 1);
          } catch {
            rendered.delete(pageNumber);
            if (!cancelled) {
              setError(t("viewer.pdfLoadFailed"));
            }
          } finally {
            page?.cleanup();
          }
        };

        observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              const index = pageNodes.indexOf(entry.target as HTMLDivElement);
              if (index >= 0) void renderPage(index + 1);
            }
          },
          { root: host, rootMargin: "800px 0px" },
        );

        const first = await pdfDoc.getPage(1);
        const firstUnscaled = first.getViewport({ scale: 1 });
        const firstSize = { width: firstUnscaled.width, height: firstUnscaled.height };
        first.cleanup();

        for (let pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber += 1) {
          if (cancelled) break;
          pageSizes.set(pageNumber, firstSize);
          const placeholder = document.createElement("div");
          placeholder.className = "pdf-viewer-page-placeholder";
          layoutNode(placeholder, firstSize);
          host.append(placeholder);
          pageNodes.push(placeholder);
          observer.observe(placeholder);
          if (pageNumber === 1) void renderPage(1);
        }

        // Restore the pointer-anchored scroll position after the zoom
        // rebuild (the column reset scrolling when its content was cleared).
        const pending = pendingScrollRef.current;
        if (pending) {
          host.scrollLeft = pending.left;
          host.scrollTop = pending.top;
          pendingScrollRef.current = null;
        }

        resizeObserver = new ResizeObserver(() => {
          if (!cancelled) relayoutPages();
        });
        resizeObserver.observe(host);
      } catch {
        if (!cancelled) {
          setError(t("viewer.pdfLoadFailed"));
        }
      }
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      resizeObserver?.disconnect();
      hostWidthObserver?.disconnect();
      host.textContent = "";
    };
  }, [pdfDoc, zoom, t]);

  /**
   * Apply a new zoom while keeping the content under `clientX/clientY`
   * stationary (pointer-anchored zooming, like the image viewer's zoomAt).
   * The pages re-render asynchronously; the target scroll is stashed and the
   * render effect applies it once the new pages exist.
   */
  const stepZoomAt = (clientX: number, clientY: number, nextZoom: number) => {
    const host = hostRef.current;
    if (!host || nextZoom === zoom) return;
    const rect = host.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const anchorX = host.scrollLeft + px;
    const anchorY = host.scrollTop + py;
    const ratio = nextZoom / zoom;
    pendingScrollRef.current = {
      left: Math.max(0, anchorX * ratio - px),
      top: Math.max(0, anchorY * ratio - py),
    };
    setZoom(nextZoom);
  };

  const wheelZoom = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    // One wheel notch ≈ one step, matching the toolbar step.
    stepZoomAt(
      event.clientX,
      event.clientY,
      clampZoom(zoom * Math.exp(-event.deltaY * 0.001)),
    );
  };

  /** Step zoom at the viewport center (toolbar / keyboard). */
  const zoomAtViewportCenter = (factor: number) => {
    const host = hostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    stepZoomAt(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      clampZoom(zoom * factor),
    );
  };

  // Cmd/Ctrl+= / - / 0 — same global chords as the image/video viewer
  // (0 resets to fit width). Ignore while typing in an editable target.
  useEffect(() => {
    const platform = isMacPlatform(navigator.userAgent) ? "mac" : "windows";
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreGlobalZoomShortcut(event.target)) return;
      const action = matchGlobalZoomShortcut(event, platform);
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      if (action === "reset") {
        setZoom(1);
        return;
      }
      zoomAtViewportCenter(action === "in" ? PDF_ZOOM_STEP : 1 / PDF_ZOOM_STEP);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  return (
    <div className="pdf-viewer" data-fullscreen={isFullscreen ? "true" : undefined}>
      {pageCount !== null ? (
        <div className="pdf-viewer-toolbar">
          <button
            className="pdf-viewer-tool"
            disabled={zoom <= PDF_ZOOM_MIN}
            onClick={() => zoomAtViewportCenter(1 / PDF_ZOOM_STEP)}
            type="button"
            title={t("viewer.zoomOut")}
          >
            −
          </button>
          <span className="pdf-viewer-zoom-label">{Math.round(zoom * 100)}%</span>
          <button
            className="pdf-viewer-tool"
            disabled={zoom >= PDF_ZOOM_MAX}
            onClick={() => zoomAtViewportCenter(PDF_ZOOM_STEP)}
            type="button"
            title={t("viewer.zoomIn")}
          >
            +
          </button>
          <button
            className="pdf-viewer-tool"
            onClick={() => setZoom(1)}
            type="button"
            title={t("viewer.zoomFit")}
          >
            {t("viewer.zoomFit")}
          </button>
          <span className="pdf-viewer-meta">
            {t("viewer.pdfPages", { count: pageCount, loaded: loadedPages })}
          </span>
        </div>
      ) : null}
      {error ? <p className="pdf-viewer-error">{error}</p> : null}
      <div
        className="pdf-viewer-pages"
        onPointerCancel={(event) => {
          if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const host = hostRef.current;
          if (!host) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            scrollLeft: host.scrollLeft,
            scrollTop: host.scrollTop,
          };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          const host = hostRef.current;
          if (!drag || !host || drag.pointerId !== event.pointerId) return;
          host.scrollLeft = Math.max(0, drag.scrollLeft - (event.clientX - drag.startX));
          host.scrollTop = Math.max(0, drag.scrollTop - (event.clientY - drag.startY));
        }}
        onPointerUp={(event) => {
          if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
        }}
        onWheel={wheelZoom}
        ref={hostRef}
        tabIndex={0}
      />
    </div>
  );
}
