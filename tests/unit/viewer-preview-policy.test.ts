import { describe, expect, it } from 'vitest';

import {
  canPresentPreviewMedia,
  resolveViewerPrimarySurface,
  shouldBlockOnPreviewGeneration,
} from '../../src/renderer/viewer-preview-policy';

const nativeImage = {
  status: 'ready' as const,
  mediaType: 'image',
  playbackMode: 'source',
  url: 'serpent://source/lib/asset?revision=r1',
  kind: 'thumbnail',
};

const nativeVideoGated = {
  status: 'ready' as const,
  mediaType: 'video',
  playbackMode: 'source',
  sourceCodecs: ['avc1.42E01E', 'mp4a.40.2'],
  url: 'serpent://source/lib/asset?revision=r1',
  kind: 'webm_proxy',
};

const pendingNoUrl = {
  status: 'pending' as const,
  mediaType: 'video',
  kind: 'webm_proxy',
};

describe('viewer preview policy (REQ-VIEW-002)', () => {
  it('presents ready source/proxy URLs without a blocking generation gate', () => {
    expect(canPresentPreviewMedia(nativeImage)).toBe(true);
    expect(canPresentPreviewMedia(nativeVideoGated)).toBe(true);
    expect(canPresentPreviewMedia(pendingNoUrl)).toBe(false);
    expect(shouldBlockOnPreviewGeneration(nativeImage, true)).toBe(false);
    expect(shouldBlockOnPreviewGeneration(pendingNoUrl, false)).toBe(true);
  });

  it('does not require direct-approval by default for immediate presentation', () => {
    expect(
      resolveViewerPrimarySurface({
        loading: false,
        resolution: nativeVideoGated,
        directApproved: false,
        requireDirectApproval: false,
      }),
    ).toBe('media');

    expect(
      resolveViewerPrimarySurface({
        loading: false,
        resolution: nativeVideoGated,
        directApproved: false,
        requireDirectApproval: true,
      }),
    ).toBe('unavailable');
  });

  it('keeps waiting surface only when there is no playable URL yet', () => {
    expect(
      resolveViewerPrimarySurface({
        loading: false,
        resolution: pendingNoUrl,
        directApproved: false,
      }),
    ).toBe('waiting');

    expect(
      resolveViewerPrimarySurface({
        loading: true,
        resolution: null,
        directApproved: false,
      }),
    ).toBe('loading');

    expect(
      resolveViewerPrimarySurface({
        loading: false,
        resolution: {
          ...pendingNoUrl,
          url: 'serpent://source/lib/asset?revision=r1',
        },
        directApproved: false,
      }),
    ).toBe('media');
  });

  it('marks unsupported formats without a generating gate', () => {
    expect(
      resolveViewerPrimarySurface({
        loading: false,
        resolution: {
          status: 'missing',
          mediaType: 'other',
          errorCode: 'UNSUPPORTED_FORMAT',
          kind: 'thumbnail',
        },
        directApproved: false,
      }),
    ).toBe('unsupported');
  });

  it('presents mip placeholder while full preview is still loading (Serpent-eh07)', () => {
    expect(
      resolveViewerPrimarySurface({
        loading: true,
        resolution: null,
        directApproved: false,
        hasPlaceholder: true,
      }),
    ).toBe('media');
  });
});
