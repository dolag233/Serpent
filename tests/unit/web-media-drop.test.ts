import { describe, expect, it } from 'vitest';

import { extractWebMediaDrop } from '../../src/preload/web-media-drop';

describe('extractWebMediaDrop', () => {
  it('extracts an absolute image URL but does not mistake a wrapping link for the source page', () => {
    expect(extractWebMediaDrop({
      html: '<a href="https://example.com/gallery/42"><img alt="art" src="https://cdn.example.com/art.png?size=2&amp;dpr=1"></a>',
      uriList: '',
    })).toEqual({
      mediaType: 'image',
      mediaUrl: 'https://cdn.example.com/art.png?size=2&dpr=1',
    });
  });

  it.each([
    ['video', '<video src="https://media.example.com/clip.mp4"></video>'],
    ['video', '<video><source src="https://media.example.com/clip.webm"></video>'],
  ] as const)('extracts %s media from HTML', (mediaType, html) => {
    expect(extractWebMediaDrop({ html, uriList: '' })).toEqual({
      mediaType,
      mediaUrl: expect.stringMatching(/^https:\/\/media\.example\.com\/clip\./),
    });
  });

  it('uses the first HTTP(S) URI-list entry when HTML has no media element', () => {
    expect(extractWebMediaDrop({
      html: '<p>dragged media</p>',
      uriList: '# title\r\nhttps://cdn.example.com/reference.tiff\r\nhttps://ignored.example.com/other.png',
    })).toEqual({ mediaUrl: 'https://cdn.example.com/reference.tiff' });
  });

  it('does not treat the media URL itself as a source page URL', () => {
    expect(extractWebMediaDrop({
      html: '<img src="https://example.com/image.jpg">',
      uriList: 'https://example.com/image.jpg',
    })).toEqual({ mediaType: 'image', mediaUrl: 'https://example.com/image.jpg' });
  });

  it('does not trust an unrelated anchor outside the dragged media structure', () => {
    expect(extractWebMediaDrop({
      html: '<a href="https://example.com/unrelated">other</a><img src="https://cdn.example.com/image.jpg">',
      uriList: '',
    })).toEqual({ mediaType: 'image', mediaUrl: 'https://cdn.example.com/image.jpg' });
  });

  it.each([
    { html: '<img src="file:///etc/passwd">', uriList: '' },
    { html: '<video src="javascript:alert(1)"></video>', uriList: '' },
    { html: '', uriList: 'data:image/png;base64,AA==' },
    { html: '<img src="https://user:secret@example.com/image.png">', uriList: '' },
  ])('rejects non-HTTP or credential-bearing candidates', (input) => {
    expect(() => extractWebMediaDrop(input)).toThrowError('WEB_MEDIA_URL_INVALID');
  });

  it('reports when the drop does not contain a media candidate', () => {
    expect(() => extractWebMediaDrop({ html: '<strong>text</strong>', uriList: '# empty' }))
      .toThrowError('WEB_MEDIA_NOT_FOUND');
  });

  it('rejects oversized drag payloads before parsing', () => {
    expect(() => extractWebMediaDrop({ html: 'x'.repeat(262_145), uriList: '' }))
      .toThrowError('WEB_MEDIA_DROP_TOO_LARGE');
  });
});
