import {
  FBX_CONVERT_TIMEOUT_MS,
  FBX_GLB_ARTIFACT_KIND,
  FBX_GLB_GENERATOR_VERSION,
  FBX_MAX_TRIANGLES,
  type FbxConversionStats,
  type FbxConvertErrorCode,
} from '../../shared/fbx-conversion';
import { LibraryServiceError } from '../library-service';
import type { LibraryService } from '../library-service';
import { convertFbxToGlb, resolveConvertedGlb } from './converter';

/** Hard cap for the GLB artifact (matches the bridge output cap). */
export const FBX_GLB_MAX_BYTES = 1024 * 1024 * 1024;

/** Result payload returned to the Renderer for the `model.convert-fbx` command. */
export type FbxConvertCommandResult =
  | {
      status: 'ready';
      glbArtifactId: string;
      /** Path of the artifact relative to `.serpent/artifacts`. */
      glbRelativePath: string;
      stats?: FbxConversionStats;
      missingTextures: string[];
      warnings: string[];
    }
  | {
      status: 'failed';
      errorCode: FbxConvertErrorCode;
      reason?: string;
    };

/** In-flight deduplication: one conversion per asset at a time. */
const inFlight = new Map<string, Promise<FbxConvertCommandResult>>();

/**
 * Handle the `model.convert-fbx` worker command.
 *
 * Cache: the GLB lives in `.serpent/artifacts` as a `model_glb` artifact keyed
 * by revision (a new source revision invalidates it) plus the converter
 * `generator_version` (a converter upgrade reconverts). Single-flight: a
 * concurrent request for the same asset awaits the same conversion.
 */
export async function handleFbxConvertCommand(
  libraryService: LibraryService,
  command: { libraryId: string; assetId: string },
): Promise<FbxConvertCommandResult> {
  const key = `${command.libraryId}:${command.assetId}`;

  // Cache hit? Fresh artifacts are served without touching the source file.
  const cached = resolveConvertedGlb(libraryService, command.libraryId, command.assetId);
  if (cached) {
    return {
      status: 'ready',
      glbArtifactId: cached.artifactId,
      glbRelativePath: cached.filePath,
      missingTextures: [],
      warnings: [],
    };
  }

  const existing = inFlight.get(key);
  if (existing) return existing;

  const task = runConversion(libraryService, command).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, task);
  return task;
}

async function runConversion(
  libraryService: LibraryService,
  command: { libraryId: string; assetId: string },
): Promise<FbxConvertCommandResult> {
  let sourcePath: string;
  try {
    sourcePath = libraryService.resolveAssetPath(command.libraryId, command.assetId);
  } catch (error) {
    if (error instanceof LibraryServiceError) {
      return { status: 'failed', errorCode: 'FBX_SOURCE_NOT_FOUND', reason: error.code };
    }
    throw error;
  }

  // The WASM bridge is synchronous once started; the timeout guards the whole
  // pipeline (including the module load and the fs reads). A timed-out task
  // keeps occupying its module-queue slot until it finishes, which is the
  // documented cost of single-flight serialization.
  const conversion = convertFbxToGlb({
    sourcePath,
    maxTriangles: FBX_MAX_TRIANGLES,
  });
  let result: Awaited<typeof conversion>;
  try {
    result = await withTimeout(conversion, FBX_CONVERT_TIMEOUT_MS);
  } catch (error) {
    if (isTimeoutError(error)) {
      return { status: 'failed', errorCode: 'FBX_CONVERSION_TIMEOUT' };
    }
    throw error;
  }

  if (!result.ok) {
    return { status: 'failed', errorCode: result.failure.errorCode, reason: result.failure.reason };
  }

  let artifact: { artifactId: string; filePath: string };
  try {
    artifact = libraryService.writeDerivedArtifact({
      libraryId: command.libraryId,
      assetId: command.assetId,
      kind: FBX_GLB_ARTIFACT_KIND,
      mimeType: 'model/gltf-binary',
      bytes: result.output.glb,
      generatorVersion: FBX_GLB_GENERATOR_VERSION,
      maxBytes: FBX_GLB_MAX_BYTES,
    });
  } catch (error) {
    libraryService.reportDiagnostic('fbx-convert.artifact-write', error, {
      libraryId: command.libraryId,
      assetId: command.assetId,
    });
    return {
      status: 'failed',
      errorCode: 'FBX_CONVERSION_FAILED',
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    status: 'ready',
    glbArtifactId: artifact.artifactId,
    glbRelativePath: artifact.filePath,
    stats: result.output.stats,
    missingTextures: result.output.missingTextures,
    warnings: result.output.warnings,
  };
}

const TIMEOUT_SYMBOL = Symbol('fbx-convert-timeout');

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout', { cause: TIMEOUT_SYMBOL })), ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isTimeoutError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'cause' in error &&
    (error as { cause: unknown }).cause === TIMEOUT_SYMBOL
  );
}
