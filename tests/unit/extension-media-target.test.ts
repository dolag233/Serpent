// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';

import {
  extractHttpUrlFromCssBackgroundImage,
  isHttpUrl,
  pickLargestSrcsetUrl,
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
