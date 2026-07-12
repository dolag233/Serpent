import path from 'node:path';

/**
 * Binary path resolution for FFmpeg/ffprobe and OIIO oiiotool.
 *
 * Resolution order:
 *   1. Environment variable (SERPENT_FFMPEG_PATH / SERPENT_OIIO_PATH)
 *   2. Bundled path under process.resourcesPath (packaged app)
 *   3. System PATH (bare command name)
 *
 * The real LGPL-only FFmpeg + static oiiotool binaries are a build/download
 * step; this module resolves whatever binary is at the resolved path and
 * gracefully handles missing binaries at call time.
 */

function platformBinaryName(baseName: string): string {
  if (process.platform === 'win32') return `${baseName}.exe`;
  return baseName;
}

function resolveBundledBinary(
  binaryName: string,
  subdir: string,
): string | undefined {
  // In a packaged Electron app, process.resourcesPath points to the app's
  // Resources directory. Binaries live under resources/<subdir>/.
  if (
    typeof process.resourcesPath === 'string' &&
    process.resourcesPath.length > 0
  ) {
    const bundled = path.join(
      process.resourcesPath,
      'resources',
      subdir,
      platformBinaryName(binaryName),
    );
    return bundled;
  }
  return undefined;
}

/**
 * Resolve the FFmpeg binary path.
 *
 * Priority: SERPENT_FFMPEG_PATH env > bundled > 'ffmpeg' (system PATH).
 */
export function resolveFfmpegPath(): string {
  const envPath = process.env['SERPENT_FFMPEG_PATH'];
  if (envPath) return envPath;

  const platform =
    process.platform === 'win32'
      ? 'win32-x64'
      : process.arch === 'arm64'
        ? 'darwin-arm64'
        : 'darwin-x64';
  const bundled = resolveBundledBinary('ffmpeg', `ffmpeg/${platform}`);
  if (bundled) return bundled;

  return platformBinaryName('ffmpeg');
}

/**
 * Resolve the ffprobe binary path.
 *
 * If SERPENT_FFMPEG_PATH is set, ffprobe is resolved in the same directory.
 * Otherwise: bundled > 'ffprobe' (system PATH).
 */
export function resolveFfprobePath(): string {
  const envFfmpeg = process.env['SERPENT_FFMPEG_PATH'];
  if (envFfmpeg) {
    return path.join(path.dirname(envFfmpeg), platformBinaryName('ffprobe'));
  }

  const platform =
    process.platform === 'win32'
      ? 'win32-x64'
      : process.arch === 'arm64'
        ? 'darwin-arm64'
        : 'darwin-x64';
  const bundled = resolveBundledBinary('ffprobe', `ffmpeg/${platform}`);
  if (bundled) return bundled;

  return platformBinaryName('ffprobe');
}

/**
 * Resolve the oiiotool binary path.
 *
 * Priority: SERPENT_OIIO_PATH env > bundled > 'oiiotool' (system PATH).
 */
export function resolveOiiotoolPath(): string {
  const envPath = process.env['SERPENT_OIIO_PATH'];
  if (envPath) return envPath;

  const platform =
    process.platform === 'win32'
      ? 'win32-x64'
      : process.arch === 'arm64'
        ? 'darwin-arm64'
        : 'darwin-x64';
  const bundled = resolveBundledBinary('oiiotool', `oiio/${platform}`);
  if (bundled) return bundled;

  return platformBinaryName('oiiotool');
}
