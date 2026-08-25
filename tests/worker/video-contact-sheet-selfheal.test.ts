import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';

const roots: string[] = [];
const services: LibraryService[] = [];
afterEach(() => {
  delete process.env['SERPENT_FFMPEG_PATH'];
  for (const s of services.splice(0)) s.closeAll();
  for (const r of roots.splice(0)) {
    try {
      rmSync(r, { force: true, recursive: true });
    } catch {
      // Windows can hold brief locks (WAL/ffmpeg child); block briefly and
      // retry once instead of failing the suite on temp-dir teardown.
      const buffer = new SharedArrayBuffer(4);
      Atomics.wait(new Int32Array(buffer), 0, 0, 250);
      try {
        rmSync(r, { force: true, recursive: true });
      } catch {
        // Best effort: the OS temp cleaner owns leftovers.
      }
    }
  }
});

interface TestDbHandle {
  prepare(sql: string): { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[]; run(...params: unknown[]): unknown };
  close(): void;
}

function ffmpegAvailable(): boolean {
  const ffmpeg = process.env['SERPENT_FFMPEG_PATH'] ?? 'ffmpeg';
  try {
    execFileSync(ffmpeg, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function openLibraryDb<T>(libraryPath: string, fn: (db: TestDbHandle) => T): T {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3') as new (filename: string) => TestDbHandle;
  const db = new Database(path.join(libraryPath, '.serpent', 'library.db'));
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/**
 * Serpent-140fe2 regression: Eagle/Billfish conversions register videos with
 * width/height-only extracted_metadata (no ffprobe), so contact sheets failed
 * forever and every open re-enqueued the doomed batch. The generation path
 * must self-heal by probing duration on demand, invalidate the superseded
 * metadata row (getCurrentArtifact reads LIMIT 1 without ORDER BY), and write
 * a terminal failed artifact so the enqueue guard stops re-queueing videos
 * whose contact sheet can never succeed.
 */
describe('contact sheet self-heal for conversion-registered videos', () => {
  it('probes missing duration on demand and generates the contact sheet', async () => {
    if (!ffmpegAvailable()) return;
    const ffmpeg = process.env['SERPENT_FFMPEG_PATH'] ?? 'ffmpeg';
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-cs-selfheal-'));
    roots.push(root);
    const videoPath = path.join(root, 'clip.mp4');
    execFileSync(ffmpeg, [
      '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1.2:size=320x240:rate=10',
      '-c:v', 'mpeg4', '-q:v', '6', videoPath,
    ], { stdio: 'pipe' });

    const service = new LibraryService();
    services.push(service);
    const created = service.createLibrary({ displayName: 'CS Selfheal', selectedParentPath: root });
    service.prepareOrExecuteImport({ libraryId: created.libraryId, sourceKind: 'files', sourcePaths: [videoPath] });
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })
      .find((entry) => entry.assetId)!;
    service.enqueueThumbnailJobs(created.libraryId, { assetIds: [asset.assetId], limit: 50 });
    await service.processThumbnailQueue(created.libraryId, { maxJobs: 50 });

    // Simulate the Eagle-conversion state: metadata artifact reduced to
    // width/height only. Nothing generates a contact sheet proactively any
    // more — analysis-time ensure must self-heal duration and produce it.
    const metadataAbs = openLibraryDb(created.libraryPath, (db) => {
      const metadataRow = db.prepare(
        "SELECT file_path FROM revision_artifacts WHERE kind='extracted_metadata' AND status='ready' AND invalidated_at IS NULL AND revision_id = ?",
      ).get(asset.currentRevisionId) as { file_path?: string } | undefined;
      expect(metadataRow?.file_path, 'first wave should register video metadata').toBeTruthy();
      return path.join(created.libraryPath, '.serpent', 'artifacts', metadataRow!.file_path!);
    });
    writeFileSync(metadataAbs, JSON.stringify({ width: 320, height: 240 }), 'utf-8');
    expect(service.getCurrentArtifact(created.libraryId, asset.assetId, 'contact_sheet')?.status ?? 'missing').toBe('missing');

    const ensured = await service.ensureVideoContactSheet(created.libraryId, asset.assetId);
    expect(ensured).toBe(true);

    const sheet = service.getCurrentArtifact(created.libraryId, asset.assetId, 'contact_sheet');
    expect(sheet?.status).toBe('ready');
    // The self-heal probe replaces the width/height-only metadata artifact
    // with a full ffprobe row (new file) under the same revision.
    const healedRow = openLibraryDb(created.libraryPath, (db) =>
      db.prepare(
        "SELECT file_path, duration_ms FROM revision_artifacts WHERE kind='extracted_metadata' AND status='ready' AND invalidated_at IS NULL AND revision_id = ?",
      ).get(asset.currentRevisionId) as { file_path?: string; duration_ms?: number });
    expect(healedRow.duration_ms ?? 0).toBeGreaterThan(0);
    const healed = JSON.parse(readFileSync(
      path.join(created.libraryPath, '.serpent', 'artifacts', healedRow.file_path!),
      'utf-8',
    )) as { durationMs?: number };
    expect(healed.durationMs ?? 0).toBeGreaterThan(0);
    const readyMetadataRows = openLibraryDb(created.libraryPath, (db) =>
      db.prepare(
        "SELECT COUNT(*) n FROM revision_artifacts WHERE kind='extracted_metadata' AND status='ready' AND invalidated_at IS NULL AND revision_id = ?",
      ).get(asset.currentRevisionId) as { n: number });
    expect(readyMetadataRows.n).toBe(1);
  });

  it('writes a terminal failed artifact when ffprobe fails after registration', async () => {
    if (!ffmpegAvailable()) return;
    const ffmpeg = process.env['SERPENT_FFMPEG_PATH'] ?? 'ffmpeg';
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-cs-doomed-'));
    roots.push(root);
    const videoPath = path.join(root, 'later-corrupt.mp4');
    execFileSync(ffmpeg, [
      '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=10',
      '-c:v', 'mpeg4', '-q:v', '6', videoPath,
    ], { stdio: 'pipe' });

    const service = new LibraryService();
    services.push(service);
    const created = service.createLibrary({ displayName: 'CS Doomed', selectedParentPath: root });
    service.prepareOrExecuteImport({ libraryId: created.libraryId, sourceKind: 'files', sourcePaths: [videoPath] });
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })
      .find((entry) => entry.assetId)!;
    service.enqueueThumbnailJobs(created.libraryId, { assetIds: [asset.assetId], limit: 50 });
    await service.processThumbnailQueue(created.libraryId, { maxJobs: 50 });

    // Corrupt the MANAGED source copy after import (imports copy files into
    // the library) and reset to the conversion state: the metadata row claims
    // readiness but self-heal's ffprobe will now fail.
    writeFileSync(service.resolveAssetPath(created.libraryId, asset.assetId), Buffer.alloc(64, 0));
    openLibraryDb(created.libraryPath, (db) => {
      const metadataRow = db.prepare(
        "SELECT file_path FROM revision_artifacts WHERE kind='extracted_metadata' AND status='ready' AND invalidated_at IS NULL AND revision_id = ?",
      ).get(asset.currentRevisionId) as { file_path?: string } | undefined;
      expect(metadataRow?.file_path).toBeTruthy();
      writeFileSync(
        path.join(created.libraryPath, '.serpent', 'artifacts', metadataRow!.file_path!),
        JSON.stringify({ width: 320, height: 240 }),
        'utf-8',
      );
    });

    // Analysis-time ensure must fail while the source is broken and register
    // exactly one terminal failed artifact for the enqueue/repair guards.
    await expect(service.ensureVideoContactSheet(created.libraryId, asset.assetId))
      .rejects.toThrow();

    openLibraryDb(created.libraryPath, (db) => {
      const failedSheet = db.prepare(
        "SELECT artifact_id FROM revision_artifacts WHERE kind='contact_sheet' AND status='failed' AND invalidated_at IS NULL AND revision_id = ?",
      ).get(asset.currentRevisionId) as { artifact_id?: string } | undefined;
      expect(failedSheet?.artifact_id, 'terminal failure must register a failed contact_sheet artifact').toBeTruthy();
    });

    // A retry stays a single terminal row (no UNIQUE spam) and keeps failing.
    await expect(service.ensureVideoContactSheet(created.libraryId, asset.assetId))
      .rejects.toThrow();
    openLibraryDb(created.libraryPath, (db) => {
      const failedRows = db.prepare(
        "SELECT COUNT(*) n FROM revision_artifacts WHERE kind='contact_sheet' AND status='failed' AND invalidated_at IS NULL AND revision_id = ?",
      ).get(asset.currentRevisionId) as { n: number };
      expect(failedRows.n).toBe(1);
    });
  });

  it('enqueues AI analysis for sheet-less videos and lazily self-heals duration (hermetic)', async () => {
    process.env['SERPENT_FFMPEG_PATH'] = '/fake/ffmpeg';
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-cs-hermetic-'));
    roots.push(root);
    const cannedProbe = JSON.stringify({
      streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 }],
      format: { duration: '30.05', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
    });
    const service = new LibraryService({
      spawnFn: async (_command, args) => {
        const outPath = args[args.length - 1];
        if (typeof outPath === 'string' && (outPath.endsWith('.jpg') || outPath.endsWith('.json'))) {
          mkdirSync(path.dirname(outPath), { recursive: true });
          writeFileSync(outPath, Buffer.from('mock-output'));
        }
        return { stdout: Buffer.from(cannedProbe, 'utf-8'), stderr: '', exitCode: 0 };
      },
    });
    services.push(service);
    const created = service.createLibrary({ displayName: 'CS Hermetic', selectedParentPath: root });
    const sourcePath = path.join(root, 'video.mp4');
    writeFileSync(sourcePath, Buffer.alloc(4096, 0));
    service.prepareOrExecuteImport({ libraryId: created.libraryId, sourceKind: 'files', sourcePaths: [sourcePath] });
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })
      .find((entry) => entry.assetId)!;

    // Serpent-140fe2 blocker fix: analysis enqueue must NOT gate on a
    // pre-existing contact sheet — the lane materializes it at execution.
    const analysis = service.enqueueAiAnalysisJobs({
      libraryId: created.libraryId,
      assetIds: [asset.assetId],
    });
    expect(analysis.enqueued).toBe(1);

    const ensured = await service.ensureVideoContactSheet(created.libraryId, asset.assetId);
    expect(ensured).toBe(true);
    const healedRow = openLibraryDb(created.libraryPath, (db) =>
      db.prepare(
        "SELECT duration_ms FROM revision_artifacts WHERE kind='extracted_metadata' AND status='ready' AND invalidated_at IS NULL AND revision_id = ?",
      ).get(asset.currentRevisionId) as { duration_ms?: number });
    expect(healedRow.duration_ms ?? 0).toBeGreaterThan(0);
    expect(service.getCurrentArtifact(created.libraryId, asset.assetId, 'contact_sheet'))
      .toMatchObject({ status: 'ready' });
  });
});
