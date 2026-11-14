// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';

import {
  extractHttpUrlFromCssBackgroundImage,
  findMediaElementFromDragEvent,
  isFileUrl,
  isHttpUrl,
  pickLargestSrcsetUrl,
  resolveMediaTargetFromDragEvent,
  resolveMediaTargetFromHitElements,
} from '../../extension/media-target';
import { isOverlayHostHostname } from '../../extension/overlay-hosts';

describe('extension media target helpers', () => {
  it('accepts only HTTP(S) URLs', () => {
    expect(isHttpUrl('https://cdn.example.com/a.jpg')).toBe(true);
    expect(isHttpUrl('http://127.0.0.1/image.png')).toBe(true);
    expect(isHttpUrl('data:image/png;base64,abc')).toBe(false);
    expect(isHttpUrl('blob:https://example.com/uuid')).toBe(false);
  });

  it('recognizes local file media without weakening the HTTP URL guard', () => {
    expect(isFileUrl('file:///C:/Pictures/shot.png')).toBe(true);
    expect(isFileUrl('https://cdn.example.com/shot.png')).toBe(false);
    expect(isHttpUrl('file:///C:/Pictures/shot.png')).toBe(false);
  });

  it('picks the largest width from srcset descriptors', () => {
    const srcset = [
      'https://i.pinimg.com/control1/236x/db/2a/7b/db2a7b15f08760dfcdf76c43280df07c.jpg 236w',
      'https://i.pinimg.com/control1/736x/db/2a/7b/db2a7b15f08760dfcdf76c43280df07c.jpg 736w',
      'https://i.pinimg.com/control1/1200x/db/2a/7b/db2a7b15f08760dfcdf76c43280df07c.jpg 1080w',
    ].join(', ');

    expect(pickLargestSrcsetUrl(srcset)).toBe(
      'https://i.pinimg.com/control1/1200x/db/2a/7b/db2a7b15f08760dfcdf76c43280df07c.jpg',
    );
  });

  it('recognizes overlay-host sites that block native image menus', () => {
    expect(isOverlayHostHostname('www.pinterest.com')).toBe(true);
    expect(isOverlayHostHostname('pin.it')).toBe(true);
    expect(isOverlayHostHostname('www.behance.net')).toBe(true);
    expect(isOverlayHostHostname('images.google.com')).toBe(true);
    expect(isOverlayHostHostname('example.com')).toBe(false);
  });

  it('extracts http(s) URLs from css background-image values', () => {
    expect(
      extractHttpUrlFromCssBackgroundImage(
        'url("https://cdn.example.com/poster.jpg")',
      ),
    ).toBe('https://cdn.example.com/poster.jpg');
    expect(
      extractHttpUrlFromCssBackgroundImage(
        'linear-gradient(transparent, black), url(https://cdn.example.com/layer.png)',
      ),
    ).toBe('https://cdn.example.com/layer.png');
    expect(extractHttpUrlFromCssBackgroundImage('none')).toBeUndefined();
  });
});

describe('resolveMediaTargetFromHitElements', () => {
  it('finds an image hidden beneath a Pinterest-style click shield', () => {
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.left = '0';
    host.style.top = '0';
    host.style.width = '400px';
    host.style.height = '400px';

    const img = document.createElement('img');
    img.src = 'https://i.pinimg.com/control1/236x/db/2a/7b/db2a7b15f08760dfcdf76c43280df07c.jpg';
    img.srcset = [
      'https://i.pinimg.com/control1/236x/db/2a/7b/db2a7b15f08760dfcdf76c43280df07c.jpg 236w',
      'https://i.pinimg.com/control1/736x/db/2a/7b/db2a7b15f08760dfcdf76c43280df07c.jpg 736w',
    ].join(', ');
    Object.assign(img.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '400px',
      height: '400px',
    });

    const shield = document.createElement('div');
    Object.assign(shield.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '400px',
      height: '400px',
    });

    host.append(img, shield);
    document.body.append(host);

    Object.defineProperty(img, 'naturalWidth', { value: 736 });
    Object.defineProperty(img, 'naturalHeight', { value: 1104 });
    img.getBoundingClientRect = () => new DOMRect(0, 0, 400, 400);
    shield.getBoundingClientRect = () => new DOMRect(0, 0, 400, 400);

    const media = resolveMediaTargetFromHitElements([shield], 200, 200);
    expect(media).toEqual({
      kind: 'image',
      mediaUrl:
        'https://i.pinimg.com/control1/736x/db/2a/7b/db2a7b15f08760dfcdf76c43280df07c.jpg',
    });

    host.remove();
  });

  it('falls back to css background-image when no img element is present', () => {
    const tile = document.createElement('div');
    Object.assign(tile.style, {
      width: '320px',
      height: '240px',
      backgroundImage: 'url("https://cdn.example.com/hero.webp")',
    });
    tile.getBoundingClientRect = () =>
      new DOMRect(0, 0, 320, 240);
    document.body.append(tile);

    const media = resolveMediaTargetFromHitElements([tile], 40, 40);
    expect(media).toEqual({
      kind: 'image',
      mediaUrl: 'https://cdn.example.com/hero.webp',
    });

    tile.remove();
  });
});

describe('resolveMediaTargetFromDragEvent', () => {
  it('prefers the actual image under a draggable link over its wrapper', () => {
    const link = document.createElement('a');
    link.href = 'https://example.com/gallery';
    const image = document.createElement('img');
    image.src = 'https://cdn.example.com/asset.webp';
    link.append(image);
    document.body.append(link);

    const event = {
      composedPath: () => [image, link, document.body, document.documentElement, document],
      dataTransfer: null,
      clientX: 0,
      clientY: 0,
    } as unknown as DragEvent;

    expect(resolveMediaTargetFromDragEvent(document, event)).toEqual({
      kind: 'image',
      mediaUrl: 'https://cdn.example.com/asset.webp',
    });
    expect(findMediaElementFromDragEvent(document, event)).toBe(image);
    link.remove();
  });

  it('uses uri-list drag data when the site drags a proxy element', () => {
    const event = {
      composedPath: () => [document.body, document.documentElement, document],
      dataTransfer: {
        getData: (type: string) => type === 'text/uri-list'
          ? '# browser metadata\nhttps://cdn.example.com/video.mp4\n'
          : '',
      },
      clientX: Number.NaN,
      clientY: Number.NaN,
    } as unknown as DragEvent;

    expect(resolveMediaTargetFromDragEvent(document, event)).toEqual({
      kind: 'video',
      mediaUrl: 'https://cdn.example.com/video.mp4',
    });
  });

  it('does not treat an anchor page URL as an image', () => {
    const event = {
      composedPath: () => [document.body, document.documentElement, document],
      dataTransfer: {
        getData: (type: string) => type === 'text/uri-list'
          ? 'https://example.com/article/42'
          : type === 'text/html'
            ? '<a href="https://example.com/article/42">article</a>'
            : 'https://example.com/article/42',
      },
      clientX: Number.NaN,
      clientY: Number.NaN,
    } as unknown as DragEvent;

    expect(resolveMediaTargetFromDragEvent(document, event)).toBeNull();
  });

  it('recognizes an SVG image element used by canvas-like galleries', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    image.setAttribute('href', 'https://cdn.example.com/vector-preview.png');
    svg.append(image);
    document.body.append(svg);

    const event = {
      composedPath: () => [image, svg, document.body, document.documentElement, document],
      dataTransfer: null,
      clientX: 0,
      clientY: 0,
    } as unknown as DragEvent;

    expect(resolveMediaTargetFromDragEvent(document, event)).toEqual({
      kind: 'image',
      mediaUrl: 'https://cdn.example.com/vector-preview.png',
    });
    svg.remove();
  });

  it('keeps the local image element for the file-page upload fallback', () => {
    const image = document.createElement('img');
    image.src = 'file:///C:/Pictures/shot.png';
    document.body.append(image);

    const event = {
      composedPath: () => [image, document.body, document.documentElement, document],
      dataTransfer: null,
      clientX: 0,
      clientY: 0,
    } as unknown as DragEvent;

    const media = resolveMediaTargetFromDragEvent(document, event);
    expect(media?.kind).toBe('image');
    expect(media?.mediaUrl).toBe('file:///C:/Pictures/shot.png');
    expect(media?.sourceElement).toBe(image);
    image.remove();
  });
});
