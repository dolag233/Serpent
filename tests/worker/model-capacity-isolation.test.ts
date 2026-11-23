import { mkdir, mkdtemp, realpath, rm, writeFile, statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import { mediaResourceGuard } from '../../src/worker/media-resource-guard';
import { convertFbxBuffer } from '../../src/worker/fbx/converter';
import { importNoConflict } from './import-no-conflict';

async function cleanupFixture(service: LibraryService, root: string, ownedRoot: string): Promise<void> {
  await service.closeAllAsync(5000);
  mediaResourceGuard.reset();
  if (await realpath(root) !== ownedRoot || path.dirname(ownedRoot) !== await realpath(tmpdir())) {
    throw new Error('Owned fixture boundary changed');
  }
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

it('fails one capacity-limited model once while thumbnails in both libraries keep decoding', async () => {
  const disk = await statfs(tmpdir());
  if (disk.bavail * disk.bsize < 64 * 1024 * 1024) throw new Error('Insufficient fixture space');
  const root = await mkdtemp(path.join(tmpdir(), 'serpent-model-capacity-'));
  const ownedRoot = await realpath(root);
  const diagnostics: string[] = [];
  const service = new LibraryService({ onDiagnostic: event => diagnostics.push(event.scope) });
  mediaResourceGuard.reset();
  try {
    const first = service.createLibrary({ displayName: 'Model capacity fixture', selectedParentPath: root });
    const second = service.createLibrary({ displayName: 'Other fixture', selectedParentPath: root });
    const modelPath = fileURLToPath(new URL('../fixtures/fbx/blender_272_cube_7400_binary.fbx', import.meta.url));
    const modelId = importNoConflict(service, first.libraryId, modelPath).assets[0]!.assetId;
    let attempts = 0;
    const render = async () => {
      attempts += 1;
      return { status: 'failed' as const, errorCode: 'FBX_LIMIT_EXCEEDED' as const,
        reason: 'out of memory packing result' };
    };
    expect(service.enqueueThumbnailJobs(first.libraryId, { assetIds: [modelId] })).toBe(1);
    await service.processThumbnailQueue(first.libraryId, {
      assetIds: [modelId], maxJobs: 1, jobKinds: ['generate_thumbnail'], modelThumbnailRenderer: render,
    });
    expect(mediaResourceGuard.isCoolingDown()).toBe(false);
    expect(service.listMediaJobs(first.libraryId).jobs.find(job => job.assetId === modelId))
      .toMatchObject({ status: 'failed', errorCode: 'FBX_LIMIT_EXCEEDED', attemptCount: 1 });
    expect(service.enqueueThumbnailJobs(first.libraryId, { assetIds: [modelId] })).toBe(0);
    await service.processThumbnailQueue(first.libraryId, {
      assetIds: [modelId], maxJobs: 1, jobKinds: ['generate_thumbnail'], modelThumbnailRenderer: render,
    });
    expect(attempts).toBe(1);

    for (const [index, library] of [first, second].entries()) {
      const source = path.join(root, `image-${String.fromCharCode(97 + index)}.png`);
      await writeFile(source, await sharp({ create: {
        width: 2049, height: 3, channels: 3, background: { r: 70 + index, g: 100, b: 130 },
      } }).png().toBuffer());
      const imageId = importNoConflict(service, library.libraryId, source).assets[0]!.assetId;
      service.enqueueThumbnailJobs(library.libraryId, { assetIds: [imageId] });
      await service.processThumbnailQueue(library.libraryId, {
        assetIds: [imageId], maxJobs: 1, jobKinds: ['generate_thumbnail'],
      });
      const imageJob = service.listMediaJobs(library.libraryId).jobs.find(job =>
        job.assetId === imageId && job.kind === 'generate_thumbnail');
      expect(imageJob?.status, JSON.stringify({ errorCode: imageJob?.errorCode, diagnostics,
        cooling: mediaResourceGuard.isCoolingDown(), external: mediaResourceGuard.hasExternalHold() }))
        .toBe('succeeded');
      const artifact = service.getCurrentArtifact(library.libraryId, imageId, 'thumbnail');
      expect(artifact?.status).toBe('ready');
      expect(artifact?.width).toBeGreaterThan(0);
      expect(artifact?.height).toBeGreaterThan(0);
      if (!artifact) throw new Error('Missing decoded thumbnail artifact');
      const decoded = await sharp(path.join(library.libraryPath, '.serpent', 'artifacts', artifact.filePath))
        .raw().toBuffer({ resolveWithObject: true });
      expect(decoded.info.width).toBeGreaterThan(0);
      expect(decoded.data.length).toBeGreaterThan(0);
    }
  } finally {
    await cleanupFixture(service, root, ownedRoot);
  }
}, 30_000);

it('keeps a structured host ENOMEM through the parse thread and backs off the media queue', async () => {
  const disk = await statfs(tmpdir());
  if (disk.bavail * disk.bsize < 64 * 1024 * 1024) throw new Error('Insufficient fixture space');
  const root = await mkdtemp(path.join(tmpdir(), 'serpent-model-capacity-'));
  const ownedRoot = await realpath(root);
  const service = new LibraryService();
  const previousDir = process.env['SERPENT_UFBX_DIR'];
  mediaResourceGuard.reset();
  try {
    const runtime = path.join(root, 'runtime');
    await mkdir(runtime);
    await writeFile(path.join(runtime, 'ufbx.wasm'), Buffer.from([0]));
    await writeFile(path.join(runtime, 'ufbx.js'), `
module.exports = async () => ({
  HEAPU8: new Uint8Array(4096), _malloc: () => 1, _free: () => {}, _serpent_free_out: () => {},
  _serpent_parse: () => { throw Object.assign(new Error('native allocation failed'), { code: 'ENOMEM', errno: -12 }); }
});
`);
    process.env['SERPENT_UFBX_DIR'] = runtime;
    const library = service.createLibrary({ displayName: 'Host pressure fixture', selectedParentPath: root });
    const modelPath = fileURLToPath(new URL('../fixtures/fbx/blender_272_cube_7400_binary.fbx', import.meta.url));
    const modelId = importNoConflict(service, library.libraryId, modelPath).assets[0]!.assetId;
    service.enqueueThumbnailJobs(library.libraryId, { assetIds: [modelId] });
    let attempts = 0;
    const renderer = async () => {
      attempts += 1;
      const result = await convertFbxBuffer(Buffer.from('fixture'), { sourcePath: 'fixture.fbx' });
      if (result.ok) throw new Error('Injected native ENOMEM did not fire');
      expect(result.failure.errorCode).toBe('FBX_RESOURCE_EXHAUSTED');
      return { status: 'failed' as const, ...result.failure };
    };
    await service.processThumbnailQueue(library.libraryId, {
      assetIds: [modelId], maxJobs: 1, jobKinds: ['generate_thumbnail'], modelThumbnailRenderer: renderer,
    });
    expect(mediaResourceGuard.isCoolingDown()).toBe(true);
    expect(service.listMediaJobs(library.libraryId).jobs.find(job =>
      job.assetId === modelId && job.kind === 'generate_thumbnail'))
      .toMatchObject({ status: 'queued', errorCode: 'MEDIA_RESOURCE_EXHAUSTED', attemptCount: 1 });
    expect(await service.processThumbnailQueue(library.libraryId, {
      assetIds: [modelId], maxJobs: 1, jobKinds: ['generate_thumbnail'], modelThumbnailRenderer: renderer,
    })).toBe(0);
    expect(attempts).toBe(1);
  } finally {
    if (previousDir === undefined) delete process.env['SERPENT_UFBX_DIR'];
    else process.env['SERPENT_UFBX_DIR'] = previousDir;
    await cleanupFixture(service, root, ownedRoot);
  }
}, 30_000);
