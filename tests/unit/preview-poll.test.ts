import { describe, expect, it } from 'vitest';

import {
  needsDirectPlaybackGate,
  nextDirectApprovedState,
  samePreviewPlayback,
  shouldContinuePreviewPolling,
} from '../../src/renderer/preview-poll';

const directReady = {
  status: 'ready' as const,
  mediaType: 'video',
  playbackMode: 'source',
  sourceCodecs: ['avc1.42E01E'],
  url: 'serpent://source/lib/asset?revision=r1',
  playbackToken: 'asset:r1',
  kind: 'source',
};

describe('preview poll policy (BUG-VIEWER-001)', () => {
  it('gates only direct-play videos that advertise codecs', () => {
    expect(needsDirectPlaybackGate(directReady)).toBe(true);
    expect(
      needsDirectPlaybackGate({
        ...directReady,
        playbackMode: 'proxy',
        kind: 'webm_proxy',
      }),
    ).toBe(false);
    expect(
      needsDirectPlaybackGate({
        ...directReady,
        sourceCodecs: [],
      }),
    ).toBe(false);
  });

  it('stops polling once ready URL is playable', () => {
    expect(shouldContinuePreviewPolling(null, false)).toBe(true);
    expect(
      shouldContinuePreviewPolling({ status: 'pending' }, false),
    ).toBe(true);
    expect(shouldContinuePreviewPolling(directReady, false)).toBe(true);
    expect(shouldContinuePreviewPolling(directReady, true)).toBe(false);
    expect(
      shouldContinuePreviewPolling(
        { ...directReady, playbackMode: 'proxy', sourceCodecs: undefined },
        false,
      ),
    ).toBe(false);
    expect(
      shouldContinuePreviewPolling({ status: 'failed' }, false),
    ).toBe(false);
  });

  it('keeps polling while source color metadata is being warmed', () => {
    expect(
      shouldContinuePreviewPolling(
        { ...directReady, mediaType: 'image', colorSpacePending: true },
        true,
      ),
    ).toBe(true);
  });

  it('does not revoke directApproved on identical playback identity', () => {
    const first = nextDirectApprovedState({
      resolution: directReady,
      previousIdentity: null,
      previousApproved: false,
    });
    expect(first.approved).toBe(false);

    const afterCapability = nextDirectApprovedState({
      resolution: directReady,
      previousIdentity: first.identity,
      previousApproved: true,
    });
    expect(afterCapability.approved).toBe(true);

    const polledAgain = nextDirectApprovedState({
      resolution: { ...directReady },
      previousIdentity: afterCapability.identity,
      previousApproved: true,
    });
    expect(polledAgain.approved).toBe(true);
  });

  it('treats identical playback fields as unchanged', () => {
    expect(samePreviewPlayback(directReady, { ...directReady })).toBe(true);
    expect(
      samePreviewPlayback(directReady, {
        ...directReady,
        url: 'serpent://source/lib/asset?revision=r2',
      }),
    ).toBe(false);
  });
});
