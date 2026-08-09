import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import { importNoConflict } from './import-no-conflict';

const ffmpegPath = process.env['SERPENT_REAL_FFMPEG_PATH'];
const ffprobePath = process.env['SERPENT_REAL_FFPROBE_PATH'];
// The product FFmpeg intentionally excludes avdevice/lavfi because it only
// needs to read user media and write owned proxies. Fixture generation may use
// an explicitly supplied developer FFmpeg with lavfi enabled; it is never
// treated as product-runtime evidence.
const fixtureFfmpegPath = process.env['SERPENT_REAL_FIXTURE_FFMPEG_PATH'] ?? ffmpegPath;
const canRun = Boolean(
  ffmpegPath
  && ffprobePath
  && fixtureFfmpegPath
  && existsSync(ffmpegPath)
  && existsSync(ffprobePath)
  && existsSync(fixtureFfmpegPath),
);
const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-real-common-av-'));
  temporaryRoots.push(root);
  return root;
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, `${command} ${args.join(' ')}\n${result.stderr}`).toBe(0);
}

function buildFixtures(root: string): string[] {
  mkdirSync(root, { recursive: true });
  const wav = path.join(root, 'tone.wav');
  run(fixtureFfmpegPath!, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000',
    '-t', '1', '-c:a', 'pcm_s16le', wav,
  ]);

  const audioOutputs: Array<[string, string[]]> = [
    ['tone.mp3', ['-c:a', 'libmp3lame']],
    ['tone.ogg', ['-c:a', 'libvorbis']],
    ['tone.oga', ['-c:a', 'libvorbis']],
    ['tone.m4a', ['-c:a', 'aac']],
    ['tone.aac', ['-c:a', 'aac', '-f', 'adts']],
    ['tone.flac', ['-c:a', 'flac']],
    ['tone.opus', ['-c:a', 'libopus']],
  ];
  const audioPaths = [wav];
  for (const [name, codecArgs] of audioOutputs) {
    const output = path.join(root, name);
    run(fixtureFfmpegPath!, ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, ...codecArgs, output]);
    audioPaths.push(output);
  }

  const videoOutputs: Array<[string, string[]]> = [
    ['clip.mp4', ['-c:v', 'mpeg4', '-c:a', 'aac', '-pix_fmt', 'yuv420p']],
    ['clip.mov', ['-c:v', 'mpeg4', '-c:a', 'aac', '-pix_fmt', 'yuv420p']],
    ['clip.avi', ['-c:v', 'mpeg4', '-c:a', 'mp3', '-pix_fmt', 'yuv420p']],
    ['clip.wmv', ['-c:v', 'wmv2', '-c:a', 'wmav2', '-pix_fmt', 'yuv420p']],
    ['clip.webm', ['-c:v', 'libvpx-vp9', '-c:a', 'libopus']],
    ['clip.mkv', ['-c:v', 'mpeg4', '-c:a', 'aac', '-pix_fmt', 'yuv420p']],
    ['clip.m4v', ['-c:v', 'mpeg4', '-c:a', 'aac', '-pix_fmt', 'yuv420p']],
  ];
  const videoPaths: string[] = [];
  for (const [name, codecArgs] of videoOutputs) {
    const output = path.join(root, name);
    run(fixtureFfmpegPath!, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=blue:s=64x48:r=24', '-i', wav,
      '-t', '1', ...codecArgs, output,
    ]);
    videoPaths.push(output);
  }
  return [...audioPaths, ...videoPaths];
}

afterAll(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true, maxRetries: 5, retryDelay: 200 });
  }
});

/**
 * Opt-in development evidence. It intentionally accepts explicit local paths
 * rather than treating a PATH binary as a release bundle. Release evidence is
 * still the checksum-pinned resource bundle test.
 */
describe.runIf(canRun)('real common audio/video format matrix', () => {
  it('turns every MVP audio/video source into a playable owned proxy', async () => {
    const root = temporaryRoot();
    const sourceRoot = path.join(root, 'sources');
    const sourcePaths = buildFixtures(sourceRoot);
    process.env['SERPENT_FFMPEG_PATH'] = ffmpegPath;
    process.env['SERPENT_FFPROBE_PATH'] = ffprobePath;
    const service = new LibraryService();
    try {
      const library = service.createLibrary({ displayName: 'RealCommonFormats', selectedParentPath: root });
      for (const sourcePath of sourcePaths) {
        importNoConflict(service, library.libraryId, sourcePath);
      }

      service.enqueueThumbnailJobs(library.libraryId);
      while (service.listMediaJobs(library.libraryId).queued > 0) {
        expect(await service.processThumbnailQueue(library.libraryId)).toBeGreaterThan(0);
      }

      const assets = service.listAssets({ libraryId: library.libraryId, recursive: true });
      expect(assets).toHaveLength(sourcePaths.length);
      for (const asset of assets) {
        const kind = asset.mediaType === 'video' ? 'webm_proxy' : 'audio_proxy';
        const artifact = service.getCurrentArtifact(library.libraryId, asset.assetId, kind);
        const jobs = service.listMediaJobs(library.libraryId).jobs
          .filter((job) => job.assetId === asset.assetId)
          .map(({ kind: jobKind, status, errorCode }) => ({ kind: jobKind, status, errorCode }));
        expect(artifact, `${asset.displayName}: ${JSON.stringify(jobs)}`).toMatchObject({
          status: 'ready',
          mimeType: asset.mediaType === 'video'
            ? expect.stringMatching(/^video\/(mp4|webm)$/u)
            : 'audio/ogg',
        });
        const proxyPath = service.getArtifactAbsolutePath(library.libraryId, artifact!.artifactId, 'proxy');
        const probe = spawnSync(ffprobePath!, [
          '-v', 'error', '-show_entries', 'stream=codec_name,codec_type', '-of', 'json', proxyPath,
        ], { encoding: 'utf8', timeout: 30_000 });
        expect(probe.status, `${asset.displayName}: ${probe.stderr}`).toBe(0);
        const streams = JSON.parse(probe.stdout) as { streams?: Array<{ codec_name?: string; codec_type?: string }> };
        const expectedAudioCodec = asset.mediaType === 'video'
          ? (artifact!.mimeType === 'video/mp4' ? 'aac' : 'opus')
          : 'opus';
        expect(streams.streams?.some((stream) => stream.codec_name === expectedAudioCodec && stream.codec_type === 'audio'))
          .toBe(true);
        if (asset.mediaType === 'video') {
          const videoCodec = artifact!.mimeType === 'video/mp4' ? 'h264' : 'vp9';
          expect(streams.streams?.some((stream) => stream.codec_name === videoCodec && stream.codec_type === 'video'))
            .toBe(true);
        }
      }
    } finally {
      service.closeAll();
    }
  }, 180_000);
});
