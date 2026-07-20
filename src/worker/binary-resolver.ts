import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Binary path resolution for FFmpeg/ffprobe and OIIO oiiotool.
 *
 * Resolution order:
 *   1. Environment variable (SERPENT_FFMPEG_PATH / SERPENT_OIIO_PATH)
 *   2. Bundled path under process.resourcesPath (packaged app)
 *   3. Dev unpackaged: `<cwd>/resources/<tool>/<platform>/`
 *   4. System PATH (bare command name)
 *
 * Main also injects absolute SERPENT_*_PATH when forking the Library Worker
 * (`media-binary-env.ts`) because Electron GUI / UtilityProcess PATH often
 * omits user-installed binaries while Chromium hover preview still works.
 */

function platformBinaryName(baseName: string): string {
  if (process.platform === 'win32') return `${baseName}.exe`;
  return baseName;
}

function platformDirectory(): string {
  if (process.platform === 'win32') return 'win32-x64';
  return process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
}

/**
 * Executability is platform-specific: POSIX has a real execute permission
 * bit, while Windows decides runnability by extension and PE validation at
 * spawn time (Node maps X_OK to F_OK there, so an X_OK check would accept
 * any existing file). On both platforms a directory at the bundled path must
 * be rejected — accessSync alone would accept it.
 */
function isRunnableBundledBinary(filePath: string): boolean {
  try {
    if (!statSync(filePath).isFile()) return false;
    if (process.platform !== 'win32') {
      accessSync(filePath, constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function resolveBundledBinary(
  binaryName: string,
  toolDir: string,
): string | undefined {
  const fileName = platformBinaryName(binaryName);
  const platform = platformDirectory();
  const relative = path.join(toolDir, platform, fileName);
  const candidates: string[] = [];

  if (
    typeof process.resourcesPath === 'string' &&
    process.resourcesPath.length > 0
  ) {
    // Packaged: forge `extraResource: ['resources']` → Resources/resources/…
    candidates.push(path.join(process.resourcesPath, 'resources', relative));
    // Some packagers flatten so binaries sit directly under Resources/…
    candidates.push(path.join(process.resourcesPath, relative));
  }

  // Dev: electron-forge typically keeps cwd at the project root.
  candidates.push(path.join(process.cwd(), 'resources', relative));

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (isRunnableBundledBinary(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Resolve the FFmpeg binary path.
 *
 * Priority: SERPENT_FFMPEG_PATH env > bundled/dev resources > 'ffmpeg' (PATH).
 */
export function resolveFfmpegPath(): string {
  const envPath = process.env['SERPENT_FFMPEG_PATH'];
  if (envPath) return envPath;

  const bundled = resolveBundledBinary('ffmpeg', 'ffmpeg');
  if (bundled) return bundled;

  return platformBinaryName('ffmpeg');
}

/**
 * Resolve the ffprobe binary path.
 *
 * If SERPENT_FFMPEG_PATH is set, ffprobe is resolved in the same directory.
 * Otherwise: bundled/dev resources > 'ffprobe' (PATH).
 */
export function resolveFfprobePath(): string {
  const envFfmpeg = process.env['SERPENT_FFMPEG_PATH'];
  if (envFfmpeg) {
    return path.join(path.dirname(envFfmpeg), platformBinaryName('ffprobe'));
  }

  const bundled = resolveBundledBinary('ffprobe', 'ffmpeg');
  if (bundled) return bundled;

  return platformBinaryName('ffprobe');
}

/**
 * Resolve the oiiotool binary path.
 *
 * Priority: SERPENT_OIIO_PATH env > bundled/dev resources > 'oiiotool' (PATH).
 */
export function resolveOiiotoolPath(): string {
  const envPath = process.env['SERPENT_OIIO_PATH'];
  if (envPath) return envPath;

  const bundled = resolveBundledBinary('oiiotool', 'oiio');
  if (bundled) return bundled;

  return platformBinaryName('oiiotool');
}
