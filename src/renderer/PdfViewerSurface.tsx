import { useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask } from "pdfjs-dist/types/src/display/api";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

import type { SerpentLibraryApi } from "../shared/library-api";
import { useT } from "./i18n";

export type PdfViewerSurfaceProps = {
  api: SerpentLibraryApi;
  libraryId: string;
  assetId: string;
  sourceUrl: string;
  isFullscreen: boolean;
};

/**
 * Serpent-8ca259: PDF viewer that renders every page into a vertical,
 * scrollable column with pdfjs-dist (browser build). Pages render lazily as
 * they approach the viewport so huge documents stay usable.
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
    const rendered = new Set<number>();

    void (async () => {
      try {
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
        const base = await pdf.getPage(1);
        const baseViewport = base.getViewport({ scale: 1 });
        base.cleanup();
        // Fit the widest page to the host width; cap at 1600px.
        const targetWidth = Math.min(1600, Math.max(320, host.clientWidth - 48));
        const scale = baseViewport.width > 0 ? targetWidth / baseViewport.width : 1;

        const renderPage = async (pageNumber: number) => {
          if (rendered.has(pageNumber)) return;
          rendered.add(pageNumber);
          const page = await pdf.getPage(pageNumber);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          canvas.className = "pdf-viewer-page";
          const context = canvas.getContext("2d");
          if (!context) {
            page.cleanup();
            return;
          }
          const wrap = document.createElement("div");
          wrap.className = "pdf-viewer-page-wrap";
          wrap.append(canvas);
          host.append(wrap);
          await page.render({ canvas, canvasContext: context, viewport }).promise;
          page.cleanup();
          setLoadedPages((count) => count + 1);
        };

        // IntersectionObserver renders pages as they scroll into view.
        const observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              const index = [...host.children].indexOf(entry.target as Element);
              if (index >= 0) void renderPage(index + 1);
            }
          },
          { root: host, rootMargin: "600px 0px" },
        );

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (cancelled) break;
          const placeholder = document.createElement("div");
          placeholder.className = "pdf-viewer-page-placeholder";
          placeholder.style.height = `${Math.ceil(baseViewport.height * scale)}px`;
          host.append(placeholder);
          observer.observe(placeholder);
          // Render the first page immediately so the view is not blank.
          if (pageNumber === 1) void renderPage(1);
        }
        return () => observer.disconnect();
      } catch {
        if (!cancelled) {
          setError(t("viewer.pdfLoadFailed"));
        }
      }
    })();

    return () => {
      cancelled = true;
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
