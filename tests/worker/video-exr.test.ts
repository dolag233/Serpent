import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  LibraryService,
  LibraryServiceError,
  type SpawnFunction,
  type SpawnResult,
} from '../../src/worker/library-service';

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
  const result = service.prepareOrExecuteImport({
    libraryId,
    sourceKind: 'files',
    sourcePaths: [sourcePath],
  });
  if ('importId' in result) {
    const discard = service.abandonImport(result.importId);
    expect(discard).toBe(result.importId);
    throw new Error('Import generated unexpected conflicts.');
  }
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
    const outputExtensions = ['.jpg', '.webm', '.png', '.webp', '.json'];
    if (outputPath && outputExtensions.some((ext) => outputPath.endsWith(ext))) {
      mkdirSync(path.dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, Buffer.from('mock-output-data'));
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

    await service.generateThumbnail({
      libraryId: created.libraryId,
      assetId: assets[0]!.assetId,
    });

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
    expect(metadata.height).toBe(1080);
    expect(metadata.rotation).toBe(-90);
    expect(metadata.videoCodec).toBe('h264');
    expect(metadata.hasAudio).toBe(true);

    db.close();
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

    const sourcePath = path.join(root, 'video.mp4');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(service, created.libraryId, sourcePath);

    const assets = service.listAssets({
      libraryId: created.libraryId,
      recursive: true,
    });
    await service.generateThumbnail({
      libraryId: created.libraryId,
      assetId: assets[0]!.assetId,
    });

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
    expect(posterCall!.args).toContain('-frames:v');
    expect(posterCall!.args).toContain('1');

    db.close();
    service.closeAll();
  });

  it('generates contact_sheet artifact with well-formed drawtext/tile args', async () => {
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

    const assets = service.listAssets({
      libraryId: created.libraryId,
      recursive: true,
    });
    await service.generateThumbnail({
      libraryId: created.libraryId,
      assetId: assets[0]!.assetId,
    });

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
    expect(vfValue2).toContain('drawtext=');
    expect(vfValue2).toContain('pts');
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

    const sourcePath = path.join(root, 'video.mp4');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    importNoConflict(service, created.libraryId, sourcePath);

    const assets = service.listAssets({
      libraryId: created.libraryId,
      recursive: true,
    });
    await service.generateThumbnail({
      libraryId: created.libraryId,
      assetId: assets[0]!.assetId,
    });

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

    db.close();
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

    // generateThumbnail should not throw (individual artifacts fail, not the whole call)
    await service.generateThumbnail({
      libraryId: created.libraryId,
      assetId: assets[0]!.assetId,
    });

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

    db.close();
    service.closeAll();
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
    const result = await service.generateThumbnail({
      libraryId: created.libraryId,
      assetId: assets[0]!.assetId,
    });
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
    const oiioCall = capturedSpawnArgs.find(
      (c) => c.command === '/fake/oiiotool',
    );
    expect(oiioCall).toBeDefined();
    expect(oiioCall!.args).toContain('--resize');
    expect(oiioCall!.args).toContain('0x512');
    expect(oiioCall!.args).toContain('-o');
    // Check that the input path is the resolved asset path (inside the library)
    const assetPath = service.resolveAssetPath(created.libraryId, assets[0]!.assetId);
    expect(oiioCall!.args[0]).toBe(assetPath);

    db.close();
    service.closeAll();
  });

  it('writes failed artifact when oiiotool binary is missing (ENOENT)', async () => {
    process.env['SERPENT_OIIO_PATH'] = '/fake/oiiotool-missing';
    const root = temporaryRoot();
    const service = new LibraryService({
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
    ).rejects.toBeInstanceOf(LibraryServiceError);

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
    const result = await service.generateThumbnail({
      libraryId: created.libraryId,
      assetId: assets[0]!.assetId,
    });
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
    const result = await service.generateThumbnail({
      libraryId: created.libraryId,
      assetId: assets[0]!.assetId,
    });
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
    const result = await service.generateThumbnail({
      libraryId: created.libraryId,
      assetId: assets[0]!.assetId,
    });
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
});
