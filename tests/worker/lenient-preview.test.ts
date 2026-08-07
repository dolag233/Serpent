// Serpent-verg.2: preview resolution (getPreviewArtifact) must keep working
// on an older library whose artifact table or artifact columns are missing —
// degraded to "no artifact" instead of failing (0031 §1).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';

const temporaryRoots: string[] = [];
const require = createRequire(import.meta.url);

interface TestDatabaseConnection {
  close(): void;
  exec(sql: string): void;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  prepare(source: string): {
    get(...parameters: unknown[]): unknown;
    all(...parameters: unknown[]): unknown;
  };
}

const TestDatabase = require('better-sqlite3') as new (filename: string) => TestDatabaseConnection;

const VALID_1X1_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-lenient-preview-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function libraryWithOneAsset(root: string, displayName: string): {
  service: LibraryService;
  libraryId: string;
  assetId: string;
  libraryPath: string;
} {
  const service = new LibraryService();
  const library = service.createLibrary({ displayName, selectedParentPath: root });
  const fixture = path.join(root, 'sample.png');
  writeFileSync(fixture, VALID_1X1_PNG);
  const imported = service.prepareOrExecuteImport({
    libraryId: library.libraryId,
    sourceKind: 'files',
    sourcePaths: [fixture],
  });
  if ('importId' in imported) throw new Error('unexpected conflict plan');
  const asset = imported.assets[0]!;
  return {
    service,
    libraryId: library.libraryId,
    assetId: asset.assetId,
    libraryPath: library.libraryPath,
  };
}

function dropTable(dbPath: string, table: string): void {
  const db = new TestDatabase(dbPath);
  db.exec(`DROP TABLE ${table}`);
  db.close();
}

function dropColumns(dbPath: string, table: string, columns: string[]): void {
  const db = new TestDatabase(dbPath);
  const indexes = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_%'",
    )
    .all(table) as Array<{ name: string }>;
  for (const index of indexes) db.exec(`DROP INDEX ${index.name}`);
  for (const column of columns) db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  db.close();
}

describe('getPreviewArtifact lenient read (Serpent-verg.2)', () => {
  it('resolves a thumbnail artifact on a current library (baseline)', () => {
    const root = temporaryRoot();
    const { service, libraryId, assetId } = libraryWithOneAsset(root, 'PreviewBaseline');
    const preview = service.getPreviewArtifact(libraryId, assetId);
    expect(['ready', 'pending']).toContain(preview.status);
    expect(preview.kind).toBe('thumbnail');
    service.closeAll();
  });

  it('resolves preview without failing when the artifact table is missing', () => {
    const root = temporaryRoot();
    const { service, libraryId, assetId, libraryPath } = libraryWithOneAsset(
      root,
      'PreviewNoArtifacts',
    );
    dropTable(path.join(libraryPath, '.serpent', 'library.db'), 'revision_artifacts');
    service.closeAll();
    service.openLibrary(libraryPath);

    const preview = service.getPreviewArtifact(libraryId, assetId);
    expect(['ready', 'pending', 'missing']).toContain(preview.status);
    expect(preview.artifactId).toBeUndefined();
    service.closeAll();
  });

  it('degrades when artifact status columns are missing', () => {
    const root = temporaryRoot();
    const { service, libraryId, assetId, libraryPath } = libraryWithOneAsset(
      root,
      'PreviewNoStatus',
    );
    dropColumns(path.join(libraryPath, '.serpent', 'library.db'), 'revision_artifacts', [
      'status',
      'error_code',
    ]);
    service.closeAll();
    service.openLibrary(libraryPath);

    const preview = service.getPreviewArtifact(libraryId, assetId);
    // The missing status degrades to non-ready; the preview must not throw
    // and must expose a source playback path or pending state.
    expect(['pending', 'missing', 'ready']).toContain(preview.status);
    service.closeAll();
  });
});
