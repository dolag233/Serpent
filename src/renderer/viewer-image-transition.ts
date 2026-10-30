/** A decoded image held above both the browse canvas and viewer during handoff. */
export interface PhotoFlight {
  element: HTMLImageElement | HTMLCanvasElement;
  clip?: { element: HTMLDivElement; from: DOMRect };
  remove(): void;
}

function viewportClip(rect: DOMRect): string {
  return `inset(${rect.top}px ${innerWidth - rect.right}px ${innerHeight - rect.bottom}px ${rect.left}px)`;
}

/** `complete` alone can still leave the first draw doing expensive decoding. */
export async function preparePhotoFlightSource(image: HTMLImageElement | null, signal: AbortSignal): Promise<boolean> {
  if (!image || signal.aborted) return false;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolve(ready && !signal.aborted && image.complete && image.naturalWidth > 0);
    };
    const abort = () => finish(false);
    const timer = setTimeout(() => finish(false), 1500);
    signal.addEventListener("abort", abort, { once: true });
    void image.decode().then(() => finish(true), () => finish(false));
  });
}

/** Image pixels inside a contain-fit card, excluding the card's letterbox. */
export function containedPhotoRect(box: DOMRect, width: number, height: number): DOMRect {
  if (width <= 0 || height <= 0 || box.width <= 0 || box.height <= 0) return box;
  const scale = Math.min(box.width / width, box.height / height);
  const w = width * scale;
  const h = height * scale;
  return new DOMRect(box.left + (box.width - w) / 2, box.top + (box.height - h) / 2, w, h);
}

/** Only corners touching the card's clipped corners inherit its radius. */
export function cardPhotoRadius(card: HTMLElement, photo: DOMRect): string {
  const box = card.getBoundingClientRect();
  const style = getComputedStyle(card);
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;
  const left = near(photo.left, box.left);
  const right = near(photo.right, box.right);
  const top = near(photo.top, box.top);
  const bottom = near(photo.bottom, box.bottom);
  return [
    left && top ? style.borderTopLeftRadius : "0px",
    right && top ? style.borderTopRightRadius : "0px",
    right && bottom ? style.borderBottomRightRadius : "0px",
    left && bottom ? style.borderBottomLeftRadius : "0px",
  ].map((radius) => radius || "0px").join(" ");
}

export function createPhotoFlight(image: HTMLImageElement | HTMLCanvasElement | null, rect: DOMRect | null, radius = "0px"): PhotoFlight | null {
  const sourceWidth = image instanceof HTMLCanvasElement ? image.width : image?.naturalWidth ?? 0;
  const sourceHeight = image instanceof HTMLCanvasElement ? image.height : image?.naturalHeight ?? 0;
  if (!image || !rect || (image instanceof HTMLImageElement && !image.complete) || !sourceWidth || rect.width < 1 || rect.height < 1 ||
      rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  // Copy already decoded pixels once, rather than making another full-size
  // source image compete with the viewer for decoding/GPU upload. Portrait
  // camera originals can be tens of megapixels; the flight only needs enough
  // pixels for the window in which it is animated.
  const copy = document.createElement("canvas");
  const maxEdge = Math.min(2048, Math.max(innerWidth, innerHeight, 1) * Math.min(window.devicePixelRatio || 1, 2));
  const height = sourceHeight || sourceWidth * rect.height / rect.width;
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, height));
  copy.width = Math.max(1, Math.round(sourceWidth * scale));
  copy.height = Math.max(1, Math.round(height * scale));
  const context = copy.getContext("2d");
  if (!context) return null;
  try { context.drawImage(image, 0, 0, copy.width, copy.height); } catch { return null; }
  // Keep mip crossfades and card styles out of the independent flight layer.
  copy.className = "viewer-photo-flight";
  copy.setAttribute("aria-hidden", "true");
  Object.assign(copy.style, {
    position: "fixed", zIndex: "2147483647", pointerEvents: "none", margin: "0",
    left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
    maxWidth: "none", maxHeight: "none", transform: "none", translate: "none", objectFit: "contain",
    borderRadius: radius, opacity: "1", visibility: "visible", willChange: "transform, border-radius",
    transition: "none", animation: "none",
  });
  document.body.appendChild(copy);
  return { element: copy, remove: () => copy.remove() };
}

/** Capture the visible pixels before restoring the browse layout changes geometry. */
export function capturePhotoReturnFlight(image: HTMLImageElement | null, openingFlight: PhotoFlight | null, raster?: HTMLCanvasElement | null): { flight: PhotoFlight; from: DOMRect; radius: string } | null {
  if (openingFlight) {
    const element = openingFlight.element;
    // A quick close reverses from the current frame, including a partially
    // expanded thumbnail whose full viewer image has not decoded yet.
    for (const animation of element.getAnimations()) animation.pause();
    const from = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const scale = element.offsetWidth > 0 ? from.width / element.offsetWidth : 1;
    const radius = style.borderRadius.replace(/([\d.]+)px/g, (_, value: string) => `${Number(value) * scale}px`);
    Object.assign(element.style, {
      left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`,
      transform: "none", borderRadius: radius,
    });
    for (const animation of element.getAnimations()) animation.cancel();
    return { flight: openingFlight, from, radius };
  }
  const from = image?.getBoundingClientRect() ?? null;
  const reusable = raster && from && raster.height > 0 && from.height > 0
    && Math.abs(raster.width / raster.height - from.width / from.height) < 0.01;
  const flight = createPhotoFlight(reusable ? raster : image, from);
  if (flight && from && image) {
    // Keep clipping in screen coordinates. Animating a local inset together
    // with image scale multiplies the two interpolations: the visible area
    // grows before shrinking and looks like a sudden reset to the full photo.
    const viewport = image.closest(".preview-image-viewport")?.getBoundingClientRect();
    if (viewport) {
      const left = Math.max(0, viewport.left, from.left);
      const top = Math.max(0, viewport.top, from.top);
      const right = Math.min(innerWidth, viewport.right, from.right);
      const bottom = Math.min(innerHeight, viewport.bottom, from.bottom);
      const visible = new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
      const clip = document.createElement("div");
      clip.className = "viewer-photo-flight-clip";
      clip.setAttribute("aria-hidden", "true");
      Object.assign(clip.style, {
        position: "fixed", inset: "0", pointerEvents: "none", zIndex: "2147483647",
        overflow: "hidden", clipPath: viewportClip(visible),
      });
      flight.element.style.position = "absolute";
      document.body.appendChild(clip);
      clip.appendChild(flight.element);
      flight.clip = { element: clip, from: visible };
      flight.remove = () => clip.remove();
    }
  }
  return flight && from ? { flight, from, radius: "0px" } : null;
}

/** Retry a zero-sized initial layout instead of silently dropping the opening. */
export function schedulePhotoFlightStart(isCurrent: () => boolean, tryStart: () => boolean): () => void {
  let frame: number | undefined;
  let cancelled = false;
  let attempts = 0;
  const attempt = () => {
    if (cancelled || !isCurrent()) return;
    if (tryStart() || ++attempts >= 120) return;
    frame = requestAnimationFrame(attempt);
  };
  attempt();
  return () => { cancelled = true; if (frame !== undefined) cancelAnimationFrame(frame); };
}

export async function movePhotoFlight(flight: PhotoFlight, from: DOMRect, to: DOMRect, fromRadius = "0px", toRadius = "0px"): Promise<void> {
  if (from.width < 1 || from.height < 1 || to.width < 1 || to.height < 1) return;
  // Uniform scaling preserves the photo's proportions. Centering also absorbs
  // subpixel rounding or a small aspect difference between thumbnail and source.
  const scale = Math.min(to.width / from.width, to.height / from.height);
  const x = to.left + (to.width - from.width * scale) / 2 - from.left;
  const y = to.top + (to.height - from.height * scale) / 2 - from.top;
  // A scaled element scales its CSS corner radius as well; compensate so the
  // visible final radius still matches the card on the return journey.
  const scaledRadius = toRadius.replace(/([\d.]+)px/g, (_, value: string) => `${Number(value) / scale}px`);
  const animation = flight.element.animate([
    { transform: "translate(0, 0) scale(1)", transformOrigin: "top left", borderRadius: fromRadius },
    { transform: `translate(${x}px, ${y}px) scale(${scale})`, transformOrigin: "top left", borderRadius: scaledRadius },
  ], { duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "forwards" });
  if (flight.clip) {
    flight.clip.element.animate([
      { clipPath: viewportClip(flight.clip.from) },
      { clipPath: viewportClip(to) },
    ], { duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "forwards" });
  }
  try { await animation.finished; } catch { /* interrupted by navigation */ }
}
