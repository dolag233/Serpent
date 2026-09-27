import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import { importNoConflict } from './import-no-conflict';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function libraryWithZip(): { service: LibraryService; libraryId: string; assetId: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-plugin-zip-'));
  roots.push(root);
  const service = new LibraryService();
  const created = service.createLibrary({ displayName: 'ZipPlugin', selectedParentPath: root });
  writeFileSync(path.join(root, 'bundle.zip'), 'not-a-real-archive');
  importNoConflict(service, created.libraryId, path.join(root, 'bundle.zip'));
  const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;
  return { service, libraryId: created.libraryId, assetId: asset.assetId };
}

describe('plugin thumbnail extensions', () => {
  it('does not enqueue a zip until a thumbnail provider claims it', () => {
    const { service, libraryId } = libraryWithZip();
    expect(service.enqueueThumbnailJobs(libraryId)).toBe(0);
    service.closeAll();
  });

  it('generates a card image for a zip and opens that image in the viewer', async () => {
    const { service, libraryId, assetId } = libraryWithZip();
    service.setPluginThumbnailExtensions(libraryId, ['.zip']);
    expect(service.enqueueThumbnailJobs(libraryId)).toBe(1);

    expect(await service.processThumbnailQueue(libraryId, {
      maxJobs: 1,
      pluginMediaProvider: async ({ assetId: queuedAssetId }) =>
        (await service.writePluginMediaArtifact({
          libraryId,
          assetId: queuedAssetId,
          mimeType: 'image/png',
          bytesBase64: PNG_BASE64,
          providerId: 'zip-thumbnail',
        })).artifactId,
    })).toBe(1);

    expect(service.getCurrentArtifact(libraryId, assetId, 'thumbnail')).toMatchObject({
      status: 'ready',
      mimeType: 'image/png',
      generatorVersion: 'plugin:zip-thumbnail',
      width: 1,
      height: 1,
    });
    expect(service.getPreviewArtifact(libraryId, assetId)).toMatchObject({
      mediaType: 'image',
      status: 'ready',
      mimeType: 'image/png',
    });
    service.closeAll();
  });
});
