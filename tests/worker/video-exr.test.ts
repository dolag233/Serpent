import { existsSync, mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  LibraryService,
  defaultSpawnFn,
  type LibraryServiceDiagnostic,
  type SpawnFunction,
  type SpawnResult,
} from '../../src/worker/library-service';
import { AUDIO_WAVEFORM_COVER_GENERATOR_TAG } from '../../src/shared/audio-media';
import { importNoConflict as sharedImportNoConflict } from './import-no-conflict';

const temporaryRoots: string[] = [];
const require = createRequire(import.meta.url);

interface TestDatabaseConnection {
  close(): void;
  exec(source: string): void;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  prepare(source: string): {
    all(...parameters: unknown[]): unknown[];
    get(...parameters: unknown[]): unknown;
    run(...parameters: unknown[]): unknown;
  };
}

const TestDatabase = require('better-sqlite3') as new (
  filename: string,
) => TestDatabaseConnection;

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-video-exr-'));
  temporaryRoots.push(root);
  return root;
}

const VALID_1X1_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64',
);

function createTestImage(destPath: string): void {
  mkdirSync(path.dirname(destPath), { recursive: true });
  writeFileSync(destPath, VALID_1X1_PNG);
}

function importNoConflict(
  service: LibraryService,
  libraryId: string,
  sourcePath: string,
): void {
  sharedImportNoConflict(service, libraryId, sourcePath);
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    try {
      rmSync(root, { force: true, recursive: true });
    } catch {
      // Cleanup is best-effort.
    }
  }
  // Clean up process.env side effects
  delete process.env['SERPENT_FFMPEG_PATH'];
  delete process.env['SERPENT_OIIO_PATH'];
});

// ── Mock spawn factories ───────────────────────────────────────────

/** Canned ffprobe JSON for a 30s 1920x1080 MP4. */
const CANNED_FFPROBE_JSON = JSON.stringify({
  streams: [
    {
      codec_type: 'video',
      codec_name: 'h264',
      width: 1920,
      height: 1080,
      r_frame_rate: '30000/1001',
      pix_fmt: 'yuv420p',
      bit_rate: '5000000',
      side_data_list: [{ rotation: -90 }],
    },
    {
      codec_type: 'audio',
      codec_name: 'aac',
      channels: 2,
      sample_rate: '48000',
    },
  ],
  format: {
    filename: '/fake/video.mp4',
    format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
    duration: '30.05',
    bit_rate: '5500000',
  },
});

/** Create a mock spawnFn that returns canned responses based on command name. */
interface MockSpawnConfig {
  ffprobeStdout?: string;
  ffprobeExitCode?: number;
  ffmpegExitCode?: number;
  oiiotoolExitCode?: number;
  /** Simulate ENOENT for a specific command */
  enoentCommand?: string;
}

function createMockSpawn(config: MockSpawnConfig): SpawnFunction {
  return async (
    command: string,
    args: string[],
  ): Promise<SpawnResult> => {
    if (config.enoentCommand && command === config.enoentCommand) {
      const err = new Error(
        `ENOENT: no such file or directory, open '${command}'`,
      );
      (err as NodeJS.ErrnoException).code = 'ENOENT';
      throw err;
    }

    // Write a small output file for any spawn that produces an output
    // (last argument is always the output file path).
    const outputPath = args[args.length - 1];
    const outputExtensions = ['.jpg', '.webm', '.ogg', '.png', '.webp', '.json'];
    if (outputPath && outputExtensions.some((ext) => outputPath.endsWith(ext))) {
      mkdirSync(path.dirname(outputPath), { recursive: true });
      // Valid 1×1 transparent PNG so sharp.flatten can composite waveform covers.
      // Other formats keep a tiny opaque stub.
      if (outputPath.endsWith('.png')) {
        writeFileSync(
          outputPath,
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
            'base64',
          ),
        );
      } else {
        writeFileSync(outputPath, Buffer.from('mock-output-data'));
      }
    }

    if (command === '/fake/ffprobe' || command.includes('ffprobe')) {
      return {
        stdout: Buffer.from(config.ffprobeStdout ?? CANNED_FFPROBE_JSON, 'utf-8'),
        stderr: '',
        exitCode: config.ffprobeExitCode ?? 0,
      };
    }

    if (command === '/fake/ffmpeg' || command.includes('ffmpeg')) {
      return {
        stdout: Buffer.alloc(0),
        stderr: '',
        exitCode: config.ffmpegExitCode ?? 0,
      };
    }

    if (command === '/fake/oiiotool' || command.includes('oiiotool')) {
      return {
        stdout: Buffer.alloc(0),
        stderr: '',
        exitCode: config.oiiotoolExitCode ?? 0,
      };
    }

    // Unknown command: simulate ENOENT
    const err = new Error(`ENOENT: no such file or directory, open '${command}'`);
    (err as NodeJS.ErrnoException).code = 'ENOENT';
    throw err;
  };
}

function assertDb(
  libraryPath: string,
): TestDatabaseConnection {
  return new TestDatabase(path.join(libraryPath, '.serpent', 'library.db'));
}

// ── Tests ──────────────────────────────────────────────────────────

describe('video (ffprobe + ffmpeg)', () => {
  it('generates extracted_metadata artifact from ffprobe JSON', async () => {
    process.env['SERPENT_FFMPEG_PATH'] = '/fake/ffmpeg';
    const root = temporaryRoot();
    const service = new LibraryService({
      spawnFn: createMockSpawn({ ffprobeStdout: CANNED_FFPROBE_JSON }),
    });
    const created = service.createLibrary({
      displayName: 'VideoProbe',
      selectedParentPath: root,
    });

    // Create a dummy MP4 file
    const sourcePath = path.join(root, 'video.mp4');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(service, created.libraryId, sourcePath);

    const assets = service.listAssets({
      libraryId: created.libraryId,
      recursive: true,
    });
    expect(assets).toHaveLength(1);

    service.enqueueThumbnailJobs(created.libraryId);
    await service.processThumbnailQueue(created.libraryId);

    // Verify extracted_metadata artifact
    const db = assertDb(created.libraryPath);
    const metaRow = db
      .prepare(
        "SELECT kind, status, mime_type, width, height FROM revision_artifacts WHERE kind = 'extracted_metadata'",
      )
      .get() as {
        kind: string;
        status: string;
        mime_type: string;
        width: number;
        height: number;
      } | undefined;
    expect(metaRow).toBeDefined();
    expect(metaRow!.kind).toBe('extracted_metadata');
    expect(metaRow!.status).toBe('ready');
    expect(metaRow!.mime_type).toBe('application/json');
    expect(metaRow!.width).toBe(1920);
    expect(metaRow!.height).toBe(1080);

    // Verify metadata JSON content
    const metaArtifact = db
      .prepare(
        "SELECT file_path FROM revision_artifacts WHERE kind = 'extracted_metadata'",
      )
      .get() as { file_path: string };
    const jsonPath = path.join(
      created.libraryPath,
      '.serpent',
      'artifacts',
      metaArtifact.file_path,
    );
    expect(existsSync(jsonPath)).toBe(true);
    const metadata = JSON.parse(
      require('node:fs').readFileSync(jsonPath, 'utf-8'),
    );
    expect(metadata.durationMs).toBe(30050);
    expect(metadata.width).toBe(1920);
    expect(service.listAssets({ libraryId: created.libraryId, recursive: true })[0])
      .toMatchObject({ width: 1920, height: 1080, durationMs: 30050 });
    expect(metadata.height).toBe(1080);
    expect(metadata.rotation).toBe(-90);
    expect(metadata.videoCodec).toBe('h264');
    expect(metadata.hasAudio).toBe(true);

    const extracted = service.getExtractedMetadata({
      libraryId: created.libraryId,
      assetId: assets[0]!.assetId,
    });
    expect(extracted.status).toBe('ready');
    expect(extracted.metadata).toMatchObject({
      videoCodec: 'h264',
      audioCodec: 'aac',
      framerate: '30000/1001',
      videoBitrate: '5000000',
      hasAudio: true,
      containerBitrate: '5500000',
    });

    db.close();
    service.closeAll();
  });

  it('returns missing extracted metadata safely before probe', () => {
    process.env['SERPENT_FFMPEG_PATH'] = '/fake/ffmpeg';
    const root = temporaryRoot();
    const service = new LibraryService({
      spawnFn: createMockSpawn({ ffprobeStdout: CANNED_FFPROBE_JSON }),
    });
    const created = service.createLibrary({
      displayName: 'VideoMetaMissing',
      selectedParentPath: root,
    });
    const sourcePath = path.join(root, 'video.mp4');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(service, created.libraryId, sourcePath);
    const assets = service.listAssets({
      libraryId: created.libraryId,
      recursive: true,
    });
    expect(assets).toHaveLength(1);

    const extracted = service.getExtractedMetadata({
      libraryId: created.libraryId,
      assetId: assets[0]!.assetId,
    });
    expect(extracted).toMatchObject({
      assetId: assets[0]!.assetId,
      status: 'missing',
      metadata: null,
    });

    service.closeAll();
  });

  it('generates video_poster artifact via ffmpeg', async () => {
    process.env['SERPENT_FFMPEG_PATH'] = '/fake/ffmpeg';
    const root = temporaryRoot();
    const capturedSpawnArgs: Array<{ command: string; args: string[] }> = [];
    const service = new LibraryService({
      spawnFn: async (command, args) => {
        capturedSpawnArgs.push({ command, args });
        // Write output files
        const outPath = args[args.length - 1];
        if (outPath && (outPath.endsWith('.jpg') || outPath.endsWith('.webm') || outPath.endsWith('.json'))) {
          mkdirSync(path.dirname(outPath), { recursive: true });
          writeFileSync(outPath, Buffer.from('mock-output-data'));
        }
        if (command === '/fake/ffprobe' || command.includes('ffprobe')) {
          return { stdout: Buffer.from(CANNED_FFPROBE_JSON, 'utf-8'), stderr: '', exitCode: 0 };
        }
        return { stdout: Buffer.alloc(0), stderr: '', exitCode: 0 };
      },
    });
    const created = service.createLibrary({
      displayName: 'VideoPoster',
      selectedParentPath: root,
    });

    const sourcePath = path.join(root, 'video.avi');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(service, created.libraryId, sourcePath);

    service.enqueueThumbnailJobs(created.libraryId);
    await service.processThumbnailQueue(created.libraryId);

    // Verify video_poster artifact exists
    const db = assertDb(created.libraryPath);
    const posterRow = db
      .prepare(
        "SELECT kind, status, mime_type FROM revision_artifacts WHERE kind = 'video_poster'",
      )
      .get() as { kind: string; status: string; mime_type: string } | undefined;
    expect(posterRow).toBeDefined();
    expect(posterRow!.kind).toBe('video_poster');
    expect(posterRow!.status).toBe('ready');
    expect(posterRow!.mime_type).toBe('image/jpeg');

    // Verify ffmpeg poster args are well-formed
    const posterCall = capturedSpawnArgs.find(
      (c) => c.command === '/fake/ffmpeg' && c.args.includes('-vf'),
    );
    expect(posterCall).toBeDefined();
    // Check that the poster filter includes the thumbnail filter
    const vfIdx = posterCall!.args.indexOf('-vf');
    expect(vfIdx).not.toBe(-1);
    const vfValue = posterCall!.args[vfIdx + 1] as string;
    expect(vfValue).toContain('thumbnail');
    expect(vfValue).toContain('scale=640:-1');
    expect(vfValue).not.toContain('fps=');
    expect(posterCall!.args).toContain('-frames:v');
    expect(posterCall!.args).toContain('1');

    db.close();
    service.closeAll();
  });

  it('generates a font-independent contact_sheet with fps/scale/tile args', async () => {
    process.env['SERPENT_FFMPEG_PATH'] = '/fake/ffmpeg';
    const root = temporaryRoot();
    const capturedSpawnArgs: Array<{ command: string; args: string[] }> = [];
    const service = new LibraryService({
      spawnFn: async (command, args) => {
        capturedSpawnArgs.push({ command, args });
        // Write output file for any output extension
        const outPath = args[args.length - 1];
        if (outPath && (outPath.endsWith('.jpg') || outPath.endsWith('.webm') || outPath.endsWith('.json'))) {
          mkdirSync(path.dirname(outPath), { recursive: true });
          writeFileSync(outPath, Buffer.from('mock-output-data'));
        }
        // Return ffprobe JSON for the probe step
        if (command === '/fake/ffprobe' || command.includes('ffprobe')) {
          return { stdout: Buffer.from(CANNED_FFPROBE_JSON, 'utf-8'), stderr: '', exitCode: 0 };
        }
        return { stdout: Buffer.alloc(0), stderr: '', exitCode: 0 };
      },
    });
    const created = service.createLibrary({
      displayName: 'ContactSheet',
      selectedParentPath: root,
    });

    const sourcePath = path.join(root, 'video.mp4');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(service, created.libraryId, sourcePath);

    service.enqueueThumbnailJobs(created.libraryId);
    await service.processThumbnailQueue(created.libraryId);

    // Verify contact_sheet artifact exists
    const db = assertDb(created.libraryPath);
    const sheetRow = db
      .prepare(
        "SELECT kind, status, mime_type FROM revision_artifacts WHERE kind = 'contact_sheet'",
      )
      .get() as { kind: string; status: string; mime_type: string } | undefined;
    expect(sheetRow).toBeDefined();
    expect(sheetRow!.kind).toBe('contact_sheet');
    expect(sheetRow!.status).toBe('ready');
    expect(sheetRow!.mime_type).toBe('image/jpeg');

    // Verify contact sheet filter args are well-formed
    const sheetCall = capturedSpawnArgs.find(
      (c) => c.command === '/fake/ffmpeg' &&
        c.args.includes('-vf') &&
        c.args.some((a) => a.includes('tile=')),
    );
    expect(sheetCall).toBeDefined();
    const vfIdx2 = sheetCall!.args.indexOf('-vf');
    const vfValue2 = sheetCall!.args[vfIdx2 + 1] as string;
    expect(vfValue2).toContain('fps=');
    expect(vfValue2).toContain('scale=');
    // Serpent-6w40: the AI contact sheet stamps a timestamp (HH:MM:SS.mmm)
    // on every frame using the bundled DejaVu Sans font.
    expect(vfValue2).toContain('drawtext=');
    expect(vfValue2).toContain('%{pts:hms}');
    expect(vfValue2).toContain('DejaVuSans.ttf');
    expect(vfValue2).toContain('tile=');

    db.close();
    service.closeAll();
  });

  it('generates webm_proxy artifact with VP9/Opus args', async () => {
    process.env['SERPENT_FFMPEG_PATH'] = '/fake/ffmpeg';
    const root = temporaryRoot();
    const capturedSpawnArgs: Array<{ command: string; args: string[] }> = [];
    const service = new LibraryService({
      spawnFn: async (command, args) => {
        capturedSpawnArgs.push({ command, args });
        const outPath = args[args.length - 1];
        if (outPath && (outPath.endsWith('.webm') || outPath.endsWith('.jpg') || outPath.endsWith('.json'))) {
          mkdirSync(path.dirname(outPath), { recursive: true });
          writeFileSync(outPath, Buffer.from('mock-output-data'));
        }
        if (command === '/fake/ffprobe' || command.includes('ffprobe')) {
          return { stdout: Buffer.from(CANNED_FFPROBE_JSON, 'utf-8'), stderr: '', exitCode: 0 };
        }
        return { stdout: Buffer.alloc(0), stderr: '', exitCode: 0 };
      },
    });
    const created = service.createLibrary({
      displayName: 'WebmProxy',
      selectedParentPath: root,
    });

    const sourcePath = path.join(root, 'video.avi');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(service, created.libraryId, sourcePath);

    const assets = service.listAssets({
      libraryId: created.libraryId,
      recursive: true,
    });
    service.enqueueThumbnailJobs(created.libraryId);
    await service.processThumbnailQueue(created.libraryId);

    // Verify webm_proxy artifact
    const db = assertDb(created.libraryPath);
    const proxyRow = db
      .prepare(
        "SELECT kind, status, mime_type FROM revision_artifacts WHERE kind = 'webm_proxy'",
      )
      .get() as { kind: string; status: string; mime_type: string } | undefined;
    expect(proxyRow).toBeDefined();
    expect(proxyRow!.kind).toBe('webm_proxy');
    expect(proxyRow!.status).toBe('ready');
    expect(proxyRow!.mime_type).toBe('video/webm');

    expect(service.getPreviewArtifact(created.libraryId, assets[0]!.assetId)).toMatchObject({
      mediaType: 'video',
      status: 'ready',
      kind: 'webm_proxy',
      mimeType: 'video/webm',
    });

    // Verify webm proxy args are well-formed
    const proxyCall = capturedSpawnArgs.find(
      (c) => c.command === '/fake/ffmpeg' && c.args.includes('libvpx-vp9'),
    );
    expect(proxyCall).toBeDefined();
    expect(proxyCall!.args).toContain('-c:v');
    expect(proxyCall!.args).toContain('libvpx-vp9');
    expect(proxyCall!.args).toContain('-c:a');
    expect(proxyCall!.args).toContain('libopus');
    expect(proxyCall!.args).toContain('-g');
    expect(proxyCall!.args).toContain('60');
    expect(proxyCall!.args).toContain('-row-mt');
    expect(proxyCall!.args).not.toContain('-row-mv');
    const proxyFilterIndex = proxyCall!.args.indexOf('-vf');
    expect(proxyCall!.args[proxyFilterIndex + 1]).toBe(
      'scale=w=min(720\\,iw):h=min(720\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2',
    );

    db.close();
    service.closeAll();
  });

  it('keeps the ORIGINAL source for natively playable videos even when a proxy artifact exists (REQ-VIEW-002)', async () => {
    // Regression: the video resolution branch used to return playbackMode
    // 'proxy' whenever a ready webm_proxy artifact existed, so the viewer
    // played the WebM derivative instead of the original MP4. REQ-VIEW-002
    // requires the viewer to always present the original source; the proxy
    // stays for non-native containers (AVI/WMV) and hover derivatives.
    process.env['SERPENT_FFMPEG_PATH'] = '/fake/ffmpeg';
    const root = temporaryRoot();
    const service = new LibraryService({
      spawnFn: async (command, args) => {
        const outPath = args[args.length - 1];
        if (
          outPath &&
          (outPath.endsWith('.webm') ||
            outPath.endsWith('.jpg') ||
            outPath.endsWith('.json'))
        ) {
          mkdirSync(path.dirname(outPath), { recursive: true });
          writeFileSync(outPath, Buffer.from('mock-output-data'));
        }
        if (command === '/fake/ffprobe' || command.includes('ffprobe')) {
          return {
            stdout: Buffer.from(CANNED_FFPROBE_JSON, 'utf-8'),
            stderr: '',
            exitCode: 0,
          };
        }
        return { stdout: Buffer.alloc(0), stderr: '', exitCode: 0 };
      },
    });
    const created = service.createLibrary({
      displayName: 'DirectSource',
      selectedParentPath: root,
    });
    const sourcePath = path.join(root, 'video.mp4');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(service, created.libraryId, sourcePath);
    const assets = service.listAssets({
      libraryId: created.libraryId,
      recursive: true,
    });

    // Run the media queue so the ffprobe probe artifact (source of the
    // sourceCodecs hint) is written, like a real ingested video.
    service.enqueueThumbnailJobs(created.libraryId);
    await service.processThumbnailQueue(created.libraryId);

    // Premise: a ready WebM proxy derivative exists for the MP4.
    const proxyArtifact = service.writeDerivedArtifact({
      libraryId: created.libraryId,
      assetId: assets[0]!.assetId,
      kind: 'webm_proxy',
      mimeType: 'video/webm',
      bytes: Buffer.from('mock-proxy-bytes'),
      generatorVersion: 'test',
      maxBytes: 1024 * 1024,
    });
    expect(proxyArtifact.artifactId).toBeTruthy();

    // The viewer resolution must still present the ORIGINAL source, with the
    // container/codecs populated so the renderer can probe and pre-warm the
    // proxy only as a fallback.
    expect(
      service.getPreviewArtifact(created.libraryId, assets[0]!.assetId),
    ).toMatchObject({
      mediaType: 'video',
      status: 'ready',
      playbackMode: 'source',
      sourceMimeType: 'video/mp4',
      sourceContainer: 'mp4',
      sourceCodecs: ['h264'],
    });

    // Hover previews keep the proxy-first behavior: with a ready proxy the
    // 'hover' intent returns the lightweight WebM, never the original source.
    expect(
      service.getPreviewArtifact(created.libraryId, assets[0]!.assetId, 'hover'),
    ).toMatchObject({
      mediaType: 'video',
      status: 'ready',
      kind: 'webm_proxy',
      mimeType: 'video/webm',
      playbackMode: 'proxy',
    });

    service.closeAll();
  });

  it('rejects and removes a WebM proxy above the 512 MiB safety limit', async () => {
    process.env['SERPENT_FFMPEG_PATH'] = '/fake/ffmpeg';
    const root = temporaryRoot();
    const diagnostics: LibraryServiceDiagnostic[] = [];
    const service = new LibraryService({
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      spawnFn: async (_command, args) => {
        const outputPath = args[args.length - 1]!;
        mkdirSync(path.dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, Buffer.from('oversized-proxy'));
        truncateSync(outputPath, 512 * 1024 * 1024 + 1);
        return { stdout: Buffer.alloc(0), stderr: '', exitCode: 0 };
      },
    });
    const created = service.createLibrary({
      displayName: 'OversizedWebmProxy',
      selectedParentPath: root,
    });
    const sourcePath = path.join(root, 'oversized.avi');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(service, created.libraryId, sourcePath);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;

    const jobId = service.enqueueArtifactRetry({
      libraryId: created.libraryId,
      assetId: asset.assetId,
      kind: 'webm_proxy',
    });
    await service.processThumbnailQueue(created.libraryId, { maxJobs: 1 });

    expect(service.listMediaJobs(created.libraryId).jobs.find((job) => job.jobId === jobId))
      .toMatchObject({ status: 'failed', errorCode: 'MEDIA_PROCESSING_FAILED' });
    const artifact = service.getCurrentArtifact(created.libraryId, asset.assetId, 'webm_proxy');
    expect(artifact).toMatchObject({ status: 'failed', errorCode: 'MEDIA_PROCESSING_FAILED' });
    expect(existsSync(path.join(created.libraryPath, '.serpent', 'artifacts', artifact!.filePath)))
      .toBe(false);
    expect(diagnostics).toContainEqual(expect.objectContaining({
      scope: 'media-job.failed',
      context: expect.objectContaining({ errorCode: 'MEDIA_PROCESSING_FAILED' }),
      error: expect.objectContaining({ message: expect.stringContaining('512 MiB') }),
    }));
    service.closeAll();
  });

  it('writes failed artifact when ffmpeg binary is missing (ENOENT)', async () => {
    // Set env to a path that doesn't exist; our spawnFn will throw ENOENT
    process.env['SERPENT_FFMPEG_PATH'] = '/fake/ffmpeg-missing';
    const root = temporaryRoot();
    const service = new LibraryService({
      spawnFn: createMockSpawn({
        enoentCommand: '/fake/ffmpeg-missing',
        // ffprobe also needs to throw for the integrated flow
        ffprobeStdout: CANNED_FFPROBE_JSON,
        ffprobeExitCode: 0,
      }),
    });
    const created = service.createLibrary({
      displayName: 'MissingFFmpeg',
      selectedParentPath: root,
    });

    const sourcePath = path.join(root, 'video.mp4');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(service, created.libraryId, sourcePath);

    const assets = service.listAssets({
      libraryId: created.libraryId,
      recursive: true,
    });

    await expect(service.generateThumbnail({
      libraryId: created.libraryId,
      assetId: assets[0]!.assetId,
    })).rejects.toMatchObject({ reason: 'MEDIA_PROCESSING_FAILED' });

    // Verify failed video_poster artifact with FFMPEG_REQUIRED
    const db = assertDb(created.libraryPath);
    const failedRows = db
      .prepare(
        "SELECT kind, status, error_code FROM revision_artifacts WHERE status = 'failed' AND error_code = 'FFMPEG_REQUIRED'",
      )
      .all() as Array<{ kind: string; status: string; error_code: string }>;
    expect(failedRows.length).toBeGreaterThanOrEqual(1);
    const posterFailed = failedRows.find((r) => r.kind === 'video_poster');
    expect(posterFailed).toBeDefined();

    // REQ-VIEW-002: the MP4 container is natively playable, so the viewer
    // resolution stays on the ORIGINAL source even when proxy generation
    // failed (the failed-artifact evidence is asserted above).
    expect(service.getPreviewArtifact(created.libraryId, assets[0]!.assetId)).toMatchObject({
      mediaType: 'video',
      status: 'ready',
      playbackMode: 'source',
      mimeType: 'video/mp4',
    });

    db.close();
    service.closeAll();
  });

  it('automatically requeues a component failure after the media environment is repaired', async () => {
    process.env['SERPENT_FFMPEG_PATH'] = '/fake/ffmpeg';
    const root = temporaryRoot();
    const failedService = new LibraryService({
      spawnFn: createMockSpawn({
        enoentCommand: '/fake/ffmpeg',
      }),
    });
    const created = failedService.createLibrary({
      displayName: 'AutoRepairVideo',
      selectedParentPath: root,
    });
    const sourcePath = path.join(root, 'video.mp4');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(failedService, created.libraryId, sourcePath);
    const asset = failedService.listAssets({
      libraryId: created.libraryId,
      recursive: true,
    })[0]!;

    expect(failedService.enqueueThumbnailJobs(created.libraryId)).toBe(1);
    await failedService.processThumbnailQueue(created.libraryId, { maxJobs: 1 });
    expect(failedService.listMediaJobs(created.libraryId).jobs[0]).toMatchObject({
      status: 'failed',
      errorCode: 'FFMPEG_REQUIRED',
    });
    failedService.closeAll();

    const repairedService = new LibraryService({
      mediaComponentProbe: (component) => component === 'ffmpeg',
      spawnFn: createMockSpawn({}),
    });
    repairedService.openLibrary(created.libraryPath);

    expect(repairedService.listMediaJobs(created.libraryId).jobs).toEqual([
      expect.objectContaining({
        status: 'queued',
        errorCode: null,
        attemptCount: 0,
      }),
    ]);
    expect(repairedService.enqueueThumbnailJobs(created.libraryId, {
      repairFailed: true,
    })).toBe(0);
    expect(repairedService.listMediaJobs(created.libraryId).jobs).toHaveLength(1);
    await repairedService.processThumbnailQueue(created.libraryId, { maxJobs: 1 });
    expect(repairedService.getCurrentArtifact(
      created.libraryId,
      asset.assetId,
      'video_poster',
    )).toMatchObject({ status: 'ready' });
    expect(repairedService.listMediaJobs(created.libraryId).jobs.find(
      (job) => job.kind === 'generate_thumbnail',
    )).toMatchObject({
      status: 'succeeded',
      errorCode: null,
    });
    repairedService.closeAll();
  });

  it('automatically requeues an OIIO component failure after repair', async () => {
    process.env['SERPENT_OIIO_PATH'] = '/fake/oiiotool';
    const root = temporaryRoot();
    const failedService = new LibraryService({
      spawnFn: createMockSpawn({
        enoentCommand: '/fake/oiiotool',
      }),
    });
    const created = failedService.createLibrary({
      displayName: 'AutoRepairOiio',
      selectedParentPath: root,
    });
    const sourcePath = path.join(root, 'render.exr');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(failedService, created.libraryId, sourcePath);
    const asset = failedService.listAssets({
      libraryId: created.libraryId,
      recursive: true,
    })[0]!;

    expect(failedService.enqueueThumbnailJobs(created.libraryId)).toBe(1);
    await failedService.processThumbnailQueue(created.libraryId, { maxJobs: 1 });
    expect(failedService.listMediaJobs(created.libraryId).jobs[0]).toMatchObject({
      status: 'failed',
      errorCode: 'OIIO_REQUIRED',
    });
    failedService.closeAll();

    const repairedService = new LibraryService({
      mediaComponentProbe: (component) => component === 'oiio',
      spawnFn: createMockSpawn({}),
    });
    repairedService.openLibrary(created.libraryPath);
    expect(repairedService.listMediaJobs(created.libraryId).jobs).toEqual([
      expect.objectContaining({
        status: 'queued',
        errorCode: null,
        attemptCount: 0,
      }),
    ]);

    await repairedService.processThumbnailQueue(created.libraryId, { maxJobs: 1 });
    expect(repairedService.getCurrentArtifact(
      created.libraryId,
      asset.assetId,
      'thumbnail',
    )).toMatchObject({ status: 'ready' });
    const jobsBeforeSecondRepair = repairedService.listMediaJobs(created.libraryId).jobs;
    expect(repairedService.enqueueThumbnailJobs(created.libraryId, {
      repairFailed: true,
    })).toBe(0);
    expect(repairedService.listMediaJobs(created.libraryId).jobs).toHaveLength(
      jobsBeforeSecondRepair.length,
    );
    repairedService.closeAll();
  });

  it('automatically requeues a failed audio proxy after FFmpeg is repaired', async () => {
    process.env['SERPENT_FFMPEG_PATH'] = '/fake/ffmpeg';
    const root = temporaryRoot();
    const failedService = new LibraryService({
      spawnFn: createMockSpawn({ enoentCommand: '/fake/ffmpeg' }),
    });
    const created = failedService.createLibrary({
      displayName: 'AutoRepairAudioProxy',
      selectedParentPath: root,
    });
    const sourcePath = path.join(root, 'voice.flac');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(failedService, created.libraryId, sourcePath);
    const asset = failedService.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;
    failedService.enqueueArtifactRetry({
      libraryId: created.libraryId,
      assetId: asset.assetId,
      kind: 'audio_proxy',
    });
    await failedService.processThumbnailQueue(created.libraryId, { maxJobs: 1 });
    expect(failedService.getCurrentArtifact(created.libraryId, asset.assetId, 'audio_proxy'))
      .toMatchObject({ status: 'failed', errorCode: 'FFMPEG_REQUIRED' });
    failedService.closeAll();

    const repairedService = new LibraryService({
      mediaComponentProbe: (component) => component === 'ffmpeg',
      spawnFn: createMockSpawn({}),
    });
    repairedService.openLibrary(created.libraryPath);
    expect(repairedService.listMediaJobs(created.libraryId).jobs.find((job) =>
      job.assetId === asset.assetId && job.kind === 'generate_audio_proxy',
    )).toMatchObject({ status: 'queued', errorCode: null, attemptCount: 0 });
    repairedService.closeAll();
  });

  it('throttles repeated probes while a required component remains unavailable', () => {
    process.env['SERPENT_FFMPEG_PATH'] = '/fake/ffmpeg';
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({
      displayName: 'AutoRepairProbeThrottle',
      selectedParentPath: root,
    });
    const sourcePath = path.join(root, 'video.mp4');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(service, created.libraryId, sourcePath);
    const asset = service.listAssets({
      libraryId: created.libraryId,
      recursive: true,
    })[0]!;
    const db = assertDb(created.libraryPath);
    db.prepare(
      `INSERT INTO revision_artifacts
         (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
          generator_version, status, error_code, generated_at)
       VALUES (?, ?, 'video_poster', 'image/jpeg', 0, ?, 'test', 'failed',
               'FFMPEG_REQUIRED', ?)`,
    ).run(
      randomUUID(),
      asset.currentRevisionId,
      'failed-poster.jpg',
      new Date().toISOString(),
    );
    db.close();
    service.closeAll();

    let probeCount = 0;
    const reopened = new LibraryService({
      mediaComponentProbe: () => {
        probeCount += 1;
        return false;
      },
    });
    reopened.openLibrary(created.libraryPath);
    expect(probeCount).toBe(1);
    expect(reopened.enqueueThumbnailJobs(created.libraryId, {
      repairFailed: true,
    })).toBe(0);
    expect(probeCount).toBe(1);
    reopened.closeAll();
  });

  it('does not automatically retry a non-component thumbnail failure', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({
      displayName: 'NoAutoRepairForCorruptInput',
      selectedParentPath: root,
    });
    const sourcePath = path.join(root, 'image.png');
    createTestImage(sourcePath);
    importNoConflict(service, created.libraryId, sourcePath);
    const asset = service.listAssets({
      libraryId: created.libraryId,
      recursive: true,
    })[0]!;
    const db = assertDb(created.libraryPath);
    db.prepare(
      `INSERT INTO revision_artifacts
         (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
          generator_version, status, error_code, generated_at)
       VALUES (?, ?, 'thumbnail', 'image/webp', 0, ?, 'test', 'failed',
               'THUMBNAIL_GENERATION_FAILED', ?)`,
    ).run(
      randomUUID(),
      asset.currentRevisionId,
      'failed-thumbnail.webp',
      new Date().toISOString(),
    );
    db.close();
    service.closeAll();

    const reopened = new LibraryService({
      mediaComponentProbe: () => true,
    });
    reopened.openLibrary(created.libraryPath);
    expect(reopened.listMediaJobs(created.libraryId).jobs).toHaveLength(0);
    reopened.closeAll();
  });

  it('invalidates the prior current artifacts before a successful retry', async () => {
    process.env['SERPENT_FFMPEG_PATH'] = '/fake/ffmpeg';
    const root = temporaryRoot();
    const service = new LibraryService({ spawnFn: createMockSpawn({}) });
    const created = service.createLibrary({ displayName: 'VideoRetry', selectedParentPath: root });
    const sourcePath = path.join(root, 'video.mp4');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(service, created.libraryId, sourcePath);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;

    const first = (await service.generateThumbnail({ libraryId: created.libraryId, assetId: asset.assetId }))!;
    const second = (await service.generateThumbnail({ libraryId: created.libraryId, assetId: asset.assetId }))!;

    expect(second.artifactId).not.toBe(first.artifactId);
    const db = assertDb(created.libraryPath);
    const posters = db.prepare(
      `SELECT artifact_id, status, invalidated_at
         FROM revision_artifacts
        WHERE revision_id = ? AND kind = 'video_poster'
        ORDER BY generated_at`,
    ).all(asset.currentRevisionId) as Array<{
      artifact_id: string;
      status: string;
      invalidated_at: string | null;
    }>;
    expect(posters).toHaveLength(2);
    expect(posters.filter((row) => row.invalidated_at === null)).toEqual([
      expect.objectContaining({ artifact_id: second.artifactId, status: 'ready' }),
    ]);
    expect(posters.find((row) => row.artifact_id === first.artifactId)?.invalidated_at).not.toBeNull();

    db.close();
    service.closeAll();
  });

  it('rejects a failed poster retry and leaves one current failed artifact', async () => {
    process.env['SERPENT_FFMPEG_PATH'] = '/fake/ffmpeg';
    const root = temporaryRoot();
    let failPoster = false;
    let assetChangeEvents = 0;
    const diagnostics: LibraryServiceDiagnostic[] = [];
    const service = new LibraryService({
      onAssetsChanged: () => { assetChangeEvents += 1; },
      onDiagnostic: (diagnostic) => { diagnostics.push(diagnostic); },
      spawnFn: async (command, args) => {
        const outputPath = args[args.length - 1];
        if (outputPath && /\.(?:jpg|webm)$/u.test(outputPath)) {
          mkdirSync(path.dirname(outputPath), { recursive: true });
          writeFileSync(outputPath, 'output');
        }
        if (command.includes('ffprobe')) {
          return { stdout: Buffer.from(CANNED_FFPROBE_JSON), stderr: '', exitCode: 0 };
        }
        const isPoster = args.includes('-frames:v') && args.includes('1');
        return {
          stdout: Buffer.alloc(0),
          stderr: isPoster && failPoster ? `${'discarded '.repeat(40)}POSTER_FAILURE_TAIL` : '',
          exitCode: isPoster && failPoster ? 1 : 0,
        };
      },
    });
    const created = service.createLibrary({ displayName: 'VideoRetryFailure', selectedParentPath: root });
    const sourcePath = path.join(root, 'video.mp4');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(service, created.libraryId, sourcePath);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;
    await service.generateThumbnail({ libraryId: created.libraryId, assetId: asset.assetId });

    assetChangeEvents = 0;
    failPoster = true;
    await expect(service.generateThumbnail({
      libraryId: created.libraryId,
      assetId: asset.assetId,
    })).rejects.toMatchObject({ reason: 'MEDIA_PROCESSING_FAILED' });
    expect(assetChangeEvents).toBe(0);
    const posterDiagnostic = diagnostics.find((diagnostic) => diagnostic.scope === 'video-poster');
    expect(posterDiagnostic?.error).toBeInstanceOf(Error);
    expect((posterDiagnostic?.error as Error).message.endsWith('POSTER_FAILURE_TAIL')).toBe(true);

    const db = assertDb(created.libraryPath);
    const currentPoster = db.prepare(
      `SELECT artifact_id, status, error_code
         FROM revision_artifacts
        WHERE revision_id = ? AND kind = 'video_poster' AND invalidated_at IS NULL`,
    ).get(asset.currentRevisionId) as {
      artifact_id: string;
      status: string;
      error_code: string;
    };
    expect(currentPoster.artifact_id).toBeTruthy();
    expect(currentPoster.status).toBe('failed');
    expect(currentPoster.error_code).toBe('VIDEO_POSTER_GENERATION_FAILED');

    db.close();
    service.closeAll();
  });
});

describe('media execution cancellation and global decoder limits', () => {
  it('terminates the default subprocess runner through AbortSignal', async () => {
    const controller = new AbortController();
    const running = defaultSpawnFn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      { timeoutMs: 30_000, signal: controller.signal },
    );
    controller.abort();
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('aborts an in-flight FFmpeg job and discards every late failure artifact', async () => {
    process.env['SERPENT_FFMPEG_PATH'] = '/fake/ffmpeg';
    const root = temporaryRoot();
    let started!: () => void;
    const spawnStarted = new Promise<void>((resolve) => { started = resolve; });
    let observedSignal: AbortSignal | undefined;
    const service = new LibraryService({
      spawnFn: async (_command, _args, options) => {
        observedSignal = options?.signal;
        started();
        return await new Promise<SpawnResult>((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('cancelled', 'AbortError')),
            { once: true },
          );
        });
      },
    });
    const created = service.createLibrary({ displayName: 'AbortVideo', selectedParentPath: root });
    const source = path.join(root, 'abort.mp4');
    writeFileSync(source, Buffer.alloc(1024));
    importNoConflict(service, created.libraryId, source);
    service.enqueueThumbnailJobs(created.libraryId);
    const jobId = service.listMediaJobs(created.libraryId).jobs[0]!.jobId;

    const processing = service.processThumbnailQueue(created.libraryId, { maxJobs: 1 });
    await spawnStarted;
    expect(service.cancelMediaJobs(created.libraryId, [jobId])).toEqual({ cancelledCount: 1 });
    await processing;

    expect(observedSignal?.aborted).toBe(true);
    expect(service.listMediaJobs(created.libraryId).jobs[0]!.status).toBe('cancelled');
    const db = assertDb(created.libraryPath);
    expect(db.prepare('SELECT COUNT(*) AS count FROM revision_artifacts').get()).toMatchObject({ count: 0 });
    db.close();
    service.closeAll();
  });

  it('limits FFmpeg and ffprobe to one subprocess across concurrent libraries', async () => {
    process.env['SERPENT_FFMPEG_PATH'] = '/fake/ffmpeg';
    const root = temporaryRoot();
    let active = 0;
    let maximum = 0;
    const spawnFn: SpawnFunction = async (command, args) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const output = args[args.length - 1]!;
      if (!command.includes('ffprobe')) {
        mkdirSync(path.dirname(output), { recursive: true });
        writeFileSync(output, Buffer.from('video-artifact'));
      }
      active -= 1;
      return {
        stdout: command.includes('ffprobe')
          ? Buffer.from(CANNED_FFPROBE_JSON)
          : Buffer.alloc(0),
        stderr: '',
        exitCode: 0,
      };
    };
    const targets: Array<{ service: LibraryService; libraryId: string; assetId: string }> = [];
    for (const [index, name] of ['one.mp4', 'two.mp4'].entries()) {
      const service = new LibraryService({ spawnFn });
      const created = service.createLibrary({ displayName: `FfmpegLimit-${index}`, selectedParentPath: root });
      const source = path.join(root, name);
      writeFileSync(source, Buffer.alloc(1024));
      importNoConflict(service, created.libraryId, source);
      targets.push({
        service,
        libraryId: created.libraryId,
        assetId: service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!.assetId,
      });
    }
    await Promise.all(targets.map((target) => target.service.generateThumbnail({
      libraryId: target.libraryId,
      assetId: target.assetId,
    })));
    expect(maximum).toBe(1);
    for (const target of targets) target.service.closeAll();
  });

  it('limits OpenImageIO to one subprocess across concurrent libraries', async () => {
    process.env['SERPENT_OIIO_PATH'] = '/fake/oiiotool';
    const root = temporaryRoot();
    let active = 0;
    let maximum = 0;
    const spawnFn: SpawnFunction = async (_command, args) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const output = args[args.length - 1]!;
      mkdirSync(path.dirname(output), { recursive: true });
      writeFileSync(output, VALID_1X1_PNG);
      active -= 1;
      return { stdout: Buffer.alloc(0), stderr: '', exitCode: 0 };
    };
    const targets: Array<{ service: LibraryService; libraryId: string; assetId: string }> = [];
    for (const [index, name] of ['one.exr', 'two.exr'].entries()) {
      const service = new LibraryService({ spawnFn });
      const created = service.createLibrary({ displayName: `OiioLimit-${index}`, selectedParentPath: root });
      const source = path.join(root, name);
      writeFileSync(source, Buffer.from('fake-exr'));
      importNoConflict(service, created.libraryId, source);
      targets.push({
        service,
        libraryId: created.libraryId,
        assetId: service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!.assetId,
      });
    }
    await Promise.all(targets.map((target) => target.service.generateThumbnail({
      libraryId: target.libraryId,
      assetId: target.assetId,
    })));
    expect(maximum).toBe(1);
    for (const target of targets) target.service.closeAll();
  });
});

describe('subprocess diagnostics', () => {
  it('caps stdout and stderr while preserving their tails', async () => {
    const nodePath = process.env['npm_node_execpath'] ?? 'node';
    const result = await defaultSpawnFn(nodePath, [
      '-e',
      `process.stdout.write('A'.repeat(9 * 1024 * 1024) + 'STDOUT_TAIL');` +
        `process.stderr.write('B'.repeat(600 * 1024) + 'STDERR_TAIL');`,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.byteLength).toBe(8 * 1024 * 1024);
    expect(result.stdout.toString('utf-8').endsWith('STDOUT_TAIL')).toBe(true);
    expect(Buffer.byteLength(result.stderr)).toBe(512 * 1024);
    expect(result.stderr.endsWith('STDERR_TAIL')).toBe(true);
  });
});

describe('EXR/TGA (oiiotool)', () => {
  it('generates PNG thumbnail artifact for EXR via oiiotool', async () => {
    process.env['SERPENT_OIIO_PATH'] = '/fake/oiiotool';
    const root = temporaryRoot();
    const capturedSpawnArgs: Array<{ command: string; args: string[] }> = [];
    const service = new LibraryService({
      spawnFn: async (command, args) => {
        capturedSpawnArgs.push({ command, args });
        // Write the output PNG
        const outPath = args[args.length - 1];
        if (outPath && outPath.endsWith('.png')) {
          mkdirSync(path.dirname(outPath), { recursive: true });
          writeFileSync(outPath, Buffer.from('fake-png-data'));
        }
        return { stdout: Buffer.alloc(0), stderr: '', exitCode: 0 };
      },
    });
    const created = service.createLibrary({
      displayName: 'EXRThumb',
      selectedParentPath: root,
    });

    const sourcePath = path.join(root, 'render.exr');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(service, created.libraryId, sourcePath);

    const assets = service.listAssets({
      libraryId: created.libraryId,
      recursive: true,
    });
    const result = (await service.generateThumbnail({
      libraryId: created.libraryId,
      assetId: assets[0]!.assetId,
    }))!;
    expect(result.artifactId).toBeTruthy();
    expect(result.artifactId).not.toBe('');

    // Verify thumbnail artifact
    const db = assertDb(created.libraryPath);
    const thumbRow = db
      .prepare(
        "SELECT kind, status, mime_type, generator_version FROM revision_artifacts WHERE kind = 'thumbnail'",
      )
      .get() as {
        kind: string;
        status: string;
        mime_type: string;
        generator_version: string;
      } | undefined;
    expect(thumbRow).toBeDefined();
    expect(thumbRow!.kind).toBe('thumbnail');
    expect(thumbRow!.status).toBe('ready');
    expect(thumbRow!.mime_type).toBe('image/png');
    expect(thumbRow!.generator_version).toContain('oiio@');

    // Verify oiiotool args
    const assetPath = service.resolveAssetPath(created.libraryId, assets[0]!.assetId);
    const oiioCall = capturedSpawnArgs.find(
      (c) => c.command === '/fake/oiiotool' && c.args.includes(assetPath) && c.args.includes('--colorconfig'),
    );
    expect(oiioCall).toBeDefined();
    expect(oiioCall!.args).toContain('--colorconfig');
    expect(oiioCall!.args).toContain('ocio://studio-config-v4.0.0_aces-v2.0_ocio-v2.5');
    expect(oiioCall!.args).toContain('--iscolorspace');
    expect(oiioCall!.args).toContain('scene_linear');
    expect(oiioCall!.args).toContain('--mulc');
    expect(oiioCall!.args).toContain('1,1,1,1');
    expect(oiioCall!.args).toContain('--ociodisplay:from=scene_linear:unpremult=1');
    const displayIndex = oiioCall!.args.indexOf('--ociodisplay:from=scene_linear:unpremult=1');
    expect(oiioCall!.args.slice(displayIndex + 1, displayIndex + 3)).toEqual(['', '']);
    expect(oiioCall!.args).toContain('--resize');
    expect(oiioCall!.args).toContain('0x512');
    expect(oiioCall!.args).toContain('-o');
    // Check that the input path is the resolved asset path (inside the library)
    expect(oiioCall!.args).toContain(assetPath);

    db.close();
    service.closeAll();
  });

  it('lists EXR parts and regenerates the selected part for the viewer', async () => {
    process.env['SERPENT_OIIO_PATH'] = '/fake/oiiotool';
    const root = temporaryRoot();
    const invocations: string[][] = [];
    const service = new LibraryService({
      spawnFn: async (_command, args) => {
        invocations.push(args);
        if (args.includes('--info')) {
          return {
            stdout: Buffer.from([
              ' subimage  0: 64 x 48, 3 channel, float openexr',
              '    name: "beauty"',
              ' subimage  1: 64 x 48, 3 channel, float openexr',
              '    name: "depth"',
              '',
            ].join('\n')),
            stderr: '',
            exitCode: 0,
          };
        }
        const outputPath = args.at(-1);
        if (outputPath?.endsWith('.png')) {
          mkdirSync(path.dirname(outputPath), { recursive: true });
          writeFileSync(outputPath, Buffer.from('fake-png-data'));
        }
        return { stdout: Buffer.alloc(0), stderr: '', exitCode: 0 };
      },
    });
    const created = service.createLibrary({ displayName: 'EXRParts', selectedParentPath: root });
    const sourcePath = path.join(root, 'layers.exr');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(service, created.libraryId, sourcePath);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;

    await service.generateThumbnail({ libraryId: created.libraryId, assetId: asset.assetId });
    await expect(service.resolvePreviewArtifact(created.libraryId, asset.assetId, 1))
      .resolves.toMatchObject({
        mediaType: 'image',
        status: 'ready',
        selectedExrPlane: 1,
        exrPlanes: [
          { index: 0, label: 'Part 0: beauty' },
          { index: 1, label: 'Part 1: depth' },
        ],
      });
    const partOneDecode = invocations.find((args) =>
      args.includes('--subimage') && args[args.indexOf('--subimage') + 1] === '1',
    );
    expect(partOneDecode).toBeDefined();
    const db = assertDb(created.libraryPath);
    expect(db.prepare(
      "SELECT generator_version FROM revision_artifacts WHERE kind = 'thumbnail' AND invalidated_at IS NULL",
    ).get()).toMatchObject({ generator_version: expect.stringContaining('subimage=1') });
    db.close();
    service.closeAll();
  });

  it('routes every OIIO-backed image and RAW format through a derived PNG', async () => {
    process.env['SERPENT_OIIO_PATH'] = '/fake/oiiotool';
    const root = temporaryRoot();
    const invocations: string[][] = [];
    const service = new LibraryService({
      spawnFn: async (_command, args) => {
        invocations.push(args);
        const outputPath = args.at(-1);
        if (outputPath?.endsWith('.png')) {
          mkdirSync(path.dirname(outputPath), { recursive: true });
          writeFileSync(outputPath, Buffer.from('fake-png-data'));
        }
        return { stdout: Buffer.alloc(0), stderr: '', exitCode: 0 };
      },
    });
    const created = service.createLibrary({ displayName: 'OiioFormatMatrix', selectedParentPath: root });
    const extensions = [
      'bmp', 'ico', 'psd', 'exr', 'tga', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'raf', 'orf', 'rw2',
    ];
    for (const extension of extensions) {
      const sourcePath = path.join(root, `sample.${extension}`);
      writeFileSync(sourcePath, Buffer.alloc(4096, 0));
      importNoConflict(service, created.libraryId, sourcePath);
    }

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    expect(assets).toHaveLength(extensions.length);
    for (const asset of assets) {
      const result = (await service.generateThumbnail({
        libraryId: created.libraryId,
        assetId: asset.assetId,
      }))!;
      expect(result.artifactId).toBeTruthy();
      expect(service.getCurrentArtifact(created.libraryId, asset.assetId, 'thumbnail'))
        .toMatchObject({ status: 'ready', mimeType: 'image/png' });
    }
    expect(invocations.filter((args) => args.includes('--colorconfig')))
      .toHaveLength(extensions.length);
    service.closeAll();
  });

  it('uses the OCIO display-transform path for TGA assets', async () => {
    process.env['SERPENT_OIIO_PATH'] = '/fake/oiiotool';
    const root = temporaryRoot();
    const capturedSpawnArgs: string[][] = [];
    const service = new LibraryService({
      spawnFn: async (_command, args) => {
        capturedSpawnArgs.push(args);
        const outputPath = args[args.length - 1];
        if (outputPath?.endsWith('.png')) {
          mkdirSync(path.dirname(outputPath), { recursive: true });
          writeFileSync(outputPath, Buffer.from('fake-png-data'));
        }
        return { stdout: Buffer.alloc(0), stderr: '', exitCode: 0 };
      },
    });
    const created = service.createLibrary({
      displayName: 'TGAThumb',
      selectedParentPath: root,
    });
    const sourcePath = path.join(root, 'paint.tga');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(service, created.libraryId, sourcePath);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;

    await service.generateThumbnail({ libraryId: created.libraryId, assetId: asset.assetId });

    const invocation = capturedSpawnArgs.find((args) => args.includes(
      service.resolveAssetPath(created.libraryId, asset.assetId),
    ) && args.includes('--colorconfig'));
    expect(invocation).toEqual(expect.arrayContaining([
      '--colorconfig',
      'ocio://studio-config-v4.0.0_aces-v2.0_ocio-v2.5',
      '--ociodisplay:from=scene_linear:unpremult=1',
      '',
      '1,1,1,1',
    ]));
    service.closeAll();
  });

  it('falls back from sharp to OIIO for a TIFF that sharp cannot decode', async () => {
    process.env['SERPENT_OIIO_PATH'] = '/fake/oiiotool';
    const root = temporaryRoot();
    const invocations: Array<{ command: string; args: string[] }> = [];
    const diagnostics: LibraryServiceDiagnostic[] = [];
    const service = new LibraryService({
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      spawnFn: async (command, args) => {
        invocations.push({ command, args });
        const outputPath = args[args.length - 1];
        if (outputPath?.endsWith('.png')) {
          mkdirSync(path.dirname(outputPath), { recursive: true });
          writeFileSync(outputPath, Buffer.from('fake-png-data'));
        }
        return { stdout: Buffer.alloc(0), stderr: '', exitCode: 0 };
      },
    });
    const created = service.createLibrary({
      displayName: 'ComplexTIFF',
      selectedParentPath: root,
    });
    const sourcePath = path.join(root, 'multi-part.tiff');
    writeFileSync(sourcePath, Buffer.from('unsupported-complex-tiff'));
    importNoConflict(service, created.libraryId, sourcePath);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;

    const result = (await service.generateThumbnail({
      libraryId: created.libraryId,
      assetId: asset.assetId,
    }))!;

    expect(invocations.some(({ command }) => command === '/fake/oiiotool')).toBe(true);
    expect(diagnostics.some(({ scope }) => scope === 'thumbnail.tiff-sharp-fallback')).toBe(true);
    const db = assertDb(created.libraryPath);
    const row = db.prepare(
      'SELECT status, mime_type, generator_version, error_code FROM revision_artifacts WHERE artifact_id = ?',
    ).get(result.artifactId) as {
      status: string;
      mime_type: string;
      generator_version: string;
      error_code: string | null;
    };
    expect(row).toMatchObject({ status: 'ready', mime_type: 'image/png', error_code: null });
    expect(row.generator_version).toContain('oiio@3.1.12.0');
    expect(db.prepare(
      "SELECT COUNT(*) AS count FROM revision_artifacts WHERE status = 'failed'",
    ).get()).toMatchObject({ count: 0 });
    db.close();
    service.closeAll();
  });

  it('records a safe transform error code and a full diagnostic', async () => {
    process.env['SERPENT_OIIO_PATH'] = '/fake/oiiotool';
    const root = temporaryRoot();
    const diagnostics: LibraryServiceDiagnostic[] = [];
    const service = new LibraryService({
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      spawnFn: async () => ({
        stdout: Buffer.alloc(0),
        stderr: 'OCIO display/view transform rejected the selected config',
        exitCode: 7,
      }),
    });
    const created = service.createLibrary({
      displayName: 'TransformFailure',
      selectedParentPath: root,
    });
    const sourcePath = path.join(root, 'render.exr');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(service, created.libraryId, sourcePath);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;

    await expect(service.generateThumbnail({
      libraryId: created.libraryId,
      assetId: asset.assetId,
    })).rejects.toMatchObject({ reason: 'MEDIA_PROCESSING_FAILED' });

    const db = assertDb(created.libraryPath);
    expect(db.prepare(
      "SELECT status, error_code FROM revision_artifacts WHERE kind = 'thumbnail'",
    ).get()).toMatchObject({ status: 'failed', error_code: 'OIIO_COLOR_TRANSFORM_FAILED' });
    const diagnostic = diagnostics.find(({ scope }) => scope === 'oiio.thumbnail');
    expect(diagnostic?.context).toMatchObject({
      assetId: asset.assetId,
      errorCode: 'OIIO_COLOR_TRANSFORM_FAILED',
      ocioConfig: 'ocio://studio-config-v4.0.0_aces-v2.0_ocio-v2.5',
    });
    expect(diagnostic?.error).toMatchObject({
      message: expect.stringContaining('display/view transform rejected'),
    });
    db.close();
    service.closeAll();
  });

  it('writes failed artifact when oiiotool binary is missing (ENOENT)', async () => {
    process.env['SERPENT_OIIO_PATH'] = '/fake/oiiotool-missing';
    const root = temporaryRoot();
    const diagnostics: LibraryServiceDiagnostic[] = [];
    const service = new LibraryService({
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      spawnFn: createMockSpawn({
        oiiotoolExitCode: 0,
        enoentCommand: '/fake/oiiotool-missing',
      }),
    });
    const created = service.createLibrary({
      displayName: 'MissingOIIO',
      selectedParentPath: root,
    });

    const sourcePath = path.join(root, 'render.exr');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(service, created.libraryId, sourcePath);

    const assets = service.listAssets({
      libraryId: created.libraryId,
      recursive: true,
    });

    await expect(
      service.generateThumbnail({
        libraryId: created.libraryId,
        assetId: assets[0]!.assetId,
      }),
    ).rejects.toMatchObject({ reason: 'OIIO_REQUIRED' });

    // Verify failed artifact with OIIO_REQUIRED
    const db = assertDb(created.libraryPath);
    const failedRow = db
      .prepare(
        "SELECT kind, status, error_code FROM revision_artifacts WHERE status = 'failed'",
      )
      .get() as { kind: string; status: string; error_code: string } | undefined;
    expect(failedRow).toBeDefined();
    expect(failedRow!.status).toBe('failed');
    expect(failedRow!.error_code).toBe('OIIO_REQUIRED');
    expect(diagnostics.some((diagnostic) => (
      diagnostic.scope === 'oiio.thumbnail'
      && diagnostic.context?.['errorCode'] === 'OIIO_REQUIRED'
    ))).toBe(true);

    db.close();
    service.closeAll();
  });
});

describe('generateThumbnail dispatch by media type', () => {
  it('dispatches image assets to sharp (existing path)', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({
      displayName: 'DispatchImage',
      selectedParentPath: root,
    });

    const sourcePath = path.join(root, 'photo.png');
    createTestImage(sourcePath);
    importNoConflict(service, created.libraryId, sourcePath);

    const assets = service.listAssets({
      libraryId: created.libraryId,
      recursive: true,
    });
    const result = (await service.generateThumbnail({
      libraryId: created.libraryId,
      assetId: assets[0]!.assetId,
    }))!;
    expect(result.artifactId).toBeTruthy();

    // Verify sharp-generated WebP thumbnail
    const db = assertDb(created.libraryPath);
    const row = db
      .prepare(
        "SELECT kind, mime_type, generator_version FROM revision_artifacts WHERE artifact_id = ?",
      )
      .get(result.artifactId) as {
        kind: string;
        mime_type: string;
        generator_version: string;
      } | undefined;
    expect(row).toBeDefined();
    expect(row!.kind).toBe('thumbnail');
    expect(row!.mime_type).toBe('image/webp');
    expect(row!.generator_version).toContain('sharp@');
    db.close();

    service.closeAll();
  });

  it('dispatches video assets to ffmpeg (mocked)', async () => {
    process.env['SERPENT_FFMPEG_PATH'] = '/fake/ffmpeg';
    const root = temporaryRoot();
    const service = new LibraryService({
      spawnFn: createMockSpawn({ ffprobeStdout: CANNED_FFPROBE_JSON }),
    });
    const created = service.createLibrary({
      displayName: 'DispatchVideo',
      selectedParentPath: root,
    });

    const sourcePath = path.join(root, 'video.mp4');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(service, created.libraryId, sourcePath);

    const assets = service.listAssets({
      libraryId: created.libraryId,
      recursive: true,
    });
    const result = (await service.generateThumbnail({
      libraryId: created.libraryId,
      assetId: assets[0]!.assetId,
    }))!;
    expect(result.artifactId).toBeTruthy();

    // Verify artifacts were created (extracted_metadata + video_poster at minimum)
    const db = assertDb(created.libraryPath);
    const kinds = db
      .prepare(
        "SELECT kind FROM revision_artifacts WHERE revision_id = ?",
      )
      .all(assets[0]!.currentRevisionId) as Array<{ kind: string }>;
    const kindNames = kinds.map((k) => k.kind);
    expect(kindNames).toContain('extracted_metadata');
    expect(kindNames).toContain('video_poster');
    db.close();

    service.closeAll();

    const reopenedService = new LibraryService({
      spawnFn: createMockSpawn({ ffprobeStdout: CANNED_FFPROBE_JSON }),
    });
    const reopened = reopenedService.openLibrary(created.libraryPath);
    const listed = reopenedService.listAssets({
      libraryId: reopened.libraryId,
      recursive: true,
    });
    expect(listed[0]).toMatchObject({
      mediaType: 'video',
      thumbnailStatus: 'ready',
      thumbnailArtifactId: result.artifactId,
    });
    const searched = reopenedService.searchAssets({
      libraryId: reopened.libraryId,
      filters: [],
    });
    expect(searched.items[0]).toMatchObject({
      mediaType: 'video',
      thumbnailStatus: 'ready',
      thumbnailArtifactId: result.artifactId,
    });
    const reopenedDb = assertDb(created.libraryPath);
    const queued = reopenedDb.prepare(
      "SELECT COUNT(*) AS count FROM jobs WHERE kind = 'generate_thumbnail' AND status = 'queued'",
    ).get() as { count: number };
    expect(queued.count).toBe(0);
    reopenedDb.close();
    reopenedService.closeAll();
  });

  it('dispatches EXR assets to oiiotool (mocked)', async () => {
    process.env['SERPENT_OIIO_PATH'] = '/fake/oiiotool';
    const root = temporaryRoot();
    const service = new LibraryService({
      spawnFn: createMockSpawn({ oiiotoolExitCode: 0 }),
    });
    const created = service.createLibrary({
      displayName: 'DispatchEXR',
      selectedParentPath: root,
    });

    const sourcePath = path.join(root, 'render.exr');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(service, created.libraryId, sourcePath);

    const assets = service.listAssets({
      libraryId: created.libraryId,
      recursive: true,
    });
    const result = (await service.generateThumbnail({
      libraryId: created.libraryId,
      assetId: assets[0]!.assetId,
    }))!;
    expect(result.artifactId).toBeTruthy();
    expect(result.artifactId).not.toBe('');

    // Verify oiiotool-generated thumbnail
    const db = assertDb(created.libraryPath);
    const row = db
      .prepare(
        "SELECT kind, generator_version FROM revision_artifacts WHERE artifact_id = ?",
      )
      .get(result.artifactId) as {
        kind: string;
        generator_version: string;
      } | undefined;
    expect(row).toBeDefined();
    expect(row!.kind).toBe('thumbnail');
    expect(row!.generator_version).toContain('oiio@');
    db.close();

    service.closeAll();
  });

  it('rejects unsupported formats', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({
      displayName: 'UnsupportedFormat',
      selectedParentPath: root,
    });

    const sourcePath = path.join(root, 'file.xyz');
    writeFileSync(sourcePath, Buffer.alloc(1024, 0));
    importNoConflict(service, created.libraryId, sourcePath);

    const assets = service.listAssets({
      libraryId: created.libraryId,
      recursive: true,
    });
    await expect(
      service.generateThumbnail({
        libraryId: created.libraryId,
        assetId: assets[0]!.assetId,
      }),
    ).rejects.toThrow();

    service.closeAll();
  });
});

describe('enqueueThumbnailJobs handles all media types', () => {
  it('enqueues jobs for video assets', () => {
    process.env['SERPENT_FFMPEG_PATH'] = '/fake/ffmpeg';
    const root = temporaryRoot();
    const service = new LibraryService({
      spawnFn: createMockSpawn({ ffprobeStdout: CANNED_FFPROBE_JSON }),
    });
    const created = service.createLibrary({
      displayName: 'EnqueueVideo',
      selectedParentPath: root,
    });

    const sourcePath = path.join(root, 'video.mp4');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(service, created.libraryId, sourcePath);

    const enqueued = service.enqueueThumbnailJobs(created.libraryId);
    expect(enqueued).toBe(1);

    service.closeAll();
  });

  it('does not re-enqueue video assets with ready video_poster', async () => {
    process.env['SERPENT_FFMPEG_PATH'] = '/fake/ffmpeg';
    const root = temporaryRoot();
    const service = new LibraryService({
      spawnFn: createMockSpawn({ ffprobeStdout: CANNED_FFPROBE_JSON }),
    });
    const created = service.createLibrary({
      displayName: 'NoReEnqueue',
      selectedParentPath: root,
    });

    const sourcePath = path.join(root, 'video.mp4');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(service, created.libraryId, sourcePath);

    // First enqueue
    expect(service.enqueueThumbnailJobs(created.libraryId)).toBe(1);

    // Process the queue to generate artifacts
    await service.processThumbnailQueue(created.libraryId);

    // Should not re-enqueue (video_poster is ready)
    expect(service.enqueueThumbnailJobs(created.libraryId)).toBe(0);

    service.closeAll();
  });

  it('enqueues jobs for EXR assets', () => {
    process.env['SERPENT_OIIO_PATH'] = '/fake/oiiotool';
    const root = temporaryRoot();
    const service = new LibraryService({
      spawnFn: createMockSpawn({ oiiotoolExitCode: 0 }),
    });
    const created = service.createLibrary({
      displayName: 'EnqueueEXR',
      selectedParentPath: root,
    });

    const sourcePath = path.join(root, 'render.exr');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(service, created.libraryId, sourcePath);

    const enqueued = service.enqueueThumbnailJobs(created.libraryId);
    expect(enqueued).toBe(1);

    service.closeAll();
  });

  it('enqueues jobs for audio assets (Serpent-13v)', () => {
    process.env['SERPENT_FFMPEG_PATH'] = '/fake/ffmpeg';
    const root = temporaryRoot();
    const service = new LibraryService({
      spawnFn: createMockSpawn({ ffprobeStdout: CANNED_FFPROBE_JSON }),
    });
    const created = service.createLibrary({
      displayName: 'EnqueueAudio',
      selectedParentPath: root,
    });

    const sourcePath = path.join(root, 'clip.wav');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(service, created.libraryId, sourcePath);

    const enqueued = service.enqueueThumbnailJobs(created.libraryId);
    expect(enqueued).toBe(1);

    service.closeAll();
  });

  it('enqueues audio when only the viewer strip exists (Serpent-051)', async () => {
    process.env['SERPENT_FFMPEG_PATH'] = '/fake/ffmpeg';
    const root = temporaryRoot();
    const service = new LibraryService({
      spawnFn: createMockSpawn({ ffprobeStdout: CANNED_FFPROBE_JSON }),
    });
    const created = service.createLibrary({
      displayName: 'AudioPosterOnly',
      selectedParentPath: root,
    });

    const sourcePath = path.join(root, 'only-poster.mp3');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(service, created.libraryId, sourcePath);

    const asset = service.listAssets({
      libraryId: created.libraryId,
      recursive: true,
    })[0]!;
    await service.generateThumbnail({
      libraryId: created.libraryId,
      assetId: asset.assetId,
    });

    const db = assertDb(created.libraryPath);
    const invalidated = db
      .prepare(
        `UPDATE revision_artifacts
            SET invalidated_at = ?
          WHERE kind = 'thumbnail'
            AND invalidated_at IS NULL
            AND revision_id = ?`,
      )
      .run(new Date().toISOString(), asset.currentRevisionId) as {
      changes: number;
    };
    expect(invalidated.changes).toBeGreaterThan(0);
    const poster = db
      .prepare(
        `SELECT artifact_id FROM revision_artifacts
          WHERE kind = 'video_poster'
            AND status = 'ready'
            AND invalidated_at IS NULL
            AND revision_id = ?`,
      )
      .get(asset.currentRevisionId) as { artifact_id: string } | undefined;
    expect(poster).toBeDefined();
    db.close();

    // Browse must not adopt the wide strip as the grid cover.
    const before = service.searchAssets({
      libraryId: created.libraryId,
      query: null,
      limit: 10,
      offset: 0,
    });
    expect(before.items[0]).toMatchObject({
      mediaType: 'audio',
      thumbnailStatus: null,
      thumbnailArtifactId: null,
    });

    expect(service.enqueueThumbnailJobs(created.libraryId)).toBe(1);

    service.closeAll();
  });
});

describe('audio waveform thumbnail (Serpent-13v)', () => {
  it('dispatches audio assets to ffmpeg waveform + opaque cover', async () => {
    process.env['SERPENT_FFMPEG_PATH'] = '/fake/ffmpeg';
    const root = temporaryRoot();
    const service = new LibraryService({
      spawnFn: createMockSpawn({ ffprobeStdout: CANNED_FFPROBE_JSON }),
    });
    const created = service.createLibrary({
      displayName: 'AudioWaveform',
      selectedParentPath: root,
    });

    const sourcePath = path.join(root, 'tone.mp3');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(service, created.libraryId, sourcePath);

    const assets = service.listAssets({
      libraryId: created.libraryId,
      recursive: true,
    });
    const result = (await service.generateThumbnail({
      libraryId: created.libraryId,
      assetId: assets[0]!.assetId,
    }))!;
    expect(result.artifactId).toBeTruthy();

    const db = assertDb(created.libraryPath);
    const row = db
      .prepare(
        "SELECT kind, mime_type, generator_version, width, height, status FROM revision_artifacts WHERE artifact_id = ?",
      )
      .get(result.artifactId) as {
        kind: string;
        mime_type: string;
        generator_version: string;
        width: number;
        height: number;
        status: string;
      } | undefined;
    expect(row).toBeDefined();
    expect(row!.kind).toBe('thumbnail');
    expect(row!.mime_type).toBe('image/png');
    expect(row!.status).toBe('ready');
    expect(row!.generator_version).toContain(AUDIO_WAVEFORM_COVER_GENERATOR_TAG);
    expect(row!.width).toBe(640);
    expect(row!.height).toBe(480);
    db.close();

    expect(assets[0]).toMatchObject({ mediaType: 'audio' });
    const listed = service.listAssets({
      libraryId: created.libraryId,
      recursive: true,
    });
    expect(listed[0]).toMatchObject({
      mediaType: 'audio',
      thumbnailStatus: 'ready',
      thumbnailArtifactId: result.artifactId,
    });

    service.closeAll();
  });

  it('generates an Opus/Ogg playback proxy for WAV after its waveform is ready', async () => {
    process.env['SERPENT_FFMPEG_PATH'] = '/fake/ffmpeg';
    const root = temporaryRoot();
    const capturedSpawnArgs: Array<{ command: string; args: string[] }> = [];
    const service = new LibraryService({
      spawnFn: async (command, args) => {
        capturedSpawnArgs.push({ command, args });
        const outputPath = args.at(-1);
        if (outputPath && ['.ogg', '.png', '.json'].some((extension) => outputPath.endsWith(extension))) {
          mkdirSync(path.dirname(outputPath), { recursive: true });
          if (outputPath.endsWith('.png')) {
            writeFileSync(outputPath, VALID_1X1_PNG);
          } else {
            writeFileSync(outputPath, Buffer.from('mock-output-data'));
          }
        }
        if (command.includes('ffprobe')) {
          return { stdout: Buffer.from(CANNED_FFPROBE_JSON), stderr: '', exitCode: 0 };
        }
        return { stdout: Buffer.alloc(0), stderr: '', exitCode: 0 };
      },
    });
    const created = service.createLibrary({ displayName: 'AudioProxy', selectedParentPath: root });
    const sourcePath = path.join(root, 'tone.wav');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(service, created.libraryId, sourcePath);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;

    service.enqueueThumbnailJobs(created.libraryId);
    await service.processThumbnailQueue(created.libraryId);

    expect(service.getCurrentArtifact(created.libraryId, asset.assetId, 'audio_proxy'))
      .toMatchObject({ status: 'ready', mimeType: 'audio/ogg' });
    // REQ-VIEW-002: WAV is natively playable, so the viewer resolution stays
    // on the ORIGINAL source; the Ogg proxy remains a hover/derivative path.
    expect(service.getPreviewArtifact(created.libraryId, asset.assetId)).toMatchObject({
      mediaType: 'audio',
      status: 'ready',
      playbackMode: 'source',
      mimeType: 'audio/wav',
    });
    const proxyCall = capturedSpawnArgs.find((call) =>
      call.args.includes('libopus') && call.args.at(-1)?.endsWith('.ogg'),
    );
    expect(proxyCall).toBeDefined();
    expect(proxyCall!.args).toContain('-vn');
    expect(proxyCall!.args).toContain('-f');
    expect(proxyCall!.args).toContain('ogg');
    service.closeAll();
  });
});

describe('independent video derivative jobs', () => {
  it('serves only the current revision through the opaque source token', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'CurrentSourceOnly', selectedParentPath: root });
    const source = path.join(root, 'current.mp4');
    writeFileSync(source, Buffer.alloc(1024));
    importNoConflict(service, created.libraryId, source);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;

    expect(service.getCurrentVideoSource(
      created.libraryId,
      asset.assetId,
      asset.currentRevisionId,
    )).toMatchObject({ mimeType: 'video/mp4' });

    const replacementRevision = randomUUID();
    const db = assertDb(created.libraryPath);
    db.prepare(
      `INSERT INTO revisions
         (revision_id, asset_id, parent_revision_id, byte_size, modified_at, original_filename, origin, accepted_at)
       VALUES (?, ?, ?, 2048, ?, 'current.mp4', 'external_change', ?)`,
    ).run(replacementRevision, asset.assetId, asset.currentRevisionId, new Date().toISOString(), new Date().toISOString());
    db.prepare('UPDATE assets SET current_revision_id = ? WHERE asset_id = ?')
      .run(replacementRevision, asset.assetId);
    db.close();

    expect(() => service.getCurrentVideoSource(
      created.libraryId,
      asset.assetId,
      asset.currentRevisionId,
    )).toThrow('ASSET_NOT_FOUND');
    service.closeAll();
  });

  it('publishes the poster before a slow proxy job resolves', async () => {
    process.env['SERPENT_FFMPEG_PATH'] = '/fake/ffmpeg';
    const root = temporaryRoot();
    let finishProxy!: () => void;
    const proxyGate = new Promise<SpawnResult>((resolve) => {
      finishProxy = () => resolve({ stdout: Buffer.alloc(0), stderr: '', exitCode: 0 });
    });
    const service = new LibraryService({
      spawnFn: async (command, args) => {
        if (command.includes('ffprobe')) {
          return { stdout: Buffer.from(CANNED_FFPROBE_JSON), stderr: '', exitCode: 0 };
        }
        const output = args[args.length - 1]!;
        if (output.endsWith('.webm')) {
          mkdirSync(path.dirname(output), { recursive: true });
          writeFileSync(output, Buffer.from('proxy'));
          return proxyGate;
        }
        mkdirSync(path.dirname(output), { recursive: true });
        writeFileSync(output, Buffer.from('poster'));
        return { stdout: Buffer.alloc(0), stderr: '', exitCode: 0 };
      },
    });
    const created = service.createLibrary({ displayName: 'PosterFirst', selectedParentPath: root });
    const source = path.join(root, 'slow.avi');
    writeFileSync(source, Buffer.alloc(1024));
    importNoConflict(service, created.libraryId, source);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;
    service.enqueueThumbnailJobs(created.libraryId);
    let posterReady!: () => void;
    const ready = new Promise<void>((resolve) => { posterReady = resolve; });
    const processing = service.processThumbnailQueue(created.libraryId, {
      maxJobs: 4,
      onResult: ({ assetId, artifactId }) => {
        if (assetId === asset.assetId && artifactId) posterReady();
      },
    });

    await ready;
    expect(service.listAssets({ libraryId: created.libraryId, recursive: true })[0])
      .toMatchObject({ thumbnailStatus: 'ready' });
    const db = assertDb(created.libraryPath);
    expect(db.prepare(
      "SELECT status FROM jobs WHERE kind = 'generate_thumbnail'",
    ).get()).toMatchObject({ status: 'succeeded' });
    db.close();
    finishProxy();
    await processing;
    service.closeAll();
  });

  it('cancels a derivative job whose queued revision is no longer current', async () => {
    process.env['SERPENT_FFMPEG_PATH'] = '/fake/ffmpeg';
    const root = temporaryRoot();
    const service = new LibraryService({ spawnFn: createMockSpawn({ ffprobeStdout: CANNED_FFPROBE_JSON }) });
    const created = service.createLibrary({ displayName: 'StaleDerivative', selectedParentPath: root });
    const source = path.join(root, 'stale.avi');
    writeFileSync(source, Buffer.alloc(1024));
    importNoConflict(service, created.libraryId, source);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;
    service.enqueueThumbnailJobs(created.libraryId);
    await service.processThumbnailQueue(created.libraryId, { maxJobs: 1 });

    const db = assertDb(created.libraryPath);
    const replacementRevision = randomUUID();
    db.prepare(
      `INSERT INTO revisions
         (revision_id, asset_id, parent_revision_id, byte_size, modified_at, original_filename, origin, accepted_at)
       VALUES (?, ?, ?, 2048, ?, 'stale.avi', 'external_change', ?)`,
    ).run(replacementRevision, asset.assetId, asset.currentRevisionId, new Date().toISOString(), new Date().toISOString());
    db.prepare('UPDATE assets SET current_revision_id = ? WHERE asset_id = ?')
      .run(replacementRevision, asset.assetId);
    db.close();

    await service.processThumbnailQueue(created.libraryId, { maxJobs: 1 });
    const verified = assertDb(created.libraryPath);
    expect(verified.prepare(
      "SELECT status, error_code FROM jobs WHERE kind = 'generate_webm_proxy'",
    ).get()).toMatchObject({ status: 'cancelled', error_code: 'STALE_REVISION' });
    expect(verified.prepare(
      "SELECT COUNT(*) AS count FROM revision_artifacts WHERE kind = 'webm_proxy' AND revision_id = ?",
    ).get(asset.currentRevisionId)).toMatchObject({ count: 0 });
    verified.close();
    service.closeAll();
  });

  it('recovers interrupted derivative jobs when reopening a library', async () => {
    process.env['SERPENT_FFMPEG_PATH'] = '/fake/ffmpeg';
    const root = temporaryRoot();
    const service = new LibraryService({ spawnFn: createMockSpawn({ ffprobeStdout: CANNED_FFPROBE_JSON }) });
    const created = service.createLibrary({ displayName: 'RecoverDerivative', selectedParentPath: root });
    const source = path.join(root, 'recover.avi');
    writeFileSync(source, Buffer.alloc(1024));
    importNoConflict(service, created.libraryId, source);
    service.enqueueThumbnailJobs(created.libraryId);
    await service.processThumbnailQueue(created.libraryId, { maxJobs: 1 });
    const db = assertDb(created.libraryPath);
    db.prepare("UPDATE jobs SET status = 'running' WHERE kind = 'generate_webm_proxy'").run();
    db.close();
    service.closeAll();

    const reopened = new LibraryService({ spawnFn: createMockSpawn({ ffprobeStdout: CANNED_FFPROBE_JSON }) });
    reopened.openLibrary(created.libraryPath);
    const recoveredDb = assertDb(created.libraryPath);
    expect(recoveredDb.prepare(
      "SELECT status, error_code FROM jobs WHERE kind = 'generate_webm_proxy'",
    ).get()).toMatchObject({ status: 'queued', error_code: 'PROCESS_INTERRUPTED' });
    recoveredDb.close();
    reopened.closeAll();
  });
});
