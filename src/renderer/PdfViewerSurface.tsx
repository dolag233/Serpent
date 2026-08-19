import { useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

import type { SerpentLibraryApi } from "../shared/library-api";
import { useT } from "./i18n";
import { applyPdfPageBox, pdfViewerContentWidth } from "./pdf-viewer-layout";

export type PdfViewerSurfaceProps = {
  api: SerpentLibraryApi;
  libraryId: string;
  assetId: string;
  sourceUrl: string;
  isFullscreen: boolean;
};

function hostPaddingX(host: HTMLElement): number {
  const style = getComputedStyle(host);
  return (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
}

type PdfPageSize = { width: number; height: number };

/**
 * Serpent-8ca259: PDF viewer that renders every page into a vertical,
 * scrollable column with pdfjs-dist (browser build). Pages keep their
 * aspect ratio, span the viewer width, and never flex-shrink into strips.
 */
export function PdfViewerSurface({
  sourceUrl,
  isFullscreen,
}: PdfViewerSurfaceProps) {
  const t = useT();
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [loadedPages, setLoadedPages] = useState<number>(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    let observer: IntersectionObserver | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let hostWidthObserver: ResizeObserver | null = null;
    const rendered = new Set<number>();
    const pageNodes: HTMLElement[] = [];
    const pageSizes = new Map<number, PdfPageSize>();
    setError(null);
    setPageCount(null);
    setLoadedPages(0);

    const contentWidth = () => pdfViewerContentWidth(host.clientWidth, hostPaddingX(host));

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
        const pdfjs = await import("pdfjs-dist");
        // Bundle the pdf.js worker locally (vite emits it as a static asset);
        // the CSP (script-src 'self') forbids CDN/blob worker sources.
        pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;
        loadingTask = pdfjs.getDocument({ url: sourceUrl });
        const pdf = await loadingTask.promise;
        if (cancelled) {
          await loadingTask.destroy();
          return;
        }
        setPageCount(pdf.numPages);

        const renderPage = async (pageNumber: number) => {
          if (rendered.has(pageNumber) || cancelled) return;
          rendered.add(pageNumber);
          let page: PDFPageProxy | undefined;
          try {
            page = await pdf.getPage(pageNumber);
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

        const first = await pdf.getPage(1);
        const firstUnscaled = first.getViewport({ scale: 1 });
        const firstSize = { width: firstUnscaled.width, height: firstUnscaled.height };
        first.cleanup();

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
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
      void loadingTask?.destroy();
    };
  }, [sourceUrl, t]);

  return (
    <div className="pdf-viewer" data-fullscreen={isFullscreen ? "true" : undefined}>
      {error ? <p className="pdf-viewer-error">{error}</p> : null}
      {pageCount !== null ? (
        <div className="pdf-viewer-meta">
          {t("viewer.pdfPages", { count: pageCount, loaded: loadedPages })}
        </div>
      ) : null}
      <div className="pdf-viewer-pages" ref={hostRef} />
    </div>
  );
}
