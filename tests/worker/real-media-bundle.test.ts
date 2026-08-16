import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const bundleRoot = path.join(projectRoot, '.media-build/darwin-arm64/bundle-root');
function installedOrBuild(relativePath: string): string {
  const installed = path.join(projectRoot, 'resources', relativePath);
  return existsSync(installed) ? installed : path.join(bundleRoot, relativePath);
}
const ffmpegPath = process.env['SERPENT_REAL_FFMPEG_PATH']
  ?? installedOrBuild('ffmpeg/darwin-arm64/ffmpeg');
const ffprobePath = process.env['SERPENT_REAL_FFPROBE_PATH']
  ?? installedOrBuild('ffmpeg/darwin-arm64/ffprobe');
const oiiotoolPath = process.env['SERPENT_REAL_OIIO_PATH']
  ?? installedOrBuild('oiio/darwin-arm64/oiiotool');
const hasRealBundle = process.platform === 'darwin' && process.arch === 'arm64'
  && [ffmpegPath, ffprobePath, oiiotoolPath].every(existsSync);
const requireRealMedia = process.env['SERPENT_REQUIRE_REAL_MEDIA'] === '1';
const temporaryRoots: string[] = [];

function assertRealMediaBundleAvailable(): void {
  if (hasRealBundle) return;
  const missing = [ffmpegPath, ffprobePath, oiiotoolPath]
    .filter((binaryPath) => !existsSync(binaryPath));
  throw new Error(
    'SERPENT_REQUIRE_REAL_MEDIA=1 requires the darwin-arm64 LGPL media bundle. '
      + `platform=${process.platform}/${process.arch}; missing=${missing.join(', ') || 'unsupported platform'}`,
  );
}

const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const VALID_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
  'base64',
);

function pcmWave(durationSeconds: number): Buffer {
  const sampleRate = 48_000;
  const channelCount = 1;
  const bytesPerSample = 2;
  const sampleCount = sampleRate * durationSeconds;
  const dataSize = sampleCount * channelCount * bytesPerSample;
  const output = Buffer.alloc(44 + dataSize);
  output.write('RIFF', 0, 'ascii');
  output.writeUInt32LE(36 + dataSize, 4);
  output.write('WAVE', 8, 'ascii');
  output.write('fmt ', 12, 'ascii');
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(channelCount, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28);
  output.writeUInt16LE(channelCount * bytesPerSample, 32);
  output.writeUInt16LE(bytesPerSample * 8, 34);
  output.write('data', 36, 'ascii');
  output.writeUInt32LE(dataSize, 40);
  return output;
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 60_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, `${command} ${args.join(' ')}\n${result.stderr}`).toBe(0);
}

function buildFixtureSet(root: string): string[] {
  const png = path.join(root, 'sample.png');
  writeFileSync(png, VALID_PNG);
  const generatedStills = ['jpg', 'tiff', 'tga', 'exr'].map((extension) =>
    path.join(root, `sample.${extension}`),
  );
  for (const output of generatedStills) {
    run(oiiotoolPath, [png, '--resize', '64x48', '-o', output]);
  }
  const gif = path.join(root, 'sample.gif');
  writeFileSync(gif, VALID_GIF);
  const audioSource = path.join(root, 'sample-audio.wav');
  writeFileSync(audioSource, pcmWave(2));

  const jpeg = generatedStills[0]!;
  const portraitJpeg = path.join(root, 'proxy-portrait-source.jpg');
  run(oiiotoolPath, [png, '--resize', '48x64', '-o', portraitJpeg]);
  const videos: Array<[string, string, string]> = [
    ['mp4', 'h264_videotoolbox', 'aac'],
    ['mov', 'prores_ks', 'pcm_s16le'],
    ['avi', 'mjpeg', 'pcm_s16le'],
    ['wmv', 'wmv2', 'wmav2'],
  ];
  for (const [extension, videoEncoder, audioEncoder] of videos) {
    const output = path.join(root, `sample.${extension}`);
    const videoSource = extension === 'wmv' ? portraitJpeg : jpeg;
    run(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-loop', '1', '-i', videoSource,
      '-i', audioSource, '-t', '2', '-c:v', videoEncoder, '-c:a', audioEncoder,
      ...(extension === 'mp4' ? ['-pix_fmt', 'yuv420p', '-movflags', '+faststart'] : []),
      output,
    ]);
  }
  return [png, gif, ...generatedStills, ...videos.map(([extension]) => path.join(root, `sample.${extension}`))];
}

afterAll(() => {
  delete process.env['SERPENT_FFMPEG_PATH'];
  delete process.env['SERPENT_FFPROBE_PATH'];
  delete process.env['SERPENT_OIIO_PATH'];
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe.runIf(hasRealBundle || requireRealMedia)('installed media bundle real-format smoke', () => {
  it('processes the MVP formats through the persistent media queue into playable derivatives', async () => {
    assertRealMediaBundleAvailable();
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-real-media-'));
    temporaryRoots.push(root);
    const sourceRoot = path.join(root, 'sources');
    mkdirSync(sourceRoot);
    const sourcePaths = buildFixtureSet(sourceRoot);
    process.env['SERPENT_FFMPEG_PATH'] = ffmpegPath;
    process.env['SERPENT_FFPROBE_PATH'] = ffprobePath;
    process.env['SERPENT_OIIO_PATH'] = oiiotoolPath;

    const diagnostics: Array<{ scope: string; error: unknown; context?: Record<string, unknown> }> = [];
    const service = new LibraryService({
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    const library = service.createLibrary({ displayName: 'RealMedia', selectedParentPath: root });
    const imported = service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths,
    });
    expect('importId' in imported).toBe(false);
    if ('importId' in imported) throw new Error('Real-media fixtures unexpectedly conflicted.');

    const assets = service.listAssets({ libraryId: library.libraryId, recursive: true });
    expect(assets).toHaveLength(sourcePaths.length);
    expect(service.enqueueThumbnailJobs(library.libraryId)).toBe(sourcePaths.length);
    while (service.listMediaJobs(library.libraryId).queued > 0) {
      const processed = await service.processThumbnailQueue(library.libraryId);
      expect(
        processed,
        `Real media queue stalled: ${JSON.stringify(diagnostics.at(-1))}`,
      ).toBeGreaterThan(0);
    }

    const refreshed = service.listAssets({ libraryId: library.libraryId, recursive: true });
    expect(
      refreshed.every((asset) => asset.thumbnailStatus === 'ready'),
      JSON.stringify(refreshed.map((asset) => ({
        name: asset.displayName,
        mediaType: asset.mediaType,
        thumbnailStatus: asset.thumbnailStatus,
        thumbnailArtifactId: asset.thumbnailArtifactId,
        currentThumbnail: service.getCurrentArtifact(
          library.libraryId,
          asset.assetId,
          asset.mediaType === 'video' ? 'video_poster' : 'thumbnail',
        ),
      }))),
    ).toBe(true);
    const videoAssets = refreshed.filter((asset) => asset.mediaType === 'video');
    expect(videoAssets).toHaveLength(4);
    for (const asset of videoAssets) {
      const queueEvidence = JSON.stringify({
        asset: asset.displayName,
        jobs: service.listMediaJobs(library.libraryId).jobs.filter((job) => job.assetId === asset.assetId),
        lastDiagnostic: diagnostics.at(-1),
      });
      expect(service.getCurrentArtifact(library.libraryId, asset.assetId, 'video_poster'), queueEvidence)
        .toMatchObject({ status: 'ready', mimeType: 'image/jpeg' });
      expect(service.getCurrentArtifact(library.libraryId, asset.assetId, 'extracted_metadata'), queueEvidence)
        .toMatchObject({ status: 'ready', mimeType: 'application/json' });
      expect(service.getCurrentArtifact(library.libraryId, asset.assetId, 'contact_sheet'), queueEvidence)
        .toMatchObject({ status: 'ready', mimeType: 'image/jpeg' });
    }

    // Serpent-cljb: importing/browsing never eagerly creates video proxies,
    // including for AVI/WMV. The real player decides whether a specific source
    // needs a proxy after it reports a decode failure.
    for (const asset of videoAssets) {
      expect(service.getCurrentArtifact(library.libraryId, asset.assetId, 'webm_proxy')).toBeNull();
      expect(service.getPreviewArtifact(library.libraryId, asset.assetId, 'viewer')).toMatchObject({
        status: 'ready',
        playbackMode: 'source',
        sourceRevisionId: asset.currentRevisionId,
      });
    }

    service.closeAll();

    const reopened = new LibraryService({
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    try {
      const reopenedLibrary = reopened.openLibrary(library.libraryPath);
      expect(reopenedLibrary.libraryId).toBe(library.libraryId);
      expect(reopened.enqueueThumbnailJobs(library.libraryId)).toBe(0);

      const reopenedJobs = reopened.listMediaJobs(library.libraryId);
      expect(reopenedJobs.queued).toBe(0);
      expect(reopenedJobs.running).toBe(0);
      expect(reopenedJobs.failed).toBe(0);
      for (const asset of videoAssets) {
        expect(reopened.getCurrentArtifact(library.libraryId, asset.assetId, 'webm_proxy')).toBeNull();
        expect(reopened.getPreviewArtifact(library.libraryId, asset.assetId, 'viewer')).toMatchObject({
          status: 'ready',
          playbackMode: 'source',
          sourceRevisionId: asset.currentRevisionId,
        });
      }
    } finally {
      reopened.closeAll();
    }
  }, 180_000);
});
