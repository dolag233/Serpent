import {
  FBX_GLB_ARTIFACT_KIND,
  FBX_GLB_GENERATOR_VERSION,
  type FbxConversionStats,
  type FbxConvertErrorCode,
} from '../../shared/fbx-conversion';
import { LibraryServiceError } from '../library-service';
import type { LibraryService } from '../library-service';
import { convertFbxToGlb, resolveConvertedGlb } from './converter';

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
interface InFlightConversion {
  controller: AbortController;
  promise: Promise<FbxConvertCommandResult>;
  waiters: number;
}

const inFlight = new Map<string, InFlightConversion>();

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
  signal?: AbortSignal,
): Promise<FbxConvertCommandResult> {
  throwIfAborted(signal);
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
  if (existing) return await waitForConversion(existing, signal);

  const controller = new AbortController();
  const entry: InFlightConversion = {
    controller,
    promise: runConversion(libraryService, command, controller.signal).finally(() => {
      if (inFlight.get(key) === entry) inFlight.delete(key);
    }),
    waiters: 0,
  };
  inFlight.set(key, entry);
  return await waitForConversion(entry, signal);
}

async function waitForConversion(
  entry: InFlightConversion,
  signal?: AbortSignal,
): Promise<FbxConvertCommandResult> {
  entry.waiters += 1;
  try {
    return await waitForAbortable(entry.promise, signal);
  } finally {
    entry.waiters -= 1;
    if (entry.waiters === 0 && !entry.controller.signal.aborted) {
      entry.controller.abort(new Error('All FBX conversion waiters cancelled.'));
    }
  }
}

function waitForAbortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(signal.reason instanceof Error
      ? signal.reason
      : new Error('FBX conversion request aborted.'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      cleanup();
      reject(signal.reason instanceof Error ? signal.reason : new Error('FBX conversion request aborted.'));
    };
    const cleanup = (): void => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

async function runConversion(
  libraryService: LibraryService,
  command: { libraryId: string; assetId: string },
  signal?: AbortSignal,
): Promise<FbxConvertCommandResult> {
  throwIfAborted(signal);
  let sourcePath: string;
  try {
    sourcePath = libraryService.resolveAssetPath(command.libraryId, command.assetId);
  } catch (error) {
    if (error instanceof LibraryServiceError) {
      return { status: 'failed', errorCode: 'FBX_SOURCE_NOT_FOUND', reason: error.code };
    }
    throw error;
  }

  // The WASM bridge and its serialized module queue are local, disk-bound
  // work. Do not turn an arbitrary wall-clock guess into a conversion failure.
  const result = await convertFbxToGlb({ sourcePath, signal });
  throwIfAborted(signal);

  if (!result.ok) {
    return { status: 'failed', errorCode: result.failure.errorCode, reason: result.failure.reason };
  }

  let artifact: { artifactId: string; filePath: string };
  try {
    throwIfAborted(signal);
    artifact = libraryService.writeDerivedArtifact({
      libraryId: command.libraryId,
      assetId: command.assetId,
      kind: FBX_GLB_ARTIFACT_KIND,
      mimeType: 'model/gltf-binary',
      bytes: result.output.glb,
      generatorVersion: FBX_GLB_GENERATOR_VERSION,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
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

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('FBX conversion aborted.');
  }
}
