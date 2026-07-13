import { readFile } from 'node:fs/promises';

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
  generateThumbnail(input: { libraryId: string; assetId: string }): Promise<{ artifactId: string }>;
  getArtifactAbsolutePath(libraryId: string, artifactId: string): string;
}

/**
 * Loads only Serpent's bounded 512px derivative for cloud analysis. The
 * original asset path is deliberately absent from this interface so TIFF,
 * EXR, and other large sources cannot accidentally be uploaded.
 */
export async function loadAiImageInput(
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
