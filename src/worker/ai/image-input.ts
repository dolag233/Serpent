import { readFile } from 'node:fs/promises';

import {
  DEFAULT_AI_ANALYSIS_IMAGE_EDGE_PX,
  normalizeAiAnalysisImageEdgePx,
} from '../../shared/ai-analysis-image';

interface ThumbnailArtifact {
  artifactId: string;
  mimeType: string;
  status: string;
}

export interface AiImageArtifactService {
  getCurrentArtifact(
    libraryId: string,
    assetId: string,
    kind: string,
  ): ThumbnailArtifact | null;
  // Null for model assets (no Worker raster generator; Serpent-fu2i). AI
  // analysis only reaches this path for images, so null is never consumed.
  generateThumbnail(input: { libraryId: string; assetId: string }): Promise<{ artifactId: string } | null>;
  getArtifactAbsolutePath(libraryId: string, artifactId: string): string;
}

/** Minimal sharp surface used for AI upload encoding (injectable in tests). */
export interface AiAnalysisSharpInstance {
  rotate(): AiAnalysisSharpInstance;
  resize(options: {
    width: number;
    height: number;
    fit: 'inside';
    withoutEnlargement: true;
  }): AiAnalysisSharpInstance;
  jpeg(options: { quality: number; mozjpeg?: boolean }): AiAnalysisSharpInstance;
  toBuffer(): Promise<Buffer>;
}

export type AiAnalysisSharpFactory = (input: string | Buffer) => AiAnalysisSharpInstance;

export interface LoadAiImageInputOptions {
  /** Absolute path of the current asset revision source file. */
  sourcePath: string;
  /** Longest edge in px; defaults to 2048 (2K). */
  maxEdgePx?: number;
  sharpFn?: AiAnalysisSharpFactory;
}

function requireDefaultSharp(): AiAnalysisSharpFactory {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sharp = require('sharp') as AiAnalysisSharpFactory & {
    cache?: (options: { files: number }) => void;
  };
  sharp.cache?.({ files: 0 });
  return sharp;
}

/**
 * Encodes an on-disk or in-memory image so the longest edge does not exceed
 * `maxEdgePx`. Never upscales. Output is JPEG for predictable upload size.
 */
export async function encodeAiAnalysisImage(
  input: string | Buffer,
  maxEdgePx: number,
  sharpFn: AiAnalysisSharpFactory = requireDefaultSharp(),
): Promise<{ imageBase64: string; mime: 'image/jpeg' }> {
  const edge = normalizeAiAnalysisImageEdgePx(maxEdgePx);
  const bytes = await sharpFn(input)
    .rotate()
    .resize({
      width: edge,
      height: edge,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
  return {
    imageBase64: bytes.toString('base64'),
    mime: 'image/jpeg',
  };
}

async function loadReadyThumbnail(
  service: AiImageArtifactService,
  libraryId: string,
  assetId: string,
): Promise<{ imageBase64: string; mime: string; artifactId: string }> {
  let artifact = service.getCurrentArtifact(libraryId, assetId, 'thumbnail');
  if (!artifact || artifact.status !== 'ready') {
    try {
      await service.generateThumbnail({ libraryId, assetId });
    } catch (error) {
      // Automatic media scheduling may have won the same asset race. Reuse
      // its ready derivative; otherwise preserve the real decoder failure.
      artifact = service.getCurrentArtifact(libraryId, assetId, 'thumbnail');
      if (!artifact || artifact.status !== 'ready') throw error;
    }
    if (!artifact || artifact.status !== 'ready') {
      artifact = service.getCurrentArtifact(libraryId, assetId, 'thumbnail');
    }
  }
  if (!artifact || artifact.status !== 'ready' || !artifact.mimeType.startsWith('image/')) {
    throw new Error('A ready image thumbnail is required for AI analysis.');
  }

  const artifactPath = service.getArtifactAbsolutePath(libraryId, artifact.artifactId);
  const bytes = await readFile(artifactPath);
  return {
    imageBase64: bytes.toString('base64'),
    mime: artifact.mimeType,
    artifactId: artifact.artifactId,
  };
}

/**
 * Builds a bounded upload for cloud analysis from the source file when sharp
 * can decode it; otherwise falls back to Serpent's thumbnail derivative and
 * re-encodes it under the same edge cap. Never uploads an unbounded original.
 */
export async function loadAiImageInput(
  service: AiImageArtifactService,
  libraryId: string,
  assetId: string,
  options: LoadAiImageInputOptions,
): Promise<{ imageBase64: string; mime: string; artifactId?: string }> {
  const maxEdgePx = normalizeAiAnalysisImageEdgePx(
    options.maxEdgePx ?? DEFAULT_AI_ANALYSIS_IMAGE_EDGE_PX,
  );
  const sharpFn = options.sharpFn ?? requireDefaultSharp();

  try {
    return await encodeAiAnalysisImage(options.sourcePath, maxEdgePx, sharpFn);
  } catch {
    // TIFF/EXR/odd codecs may fail; the 512px thumbnail is the safe fallback.
    const thumbnail = await loadReadyThumbnail(service, libraryId, assetId);
    try {
      const encoded = await encodeAiAnalysisImage(
        Buffer.from(thumbnail.imageBase64, 'base64'),
        maxEdgePx,
        sharpFn,
      );
      return { ...encoded, artifactId: thumbnail.artifactId };
    } catch {
      return thumbnail;
    }
  }
}
