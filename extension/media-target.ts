export interface MediaTarget {
  kind: 'image' | 'video';
  mediaUrl: string;
  /** Local file pages need the rendered element to create an upload payload. */
  sourceElement?: HTMLImageElement | HTMLVideoElement;
  /** Some Chromium file-page drags expose the original File in DataTransfer. */
  sourceFile?: File;
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

export function isFileUrl(value: string | undefined | null): value is string {
  if (!value) return false;
  try {
    return new URL(value).protocol === 'file:';
  } catch {
    return false;
  }
}

export function isSupportedMediaUrl(value: string | undefined | null): value is string {
  return isHttpUrl(value) || isFileUrl(value);
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
    if (!isSupportedMediaUrl(url)) continue;

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
    if (isSupportedMediaUrl(raw)) return raw;
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
    img.getAttribute('data-lazy-src'),
    img.getAttribute('data-original-src'),
    img.getAttribute('data-image-url'),
    img.getAttribute('data-url'),
    img.getAttribute('data-fallback-src'),
    dataset.src,
    dataset.original,
    dataset.origImg,
    dataset.pinMedia,
    dataset.lazySrc,
    dataset.originalSrc,
    dataset.imageUrl,
    dataset.url,
    dataset.fallbackSrc,
  ];

  for (const candidate of candidates) {
    if (isSupportedMediaUrl(candidate)) return candidate;
  }

  return undefined;
}

export function mediaUrlFromImage(img: HTMLImageElement): string | undefined {
  const srcset = img.srcset || img.getAttribute('data-srcset') || img.dataset.srcset || '';
  if (srcset) {
    const fromSrcset = pickLargestSrcsetUrl(srcset);
    if (isSupportedMediaUrl(fromSrcset)) return fromSrcset;
  }

  const direct = readImageDataUrl(img);
  if (isSupportedMediaUrl(direct)) return direct;
  return undefined;
}

export function mediaUrlFromVideo(video: HTMLVideoElement): string | undefined {
  const current =
    video.currentSrc ||
    video.src ||
    video.getAttribute('data-src') ||
    video.getAttribute('data-video-src') ||
    video.dataset.src ||
    video.dataset.videoSrc ||
    '';
  if (isSupportedMediaUrl(current)) return current;

  for (const source of video.querySelectorAll('source')) {
    const sourceSrcset = source.srcset || source.getAttribute('data-srcset') || '';
    if (sourceSrcset) {
      const fromSrcset = pickLargestSrcsetUrl(sourceSrcset);
      if (isSupportedMediaUrl(fromSrcset)) return fromSrcset;
    }
    const sourceUrl = source.src || source.getAttribute('data-src') || '';
    if (isSupportedMediaUrl(sourceUrl)) return sourceUrl;
  }

  return undefined;
}

export function mediaFromElement(element: Element): MediaTarget | null {
  if (element instanceof HTMLImageElement) {
    const mediaUrl = mediaUrlFromImage(element);
    if (!mediaUrl) return null;
    return isFileUrl(mediaUrl)
      ? { kind: 'image', mediaUrl, sourceElement: element }
      : { kind: 'image', mediaUrl };
  }

  if (element instanceof HTMLVideoElement) {
    const mediaUrl = mediaUrlFromVideo(element);
    if (!mediaUrl) return null;
    return isFileUrl(mediaUrl)
      ? { kind: 'video', mediaUrl, sourceElement: element }
      : { kind: 'video', mediaUrl };
  }

  if (element instanceof HTMLPictureElement) {
    const img = element.querySelector('img');
    if (img) return mediaFromElement(img);
  }

  if (typeof SVGImageElement !== 'undefined' && element instanceof SVGImageElement) {
    const href = element.getAttribute('href') ?? element.getAttribute('xlink:href');
    if (isSupportedMediaUrl(href)) return { kind: 'image', mediaUrl: href };
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

function mediaTargetFromDragData(dataTransfer: DataTransfer | null): MediaTarget | null {
  if (!dataTransfer) return null;

  const read = (type: string): string => {
    try {
      return dataTransfer.getData(type);
    } catch {
      return '';
    }
  };

  const uriCandidate = uriListMediaUrl(read('text/uri-list'));

  const html = read('text/html');
  if (html) {
    try {
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      const mediaElement = parsed.querySelector('img,video,picture');
      if (mediaElement) {
        const media = mediaFromElement(mediaElement);
        if (media) return media;
        const nested = mediaElement.querySelector('img,video');
        if (nested) {
          const nestedMedia = mediaFromElement(nested);
          if (nestedMedia) return nestedMedia;
        }
      }
      const href = parsed.querySelector('a[href]')?.getAttribute('href');
      if (isSupportedMediaUrl(href) && looksLikeMediaPath(href)) {
        return { kind: mediaKindFromUrl(href), mediaUrl: href };
      }
    } catch {
      // A page may provide malformed HTML drag data; continue with plain text.
    }
  }

  const plainText = read('text/plain').trim();
  if (
    isSupportedMediaUrl(plainText) &&
    (!html || looksLikeMediaPath(plainText))
  ) {
    return { kind: mediaKindFromUrl(plainText), mediaUrl: plainText };
  }

  // A draggable anchor often exposes its page URL in uri-list. Only use that
  // fallback when the payload looks like a media file (or when no richer
  // representation was supplied); otherwise the page URL must not be saved
  // as an image by accident.
  if (uriCandidate && (!html || looksLikeMediaPath(uriCandidate))) {
    return { kind: mediaKindFromUrl(uriCandidate), mediaUrl: uriCandidate };
  }

  return null;
}

function uriListMediaUrl(value: string): string | undefined {
  for (const line of value.split(/\r?\n/u)) {
    const candidate = line.trim();
    if (!candidate || candidate.startsWith('#') || !isSupportedMediaUrl(candidate)) continue;
    return candidate;
  }
  return undefined;
}

function looksLikeMediaPath(value: string): boolean {
  try {
    const pathname = new URL(value).pathname.toLowerCase();
    return /\.(?:avif|bmp|gif|heic|jpeg?|jxl|png|svg|tiff?|webp|avi|m4v|mkv|mov|mp4|mpeg|webm|wmv)(?:$|\.)/u.test(pathname);
  } catch {
    return false;
  }
}

function localFileFromDataTransfer(dataTransfer: DataTransfer | null): File | undefined {
  if (!dataTransfer) return undefined;
  try {
    const file = dataTransfer.files.item(0);
    return file && file.type.startsWith('image/') ? file : undefined;
  } catch {
    return undefined;
  }
}

function mediaKindFromUrl(value: string): MediaTarget['kind'] {
  try {
    const pathname = new URL(value).pathname.toLowerCase();
    if (/\.(?:mp4|m4v|mov|webm|avi|wmv|mkv)(?:$|\.)/u.test(pathname)) {
      return 'video';
    }
  } catch {
    // Fall through to the image default used by browser image drags.
  }
  return 'image';
}

function findMediaInElementTree(root: Element): MediaTarget | null {
  const direct = mediaFromElement(root);
  if (direct) return direct;

  const candidates = root.querySelectorAll('img,video,picture,svg image');
  for (const candidate of candidates) {
    const media = mediaFromElement(candidate);
    if (media) return media;
  }

  return mediaFromBackgroundImage(root);
}

/** Resolve the actual drag source before coordinate-based fallbacks. */
export function resolveMediaTargetFromDragEvent(
  documentRoot: Document,
  event: DragEvent,
): MediaTarget | null {
  const path = event.composedPath();
  const pathElements = path.filter((node): node is Element => node instanceof Element);
  const localFile = localFileFromDataTransfer(event.dataTransfer);

  for (const element of pathElements.slice(0, MEDIA_SEARCH_ANCESTOR_LEVELS)) {
    if (element === documentRoot.body || element === documentRoot.documentElement) continue;
    const media = findMediaInElementTree(element);
    if (media) {
      return localFile && isFileUrl(media.mediaUrl)
        ? { ...media, sourceFile: localFile }
        : media;
    }
  }

  const fromData = mediaTargetFromDragData(event.dataTransfer);
  if (fromData) {
    return localFile && isFileUrl(fromData.mediaUrl)
      ? { ...fromData, sourceFile: localFile }
      : fromData;
  }

  if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
    const fromPoint = resolveMediaTargetAtPoint(
      documentRoot,
      event.clientX,
      event.clientY,
      path,
    );
    return fromPoint && localFile && isFileUrl(fromPoint.mediaUrl)
      ? { ...fromPoint, sourceFile: localFile }
      : fromPoint;
  }

  return null;
}

export function findMediaElementFromDragEvent(
  documentRoot: Document,
  event: DragEvent,
): HTMLImageElement | HTMLVideoElement | null {
  const pathElements = event.composedPath()
    .filter((node): node is Element => node instanceof Element);
  for (const element of pathElements) {
    if (element instanceof HTMLImageElement || element instanceof HTMLVideoElement) {
      return element;
    }
    const nested = element.querySelector('img,video');
    if (nested instanceof HTMLImageElement || nested instanceof HTMLVideoElement) {
      return nested;
    }
  }
  return findMediaElementAtPoint(
    documentRoot,
    event.clientX,
    event.clientY,
    event.composedPath(),
  );
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
