import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, it } from 'vitest';
import { LibraryService } from '../../src/worker/library-service';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { force: true, recursive: true }); });

it.skipIf(!process.env.TEST_VIDEO)(
    'real video contact sheet via actual ffmpeg (drawtext timestamps)',
    async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-real-video-'));
  roots.push(root);
  const src = process.env.TEST_VIDEO!;
  const service = new LibraryService();
  const created = service.createLibrary({ displayName: 'L', selectedParentPath: root });
  service.prepareOrExecuteImport({ libraryId: created.libraryId, sourceKind: 'files', sourcePaths: [src] });
  const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;
  service.enqueueThumbnailJobs(created.libraryId, { assetIds: [asset.assetId], limit: 50 });
  await service.processThumbnailQueue(created.libraryId, { maxJobs: 10 });

  const contactSheet = service.getCurrentArtifact(created.libraryId, asset.assetId, 'contact_sheet');
  if (!contactSheet || contactSheet.status !== 'ready') {
    throw new Error(`contact_sheet not ready: ${JSON.stringify(contactSheet)}`);
  }
  const contactSheetPath = service.getArtifactAbsolutePath(created.libraryId, contactSheet.artifactId);
  const { default: sharp } = await import('sharp');
  const metadata = await sharp(contactSheetPath).metadata();
  if (!metadata.width || !metadata.height || Math.max(metadata.width, metadata.height) > 2048) {
    throw new Error(`invalid contact_sheet dimensions: ${JSON.stringify(metadata)}`);
  }
  service.closeAll();
    });
