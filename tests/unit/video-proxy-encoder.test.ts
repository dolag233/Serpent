import { describe, expect, it } from 'vitest';

import {
  encoderUsesHardwareName,
  ffmpegOneFrameEncodeArgs,
  listedH264ProxyEncoders,
  parseFfmpegEncoderTokens,
} from '../../src/worker/video-proxy-encoder';

describe('video proxy encoder listing', () => {
  it('prefers listed hardware names but does not treat the name as a capability', () => {
    const available = parseFfmpegEncoderTokens(' V..... h264_videotoolbox V..... libx264 V..... libopenh264');
    expect(listedH264ProxyEncoders(available)).toEqual(['h264_videotoolbox', 'libopenh264']);
    expect(encoderUsesHardwareName('h264_videotoolbox')).toBe(true);
    expect(encoderUsesHardwareName('libopenh264')).toBe(false);
    const args = ffmpegOneFrameEncodeArgs(
      'h264_videotoolbox',
      '/tmp/probe.ppm',
      '/tmp/probe.mp4',
    );
    expect(args).toContain('h264_videotoolbox');
    expect(args).toContain('/tmp/probe.ppm');
    expect(args).not.toContain('lavfi');
  });
});
