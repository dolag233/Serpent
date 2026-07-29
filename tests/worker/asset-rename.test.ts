import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import type { LibraryServiceError } from '../../src/worker/library-service';
import { portablePathIdentity } from '../../src/worker/library-rules';
import { importNoConflict as importFile } from './import-no-conflict';

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

const require = createRequire(import.meta.url);
const TestDatabase = require('better-sqlite3') as new (filename: string) => {
  close(): void;
  prepare(source: string): {
    all(...parameters: unknown[]): unknown[];
    get(...parameters: unknown[]): unknown;
    run(...parameters: unknown[]): unknown;
  };
};

function root(): string {
  const value = mkdtempSync(path.join(tmpdir(), 'serpent-asset-rename-'));
  roots.push(value);
  return value;
}

function expectCode(
  run: () => unknown,
  code: LibraryServiceError['code'],
  reason?: string,
) {
  expect(run).toThrowError(expect.objectContaining(reason === undefined ? { code } : { code, reason }));
}

function database(libraryPath: string) {
  return new TestDatabase(path.join(libraryPath, '.serpent', 'library.db'));
}

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const value of roots.splice(0)) rmSync(value, { force: true, recursive: true });
});

describe('asset file rename (REQ-MENU-002)', () => {
  it('renames a managed asset on disk and syncs DB row and search index without a new revision', () => {
    const temp = root();
    const service = newService();
    const library = service.createLibrary({ displayName: 'Rename', selectedParentPath: temp });
    const folder = service.createManagedFolder({ libraryId: library.libraryId, name: 'Shots' });
    const nestedSource = path.join(temp, 'alpha.png');
    const rootSource = path.join(temp, 'root.png');
    writeFileSync(nestedSource, 'nested-content');
    writeFileSync(rootSource, 'root-content');
    const nested = importFile(service, library.libraryId, nestedSource, folder.folderId).assets[0]!;
    const atRoot = importFile(service, library.libraryId, rootSource).assets[0]!;

    expect(service.searchAssets({
      libraryId: library.libraryId,
      query: { clauses: [{ field: 'filename', values: ['alpha'], exclude: false }] },
    }).total).toBe(1);

    const renamed = service.renameAssetFile({
      libraryId: library.libraryId,
      assetId: nested.assetId,
      newBaseName: 'bravo',
    });
    expect(renamed.asset).toMatchObject({
      assetId: nested.assetId,
      locationKind: 'managed',
      managedFolderId: folder.folderId,
      relativeFilePath: 'Shots/bravo.png',
      displayName: 'bravo.png',
      availability: 'available',
    });
    // The disk file was really renamed in place, contents untouched.
    const assetsRoot = path.join(library.libraryPath, 'Assets');
    expect(existsSync(path.join(assetsRoot, 'Shots', 'alpha.png'))).toBe(false);
    expect(readFileSync(path.join(assetsRoot, 'Shots', 'bravo.png'), 'utf8')).toBe('nested-content');

    const renamedAtRoot = service.renameAssetFile({
      libraryId: library.libraryId,
      assetId: atRoot.assetId,
      newBaseName: 'top',
    });
    expect(renamedAtRoot.asset.relativeFilePath).toBe('top.png');
    expect(existsSync(path.join(assetsRoot, 'root.png'))).toBe(false);
    expect(readFileSync(path.join(assetsRoot, 'top.png'), 'utf8')).toBe('root-content');

    const db = database(library.libraryPath);
    try {
      const row = db.prepare(
        'SELECT relative_file_path, path_identity FROM assets WHERE asset_id = ?',
      ).get(nested.assetId) as { relative_file_path: string; path_identity: string };
      expect(row.relative_file_path).toBe('Shots/bravo.png');
      expect(row.path_identity).toBe(portablePathIdentity('Shots/bravo.png'));
      // moveAssets/trashAssets convention: a pure rename records no revision.
      const revisionCount = db.prepare(
        'SELECT COUNT(*) AS count FROM revisions WHERE asset_id = ?',
      ).get(nested.assetId) as { count: number };
      expect(revisionCount.count).toBe(1);
    } finally {
      db.close();
    }

    // FTS filename tokens follow the rename in both directions.
    expect(service.searchAssets({
      libraryId: library.libraryId,
      query: { clauses: [{ field: 'filename', values: ['alpha'], exclude: false }] },
    }).total).toBe(0);
    const after = service.searchAssets({
      libraryId: library.libraryId,
      query: { clauses: [{ field: 'filename', values: ['bravo'], exclude: false }] },
    });
    expect(after.total).toBe(1);
    expect(after.items[0]!.assetId).toBe(nested.assetId);
    service.closeAll();
  });

  it('renames a linked asset inside its linked root, preserving the directory', () => {
    const temp = root();
    const sourceRoot = path.join(temp, 'linked-src');
    mkdirSync(path.join(sourceRoot, 'sub'), { recursive: true });
    writeFileSync(path.join(sourceRoot, 'alpha.png'), 'linked-alpha');
    writeFileSync(path.join(sourceRoot, 'sub', 'beta.png'), 'linked-beta');

    const service = newService();
    const library = service.createLibrary({ displayName: 'LinkedRename', selectedParentPath: temp });
    service.importFolderAsLinked({ libraryId: library.libraryId, sourceRootPath: sourceRoot });
    const assets = service.listAssets({ libraryId: library.libraryId, recursive: true });
    const top = assets.find((asset) => asset.relativeFilePath === 'alpha.png')!;
    const nested = assets.find((asset) => asset.relativeFilePath === 'sub/beta.png')!;

    const renamedTop = service.renameAssetFile({
      libraryId: library.libraryId,
      assetId: top.assetId,
      newBaseName: 'bravo',
    });
    expect(renamedTop.asset).toMatchObject({
      locationKind: 'linked',
      relativeFilePath: 'bravo.png',
      displayName: 'bravo.png',
    });
    expect(existsSync(path.join(sourceRoot, 'alpha.png'))).toBe(false);
    expect(readFileSync(path.join(sourceRoot, 'bravo.png'), 'utf8')).toBe('linked-alpha');

    const renamedNested = service.renameAssetFile({
      libraryId: library.libraryId,
      assetId: nested.assetId,
      newBaseName: 'gamma',
    });
    expect(renamedNested.asset.relativeFilePath).toBe('sub/gamma.png');
    expect(existsSync(path.join(sourceRoot, 'sub', 'beta.png'))).toBe(false);
    expect(readFileSync(path.join(sourceRoot, 'sub', 'gamma.png'), 'utf8')).toBe('linked-beta');

    const after = service.searchAssets({
      libraryId: library.libraryId,
      query: { clauses: [{ field: 'filename', values: ['gamma'], exclude: false }] },
    });
    expect(after.total).toBe(1);
    expect(after.items[0]!.assetId).toBe(nested.assetId);
    service.closeAll();
  });

  it('batch-renames independent assets and reports local naming conflicts without rolling back prior successes', () => {
    const temp = root();
    const service = newService();
    const library = service.createLibrary({ displayName: 'Batch Rename', selectedParentPath: temp });
    const firstSource = path.join(temp, 'first.png');
    const secondSource = path.join(temp, 'second.png');
    const occupiedSource = path.join(temp, 'occupied.png');
    writeFileSync(firstSource, 'first');
    writeFileSync(secondSource, 'second');
    writeFileSync(occupiedSource, 'occupied');
    const first = importFile(service, library.libraryId, firstSource).assets[0]!;
    const second = importFile(service, library.libraryId, secondSource).assets[0]!;
    importFile(service, library.libraryId, occupiedSource);

    const result = service.renameAssetFiles({
      libraryId: library.libraryId,
      items: [
        { assetId: first.assetId, newBaseName: 'first-concept' },
        { assetId: second.assetId, newBaseName: 'occupied' },
        { assetId: 'missing-asset', newBaseName: 'unused' },
      ],
    });

    expect(result).toMatchObject({
      renamedCount: 1,
      skipped: [
        { assetId: second.assetId, reason: 'name_conflict' },
        { assetId: 'missing-asset', reason: 'asset_not_found' },
      ],
      assets: [{ assetId: first.assetId, displayName: 'first-concept.png' }],
    });
    expect(readFileSync(path.join(library.libraryPath, 'Assets', 'first-concept.png'), 'utf8')).toBe('first');
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'second.png'))).toBe(true);
    expect(service.searchAssets({
      libraryId: library.libraryId,
      query: { clauses: [{ field: 'filename', values: ['first-concept'], exclude: false }] },
    }).total).toBe(1);
    service.closeAll();
  });

  it('rejects renames onto tracked, case-variant, and untracked conflicting names', () => {
    const temp = root();
    const service = newService();
    const library = service.createLibrary({ displayName: 'Conflicts', selectedParentPath: temp });
    const folder = service.createManagedFolder({ libraryId: library.libraryId, name: 'Dupes' });
    const alphaSource = path.join(temp, 'alpha.png');
    const bravoSource = path.join(temp, 'bravo.png');
    writeFileSync(alphaSource, 'alpha');
    writeFileSync(bravoSource, 'bravo');
    const alpha = importFile(service, library.libraryId, alphaSource, folder.folderId).assets[0]!;
    importFile(service, library.libraryId, bravoSource, folder.folderId);
    const assetsRoot = path.join(library.libraryPath, 'Assets', 'Dupes');

    // Tracked asset occupying the exact target name.
    expectCode(
      () => service.renameAssetFile({ libraryId: library.libraryId, assetId: alpha.assetId, newBaseName: 'bravo' }),
      'ASSET_FILE_NAME_CONFLICT',
    );
    // Case-only difference against a DIFFERENT tracked asset is still a conflict.
    expectCode(
      () => service.renameAssetFile({ libraryId: library.libraryId, assetId: alpha.assetId, newBaseName: 'BRAVO' }),
      'ASSET_FILE_NAME_CONFLICT',
    );
    // Untracked file already on disk at the target name.
    writeFileSync(path.join(assetsRoot, 'charlie.png'), 'untracked');
    expectCode(
      () => service.renameAssetFile({ libraryId: library.libraryId, assetId: alpha.assetId, newBaseName: 'charlie' }),
      'ASSET_FILE_NAME_CONFLICT',
    );
    // Untracked file differing only by case (macOS case-insensitive semantics).
    writeFileSync(path.join(assetsRoot, 'Delta.png'), 'untracked-case');
    expectCode(
      () => service.renameAssetFile({ libraryId: library.libraryId, assetId: alpha.assetId, newBaseName: 'delta' }),
      'ASSET_FILE_NAME_CONFLICT',
    );

    // Nothing moved on disk or in the DB.
    expect(readFileSync(path.join(assetsRoot, 'alpha.png'), 'utf8')).toBe('alpha');
    expect(readFileSync(path.join(assetsRoot, 'bravo.png'), 'utf8')).toBe('bravo');
    const db = database(library.libraryPath);
    try {
      const row = db.prepare(
        'SELECT relative_file_path FROM assets WHERE asset_id = ?',
      ).get(alpha.assetId) as { relative_file_path: string };
      expect(row.relative_file_path).toBe('Dupes/alpha.png');
    } finally {
      db.close();
    }
    service.closeAll();
  });

  it('rejects renames for missing, trashed, and offline assets', () => {
    const temp = root();
    const service = newService();
    const library = service.createLibrary({ displayName: 'States', selectedParentPath: temp });
    const missingSource = path.join(temp, 'missing.png');
    const trashedSource = path.join(temp, 'trashed.png');
    writeFileSync(missingSource, 'missing');
    writeFileSync(trashedSource, 'trashed');
    const missing = importFile(service, library.libraryId, missingSource).assets[0]!;
    const trashed = importFile(service, library.libraryId, trashedSource).assets[0]!;

    rmSync(path.join(library.libraryPath, 'Assets', 'missing.png'));
    service.refreshManagedAssets(library.libraryId);
    expectCode(
      () => service.renameAssetFile({ libraryId: library.libraryId, assetId: missing.assetId, newBaseName: 'new' }),
      'ASSET_NOT_FOUND',
      'SOURCE_NOT_FOUND',
    );

    service.trashAssets({ libraryId: library.libraryId, assetIds: [trashed.assetId] });
    expectCode(
      () => service.renameAssetFile({ libraryId: library.libraryId, assetId: trashed.assetId, newBaseName: 'new' }),
      'ASSET_NOT_FOUND',
      'SOURCE_NOT_FOUND',
    );

    expectCode(
      () => service.renameAssetFile({ libraryId: library.libraryId, assetId: 'no-such-asset', newBaseName: 'new' }),
      'ASSET_NOT_FOUND',
    );
    service.closeAll();
  });

  it('rejects renames when the linked root is offline or the linked file is missing', () => {
    const temp = root();
    const missingRoot = path.join(temp, 'missing-src');
    const offlineRoot = path.join(temp, 'offline-src');
    mkdirSync(missingRoot);
    mkdirSync(offlineRoot);
    writeFileSync(path.join(missingRoot, 'gone.png'), 'gone');
    writeFileSync(path.join(offlineRoot, 'held.png'), 'held');

    const service = newService();
    const library = service.createLibrary({ displayName: 'LinkedStates', selectedParentPath: temp });
    service.importFolderAsLinked({ libraryId: library.libraryId, sourceRootPath: missingRoot });
    service.importFolderAsLinked({ libraryId: library.libraryId, sourceRootPath: offlineRoot });
    const assets = service.listAssets({ libraryId: library.libraryId, recursive: true });
    const gone = assets.find((asset) => asset.relativeFilePath === 'gone.png')!;
    const held = assets.find((asset) => asset.relativeFilePath === 'held.png')!;

    // File removed while the root stays online -> asset reconciles to missing.
    rmSync(path.join(missingRoot, 'gone.png'));
    service.refreshManagedAssets(library.libraryId);
    expectCode(
      () => service.renameAssetFile({ libraryId: library.libraryId, assetId: gone.assetId, newBaseName: 'new' }),
      'ASSET_NOT_FOUND',
      'SOURCE_NOT_FOUND',
    );

    // Whole linked root gone -> folder offline -> rename refused.
    rmSync(offlineRoot, { force: true, recursive: true });
    service.refreshManagedAssets(library.libraryId);
    expectCode(
      () => service.renameAssetFile({ libraryId: library.libraryId, assetId: held.assetId, newBaseName: 'new' }),
      'ASSET_NOT_FOUND',
      'SOURCE_NOT_FOUND',
    );
    service.closeAll();
  });

  it('treats an identical name (including case) as a successful no-op', () => {
    const temp = root();
    const service = newService();
    const library = service.createLibrary({ displayName: 'Noop', selectedParentPath: temp });
    const folder = service.createManagedFolder({ libraryId: library.libraryId, name: 'Same' });
    const source = path.join(temp, 'echo.png');
    writeFileSync(source, 'echo');
    const asset = importFile(service, library.libraryId, source, folder.folderId).assets[0]!;

    const db = database(library.libraryPath);
    const before = db.prepare(
      'SELECT relative_file_path, updated_at FROM assets WHERE asset_id = ?',
    ).get(asset.assetId) as { relative_file_path: string; updated_at: string };
    db.close();

    const renamed = service.renameAssetFile({
      libraryId: library.libraryId,
      assetId: asset.assetId,
      newBaseName: 'echo',
    });
    expect(renamed.asset.relativeFilePath).toBe('Same/echo.png');
    expect(readFileSync(path.join(library.libraryPath, 'Assets', 'Same', 'echo.png'), 'utf8')).toBe('echo');

    const after = database(library.libraryPath);
    try {
      const row = after.prepare(
        'SELECT relative_file_path, updated_at FROM assets WHERE asset_id = ?',
      ).get(asset.assetId) as { relative_file_path: string; updated_at: string };
      // A no-op writes nothing: identical row, identical update timestamp.
      expect(row).toEqual(before);
    } finally {
      after.close();
    }
    service.closeAll();
  });

  it('renames when only the case changes against itself', () => {
    const temp = root();
    const service = newService();
    const library = service.createLibrary({ displayName: 'CaseChange', selectedParentPath: temp });
    const folder = service.createManagedFolder({ libraryId: library.libraryId, name: 'Case' });
    const source = path.join(temp, 'foxtrot.png');
    writeFileSync(source, 'foxtrot');
    const asset = importFile(service, library.libraryId, source, folder.folderId).assets[0]!;

    const renamed = service.renameAssetFile({
      libraryId: library.libraryId,
      assetId: asset.assetId,
      newBaseName: 'Foxtrot',
    });
    expect(renamed.asset.relativeFilePath).toBe('Case/Foxtrot.png');
    expect(readdirSync(path.join(library.libraryPath, 'Assets', 'Case'))).toContain('Foxtrot.png');
    service.closeAll();
  });

  it('rejects invalid base names with a typed error and trims surrounding whitespace', () => {
    const temp = root();
    const service = newService();
    const library = service.createLibrary({ displayName: 'Names', selectedParentPath: temp });
    const source = path.join(temp, 'plain.png');
    writeFileSync(source, 'plain');
    const asset = importFile(service, library.libraryId, source).assets[0]!;

    const invalid = [
      '',
      '   ',
      '..',
      'a/b',
      'a\\b',
      'name.',
      // Windows-forbidden characters: rejected so renamed files stay portable.
      'a<b',
      'a>b',
      'a:b',
      'a"b',
      'a|b',
      'a?b',
      'a*b',
      'CON',
      'con',
      'aux',
      'lpt1',
      'com9',
      'con.txt',
      'a'.repeat(256),
      // 253 base bytes + '.png' exceeds the 255-byte component limit.
      'b'.repeat(253),
    ];
    for (const newBaseName of invalid) {
      expectCode(
        () => service.renameAssetFile({ libraryId: library.libraryId, assetId: asset.assetId, newBaseName }),
        'INVALID_ASSET_FILE_NAME',
        'NAME_NOT_SUPPORTED',
      );
    }
    expect(readFileSync(path.join(library.libraryPath, 'Assets', 'plain.png'), 'utf8')).toBe('plain');

    // Surrounding whitespace is trimmed before validation; the extension stays.
    const renamed = service.renameAssetFile({
      libraryId: library.libraryId,
      assetId: asset.assetId,
      newBaseName: '  trimmed  ',
    });
    expect(renamed.asset.relativeFilePath).toBe('trimmed.png');
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'trimmed.png'))).toBe(true);

    // The 255-byte boundary itself (251 + '.png') is still accepted.
    const boundary = service.renameAssetFile({
      libraryId: library.libraryId,
      assetId: asset.assetId,
      newBaseName: 'c'.repeat(251),
    });
    expect(boundary.asset.relativeFilePath).toBe(`${'c'.repeat(251)}.png`);
    service.closeAll();
  });
});
