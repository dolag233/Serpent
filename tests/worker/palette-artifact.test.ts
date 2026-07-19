import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';

const require = createRequire(import.meta.url);
const TestDatabase = require('better-sqlite3') as new (filename: string) => {
  close(): void;
  prepare(source: string): {
    all(...parameters: unknown[]): unknown[];
    get(...parameters: unknown[]): unknown;
    run(...parameters: unknown[]): { changes: number };
  };
};
const VALID_1X1_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64',
);
const roots: string[] = [];

// LibraryService holds SQLite connections and recursive fs watchers; on
// Windows those open handles block rm of the temp tree (POSIX unlinks open
// files, which is why the leak is invisible on macOS). Always close first.
const services: LibraryService[] = [];

function newService(
  ...args: ConstructorParameters<typeof LibraryService>
): LibraryService {
  const service = new LibraryService(...args);
  services.push(service);
  return service;
}


function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-palette-'));
  roots.push(root);
  return root;
}

function importAsset(service: LibraryService, libraryId: string, sourcePath: string): string {
  const result = service.prepareOrExecuteImport({
    libraryId,
    sourceKind: 'files',
    sourcePaths: [sourcePath],
  });
  if ('importId' in result) throw new Error('Unexpected import conflict.');
  return result.assets[0]!.assetId;
}

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('local extracted palette artifact', () => {
  it('persists deterministic hex ratios and ignores manual palette writes', async () => {
    const root = temporaryRoot();
    const service = newService();
    const library = service.createLibrary({ displayName: 'Palette', selectedParentPath: root });
    const source = path.join(root, 'white.png');
    writeFileSync(source, VALID_1X1_PNG);
    const assetId = importAsset(service, library.libraryId, source);

    service.enqueueThumbnailJobs(library.libraryId);
    expect(await service.processThumbnailQueue(library.libraryId)).toBe(2);

    const artifact = service.getCurrentArtifact(library.libraryId, assetId, 'extracted_palette');
    expect(artifact).toMatchObject({ status: 'ready', mimeType: 'application/json' });
    const persisted = JSON.parse(readFileSync(
      service.getArtifactAbsolutePath(library.libraryId, artifact!.artifactId),
      'utf-8',
    )) as Array<{ hex: string; ratio: number }>;
    expect(persisted).toEqual([{ hex: expect.stringMatching(/^#[0-9A-F]{6}$/u), ratio: 1 }]);

    const automatic = service.getAssetMetadata({ libraryId: library.libraryId, assetId });
    expect(automatic).toMatchObject({
      automaticPalette: persisted,
      effectivePalette: [persisted[0]!.hex],
      paletteSource: 'automatic',
    });
    // Serpent-7pg: manual palette writes are ignored; effective stays automatic.
    const manualWrite = service.setAssetMetadata({
      libraryId: library.libraryId,
      assetId,
      expectedVersion: 0,
      palette: ['#112233', '#AABBCC'],
    });
    expect(manualWrite).toMatchObject({
      palette: null,
      automaticPalette: persisted,
      effectivePalette: [persisted[0]!.hex],
      paletteSource: 'automatic',
    });
    const clearedWrite = service.setAssetMetadata({
      libraryId: library.libraryId,
      assetId,
      expectedVersion: 1,
      palette: [],
    });
    expect(clearedWrite).toMatchObject({
      palette: null,
      effectivePalette: [persisted[0]!.hex],
      paletteSource: 'automatic',
    });
    service.closeAll();
  });

  it('invalidates the prior revision palette and rebuilds it through the media queue', async () => {
    const root = temporaryRoot();
    const service = newService();
    const library = service.createLibrary({ displayName: 'RevisionPalette', selectedParentPath: root });
    const source = path.join(root, 'revision.png');
    writeFileSync(source, VALID_1X1_PNG);
    const assetId = importAsset(service, library.libraryId, source);
    service.enqueueThumbnailJobs(library.libraryId);
    await service.processThumbnailQueue(library.libraryId);
    const original = service.getCurrentArtifact(library.libraryId, assetId, 'extracted_palette')!;

    writeFileSync(service.resolveAssetPath(library.libraryId, assetId), Buffer.concat([
      VALID_1X1_PNG,
      Buffer.from('new revision'),
    ]));
    service.refreshManagedAssets(library.libraryId);
    expect(service.getCurrentArtifact(library.libraryId, assetId, 'extracted_palette')).toBeNull();
    await service.processThumbnailQueue(library.libraryId);
    const rebuilt = service.getCurrentArtifact(library.libraryId, assetId, 'extracted_palette');
    expect(rebuilt?.artifactId).not.toBe(original.artifactId);

    const db = new TestDatabase(path.join(library.libraryPath, '.serpent', 'library.db'));
    expect(db.prepare('SELECT invalidated_at FROM revision_artifacts WHERE artifact_id = ?')
      .get(original.artifactId)).toMatchObject({ invalidated_at: expect.any(String) });
    db.close();
    service.closeAll();
  });

  it('extracts from a ready video poster without reading the original video', async () => {
    const root = temporaryRoot();
    const service = newService();
    const library = service.createLibrary({ displayName: 'PosterPalette', selectedParentPath: root });
    const source = path.join(root, 'clip.mp4');
    writeFileSync(source, Buffer.from('not decoded by this test'));
    const assetId = importAsset(service, library.libraryId, source);
    const db = new TestDatabase(path.join(library.libraryPath, '.serpent', 'library.db'));
    const revision = db.prepare('SELECT current_revision_id FROM assets WHERE asset_id = ?')
      .get(assetId) as { current_revision_id: string };
    const posterId = 'poster-for-palette';
    const posterPath = `${posterId}.png`;
    const artifactsDir = path.join(library.libraryPath, '.serpent', 'artifacts');
    mkdirSync(artifactsDir, { recursive: true });
    writeFileSync(path.join(artifactsDir, posterPath), VALID_1X1_PNG);
    db.prepare(
      `INSERT INTO revision_artifacts
         (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
          generator_version, status, generated_at)
       VALUES (?, ?, 'video_poster', 'image/png', ?, ?, 'test', 'ready', ?)`,
    ).run(posterId, revision.current_revision_id, VALID_1X1_PNG.length, posterPath, new Date().toISOString());
    db.close();

    expect(service.enqueueThumbnailJobs(library.libraryId)).toBe(0);
    expect(service.listMediaJobs(library.libraryId).jobs.some((job) => job.kind === 'extract_palette')).toBe(true);
    await service.processThumbnailQueue(library.libraryId, { maxJobs: 1 });
    expect(service.getCurrentArtifact(library.libraryId, assetId, 'extracted_palette'))
      .toMatchObject({ status: 'ready' });
    service.closeAll();
  });

  it('recovers an interrupted palette job on reopen without resetting attempts', async () => {
    const root = temporaryRoot();
    const service = newService();
    const library = service.createLibrary({ displayName: 'PaletteRecovery', selectedParentPath: root });
    const source = path.join(root, 'recover.png');
    writeFileSync(source, VALID_1X1_PNG);
    const assetId = importAsset(service, library.libraryId, source);
    await service.generateThumbnail({ libraryId: library.libraryId, assetId });
    service.enqueueThumbnailJobs(library.libraryId);
    const job = service.listMediaJobs(library.libraryId).jobs.find((candidate) =>
      candidate.kind === 'extract_palette')!;
    const db = new TestDatabase(path.join(library.libraryPath, '.serpent', 'library.db'));
    db.prepare("UPDATE jobs SET status = 'running', attempt_count = 2 WHERE job_id = ?").run(job.jobId);
    db.close();
    service.closeAll();

    const reopened = newService();
    reopened.openLibrary(library.libraryPath);
    expect(reopened.listMediaJobs(library.libraryId).jobs.find((candidate) =>
      candidate.jobId === job.jobId)).toMatchObject({
      kind: 'extract_palette',
      status: 'queued',
      attemptCount: 2,
      errorCode: 'PROCESS_INTERRUPTED',
    });
    reopened.closeAll();
  });

  it('records a safe failure, retries deterministically, and supports cancellation cleanup', async () => {
    const root = temporaryRoot();
    let attempts = 0;
    let release!: () => void;
    let started!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const decoding = new Promise<void>((resolve) => { started = resolve; });
    const paletteSharpFn = () => ({
      rotate() { return this; },
      toColourspace() { return this; },
      resize() { return this; },
      ensureAlpha() { return this; },
      raw() { return this; },
      async toBuffer() {
        attempts += 1;
        if (attempts === 1) throw new Error(`private decoder detail ${root}`);
        if (attempts === 3) {
          started();
          await blocked;
        }
        return { data: new Uint8Array([255, 0, 0, 255]), info: { channels: 4 } };
      },
    });
    const diagnostics: unknown[] = [];
    const service = newService({
      paletteSharpFn,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    const library = service.createLibrary({ displayName: 'PaletteRetry', selectedParentPath: root });
    const source = path.join(root, 'retry.png');
    writeFileSync(source, VALID_1X1_PNG);
    const assetId = importAsset(service, library.libraryId, source);
    await service.generateThumbnail({ libraryId: library.libraryId, assetId });
    service.enqueueThumbnailJobs(library.libraryId);
    await service.processThumbnailQueue(library.libraryId, { maxJobs: 1 });
    let paletteJob = service.listMediaJobs(library.libraryId).jobs.find((job) => job.kind === 'extract_palette')!;
    expect(paletteJob).toMatchObject({
      status: 'failed',
      errorCode: 'PALETTE_EXTRACTION_FAILED',
      errorDetail: expect.stringContaining('Local palette extraction failed'),
    });
    expect(paletteJob.errorDetail).not.toContain(root);
    expect(diagnostics.some((entry) =>
      (entry as { error?: Error }).error?.message.includes('private decoder detail'))).toBe(true);

    expect(service.retryMediaJobs(library.libraryId, [paletteJob.jobId])).toEqual({ retriedCount: 1 });
    await service.processThumbnailQueue(library.libraryId, { maxJobs: 1 });
    expect(service.getCurrentArtifact(library.libraryId, assetId, 'extracted_palette'))
      .toMatchObject({ status: 'ready' });

    const db = new TestDatabase(path.join(library.libraryPath, '.serpent', 'library.db'));
    db.prepare("UPDATE revision_artifacts SET invalidated_at = ? WHERE kind = 'extracted_palette' AND invalidated_at IS NULL")
      .run(new Date().toISOString());
    db.close();
    service.enqueueThumbnailJobs(library.libraryId);
    paletteJob = service.listMediaJobs(library.libraryId).jobs.find((job) =>
      job.kind === 'extract_palette' && job.status === 'queued')!;
    const processing = service.processThumbnailQueue(library.libraryId, { maxJobs: 1 });
    await decoding;
    expect(service.cancelMediaJobs(library.libraryId, [paletteJob.jobId])).toEqual({ cancelledCount: 1 });
    release();
    await processing;
    expect(service.listMediaJobs(library.libraryId).jobs.find((job) => job.jobId === paletteJob.jobId))
      .toMatchObject({ status: 'cancelled' });
    expect(service.getCurrentArtifact(library.libraryId, assetId, 'extracted_palette')).toBeNull();
    service.closeAll();
  });
});
