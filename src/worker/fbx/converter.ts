import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  FBX_GLB_ARTIFACT_KIND,
  FBX_GLB_GENERATOR_VERSION,
  type FbxConversionStats,
} from '../../shared/fbx-conversion';
import type {
  FbxBridgeError,
  FbxDescriptor,
} from './descriptor';
import { buildGlb, type ResolvedTexture } from './glb-builder';
import { parseFbxBytes } from './wasm-loader';

export interface ConvertFbxInput {
  /** Absolute path of the source FBX file. */
  sourcePath: string;
  maxTriangles?: number;
}

export interface ConvertFbxOutput {
  glb: Buffer;
  stats: FbxConversionStats;
  warnings: string[];
  missingTextures: string[];
  sourceUnitMeters: number;
}

export interface ConvertFbxFailure {
  errorCode: 'FBX_SOURCE_NOT_FOUND' | 'FBX_NOT_FBX' | 'FBX_LIMIT_EXCEEDED' |
    'FBX_WASM_UNAVAILABLE' | 'FBX_NO_MESHES' | 'FBX_CONVERSION_FAILED';
  reason?: string;
}

/**
 * Convert an FBX file to a GLB buffer. Pure filesystem + WASM pipeline, no
 * library/DB access — the caller owns caching and artifacts.
 */
export async function convertFbxToGlb(
  input: ConvertFbxInput,
): Promise<{ ok: true; output: ConvertFbxOutput } | { ok: false; failure: ConvertFbxFailure }> {
  try {
    const stat = statSync(input.sourcePath);
    if (!stat.isFile()) {
      return { ok: false, failure: { errorCode: 'FBX_SOURCE_NOT_FOUND' } };
    }
    const sourceBytes = readFileSync(input.sourcePath);
    return await convertFbxBuffer(sourceBytes, {
      sourcePath: input.sourcePath,
      sourceBytes: sourceBytes.length,
      ...(input.maxTriangles === undefined ? {} : { maxTriangles: input.maxTriangles }),
    });
  } catch (error) {
    if (isMissingFileError(error)) {
      return { ok: false, failure: { errorCode: 'FBX_SOURCE_NOT_FOUND' } };
    }
    return {
      ok: false,
      failure: {
        errorCode: 'FBX_CONVERSION_FAILED',
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/** Convert in-memory FBX bytes (used by tests and the file-based entrypoint). */
export async function convertFbxBuffer(
  fbxBytes: Buffer,
  input: { sourcePath: string; sourceBytes?: number; maxTriangles?: number },
): Promise<{ ok: true; output: ConvertFbxOutput } | { ok: false; failure: ConvertFbxFailure }> {
  let packed: Buffer;
  try {
    packed = await parseFbxBytes(fbxBytes, {
      filename: input.sourcePath,
      ...(input.maxTriangles === undefined ? {} : { maxTriangles: input.maxTriangles }),
    });
  } catch (error) {
    return mapBridgeFailure(error);
  }

  let descriptor: FbxDescriptor;
  try {
    descriptor = decodeDescriptor(packed);
  } catch (error) {
    return {
      ok: false,
      failure: {
        errorCode: 'FBX_CONVERSION_FAILED',
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
  if (descriptor.meta.totalTriangles === 0 || descriptor.meta.meshCount === 0) {
    return {
      ok: false,
      failure: { errorCode: 'FBX_NO_MESHES' },
    };
  }

  const textures = resolveExternalTextures(descriptor, input.sourcePath);
  const built = await buildGlb({
    descriptor,
    packed,
    textures,
    sourceBytes: input.sourceBytes ?? fbxBytes.length,
  });

  return {
    ok: true,
    output: {
      glb: built.glb,
      stats: built.stats,
      warnings: built.warnings,
      missingTextures: built.unresolvedTextures,
      sourceUnitMeters: descriptor.meta.unitMeters,
    },
  };
}

function mapBridgeFailure(
  error: unknown,
): { ok: false; failure: ConvertFbxFailure } {
  const message = error instanceof Error ? error.message : String(error);
  let bridgeError: FbxBridgeError;
  try {
    bridgeError = JSON.parse(message) as FbxBridgeError;
  } catch {
    if (message.startsWith('UFBX_WASM_MISSING') || message.startsWith('UFBX_WASM')) {
      return { ok: false, failure: { errorCode: 'FBX_WASM_UNAVAILABLE', reason: message } };
    }
    return { ok: false, failure: { errorCode: 'FBX_CONVERSION_FAILED', reason: message } };
  }
  if (bridgeError.code === 'limits') {
    return {
      ok: false,
      failure: { errorCode: 'FBX_LIMIT_EXCEEDED', reason: bridgeError.message },
    };
  }
  return {
    ok: false,
    failure: {
      errorCode: 'FBX_NOT_FBX',
      reason: bridgeError.message ?? `ufbx error type ${bridgeError.ufbxType ?? 'unknown'}`,
    },
  };
}

function decodeDescriptor(packed: Buffer): FbxDescriptor {
  if (packed.length < 4) throw new Error('Bridge output too short.');
  const jsonLen = packed.readUInt32LE(0);
  if (jsonLen <= 0 || 4 + jsonLen > packed.length) {
    throw new Error('Bridge output has an invalid JSON length prefix.');
  }
  const parsed = JSON.parse(packed.subarray(4, 4 + jsonLen).toString('utf8')) as FbxDescriptor;
  if (!parsed.ok || !parsed.meta || !Array.isArray(parsed.meshes)) {
    throw new Error('Bridge descriptor is malformed.');
  }
  // The bridge writes SIZE_MAX as the "absent" marker for optional blobs
  // (4294967295 on wasm32, -1 after signed casts).
  for (const mesh of parsed.meshes) {
    if (mesh.normalOffset === -1 || mesh.normalOffset >= 0xffffffff) {
      mesh.normalOffset = Number.MAX_SAFE_INTEGER;
    }
    if (mesh.uvOffset === -1 || mesh.uvOffset >= 0xffffffff) {
      mesh.uvOffset = Number.MAX_SAFE_INTEGER;
    }
  }
  return parsed;
}

/**
 * Resolve external (non-embedded) texture files. The bridge reports their
 * relative filename; the model directory is the base. Only same-directory and
 * subdirectory relative paths are accepted (spec 3D-12; absolute paths and
 * `..` escapes are recorded as missing).
 */
function resolveExternalTextures(
  descriptor: FbxDescriptor,
  sourcePath: string,
): Map<number, ResolvedTexture> {
  // Embedded textures are read directly from the bridge output by the GLB
  // builder; only external files are resolved here.
  const resolved = new Map<number, ResolvedTexture>();
  const modelDir = path.dirname(sourcePath);
  for (const tex of descriptor.textures) {
    if (tex.embedded) continue;
    const relativePath = tex.relativeFilename.replaceAll('\\', '/');
    if (!isSafeRelativeTexturePath(relativePath)) continue;
    const candidate = path.join(modelDir, ...relativePath.split('/'));
    try {
      const stat = statSync(candidate);
      if (!stat.isFile() || stat.size === 0) continue;
      const bytes = readFileSync(candidate);
      const mime = detectMime(bytes);
      if (mime) {
        resolved.set(tex.index, { mimeType: mime, bytes });
      }
    } catch {
      // missing or unreadable: recorded via missingTextures by the builder
    }
  }
  return resolved;
}

function isSafeRelativeTexturePath(relativePath: string): boolean {
  if (relativePath === '' || relativePath.startsWith('/')) return false;
  if (/^[a-zA-Z]:/.test(relativePath)) return false; // drive-letter absolute
  const segments = relativePath.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') return false;
  }
  return true;
}

function detectMime(bytes: Buffer): 'image/png' | 'image/jpeg' | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  return null;
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}

/**
 * Read the current GLB artifact for an asset, if the cache is fresh
 * (generator version matches). Pure resolver for later slices (viewer
 * resolution in slice C / thumbnail in slice E); no conversion is triggered.
 */
export function resolveConvertedGlb(
  library: {
    getCurrentArtifact(
      libraryId: string,
      assetId: string,
      kind: string,
    ): {
      artifactId: string;
      filePath: string;
      mimeType: string;
      generatorVersion: string;
      status: string;
      errorCode: string | null;
    } | null;
  },
  libraryId: string,
  assetId: string,
): { artifactId: string; filePath: string; mimeType: string } | null {
  const artifact = library.getCurrentArtifact(libraryId, assetId, FBX_GLB_ARTIFACT_KIND);
  if (!artifact || artifact.status !== 'ready') return null;
  if (artifact.generatorVersion !== FBX_GLB_GENERATOR_VERSION) return null;
  return {
    artifactId: artifact.artifactId,
    filePath: artifact.filePath,
    mimeType: artifact.mimeType,
  };
}
