import { describe, expect, it, vi } from 'vitest';

import {
  DirectPlayCapabilityService,
  type DirectPlayCapabilityCache,
  type DirectPlayMediaDescriptor,
} from '../../src/renderer/direct-play-capability';

const H264_MP4: DirectPlayMediaDescriptor = {
  container: 'mp4',
  mimeType: 'video/mp4',
  codecs: ['avc1.640028', 'mp4a.40.2'],
};

function createService(options: {
  platform?: string;
  arch?: string;
  canPlayType?: '' | 'maybe' | 'probably';
  probeResult?: boolean;
  cache?: DirectPlayCapabilityCache;
} = {}) {
  const probe = vi.fn().mockResolvedValue(options.probeResult ?? true);
  const canPlayType = vi.fn().mockReturnValue(options.canPlayType ?? 'probably');
  const service = new DirectPlayCapabilityService({
    runtime: { platform: options.platform ?? 'darwin', arch: options.arch ?? 'arm64' },
    canPlayType,
    probeDirectLoad: probe,
    cache: options.cache,
  });
  return { canPlayType, probe, service };
}

describe('DirectPlayCapabilityService', () => {
  it.each(['avi', 'wmv', 'unknown'] as const)(
    'routes %s and unknown containers directly to a proxy',
    async (container) => {
      const { canPlayType, probe, service } = createService();

      await expect(service.decide({
        container,
        mimeType: container === 'unknown' ? null : `video/${container}`,
        codecs: ['some-codec'],
      })).resolves.toEqual({ mode: 'proxy', reason: 'container_requires_proxy' });
      expect(canPlayType).not.toHaveBeenCalled();
      expect(probe).not.toHaveBeenCalled();
    },
  );

  it('does not optimistically direct-play a candidate with unknown codec metadata', async () => {
    const { canPlayType, probe, service } = createService();

    await expect(service.decide({
      container: 'mp4',
      mimeType: 'video/mp4',
      codecs: [],
    })).resolves.toEqual({ mode: 'proxy', reason: 'media_capability_unknown' });
    expect(canPlayType).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
  });

  it('uses the MIME and RFC 6381 codecs for canPlayType before probing', async () => {
    const { canPlayType, probe, service } = createService({ canPlayType: '' });

    const decision = await service.decide(H264_MP4);

    expect(decision).toMatchObject({ mode: 'proxy', reason: 'can_play_type_rejected' });
    expect(canPlayType).toHaveBeenCalledWith(
      'video/mp4; codecs="avc1.640028, mp4a.40.2"',
    );
    expect(probe).not.toHaveBeenCalled();
  });

  it('requires a successful injected real-load probe before allowing direct play', async () => {
    const supported = createService({ canPlayType: 'maybe', probeResult: true });
    const rejected = createService({ canPlayType: 'probably', probeResult: false });

    await expect(supported.service.decide(H264_MP4)).resolves.toMatchObject({
      mode: 'direct',
      reason: 'real_load_supported',
    });
    await expect(rejected.service.decide(H264_MP4)).resolves.toMatchObject({
      mode: 'proxy',
      reason: 'real_load_rejected',
    });
  });

  it('deduplicates concurrent and later real-load probes for one runtime capability', async () => {
    let finishProbe!: (supported: boolean) => void;
    const probePromise = new Promise<boolean>((resolve) => { finishProbe = resolve; });
    const probe = vi.fn().mockReturnValue(probePromise);
    const service = new DirectPlayCapabilityService({
      runtime: { platform: 'darwin', arch: 'arm64' },
      canPlayType: () => 'probably',
      probeDirectLoad: probe,
    });

    const first = service.decide(H264_MP4);
    const concurrent = service.decide(H264_MP4);
    expect(probe).toHaveBeenCalledTimes(1);
    finishProbe(true);

    await expect(Promise.all([first, concurrent])).resolves.toMatchObject([
      { mode: 'direct' },
      { mode: 'direct' },
    ]);
    await service.decide(H264_MP4);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('keys a shared cache by platform, architecture, container and codecs', async () => {
    const cache: DirectPlayCapabilityCache = new Map();
    const darwin = createService({ platform: 'darwin', arch: 'arm64', cache });
    const windows = createService({ platform: 'win32', arch: 'x64', cache });

    const darwinDecision = await darwin.service.decide(H264_MP4);
    await darwin.service.decide({ ...H264_MP4, codecs: [...H264_MP4.codecs].reverse() });
    const windowsDecision = await windows.service.decide(H264_MP4);

    expect(darwin.probe).toHaveBeenCalledTimes(1);
    expect(windows.probe).toHaveBeenCalledTimes(1);
    expect(darwinDecision.cacheKey).toContain('darwin|arm64|mp4');
    expect(windowsDecision.cacheKey).toContain('win32|x64|mp4');
  });

  it('does not let one rejected real-load probe poison later assets with the same codec', async () => {
    const probe = vi.fn().mockRejectedValue(new Error('media element failed'));
    const service = new DirectPlayCapabilityService({
      runtime: { platform: 'darwin', arch: 'arm64' },
      canPlayType: () => 'probably',
      probeDirectLoad: probe,
    });

    await expect(service.decide(H264_MP4)).resolves.toMatchObject({
      mode: 'proxy',
      reason: 'real_load_rejected',
    });
    await service.decide(H264_MP4);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('allows only one proxy request after direct playback fails for a revision', () => {
    const { service } = createService();

    expect(service.claimProxyFallback('asset-1:revision-1').shouldRequestProxy).toBe(true);
    expect(service.claimProxyFallback('asset-1:revision-1').shouldRequestProxy).toBe(false);
    expect(service.claimProxyFallback('asset-1:revision-2').shouldRequestProxy).toBe(true);

    service.forgetPlayback('asset-1:revision-1');
    expect(service.claimProxyFallback('asset-1:revision-1').shouldRequestProxy).toBe(true);
    expect(() => service.claimProxyFallback('   ')).toThrow('playbackKey must not be empty.');
  });
});
