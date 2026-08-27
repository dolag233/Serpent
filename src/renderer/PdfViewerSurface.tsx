import { useEffect, useRef, useState } from "react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from "pdfjs-dist/types/src/display/api";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

import type { SerpentLibraryApi } from "../shared/library-api";
import { isMacPlatform } from "./commands/command-types";
import {
  matchGlobalZoomShortcut,
  shouldIgnoreGlobalZoomShortcut,
} from "./global-zoom-shortcuts";
import { useT } from "./i18n";
import type { PdfZoomAnchor } from "./pdf-viewer-layout";
import {
  applyPdfPageBox,
  hitPdfPageColumn,
  pdfPageBoxesFromViewportRects,
  pdfPointerAnchoredScroll,
  pdfViewerContentWidth,
} from "./pdf-viewer-layout";

export type PdfViewerSurfaceProps = {
  api: SerpentLibraryApi;
  libraryId: string;
  assetId: string;
  sourceUrl: string | null;
  /** Ready document thumbnail shown while pdf.js loads the real source. */
  placeholderUrl?: string | null;
  /** Aborted when the owning viewer session closes or changes revision. */
  sessionSignal?: AbortSignal | null;
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
 * - zooming keeps the pointer-anchored page-local point in place on every
 *   page (gap/padding do not scale, so origin-uniform scroll is wrong);
 * - when zoomed past the viewport, drag with the left button to pan, or
 *   scroll both axes.
 */
export function PdfViewerSurface({
  sourceUrl,
  placeholderUrl,
  sessionSignal,
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
  const [hostClientWidth, setHostClientWidth] = useState(0);
  const [pdfLoading, setPdfLoading] = useState(Boolean(sourceUrl));
  /**
   * Page-local zoom anchor. Flex gap and padding do not scale with zoom, so
   * later pages cannot use origin-uniform `(scroll + pointer) * ratio`.
   * All page boxes are resized to the new zoom first, then this point is
   * restored under the pointer.
   */
  const pendingZoomAnchorRef = useRef<PdfZoomAnchor | null>(null);

  // PDF canvas backing stores are sized from the host's CSS width. Re-render
  // after a pane/window resize so a page is never stretched into a larger CSS
  // box than the bitmap that backs it. requestAnimationFrame coalesces the
  // stream of ResizeObserver notifications produced while a window is dragged.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let frame: number | null = null;
    const measure = () => {
      frame = null;
      const nextWidth = host.clientWidth;
      setHostClientWidth((previousWidth) => (
        previousWidth === nextWidth ? previousWidth : nextWidth
      ));
    };
    const scheduleMeasure = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(host);
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);

  // Load the document once per source; rendering reacts to pdfDoc/zoom below.
  // The parent keys the surface by asset, so a source change remounts this
  // component and the state below starts fresh — no synchronous reset needed.
  //
  // `serpent://` is intentionally not an http(s) URL. pdf.js therefore falls
  // back to its XHR network stream and does not issue Range requests for the
  // custom protocol. Use PDFDataRangeTransport over the existing authenticated
  // protocol instead: the renderer never receives a filesystem path, and the
  // PDF parser can request only the byte ranges it needs.
  useEffect(() => {
    let cancelled = Boolean(sessionSignal?.aborted);
    let loadingTask: PDFDocumentLoadingTask | null = null;
    const rangeControllers = new Set<AbortController>();
    let abortRangeRequests: (() => void) | undefined;
    const abortSessionWork = () => {
      cancelled = true;
      abortRangeRequests?.();
      void loadingTask?.destroy();
    };
    sessionSignal?.addEventListener("abort", abortSessionWork, { once: true });
    queueMicrotask(() => {
      if (cancelled) return;
      setPdfLoading(Boolean(sourceUrl));
      setError(null);
      setPdfDoc(null);
      setPageCount(null);
      setLoadedPages(0);
    });

    const parseContentRange = (value: string | null): { length: number } | null => {
      const match = /^bytes\s+\d+-\d+\/(\d+)$/u.exec(value?.trim() ?? "");
      if (!match) return null;
      const length = Number(match[1]);
      return Number.isSafeInteger(length) && length > 0 ? { length } : null;
    };

    void (async () => {
      try {
        if (!sourceUrl) {
          setPdfLoading(false);
          return;
        }
        const pdfjs = await import("pdfjs-dist");
        // StrictMode can clean up an effect before a dynamic import resolves.
        // Do not start a second network task from that cancelled invocation.
        if (cancelled) return;
        // Bundle the pdf.js worker locally (vite emits it as a static asset);
        // the CSP (script-src 'self') forbids CDN/blob worker sources.
        pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

        let range: InstanceType<typeof pdfjs.PDFDataRangeTransport> | null = null;
        try {
          const probe = await fetch(sourceUrl, {
            headers: { Range: "bytes=0-0" },
            signal: sessionSignal ?? undefined,
          });
          const contentRange = parseContentRange(probe.headers.get("Content-Range"));
          if (probe.status === 206 && contentRange) {
            const initialData = new Uint8Array(await probe.arrayBuffer());
            if (!cancelled) {
              let aborted = false;
              const transport = new pdfjs.PDFDataRangeTransport(
                contentRange.length,
                initialData,
                false,
              );
              const rangeRequests = new Map<string, Promise<void>>();
              const requestRange = (begin: number, end: number): void => {
                if (aborted || begin >= end) return;
                const key = `${begin}:${end}`;
                const existing = rangeRequests.get(key);
                if (existing) return;
                const controller = new AbortController();
                rangeControllers.add(controller);
                const abortFromSession = () => controller.abort();
                sessionSignal?.addEventListener("abort", abortFromSession, { once: true });
                const request = fetch(sourceUrl, {
                  headers: { Range: `bytes=${begin}-${end - 1}` },
                  signal: controller.signal,
                })
                  .then(async (response) => {
                    if (!response.ok) throw new Error(`PDF range request failed (${response.status}).`);
                    const bytes = new Uint8Array(await response.arrayBuffer());
                    if (!aborted) transport.onDataRange(begin, bytes);
                  })
                  .catch((error: unknown) => {
                    if (aborted || (error instanceof DOMException && error.name === "AbortError")) return;
                    setError(t("viewer.pdfLoadFailed"));
                    void loadingTask?.destroy();
                  })
                  .finally(() => {
                    rangeRequests.delete(key);
                    rangeControllers.delete(controller);
                    sessionSignal?.removeEventListener("abort", abortFromSession);
                  });
                rangeRequests.set(key, request);
              };
              const rangeTransport = transport as InstanceType<typeof pdfjs.PDFDataRangeTransport> & {
                requestDataRange(begin: number, end: number): void;
                abort(): void;
              };
              rangeTransport.requestDataRange = requestRange;
              abortRangeRequests = () => {
                aborted = true;
                for (const controller of rangeControllers) controller.abort();
                rangeControllers.clear();
                rangeRequests.clear();
              };
              rangeTransport.abort = abortRangeRequests;
              range = rangeTransport;
            }
          }
        } catch {
          // Fall back to the existing stream when a protocol implementation
          // or an older exported library does not support byte ranges.
          range = null;
        }
        if (cancelled) return;
        loadingTask = range
          ? pdfjs.getDocument({
              range,
              rangeChunkSize: 256 * 1024,
              disableAutoFetch: true,
              disableStream: true,
            })
          : pdfjs.getDocument({ url: sourceUrl });
        const pdf = await loadingTask.promise;
        if (!cancelled) {
          setPageCount(pdf.numPages);
          setPdfDoc(pdf);
          setPdfLoading(false);
        }
      } catch {
        if (!cancelled) {
          setPdfLoading(false);
          setError(t("viewer.pdfLoadFailed"));
        }
      }
    })();
    return () => {
      sessionSignal?.removeEventListener("abort", abortSessionWork);
      abortSessionWork();
    };
  }, [sessionSignal, sourceUrl, t]);

  // Render the page column. Re-runs when the document loads or the zoom
  // or host width changes; the loaded document is reused so zooming never
  // re-fetches.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !pdfDoc || hostClientWidth <= 48 || sessionSignal?.aborted) return;
    let cancelled = false;
    let observer: IntersectionObserver | null = null;
    const rendered = new Set<number>();
    const renderTasks = new Set<RenderTask>();
    const pageNodes: HTMLElement[] = [];
    const abortRenderWork = () => {
      cancelled = true;
      observer?.disconnect();
      for (const renderTask of renderTasks) renderTask.cancel();
      renderTasks.clear();
    };
    sessionSignal?.addEventListener("abort", abortRenderWork, { once: true });
    // Nodes from the previous render pass (zoom change). Kept as transition
    // placeholders so the column never blanks out between zoom levels. Page
    // boxes resize immediately (required for later-page pointer anchors);
    // canvases still swap in place after the new bitmap is ready.
    const staleNodes = [...host.children] as HTMLElement[];

    const contentWidth = () => pdfViewerContentWidth(host.clientWidth, hostPaddingX(host)) * zoom;

    const layoutNode = (element: HTMLElement, size: PdfPageSize) => {
      applyPdfPageBox(element, contentWidth(), size.width, size.height);
      // The wrap CSS pins width:100% to the viewport; an explicit width lets
      // zoomed pages overflow and unlocks horizontal scrolling (Serpent P2).
      element.style.width = `${Math.round(contentWidth())}px`;
      element.dataset.pdfPageWidth = String(size.width);
      element.dataset.pdfPageHeight = String(size.height);
    };

    const pageSizeFromNode = (element: HTMLElement, fallback: PdfPageSize): PdfPageSize => {
      const width = Number(element.dataset.pdfPageWidth);
      const height = Number(element.dataset.pdfPageHeight);
      if (width > 0 && height > 0) return { width, height };
      if (element.offsetWidth > 0 && element.offsetHeight > 0) {
        return { width: element.offsetWidth, height: element.offsetHeight };
      }
      return fallback;
    };

    const restoreZoomAnchor = (nodes: HTMLElement[]) => {
      const pending = pendingZoomAnchorRef.current;
      pendingZoomAnchorRef.current = null;
      if (!pending || nodes.length === 0) return pending;
      const hostRect = host.getBoundingClientRect();
      const boxes = pdfPageBoxesFromViewportRects(
        nodes.map((node) => node.getBoundingClientRect()),
        {
          left: hostRect.left,
          top: hostRect.top,
          scrollLeft: host.scrollLeft,
          scrollTop: host.scrollTop,
        },
      );
      const page = boxes[Math.min(pending.pageIndex, boxes.length - 1)];
      if (!page) return pending;
      const next = pdfPointerAnchoredScroll({
        pointerX: pending.pointerX,
        pointerY: pending.pointerY,
        page,
        fracX: pending.fracX,
        fracY: pending.fracY,
      });
      host.scrollLeft = next.left;
      host.scrollTop = next.top;
      return pending;
    };

    // Resize every existing page box to the new zoom before restoring scroll.
    // Off-screen pages used to keep their old height, so a later-page pointer
    // anchor was computed against a column that had not actually grown.
    const fallbackSize: PdfPageSize = { width: 612, height: 792 };
    const existingFallback = staleNodes[0]
      ? pageSizeFromNode(staleNodes[0], fallbackSize)
      : fallbackSize;
    for (const node of staleNodes) {
      layoutNode(node, pageSizeFromNode(node, existingFallback));
    }
    const restoredAnchor = restoreZoomAnchor(staleNodes);
    const priorityPage = restoredAnchor ? restoredAnchor.pageIndex + 1 : 1;

    void (async () => {
      try {
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
            // Render BEFORE mounting: swapping the placeholder for a wrap that
            // still holds a blank canvas flashes white. Rendering off-DOM and
            // replacing afterwards keeps the previous page visible until the
            // crisp bitmap is ready (Serpent P2: no white flash on zoom).
            const renderTask = page.render({ canvas, canvasContext: context, viewport });
            renderTasks.add(renderTask);
            try {
              await renderTask.promise;
            } finally {
              renderTasks.delete(renderTask);
            }
            if (cancelled) return;
            const placeholder = pageNodes[pageNumber - 1];
            if (placeholder?.isConnected) {
              observer?.unobserve(placeholder);
              placeholder.replaceWith(wrap);
            } else {
              host.append(wrap);
            }
            pageNodes[pageNumber - 1] = wrap;
            setLoadedPages((count) => count + 1);
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

        // Put the first placeholder in the DOM before doing any long page
        // column work, then start the first render immediately. This keeps a
        // real page from waiting behind a document with hundreds of pages.
        const firstStale = staleNodes[0];
        const firstPlaceholder = firstStale && firstStale.isConnected
          ? firstStale
          : document.createElement("div");
        if (!firstStale || !firstStale.isConnected) {
          firstPlaceholder.className = "pdf-viewer-page-placeholder";
          layoutNode(firstPlaceholder, firstSize);
          host.append(firstPlaceholder);
        }
        pageNodes.push(firstPlaceholder);
        observer.observe(firstPlaceholder);
        void renderPage(1);

        for (let pageNumber = 2; pageNumber <= pdfDoc.numPages; pageNumber += 1) {
          if (cancelled) break;
          const stale = staleNodes[pageNumber - 1];
          if (stale && stale.isConnected) {
            pageNodes.push(stale);
            observer.observe(stale);
          } else {
            const placeholder = document.createElement("div");
            placeholder.className = "pdf-viewer-page-placeholder";
            layoutNode(placeholder, firstSize);
            host.append(placeholder);
            pageNodes.push(placeholder);
            observer.observe(placeholder);
          }
          // A large PDF can have thousands of pages. Let layout, input and
          // the pdf.js worker run between small placeholder batches.
          if (pageNumber % 32 === 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            if (cancelled) break;
          }
        }

        if (priorityPage !== 1) void renderPage(priorityPage);

      } catch {
        if (!cancelled) {
          setError(t("viewer.pdfLoadFailed"));
        }
      }
    })();

    return () => {
      sessionSignal?.removeEventListener("abort", abortRenderWork);
      abortRenderWork();
      // Do NOT clear host.textContent here: zoom re-renders reuse the previous
      // page nodes as transition placeholders (no white flash). The component
      // unmount is handled by React removing the subtree.
    };
  }, [hostClientWidth, pdfDoc, sessionSignal, t, zoom]);

  /**
   * Apply a new zoom while keeping the page-local point under the pointer
   * stationary. Record the hit against the current column; the render effect
   * resizes every page box, then restores that point.
   */
  const stepZoomAt = (clientX: number, clientY: number, nextZoom: number) => {
    const host = hostRef.current;
    if (!host || nextZoom === zoom) return;
    const rect = host.getBoundingClientRect();
    const pointerX = clientX - rect.left;
    const pointerY = clientY - rect.top;
    const children = [...host.children] as HTMLElement[];
    const boxes = pdfPageBoxesFromViewportRects(
      children.map((child) => child.getBoundingClientRect()),
      {
        left: rect.left,
        top: rect.top,
        scrollLeft: host.scrollLeft,
        scrollTop: host.scrollTop,
      },
    );
    const hit = hitPdfPageColumn(boxes, host.scrollLeft + pointerX, host.scrollTop + pointerY);
    pendingZoomAnchorRef.current = {
      ...hit,
      pointerX,
      pointerY,
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
    <div
      className="pdf-viewer"
      data-fullscreen={isFullscreen ? "true" : undefined}
      data-loading={pdfLoading ? "true" : undefined}
    >
      {placeholderUrl && loadedPages === 0 ? (
        <div className="pdf-viewer-placeholder" aria-hidden="true">
          <img alt="" src={placeholderUrl} />
        </div>
      ) : null}
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
