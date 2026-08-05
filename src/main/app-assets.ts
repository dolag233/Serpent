import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { HDRI_PRESETS } from '../shared/hdri-presets';

/**
 * Bundled renderer asset serving for the `serpent://app-assets` route
 * (slice C, Serpent-qvc6).
 *
 * Why this exists: three r185 loaders use `fetch`, and in the packaged app
 * the renderer runs from `file://` where fetch is blocked — so `.hdr`
 * environment maps (and anything else bundled with the renderer) cannot be
 * loaded from their Vite asset URLs. The viewer instead fetches
 * `serpent://app-assets/hdri/<fileName>`, which this module resolves to a
 * real file in both modes:
 *
 * - dev:      <appPath>/src/renderer/assets/hdri/<fileName>
 * - packaged: <appPath>/.vite/renderer/main_window/assets/<base>-<hash>.hdr
 *   (Vite content-hashes the emitted asset; we scan that one directory and
 *   match the preset basename, then verify size + sha256 against the shared
 *   receipt table in src/shared/hdri-presets.ts).
 *
 * Security boundary: only the whitelisted preset file names are resolvable
 * (route must match `hdri/<fileName>` of a known preset); no renderer-supplied
 * path is ever read, and every served file is verified against its receipt.
 * Resolved+verified paths are cached per (appPath, fileName).
 */

export const APP_ASSET_HOST = 'app-assets' as const;

/** Route shape: `hdri/<presetFileName>`. Anything else is rejected. */
const HASHED_HDR_PATTERN = /^([a-z0-9_]+)-[A-Za-z0-9_-]{8,64}\.hdr$/u;

export interface AppAssetFs {
  /** List directory entries (null when the directory does not exist). */
  listDirectory(dir: string): string[] | null;
  fileExists(file: string): boolean;
  /** Read whole file bytes (null when unreadable). */
  readFileBytes(file: string): Buffer | null;
}

const nodeFs: AppAssetFs = {
  listDirectory: (dir) => {
    try {
      return readdirSync(dir);
    } catch {
      return null;
    }
  },
  fileExists: (file) => {
    try {
      return existsSync(file);
    } catch {
      return false;
    }
  },
  readFileBytes: (file) => {
    try {
      return readFileSync(file);
    } catch {
      return null;
    }
  },
};

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Preset lookup by exact file name (route whitelist). */
function presetForFileName(fileName: string) {
  return HDRI_PRESETS.find((preset) => preset.fileName === fileName) ?? null;
}

/** File-system-agnostic path resolution (pure; fs injected for tests). */
export function resolveAppAssetFile(input: {
  route: string;
  appPath: string;
  isPackaged: boolean;
  fs?: AppAssetFs;
}): string | null {
  const route = input.route.replace(/^\/+/u, '').replace(/^hdri\//u, '');
  if (route === input.route.replace(/^\/+/u, '') || route.includes('/')) {
    // Not an `hdri/` route at all, or a nested path — only flat preset names
    // are served.
    return null;
  }
  const preset = presetForFileName(route);
  if (!preset) return null;
  const fs = input.fs ?? nodeFs;

  const base = preset.fileName.replace(/\.hdr$/u, '');
  const candidates: string[] = [];
  if (input.isPackaged) {
    const assetsDir = path.join(
      input.appPath,
      '.vite',
      'renderer',
      'main_window',
      'assets',
    );
    const entries = fs.listDirectory(assetsDir);
    if (entries) {
      for (const entry of entries) {
        const match = HASHED_HDR_PATTERN.exec(entry);
        if (match && match[1] === base) {
          candidates.push(path.join(assetsDir, entry));
        }
      }
    }
  } else {
    candidates.push(
      path.join(input.appPath, 'src', 'renderer', 'assets', 'hdri', preset.fileName),
    );
  }
  return candidates.find((candidate) => fs.fileExists(candidate)) ?? null;
}

/** Verified-path cache: once a file passes size+hash it stays trusted. */
const verifiedPaths = new Map<string, string>();

/**
 * Serve a whitelisted bundled app asset as a `Response` (or null when the
 * route is unknown / the file is missing / the receipt check fails).
 */
export function createAppAssetResponse(input: {
  route: string;
  appPath: string;
  isPackaged: boolean;
  fs?: AppAssetFs;
}): Response | null {
  const fileName = input.route.replace(/^\/+/u, '').replace(/^hdri\//u, '');
  const preset = presetForFileName(fileName);
  if (!preset) return null;
  const cacheKey = `${input.appPath}|${fileName}`;
  const cached = verifiedPaths.get(cacheKey);
  const absolutePath =
    cached ?? resolveAppAssetFile({ ...input, route: input.route });
  if (!absolutePath) return null;

  const fs = input.fs ?? nodeFs;
  if (cached) {
    const bytes = fs.readFileBytes(absolutePath);
    if (!bytes) return null;
    return new Response(toResponseBody(bytes), { headers: hdrHeaders() });
  }
  const bytes = fs.readFileBytes(absolutePath);
  if (!bytes) return null;
  if (bytes.byteLength !== preset.fileSizeBytes || sha256Hex(bytes) !== preset.sha256) {
    // Receipt mismatch: the packaged asset is not the verified Poly Haven
    // file. Fail loudly instead of rendering a corrupted environment.
    return null;
  }
  verifiedPaths.set(cacheKey, absolutePath);
  return new Response(toResponseBody(bytes), { headers: hdrHeaders() });
}

/**
 * Buffer is not a DOM BodyInit (and its ArrayBufferLike view is rejected by
 * the DOM lib in TS 6); copy into a plain ArrayBuffer-backed Uint8Array.
 * The copied payload is small (≤1.7 MB per preset) and uncached.
 */
function toResponseBody(bytes: Buffer): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function hdrHeaders(): Record<string, string> {
  return {
    'content-type': 'image/vnd.radiance',
    'cache-control': 'no-store',
  };
}

/** Test-only hook: drop the verified-path cache (isolates test cases). */
export function resetVerifiedAppAssetPathsForTest(): void {
  verifiedPaths.clear();
}
