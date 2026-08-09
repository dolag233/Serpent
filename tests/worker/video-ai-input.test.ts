import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadVideoAiInput } from '../../src/worker/ai/video-input';

describe('loadVideoAiInput', () => {
  it('uses the contact sheet alone and never asks for a video poster', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-video-ai-input-'));
    const sheetPath = path.join(root, 'sheet.jpg');
    writeFileSync(sheetPath, 'contact-sheet');
    const requestedKinds: string[] = [];

    const input = await loadVideoAiInput({
      libraryId: 'library-1',
      assetId: 'asset-1',
      maxEdgePx: 2048,
      service: {
        getCurrentArtifact: (_libraryId, _assetId, kind) => {
          requestedKinds.push(kind);
          if (kind === 'contact_sheet') {
            return {
              artifactId: 'sheet-1',
              mimeType: 'image/jpeg',
              status: 'ready',
              filePath: 'sheet.jpg',
            };
          }
          return null;
        },
        getArtifactAbsolutePath: () => sheetPath,
      },
      encodeImage: async () => ({
        imageBase64: 'encoded-contact-sheet',
        mime: 'image/jpeg',
      }),
    });

    expect(requestedKinds).toEqual(['contact_sheet', 'extracted_metadata']);
    expect(input).toEqual({
      contactSheetBase64: 'encoded-contact-sheet',
      contactSheetMime: 'image/jpeg',
      mime: 'image/jpeg',
      contactSheetDescription: undefined,
    });
  });
});
