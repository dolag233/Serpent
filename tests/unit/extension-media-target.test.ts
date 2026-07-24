import { describe, expect, it } from 'vitest';

import {
  isHttpUrl,
  pickLargestSrcsetUrl,
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
});
