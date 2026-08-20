/**
 * H.264 proxy encoder preference. Listing an encoder in `ffmpeg -encoders`
 * is not proof that it can actually encode; callers must probe a 1-frame
 * encode before treating a hardware name as usable.
 */
export const H264_PROXY_ENCODER_CANDIDATES = [
  'h264_videotoolbox',
  'h264_mf',
  'h264_nvenc',
  'h264_qsv',
  'h264_amf',
  'libopenh264',
] as const;

export function parseFfmpegEncoderTokens(stdoutAndStderr: string): Set<string> {
  return new Set(stdoutAndStderr.split(/\s+/u).filter(Boolean));
}

export function listedH264ProxyEncoders(available: Set<string>): string[] {
  return H264_PROXY_ENCODER_CANDIDATES.filter((name) => available.has(name));
}

export function encoderUsesHardwareName(encoder: string): boolean {
  return /videotoolbox|nvenc|qsv|amf|_mf$/u.test(encoder);
}

export function ffmpegOneFrameEncodeArgs(
  encoder: string,
  inputPath: string,
  outputPath: string,
): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    inputPath,
    '-an',
    '-c:v',
    encoder,
    ...(encoder === 'h264_videotoolbox' ? ['-realtime', 'true'] : []),
    '-threads',
    '1',
    '-frames:v',
    '1',
    '-b:v',
    '100k',
    '-pix_fmt',
    'yuv420p',
    outputPath,
  ];
}
