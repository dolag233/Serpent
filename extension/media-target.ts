export interface MediaTarget {
  kind: 'image' | 'video';
  mediaUrl: string;
}

const MEDIA_SEARCH_ANCESTOR_LEVELS = 8;
const MEDIA_SEARCH_DESCENDANT_DEPTH = 6;

export function isHttpUrl(value: string | undefined | null): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function pickLargestSrcsetUrl(srcset: string): string | undefined {
  let bestUrl: string | undefined;
  let bestWidth = -1;

  for (const candidate of srcset.split(',')) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(/\s+/);
    const url = parts[0];
    const descriptor = parts[1];
    if (!isHttpUrl(url)) continue;

    let width = 0;
    if (descriptor?.endsWith('w')) {
      width = Number.parseInt(descriptor.slice(0, -1), 10);
    } else if (descriptor?.endsWith('x')) {
      width = Number.parseFloat(descriptor.slice(0, -1)) * 1000;
    } else if (!descriptor) {
      width = 1;
    }

    if (!Number.isFinite(width)) continue;
    if (width >= bestWidth) {
      bestWidth = width;
      bestUrl = url;
    }
  }

  return bestUrl;
}

/** Parse the first http(s) URL from a CSS `background-image` value. */
export function extractHttpUrlFromCssBackgroundImage(
  backgroundImage: string,
): string | undefined {
  if (!backgroundImage || backgroundImage === 'none') return undefined;

  for (const layer of backgroundImage.split(',')) {
    const match = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^)'"]+))\s*\)/i.exec(layer.trim());
    const raw = match?.[1] ?? match?.[2] ?? match?.[3];
    if (isHttpUrl(raw)) return raw;
  }

  return undefined;
}

function readImageDataUrl(img: HTMLImageElement): string | undefined {
  const dataset = img.dataset;
  const candidates = [
    img.currentSrc,
    img.src,
    img.getAttribute('data-src'),
    img.getAttribute('data-original'),
    img.getAttribute('data-orig-img'),
    img.getAttribute('data-pin-media'),
    dataset.src,
    dataset.original,
    dataset.origImg,
    dataset.pinMedia,
  ];

  for (const candidate of candidates) {
    if (isHttpUrl(candidate)) return candidate;
  }

  return undefined;
}

export function mediaUrlFromImage(img: HTMLImageElement): string | undefined {
  if (img.srcset) {
    const fromSrcset = pickLargestSrcsetUrl(img.srcset);
    if (isHttpUrl(fromSrcset)) return fromSrcset;
  }

  const direct = readImageDataUrl(img);
  if (isHttpUrl(direct)) return direct;
  return undefined;
}

export function mediaUrlFromVideo(video: HTMLVideoElement): string | undefined {
  const current = video.currentSrc || video.src;
  if (isHttpUrl(current)) return current;

  for (const source of video.querySelectorAll('source')) {
    if (source.srcset) {
      const fromSrcset = pickLargestSrcsetUrl(source.srcset);
      if (isHttpUrl(fromSrcset)) return fromSrcset;
    }
    if (isHttpUrl(source.src)) return source.src;
  }

  return undefined;
}

export function mediaFromElement(element: Element): MediaTarget | null {
  if (element instanceof HTMLImageElement) {
    const mediaUrl = mediaUrlFromImage(element);
    return mediaUrl ? { kind: 'image', mediaUrl } : null;
  }

  if (element instanceof HTMLVideoElement) {
    const mediaUrl = mediaUrlFromVideo(element);
    return mediaUrl ? { kind: 'video', mediaUrl } : null;
  }

  if (element instanceof HTMLPictureElement) {
    const img = element.querySelector('img');
    if (img) return mediaFromElement(img);
  }

  return null;
}

function mediaFromBackgroundImage(element: Element): MediaTarget | null {
  const inlineBackground =
    element instanceof HTMLElement ? element.style.backgroundImage : '';
  const computedBackground = getComputedStyle(element).backgroundImage;
  const mediaUrl =
    extractHttpUrlFromCssBackgroundImage(inlineBackground)
    ?? extractHttpUrlFromCssBackgroundImage(computedBackground);
  return mediaUrl ? { kind: 'image', mediaUrl } : null;
}

function elementContainsPoint(
  element: Element,
  clientX: number,
  clientY: number,
): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  return (
    clientX >= rect.left
    && clientX <= rect.right
    && clientY >= rect.top
    && clientY <= rect.bottom
  );
}

function imageDisplayArea(img: HTMLImageElement): number {
  const rect = img.getBoundingClientRect();
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

function findLargestImageContainingPoint(
  root: Element,
  clientX: number,
  clientY: number,
  maxDepth: number,
): HTMLImageElement | null {
  const best: { current: { img: HTMLImageElement; area: number } | null } = {
    current: null,
  };

  const walk = (element: Element, depth: number) => {
    if (element instanceof HTMLImageElement && elementContainsPoint(element, clientX, clientY)) {
      const area = imageDisplayArea(element);
      if (area > 0 && (!best.current || area > best.current.area)) {
        best.current = { img: element, area };
      }
    }

    if (depth >= maxDepth) return;
    for (const child of element.children) {
      walk(child, depth + 1);
    }
  };

  walk(root, 0);
  return best.current?.img ?? null;
}

function findVideoContainingPoint(
  root: Element,
  clientX: number,
  clientY: number,
  maxDepth: number,
): HTMLVideoElement | null {
  const best: { current: { video: HTMLVideoElement; area: number } | null } = {
    current: null,
  };

  const walk = (element: Element, depth: number) => {
    if (element instanceof HTMLVideoElement && elementContainsPoint(element, clientX, clientY)) {
      const rect = element.getBoundingClientRect();
      const area = Math.max(0, rect.width) * Math.max(0, rect.height);
      if (area > 0 && (!best.current || area > best.current.area)) {
        best.current = { video: element, area };
      }
    }

    if (depth >= maxDepth) return;
    for (const child of element.children) {
      walk(child, depth + 1);
    }
  };

  walk(root, 0);
  return best.current?.video ?? null;
}

function findMediaUnderPointInScope(
  hit: Element,
  clientX: number,
  clientY: number,
): MediaTarget | null {
  let scope: Element | null = hit;

  for (let level = 0; level < MEDIA_SEARCH_ANCESTOR_LEVELS && scope; level += 1) {
    const image = findLargestImageContainingPoint(
      scope,
      clientX,
      clientY,
      MEDIA_SEARCH_DESCENDANT_DEPTH,
    );
    if (image) {
      const media = mediaFromElement(image);
      if (media) return media;
    }

    const video = findVideoContainingPoint(
      scope,
      clientX,
      clientY,
      MEDIA_SEARCH_DESCENDANT_DEPTH,
    );
    if (video) {
      const media = mediaFromElement(video);
      if (media) return media;
    }

    scope = scope.parentElement;
  }

  return null;
}

export function collectHitElements(
  documentRoot: Document,
  clientX: number,
  clientY: number,
  composedPath?: EventTarget[],
): Element[] {
  const seen = new Set<Element>();
  const ordered: Element[] = [];

  const push = (element: Element) => {
    if (seen.has(element)) return;
    seen.add(element);
    ordered.push(element);
  };

  if (composedPath) {
    for (const node of composedPath) {
      if (node instanceof Element) push(node);
    }
  }

  for (const element of documentRoot.elementsFromPoint(clientX, clientY)) {
    push(element);
  }

  return ordered;
}

export function resolveMediaTargetFromHitElements(
  hitElements: Element[],
  clientX: number,
  clientY: number,
): MediaTarget | null {
  for (const element of hitElements) {
    const media = mediaFromElement(element);
    if (media) return media;
  }

  for (const element of hitElements) {
    const scoped = findMediaUnderPointInScope(element, clientX, clientY);
    if (scoped) return scoped;
  }

  for (const element of hitElements) {
    const background = mediaFromBackgroundImage(element);
    if (background) return background;
  }

  return null;
}

export function resolveMediaTargetAtPoint(
  documentRoot: Document,
  clientX: number,
  clientY: number,
  composedPath?: EventTarget[],
): MediaTarget | null {
  const hitElements = collectHitElements(
    documentRoot,
    clientX,
    clientY,
    composedPath,
  );
  return resolveMediaTargetFromHitElements(hitElements, clientX, clientY);
}

export function findMediaElementAtPoint(
  documentRoot: Document,
  clientX: number,
  clientY: number,
  composedPath?: EventTarget[],
): HTMLImageElement | HTMLVideoElement | null {
  const hitElements = collectHitElements(
    documentRoot,
    clientX,
    clientY,
    composedPath,
  );

  for (const element of hitElements) {
    if (
      (element instanceof HTMLImageElement || element instanceof HTMLVideoElement)
      && mediaFromElement(element)
    ) {
      return element;
    }
  }

  for (const element of hitElements) {
    let scope: Element | null = element;
    for (let level = 0; level < MEDIA_SEARCH_ANCESTOR_LEVELS && scope; level += 1) {
      const image = findLargestImageContainingPoint(
        scope,
        clientX,
        clientY,
        MEDIA_SEARCH_DESCENDANT_DEPTH,
      );
      if (image && mediaFromElement(image)) return image;

      const video = findVideoContainingPoint(
        scope,
        clientX,
        clientY,
        MEDIA_SEARCH_DESCENDANT_DEPTH,
      );
      if (video && mediaFromElement(video)) return video;

      scope = scope.parentElement;
    }
  }

  return null;
}
