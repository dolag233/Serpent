export interface MediaTarget {
  kind: 'image' | 'video';
  mediaUrl: string;
}

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

export function mediaUrlFromImage(img: HTMLImageElement): string | undefined {
  if (img.srcset) {
    const fromSrcset = pickLargestSrcsetUrl(img.srcset);
    if (isHttpUrl(fromSrcset)) return fromSrcset;
  }

  const current = img.currentSrc || img.src;
  if (isHttpUrl(current)) return current;
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

export function resolveMediaTargetAtPoint(
  documentRoot: Document,
  clientX: number,
  clientY: number,
): MediaTarget | null {
  const elements = documentRoot.elementsFromPoint(clientX, clientY);
  for (const element of elements) {
    const media = mediaFromElement(element);
    if (media) return media;
  }
  return null;
}
