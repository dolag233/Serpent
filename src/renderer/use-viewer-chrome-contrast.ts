import { useEffect, useState, type RefObject } from "react";

import {
  readMediaImageData,
  resolveViewerChromeContrasts,
  type ViewerChromeContrastMap,
} from "./viewer-chrome-contrast";

const DEFAULT_CONTRAST: ViewerChromeContrastMap = {
  prev: "on-dark",
  next: "on-dark",
  close: "on-dark",
};

function findSampleSource(
  root: HTMLElement | null,
): CanvasImageSource | null {
  if (!root) return null;
  const video = root.querySelector("video");
  if (video && video.readyState >= 2 && video.videoWidth > 0) {
    return video;
  }
  const images = root.querySelectorAll("img");
  for (const image of images) {
    if (image.complete && image.naturalWidth > 0) {
      return image;
    }
  }
  return null;
}

/**
 * Sample the viewer stage media near <>/close affordances and refresh when
 * the asset surface changes (and lightly while video plays).
 */
export function useViewerChromeContrast(
  containerRef: RefObject<HTMLElement | null>,
  refreshKey: string,
): ViewerChromeContrastMap {
  const [contrasts, setContrasts] =
    useState<ViewerChromeContrastMap>(DEFAULT_CONTRAST);

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let intervalId = 0;

    const sample = () => {
      if (cancelled) return;
      const source = findSampleSource(containerRef.current);
      const image = source ? readMediaImageData(source) : null;
      const next = resolveViewerChromeContrasts(image);
      setContrasts((current) =>
        current.prev === next.prev &&
        current.next === next.next &&
        current.close === next.close
          ? current
          : next,
      );
    };

    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(sample);
    };

    schedule();
    // Video frames / late image decode: poll briefly after open/switch.
    intervalId = window.setInterval(schedule, 700);
    const stopSoon = window.setTimeout(() => {
      window.clearInterval(intervalId);
      intervalId = 0;
    }, 4_000);

    const root = containerRef.current;
    const onMediaEvent = () => schedule();
    root?.addEventListener("load", onMediaEvent, true);
    root?.addEventListener("loadeddata", onMediaEvent, true);
    root?.addEventListener("seeked", onMediaEvent, true);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearInterval(intervalId);
      window.clearTimeout(stopSoon);
      root?.removeEventListener("load", onMediaEvent, true);
      root?.removeEventListener("loadeddata", onMediaEvent, true);
      root?.removeEventListener("seeked", onMediaEvent, true);
    };
  }, [containerRef, refreshKey]);

  return contrasts;
}
