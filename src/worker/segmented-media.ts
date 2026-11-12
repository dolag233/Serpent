import { createHash, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { lstat, open, realpath, stat, statfs, rm } from 'node:fs/promises';
import path from 'node:path';
import { resolveFfmpegPath, resolveFfprobePath } from './binary-resolver';

const MAX_ASSET_BYTES = 500 * 1024 * 1024;
const activeJobs = new Map<string, ChildProcess>();
const cancelledJobs = new Set<string>();
const activeTransfers = new Set<string>();
const completedTransfers = new Map<string, number>();

export interface SegmentedMediaCommitInput {
  sessionId: string;
  stagingDirectory: string;
  protocol: 'hls-ts' | 'hls-fmp4' | 'dash-fmp4';
  totalBytes: number;
  tracks: Array<{
    kind: 'video' | 'audio';
    segments: Array<{
      id: string;
      role: 'init' | 'media';
      byteLength: number;
      sha256: string;
      durationMs?: number;
      discontinuityBefore?: boolean;
    }>;
  }>;
}

export class SegmentedMediaCancelledError extends Error {
  constructor() {
    super('Segmented video transfer was cancelled.');
    this.name = 'SegmentedMediaCancelledError';
  }
}

export class SegmentedMediaSourceValidationError extends Error {
  readonly errorCode = 'SEGMENTED_SOURCE_VALIDATION';

  constructor(message = 'The segmented video failed media validation.', cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'SegmentedMediaSourceValidationError';
  }
}

class SegmentedMediaToolError extends Error {
  constructor(readonly phase: 'start' | 'exit' | 'timeout', message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'SegmentedMediaToolError';
  }
}

export async function mergeAndVerifySegmentedVideo(
  input: SegmentedMediaCommitInput,
): Promise<{ path: string; byteLength: number; durationSeconds: number }> {
  throwIfCancelled(input.sessionId);
  const directory = await verifyManagedSessionDirectory(input.stagingDirectory);
  const videoTracks = input.tracks.filter((track) => track.kind === 'video');
  const audioTracks = input.tracks.filter((track) => track.kind === 'audio');
  if (videoTracks.length !== 1 || audioTracks.length > 1 || input.tracks.length > 2) {
    throw new Error('Segmented video must contain one video track and at most one audio track.');
  }
  const totalBytes = await validateParts(directory, input);
  if (totalBytes !== input.totalBytes || totalBytes <= 0 || totalBytes > MAX_ASSET_BYTES) {
    throw new Error('Segmented asset length is invalid.');
  }
  await assertMergeSpace(directory, totalBytes);
  const video = input.tracks.find((track) => track.kind === 'video');
  const audio = input.tracks.find((track) => track.kind === 'audio');
  if (!video) throw new Error('Segmented video track is missing.');
  const videoPlaylist = await asSourceValidation(() => writeLocalTrackPlaylist(directory, 'video', video.segments, input.protocol));
  const audioPlaylist = audio
    ? await asSourceValidation(() => writeLocalTrackPlaylist(directory, 'audio', audio.segments, input.protocol))
    : undefined;
  const outputPath = path.join(directory, 'merged-output.mp4');
  const args = [
    '-hide_banner', '-nostdin', '-loglevel', 'error',
    '-allowed_extensions', 'm3u8,ts,m4s', '-protocol_whitelist', 'file', '-i', videoPlaylist,
  ];
  if (audioPlaylist) args.push('-allowed_extensions', 'm3u8,ts,m4s', '-protocol_whitelist', 'file', '-i', audioPlaylist);
  args.push('-map', '0:v:0');
  if (audioPlaylist) args.push('-map', '1:a:0');
  else args.push('-map', '0:a?');
  args.push('-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', '-y', outputPath);

  try {
    await asSourceValidation(() => runBinary(input.sessionId, resolveFfmpegPath(), args, directory, 2 * 60 * 60 * 1000));
    throwIfCancelled(input.sessionId);
    const outputStat = await lstat(outputPath);
    if (!outputStat.isFile() || outputStat.isSymbolicLink() || outputStat.size <= 0 || outputStat.size > MAX_ASSET_BYTES) {
      throw new SegmentedMediaSourceValidationError('Merged video exceeds the 500 MiB asset limit or is not a regular file.');
    }
    const probe = await asSourceValidation(() => probeVideo(input.sessionId, outputPath, directory));
    const expectedDuration = video.segments.reduce(
      (sum, segment) => sum + (segment.durationMs ?? 0),
      0,
    ) / 1000;
    const tolerance = Math.max(0.5, expectedDuration * 0.02);
    if (probe.durationSeconds <= 0
      || probe.durationSeconds < expectedDuration * 0.8
      || Math.abs(probe.durationSeconds - expectedDuration) > tolerance) {
      throw new SegmentedMediaSourceValidationError('Merged video duration does not match its segment timeline.');
    }
    if (audioPlaylist && !probe.hasAudio) throw new SegmentedMediaSourceValidationError('Merged video is missing its expected audio track.');
    await asSourceValidation(() => runBinary(input.sessionId, resolveFfmpegPath(), [
      '-hide_banner', '-nostdin', '-loglevel', 'error', '-protocol_whitelist', 'file',
      '-i', outputPath, '-map', '0:v:0', '-map', '0:a?', '-f', 'null', '-',
    ], directory, Math.min(2 * 60 * 60 * 1000, Math.max(60_000, expectedDuration * 20_000))));
    throwIfCancelled(input.sessionId);
    const finalStat = await stat(outputPath);
    return { path: outputPath, byteLength: finalStat.size, durationSeconds: probe.durationSeconds };
  } catch (error) {
    await rmFile(outputPath);
    throw error;
  } finally {
    activeJobs.delete(input.sessionId);
  }
}

/** Probe and decode browser-fetched MP4/WebM files before a library import starts. */
export async function validateDirectVideoSource(filePath: string, contentType: string): Promise<void> {
  const normalizedType = contentType.split(';')[0]?.trim().toLowerCase();
  if (normalizedType !== 'video/mp4' && normalizedType !== 'video/webm') return;

  const absolutePath = path.resolve(filePath);
  const info = await lstat(absolutePath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Direct video source is not a regular file.');
  if (info.size <= 0 || info.size > MAX_ASSET_BYTES) {
    throw new SegmentedMediaSourceValidationError('Direct video source is empty or exceeds the 500 MiB limit.');
  }

  const transferId = randomUUID();
  const workingDirectory = path.dirname(absolutePath);
  const probe = await asSourceValidation(() => probeVideo(transferId, absolutePath, workingDirectory));
  if (!Number.isFinite(probe.durationSeconds) || probe.durationSeconds <= 0) {
    throw new SegmentedMediaSourceValidationError('Direct video source has no valid duration.');
  }
  await asSourceValidation(() => runBinary(transferId, resolveFfmpegPath(), [
    '-hide_banner', '-nostdin', '-loglevel', 'error', '-xerror', '-err_detect', 'explode',
    '-protocol_whitelist', 'file', '-i', absolutePath,
    '-map', '0:v:0', '-map', '0:a?', '-f', 'null', '-',
  ], workingDirectory, 2 * 60 * 60 * 1000));
}

export function cancelSegmentedVideoTransfer(transferId: string): boolean {
  pruneCompletedTransfers();
  if (completedTransfers.has(transferId)) return false;
  cancelledJobs.add(transferId);
  const child = activeJobs.get(transferId);
  if (child) {
    child.kill('SIGTERM');
    const timer = setTimeout(() => {
      if (activeJobs.get(transferId) === child) child.kill('SIGKILL');
    }, 2_000);
    timer.unref?.();
  }
  return activeTransfers.has(transferId);
}

export function beginSegmentedVideoTransfer(transferId: string): void {
  pruneCompletedTransfers();
  activeTransfers.add(transferId);
}

export function finishSegmentedVideoTransfer(transferId: string): void {
  activeJobs.delete(transferId);
  activeTransfers.delete(transferId);
  cancelledJobs.delete(transferId);
  completedTransfers.set(transferId, Date.now());
}

export function throwIfSegmentedVideoTransferCancelled(transferId: string): void {
  throwIfCancelled(transferId);
}

async function verifyManagedSessionDirectory(input: string): Promise<string> {
  const resolved = path.resolve(input);
  if (!path.basename(resolved).startsWith('serpent-ext-segmented-')) {
    throw new Error('Segmented session directory is not managed.');
  }
  const info = await lstat(resolved);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid segmented session directory.');
  const canonical = await realpath(resolved);
  if (!samePath(canonical, resolved)) throw new Error('Segmented session directory resolved outside its managed path.');
  return canonical;
}

async function validateParts(directory: string, input: SegmentedMediaCommitInput): Promise<number> {
  const ids = new Set<string>();
  let total = 0;
  for (const track of input.tracks) {
    if (track.segments.length === 0) throw new Error('Segmented track has no parts.');
    for (const segment of track.segments) {
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(segment.id) || ids.has(segment.id)) {
        throw new Error('Segment ID is invalid or repeated.');
      }
      ids.add(segment.id);
      if (segment.role === 'media'
        && (!Number.isFinite(segment.durationMs) || segment.durationMs! <= 0 || segment.durationMs! > 24 * 60 * 60 * 1000)) {
        throw new Error('Segment duration is invalid.');
      }
      if (segment.role !== 'media' && segment.role !== 'init') throw new Error('Segment role is invalid.');
      if (!Number.isSafeInteger(segment.byteLength) || segment.byteLength <= 0) throw new Error('Segment byte length is invalid.');
      if (!/^[a-f0-9]{64}$/u.test(segment.sha256)) throw new Error('Segment checksum is invalid.');
      const filePath = path.join(directory, `${segment.id}.${input.protocol === 'hls-ts' ? 'ts' : 'm4s'}`);
      const info = await lstat(filePath);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== segment.byteLength) {
        throw new Error('Segment file does not match its transfer metadata.');
      }
      if (!samePath(await realpath(filePath), filePath)) throw new Error('Segment file escaped the managed directory.');
      const digest = await hashFile(filePath);
      if (digest !== segment.sha256) throw new Error('Segment checksum mismatch.');
      total += info.size;
      if (total > MAX_ASSET_BYTES) throw new Error('Segmented asset exceeds the 500 MiB limit.');
    }
  }
  return total;
}

async function writeLocalTrackPlaylist(
  directory: string,
  trackName: 'video' | 'audio',
  segments: SegmentedMediaCommitInput['tracks'][number]['segments'],
  protocol: SegmentedMediaCommitInput['protocol'],
): Promise<string> {
  if (protocol !== 'hls-ts' && segments[0]?.role !== 'init') {
    throw new Error('Fragmented MP4 track has no initialization segment.');
  }
  if (protocol === 'hls-ts' && segments.some((segment) => segment.role === 'init')) {
    throw new Error('Transport stream playlist contains an initialization segment.');
  }
  if (segments.filter((segment) => segment.role === 'init').length > 1) {
    throw new Error('Multiple initialization segments are not supported in this HLS profile.');
  }
  const media = segments.filter((segment) => segment.role === 'media');
  if (media.length === 0) throw new Error('HLS track has no media segments.');
  const maxDuration = Math.max(...media.map((segment) => (segment.durationMs ?? 0) / 1000));
  const lines = [
    '#EXTM3U',
    `#EXT-X-VERSION:${protocol === 'hls-ts' ? 3 : 7}`,
    `#EXT-X-TARGETDURATION:${Math.max(1, Math.ceil(maxDuration))}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
  ];
  const init = segments.find((segment) => segment.role === 'init');
  const partExtension = protocol === 'hls-ts' ? 'ts' : 'm4s';
  if (init) lines.push(`#EXT-X-MAP:URI="${init.id}.${partExtension}"`);
  for (const segment of media) {
    if (segment.discontinuityBefore) lines.push('#EXT-X-DISCONTINUITY');
    lines.push(`#EXTINF:${((segment.durationMs ?? 0) / 1000).toFixed(3)},`);
    lines.push(`${segment.id}.${partExtension}`);
  }
  lines.push('#EXT-X-ENDLIST', '');
  const playlistPath = path.join(directory, `${trackName}.m3u8`);
  const file = await open(playlistPath, 'wx', 0o600);
  try {
    await file.writeFile(lines.join('\n'), 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
  return playlistPath;
}

async function assertMergeSpace(directory: string, inputBytes: number): Promise<void> {
  try {
    const available = await statfs(directory);
    const freeBytes = Number(available.bavail) * Number(available.bsize);
    const outputReserveBytes = Math.min(MAX_ASSET_BYTES, inputBytes + 32 * 1024 * 1024);
    const mergeHeadroomBytes = 32 * 1024 * 1024;
    // The segments already occupy this volume. Reserve an output-sized allowance,
    // which makes the required peak equal to source segments plus merged output.
    if (Number.isFinite(freeBytes) && freeBytes < outputReserveBytes + mergeHeadroomBytes) {
      throw new Error('Insufficient disk space for source segments and the merged video.');
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Insufficient disk space')) throw error;
    // The volume may not expose free space on some filesystems; FFmpeg errors remain authoritative.
  }
}

async function probeVideo(
  transferId: string,
  filePath: string,
  cwd: string,
): Promise<{ durationSeconds: number; hasAudio: boolean }> {
  const stdout = await runBinary(transferId, resolveFfprobePath(), [
    '-v', 'error', '-protocol_whitelist', 'file',
    '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', filePath,
  ], cwd, 60_000, true);
  let parsed: unknown;
  try { parsed = JSON.parse(stdout); } catch { throw new Error('ffprobe returned invalid video metadata.'); }
  if (!parsed || typeof parsed !== 'object') throw new Error('ffprobe returned invalid video metadata.');
  const streams = Reflect.get(parsed, 'streams');
  const format = Reflect.get(parsed, 'format');
  if (!Array.isArray(streams)) throw new Error('Merged video has no streams.');
  const video = streams.find((stream) => stream && Reflect.get(stream, 'codec_type') === 'video');
  if (!video || !(Number(Reflect.get(video, 'width')) > 0) || !(Number(Reflect.get(video, 'height')) > 0)) {
    throw new Error('Merged video has no measurable video track.');
  }
  const durationSeconds = Number(format && Reflect.get(format, 'duration'));
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 24 * 60 * 60) {
    throw new Error('Merged video duration is invalid.');
  }
  return {
    durationSeconds,
    hasAudio: streams.some((stream) => stream && Reflect.get(stream, 'codec_type') === 'audio'),
  };
}

function runBinary(
  transferId: string,
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  captureStdout = false,
): Promise<string> {
  throwIfCancelled(transferId);
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(executable, args, {
        cwd,
        windowsHide: true,
        stdio: ['ignore', captureStdout ? 'pipe' : 'ignore', 'pipe'],
      });
    } catch (error) {
      reject(new SegmentedMediaToolError('start', 'Unable to start the media validation tool.', error));
      return;
    }
    activeJobs.set(transferId, child);
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    timeout.unref?.();
    if (captureStdout) {
      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdout.length < 1024 * 1024) stdout += chunk.toString('utf8').slice(0, 1024 * 1024 - stdout.length);
      });
    }
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 8 * 1024) stderr += chunk.toString('utf8').slice(0, 8 * 1024 - stderr.length);
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (activeJobs.get(transferId) === child) activeJobs.delete(transferId);
      reject(new SegmentedMediaToolError('start', 'Unable to start the media validation tool.', error));
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (activeJobs.get(transferId) === child) activeJobs.delete(transferId);
      if (cancelledJobs.has(transferId)) {
        reject(new SegmentedMediaCancelledError());
      } else if (timedOut) {
        reject(new SegmentedMediaToolError('timeout', `${path.basename(executable)} timed out.`));
      } else if (code !== 0) {
        reject(new SegmentedMediaToolError('exit', `${path.basename(executable)} failed (${code ?? 'signal'}): ${stderr.trim().slice(-1_000)}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

async function asSourceValidation<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof SegmentedMediaCancelledError || error instanceof SegmentedMediaSourceValidationError) throw error;
    if (error instanceof SegmentedMediaToolError && error.phase !== 'exit') throw error;
    throw new SegmentedMediaSourceValidationError('The selected video could not be merged or decoded.', error);
  }
}

function throwIfCancelled(transferId: string): void {
  if (cancelledJobs.has(transferId)) throw new SegmentedMediaCancelledError();
}

function pruneCompletedTransfers(): void {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [transferId, completedAt] of completedTransfers) {
    if (completedAt < cutoff) completedTransfers.delete(transferId);
  }
}

async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk: Buffer) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });
}

async function rmFile(filePath: string): Promise<void> {
  await rm(filePath, { force: true }).catch(() => undefined);
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left).replace(/\\/gu, '/');
  const normalizedRight = path.resolve(right).replace(/\\/gu, '/');
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}
