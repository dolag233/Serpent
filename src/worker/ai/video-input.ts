import { readFile } from 'node:fs/promises';

import {
  DEFAULT_AI_ANALYSIS_IMAGE_EDGE_PX,
  normalizeAiAnalysisImageEdgePx,
} from '../../shared/ai-analysis-image';
import { encodeAiAnalysisImage, type AiAnalysisSharpFactory } from './image-input';

interface VideoAiArtifact {
  artifactId: string;
  mimeType: string;
  status: string;
}

/** Narrow Worker surface used to prepare the one visual input for video AI. */
export interface VideoAiInputService {
  getCurrentArtifact(
    libraryId: string,
    assetId: string,
    kind: 'contact_sheet' | 'extracted_metadata',
  ): VideoAiArtifact | null;
  getArtifactAbsolutePath(libraryId: string, artifactId: string): string;
}

export interface LoadVideoAiInputOptions {
  libraryId: string;
  assetId: string;
  maxEdgePx?: number;
  service: VideoAiInputService;
  encodeImage?: (
    input: string | Buffer,
    maxEdgePx: number,
    sharpFn?: AiAnalysisSharpFactory,
  ) => Promise<{ imageBase64: string; mime: 'image/jpeg' }>;
  sharpFn?: AiAnalysisSharpFactory;
}

function describeVideoMetadata(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const metadata = raw as Record<string, unknown>;
  const durationMs = typeof metadata.durationMs === 'number' ? metadata.durationMs : undefined;
  const width = typeof metadata.width === 'number' ? metadata.width : undefined;
  const height = typeof metadata.height === 'number' ? metadata.height : undefined;
  const codec = typeof metadata.videoCodec === 'string' ? metadata.videoCodec : undefined;
  if (durationMs === undefined && width === undefined && height === undefined && !codec) return undefined;
  return [
    `Video dimensions: ${width ?? '?'}x${height ?? '?'}`,
    `Duration: ${durationMs === undefined ? 'unknown' : `${(durationMs / 1000).toFixed(1)}s`}`,
    `Codec: ${codec ?? 'unknown'}`,
  ].join('; ');
}

/**
 * Builds the AI payload for a video from its timestamped contact sheet only.
 * Card posters are a browsing concern and intentionally never gate analysis.
 */
export async function loadVideoAiInput(
  options: LoadVideoAiInputOptions,
): Promise<{
  contactSheetBase64: string;
  contactSheetMime: string;
  mime: string;
  contactSheetDescription: string | undefined;
}> {
  const contactSheet = options.service.getCurrentArtifact(
    options.libraryId,
    options.assetId,
    'contact_sheet',
  );
  if (!contactSheet || contactSheet.status !== 'ready' || !contactSheet.mimeType.startsWith('image/')) {
    throw new Error('A ready video contact sheet is required for AI analysis.');
  }

  const contactSheetPath = options.service.getArtifactAbsolutePath(
    options.libraryId,
    contactSheet.artifactId,
  );
  const bytes = await readFile(contactSheetPath);
  const maxEdgePx = normalizeAiAnalysisImageEdgePx(
    options.maxEdgePx ?? DEFAULT_AI_ANALYSIS_IMAGE_EDGE_PX,
  );
  let contactSheetBase64: string;
  let contactSheetMime: string;
  try {
    const encoded = await (options.encodeImage ?? encodeAiAnalysisImage)(
      bytes,
      maxEdgePx,
      options.sharpFn,
    );
    contactSheetBase64 = encoded.imageBase64;
    contactSheetMime = encoded.mime;
  } catch {
    contactSheetBase64 = bytes.toString('base64');
    contactSheetMime = contactSheet.mimeType;
  }

  let contactSheetDescription: string | undefined;
  const metadata = options.service.getCurrentArtifact(
    options.libraryId,
    options.assetId,
    'extracted_metadata',
  );
  if (metadata?.status === 'ready') {
    try {
      const metadataPath = options.service.getArtifactAbsolutePath(
        options.libraryId,
        metadata.artifactId,
      );
      contactSheetDescription = describeVideoMetadata(
        JSON.parse(await readFile(metadataPath, 'utf-8')),
      );
    } catch {
      // Metadata is contextual only; the contact sheet remains a valid input.
    }
  }

  return {
    contactSheetBase64,
    contactSheetMime,
    mime: contactSheetMime,
    contactSheetDescription,
  };
}
