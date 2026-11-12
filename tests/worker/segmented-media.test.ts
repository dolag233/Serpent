import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { executeExtensionWorkerCommand } from '../../src/worker/handlers/extension';
import { resolveFfmpegPath, resolveFfprobePath } from '../../src/worker/binary-resolver';
import { mergeAndVerifySegmentedVideo } from '../../src/worker/segmented-media';
import type { WorkerRequest } from '../../src/shared/protocol/requests';
import type { LibraryService } from '../../src/worker/library-service';

const fixtureFfmpegPath = process.env['SERPENT_REAL_FIXTURE_FFMPEG_PATH']
  ?? process.env['SERPENT_REAL_FFMPEG_PATH']
  ?? resolveFfmpegPath();
const encoderProbe = spawnSync(fixtureFfmpegPath, ['-hide_banner', '-encoders'], { encoding: 'utf8', timeout: 10_000 });
const availableEncoders = `${encoderProbe.stdout ?? ''}\n${encoderProbe.stderr ?? ''}`;
const fixtureVideoEncoder = ['libx264', 'libopenh264'].find((encoder) =>
  new RegExp(`\\b${encoder}\\b`, 'u').test(availableEncoders),
);
const canBuildRealHlsFixture = !encoderProbe.error
  && encoderProbe.status === 0
  && fixtureVideoEncoder !== undefined
  && /\baac\b/u.test(availableEncoders);
const canBuildRealWebmFixture = canBuildRealHlsFixture && /\blibvpx\b/u.test(availableEncoders);
const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-segmented-media-'));
  temporaryRoots.push(root);
  return root;
}

function run(command: string, args: string[], cwd?: string): string {
  const result = spawnSync(command, args, {
    ...(cwd === undefined ? {} : { cwd }),
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')}\n${result.stderr}`);
  return result.stdout;
}

function makeHlsFixture(root: string, protocol: 'hls-ts' | 'hls-fmp4' | 'dash-fmp4') {
  const sourceDirectory = path.join(root, 'source');
  const sessionId = randomUUID();
  const stagingDirectory = path.join(root, `serpent-ext-segmented-${sessionId}`);
  mkdirSync(sourceDirectory, { recursive: true });
  mkdirSync(stagingDirectory, { recursive: true });
  const playlistPath = path.join(sourceDirectory, 'index.m3u8');
  const segmentPattern = 'segment_%03d.ts';
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=15:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
    '-t', '2', '-c:v', fixtureVideoEncoder!, '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    '-f', 'hls', '-hls_time', '1', '-hls_playlist_type', 'vod',
  ];
  if (fixtureVideoEncoder === 'libx264') args.splice(args.indexOf('-pix_fmt'), 0, '-preset', 'ultrafast');
  if (protocol !== 'hls-ts') {
    args.push(
      '-hls_segment_type', 'fmp4',
      '-hls_fmp4_init_filename', 'init.mp4',
      '-hls_segment_filename', 'segment_%03d.m4s',
    );
  } else {
    args.push('-hls_segment_filename', segmentPattern);
  }
  args.push('index.m3u8');
  run(fixtureFfmpegPath!, args, sourceDirectory);

  const playlist = readFileSync(playlistPath, 'utf8').split(/\r?\n/u).map((line) => line.trim());
  const parts: Array<{ sourcePath: string; durationMs: number; role: 'init' | 'media' }> = [];
  if (protocol !== 'hls-ts') {
    parts.push({ sourcePath: path.join(sourceDirectory, 'init.mp4'), durationMs: 0, role: 'init' });
  }
  let durationMs: number | undefined;
  for (const line of playlist) {
    if (line.startsWith('#EXTINF:')) {
      durationMs = Math.round(Number(line.slice('#EXTINF:'.length).split(',')[0]) * 1000);
    } else if (line && !line.startsWith('#') && durationMs !== undefined) {
      parts.push({
        sourcePath: path.join(sourceDirectory, line),
        durationMs,
        role: 'media',
      });
      durationMs = undefined;
    }
  }

  const segments = parts.map((part, index) => {
    const id = part.role === 'init' ? 'v-init' : `v-${String(index).padStart(6, '0')}`;
    const extension = protocol === 'hls-ts' ? 'ts' : 'm4s';
    const destination = path.join(stagingDirectory, `${id}.${extension}`);
    const bytes = readFileSync(part.sourcePath);
    writeFileSync(destination, bytes, { mode: 0o600 });
    return {
      id,
      role: part.role,
      byteLength: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      ...(part.role === 'media' ? { durationMs: part.durationMs } : {}),
    } as const;
  });
  const totalBytes = segments.reduce((sum, segment) => sum + segment.byteLength, 0);
  return {
    sessionId,
    stagingDirectory,
    totalBytes,
    tracks: [{ kind: 'video' as const, segments }],
  };
}

function truncateMp4AtMediaData(bytes: Buffer): Buffer {
  let offset = 0;
  while (offset + 8 <= bytes.byteLength) {
    const boxSize = bytes.readUInt32BE(offset);
    const boxType = bytes.toString('ascii', offset + 4, offset + 8);
    if (boxType === 'mdat') {
      const truncated = Buffer.from(bytes.subarray(0, offset + 8));
      truncated.writeUInt32BE(8, offset);
      return truncated;
    }
    if (boxSize < 8 || offset + boxSize > bytes.byteLength) break;
    offset += boxSize;
  }
  throw new Error('Fixture MP4 has no top-level mdat box.');
}

afterAll(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe.runIf(canBuildRealHlsFixture)('segmented media FFmpeg merge and verification', () => {
  it.each(['hls-ts', 'hls-fmp4', 'dash-fmp4'] as const)(
    'merges and fully decodes a short %s video without network access',
    async (protocol) => {
      const fixture = makeHlsFixture(temporaryRoot(), protocol);
      const merged = await mergeAndVerifySegmentedVideo({
        sessionId: fixture.sessionId,
        stagingDirectory: fixture.stagingDirectory,
        protocol,
        totalBytes: fixture.totalBytes,
        tracks: fixture.tracks,
      });
      expect(merged.byteLength).toBeGreaterThan(0);
      expect(merged.durationSeconds).toBeGreaterThan(1.8);
      expect(merged.durationSeconds).toBeLessThan(2.3);
      const output = statSync(merged.path);
      expect(output.isFile()).toBe(true);
      const probe = JSON.parse(run(
        resolveFfprobePath(),
        ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'json', merged.path],
      )) as { streams: Array<{ codec_type: string; width?: number; height?: number }> };
      expect(probe.streams.some((stream) => stream.codec_type === 'video' && stream.width === 160 && stream.height === 90)).toBe(true);
      expect(probe.streams.some((stream) => stream.codec_type === 'audio')).toBe(true);
    },
  );

  it('returns a typed source-validation failure for corrupt media before library import', async () => {
    const fixture = makeHlsFixture(temporaryRoot(), 'dash-fmp4');
    const mediaSegment = fixture.tracks[0]!.segments.find((segment) => segment.role === 'media')!;
    const corrupt = Buffer.from('corrupt fMP4 media fragment');
    writeFileSync(path.join(fixture.stagingDirectory, `${mediaSegment.id}.m4s`), corrupt, { mode: 0o600 });
    const tracks = fixture.tracks.map((track) => ({
      kind: track.kind,
      segments: track.segments.map((segment) => segment.id === mediaSegment.id
        ? {
            ...segment,
            byteLength: corrupt.byteLength,
            sha256: createHash('sha256').update(corrupt).digest('hex'),
          }
        : segment),
    }));
    const totalBytes = tracks[0]!.segments.reduce((sum, segment) => sum + segment.byteLength, 0);

    await expect(mergeAndVerifySegmentedVideo({
      sessionId: fixture.sessionId,
      stagingDirectory: fixture.stagingDirectory,
      protocol: 'dash-fmp4',
      totalBytes,
      tracks,
    })).rejects.toMatchObject({ errorCode: 'SEGMENTED_SOURCE_VALIDATION' });
  });

  it('probes and fully decodes direct MP4 uploads before import, rejecting a real truncated video as source-invalid', async () => {
    const source = makeHlsFixture(temporaryRoot(), 'dash-fmp4');
    const merged = await mergeAndVerifySegmentedVideo({
      sessionId: source.sessionId,
      stagingDirectory: source.stagingDirectory,
      protocol: 'dash-fmp4',
      totalBytes: source.totalBytes,
      tracks: source.tracks,
    });
    const corruptPath = path.join(path.dirname(merged.path), 'truncated-source.mp4');
    const corruptBytes = truncateMp4AtMediaData(readFileSync(merged.path));
    writeFileSync(corruptPath, corruptBytes, { mode: 0o600 });
    const asset = { assetId: 'direct-video-asset' };
    const saveAssetFromFile = vi.fn(async () => ({ asset }));
    const libraryService = { saveAssetFromFile } as unknown as LibraryService;
    const hooks = { scheduleMutationThumbnails: vi.fn() };
    const requestFor = (
      stagedFilePath: string,
      contentType = 'video/mp4',
      filename = 'short.mp4',
    ): WorkerRequest => ({
      requestId: randomUUID(),
      command: {
        type: 'extension.save-from-file',
        kind: 'video',
        libraryId: 'library-direct-video',
        stagedFilePath,
        contentType,
        filename,
      },
    });

    await expect(executeExtensionWorkerCommand(
      libraryService,
      requestFor(merged.path),
      hooks,
    )).resolves.toMatchObject({ ok: true, type: 'extension.asset-saved' });
    if (canBuildRealWebmFixture) {
      const webmPath = path.join(path.dirname(source.stagingDirectory), 'direct-source.webm');
      run(fixtureFfmpegPath!, [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=10:duration=1',
        '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '200k',
        '-an', '-f', 'webm', webmPath,
      ]);
      await expect(executeExtensionWorkerCommand(
        libraryService,
        requestFor(webmPath, 'video/webm', 'short.webm'),
        hooks,
      )).resolves.toMatchObject({ ok: true, type: 'extension.asset-saved' });
    }
    await expect(executeExtensionWorkerCommand(
      libraryService,
      requestFor(corruptPath),
      hooks,
    )).rejects.toMatchObject({ errorCode: 'SEGMENTED_SOURCE_VALIDATION' });
    expect(saveAssetFromFile).toHaveBeenCalledTimes(canBuildRealWebmFixture ? 2 : 1);
  });
});

describe('segmented media input restrictions', () => {
  it('rejects arbitrary IDs before invoking FFmpeg', async () => {
    const root = temporaryRoot();
    const sessionId = randomUUID();
    const stagingDirectory = path.join(root, `serpent-ext-segmented-${sessionId}`);
    mkdirSync(stagingDirectory, { recursive: true });
    await expect(mergeAndVerifySegmentedVideo({
      sessionId,
      stagingDirectory,
      protocol: 'hls-ts',
      totalBytes: 1,
      tracks: [{
        kind: 'video',
        segments: [{ id: '../escape', role: 'media', byteLength: 1, sha256: '0'.repeat(64), durationMs: 1_000 }],
      }],
    })).rejects.toThrow();
  });

  it('rejects a DASH fMP4 track without its initialization segment', async () => {
    const root = temporaryRoot();
    const sessionId = randomUUID();
    const stagingDirectory = path.join(root, `serpent-ext-segmented-${sessionId}`);
    mkdirSync(stagingDirectory, { recursive: true });
    const bytes = Buffer.from('not-a-real-fragment');
    writeFileSync(path.join(stagingDirectory, 'v-0.m4s'), bytes, { mode: 0o600 });
    await expect(mergeAndVerifySegmentedVideo({
      sessionId,
      stagingDirectory,
      protocol: 'dash-fmp4',
      totalBytes: bytes.byteLength,
      tracks: [{
        kind: 'video',
        segments: [{
          id: 'v-0',
          role: 'media',
          byteLength: bytes.byteLength,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          durationMs: 1_000,
        }],
      }],
    })).rejects.toMatchObject({ errorCode: 'SEGMENTED_SOURCE_VALIDATION' });
  });
});
