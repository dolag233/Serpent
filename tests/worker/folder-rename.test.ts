import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import type { LibraryServiceError } from '../../src/worker/library-service';
import { portablePathIdentity } from '../../src/worker/library-rules';
import type { ImportCompletion } from '../../src/shared/protocol/responses';

const roots: string[] = [];
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
  const value = mkdtempSync(path.join(tmpdir(), 'serpent-folder-rename-'));
  roots.push(value);
  return value;
}

function importFile(service: LibraryService, libraryId: string, sourcePath: string, targetFolderId?: string) {
  return service.prepareOrExecuteImport({
    libraryId,
    sourceKind: 'files',
    sourcePaths: [sourcePath],
    targetFolderId,
  }) as ImportCompletion;
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
  for (const value of roots.splice(0)) rmSync(value, { force: true, recursive: true });
});

describe('managed folder rename', () => {
  it('renames a managed folder on disk and rewrites descendant folder and asset paths', () => {
    const temp = root();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'FolderRename', selectedParentPath: temp });
    const top = service.createManagedFolder({ libraryId: library.libraryId, name: 'a' });
    const nested = service.createManagedFolder({
      libraryId: library.libraryId,
      name: 'b',
      parentFolderId: top.folderId,
    });
    const source = path.join(temp, 'pic.png');
    writeFileSync(source, 'nested-content');
    const asset = importFile(service, library.libraryId, source, nested.folderId).assets[0]!;
    const assetsRoot = path.join(library.libraryPath, 'Assets');

    // Nested rename: the new relative path keeps the parent prefix.
    const renamedNested = service.renameManagedFolder({
      libraryId: library.libraryId,
      folderId: nested.folderId,
      newName: 'bee',
    });
    expect(renamedNested).toEqual({
      folderId: nested.folderId,
      parentFolderId: top.folderId,
      name: 'bee',
      relativePath: 'a/bee',
      directAssetCount: 1,
      childFolderCount: 0,
    });
    expect(existsSync(path.join(assetsRoot, 'a', 'b'))).toBe(false);
    expect(readFileSync(path.join(assetsRoot, 'a', 'bee', 'pic.png'), 'utf8')).toBe('nested-content');

    // Top-level rename: the folder row, the descendant folder row, and the
    // subtree asset all follow on disk and in the DB.
    const renamedTop = service.renameManagedFolder({
      libraryId: library.libraryId,
      folderId: top.folderId,
      newName: 'ex',
    });
    expect(renamedTop).toEqual({
      folderId: top.folderId,
      parentFolderId: null,
      name: 'ex',
      relativePath: 'ex',
      directAssetCount: 0,
      childFolderCount: 1,
    });
    expect(existsSync(path.join(assetsRoot, 'a'))).toBe(false);
    expect(readFileSync(path.join(assetsRoot, 'ex', 'bee', 'pic.png'), 'utf8')).toBe('nested-content');

    const db = database(library.libraryPath);
    try {
      const nestedRow = db.prepare(
        'SELECT name, relative_path, path_identity FROM managed_folders WHERE folder_id = ?',
      ).get(nested.folderId) as { name: string; relative_path: string; path_identity: string };
      expect(nestedRow).toEqual({
        name: 'bee',
        relative_path: 'ex/bee',
        path_identity: portablePathIdentity('ex/bee'),
      });
      const assetRow = db.prepare(
        'SELECT relative_file_path, path_identity FROM assets WHERE asset_id = ?',
      ).get(asset.assetId) as { relative_file_path: string; path_identity: string };
      expect(assetRow.relative_file_path).toBe('ex/bee/pic.png');
      expect(assetRow.path_identity).toBe(portablePathIdentity('ex/bee/pic.png'));
      // renameAssetFile convention: a pure rename records no new revision.
      const revisionCount = db.prepare(
        'SELECT COUNT(*) AS count FROM revisions WHERE asset_id = ?',
      ).get(asset.assetId) as { count: number };
      expect(revisionCount.count).toBe(1);
    } finally {
      db.close();
    }

    expect(service.listManagedFolders(library.libraryId)).toEqual([
      { folderId: top.folderId, parentFolderId: null, name: 'ex', relativePath: 'ex', directAssetCount: 0, childFolderCount: 1 },
      { folderId: nested.folderId, parentFolderId: top.folderId, name: 'bee', relativePath: 'ex/bee', directAssetCount: 1, childFolderCount: 0 },
    ]);
    service.closeAll();
  });

  it('syncs search content for assets inside the renamed subtree', () => {
    const temp = root();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'FolderFts', selectedParentPath: temp });
    const folder = service.createManagedFolder({ libraryId: library.libraryId, name: 'Shots' });
    const source = path.join(temp, 'pic.png');
    writeFileSync(source, 'content');
    const asset = importFile(service, library.libraryId, source, folder.folderId).assets[0]!;

    expect(service.searchAssets({
      libraryId: library.libraryId,
      query: { clauses: [{ field: 'folder_path', values: ['Shots'], exclude: false }] },
    }).total).toBe(1);

    service.renameManagedFolder({
      libraryId: library.libraryId,
      folderId: folder.folderId,
      newName: 'Frames',
    });

    // The old folder token no longer matches; the new one does.
    expect(service.searchAssets({
      libraryId: library.libraryId,
      query: { clauses: [{ field: 'folder_path', values: ['Shots'], exclude: false }] },
    }).total).toBe(0);
    const after = service.searchAssets({
      libraryId: library.libraryId,
      query: { clauses: [{ field: 'folder_path', values: ['Frames'], exclude: false }] },
    });
    expect(after.total).toBe(1);
    expect(after.items[0]!.assetId).toBe(asset.assetId);
    // The file name itself was untouched and stays searchable.
    expect(service.searchAssets({
      libraryId: library.libraryId,
      query: { clauses: [{ field: 'filename', values: ['pic'], exclude: false }] },
    }).total).toBe(1);
    service.closeAll();
  });

  it('treats an identical name as a successful no-op', () => {
    const temp = root();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'FolderNoop', selectedParentPath: temp });
    const folder = service.createManagedFolder({ libraryId: library.libraryId, name: 'Same' });

    const db = database(library.libraryPath);
    const before = db.prepare(
      'SELECT name, relative_path, created_at FROM managed_folders WHERE folder_id = ?',
    ).get(folder.folderId) as { name: string; relative_path: string; created_at: string };
    db.close();

    const renamed = service.renameManagedFolder({
      libraryId: library.libraryId,
      folderId: folder.folderId,
      newName: 'Same',
    });
    expect(renamed).toEqual({
      folderId: folder.folderId,
      parentFolderId: null,
      name: 'Same',
      relativePath: 'Same',
      directAssetCount: 0,
      childFolderCount: 0,
    });
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'Same'))).toBe(true);

    const after = database(library.libraryPath);
    try {
      const row = after.prepare(
        'SELECT name, relative_path, created_at FROM managed_folders WHERE folder_id = ?',
      ).get(folder.folderId) as { name: string; relative_path: string; created_at: string };
      // A no-op writes nothing: identical row.
      expect(row).toEqual(before);
    } finally {
      after.close();
    }
    service.closeAll();
  });

  it('rejects renames onto tracked, case-variant, and untracked conflicting names', () => {
    const temp = root();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'FolderConflicts', selectedParentPath: temp });
    const alpha = service.createManagedFolder({ libraryId: library.libraryId, name: 'Alpha' });
    service.createManagedFolder({ libraryId: library.libraryId, name: 'Beta' });
    const assetsRoot = path.join(library.libraryPath, 'Assets');

    // Tracked folder occupying the exact target name.
    expectCode(
      () => service.renameManagedFolder({ libraryId: library.libraryId, folderId: alpha.folderId, newName: 'Beta' }),
      'FOLDER_NAME_CONFLICT',
    );
    // Case-only difference against a DIFFERENT tracked folder is still a conflict.
    expectCode(
      () => service.renameManagedFolder({ libraryId: library.libraryId, folderId: alpha.folderId, newName: 'BETA' }),
      'FOLDER_NAME_CONFLICT',
    );
    // Untracked directory already on disk at the target name.
    mkdirSync(path.join(assetsRoot, 'charlie'));
    expectCode(
      () => service.renameManagedFolder({ libraryId: library.libraryId, folderId: alpha.folderId, newName: 'charlie' }),
      'FOLDER_NAME_CONFLICT',
    );
    // Untracked directory differing only by case (macOS case-insensitive semantics).
    mkdirSync(path.join(assetsRoot, 'Delta'));
    expectCode(
      () => service.renameManagedFolder({ libraryId: library.libraryId, folderId: alpha.folderId, newName: 'delta' }),
      'FOLDER_NAME_CONFLICT',
    );

    // Nothing moved on disk or in the DB.
    expect(existsSync(path.join(assetsRoot, 'Alpha'))).toBe(true);
    const db = database(library.libraryPath);
    try {
      const row = db.prepare(
        'SELECT relative_path FROM managed_folders WHERE folder_id = ?',
      ).get(alpha.folderId) as { relative_path: string };
      expect(row.relative_path).toBe('Alpha');
    } finally {
      db.close();
    }
    service.closeAll();
  });

  it('rejects a rename onto an existing managed asset path', () => {
    const temp = root();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'FolderAssetConflict', selectedParentPath: temp });
    const source = path.join(temp, 'bravo.png');
    writeFileSync(source, 'bravo');
    importFile(service, library.libraryId, source);
    const folder = service.createManagedFolder({ libraryId: library.libraryId, name: 'holds' });

    // A live managed asset already occupies the target path identity.
    expectCode(
      () => service.renameManagedFolder({ libraryId: library.libraryId, folderId: folder.folderId, newName: 'bravo.png' }),
      'FOLDER_NAME_CONFLICT',
    );
    expectCode(
      () => service.renameManagedFolder({ libraryId: library.libraryId, folderId: folder.folderId, newName: 'BRAVO.png' }),
      'FOLDER_NAME_CONFLICT',
    );
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'holds'))).toBe(true);
    service.closeAll();
  });

  it('rejects invalid names with a typed error and trims surrounding whitespace', () => {
    const temp = root();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'FolderNames', selectedParentPath: temp });
    const folder = service.createManagedFolder({ libraryId: library.libraryId, name: 'plain' });

    const invalid = [
      '',
      '   ',
      '.',
      '..',
      'a/b',
      'a\\b',
      'name.',
      // Windows-forbidden characters: rejected so renamed folders stay portable.
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
      // Folder display names are capped at 80 code points.
      'a'.repeat(81),
    ];
    for (const newName of invalid) {
      expectCode(
        () => service.renameManagedFolder({ libraryId: library.libraryId, folderId: folder.folderId, newName }),
        'INVALID_FOLDER_NAME',
        'NAME_NOT_SUPPORTED',
      );
    }
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'plain'))).toBe(true);

    // Surrounding whitespace is trimmed before validation.
    const renamed = service.renameManagedFolder({
      libraryId: library.libraryId,
      folderId: folder.folderId,
      newName: '  trimmed  ',
    });
    expect(renamed.relativePath).toBe('trimmed');
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'trimmed'))).toBe(true);

    // The 80-code-point boundary itself is still accepted.
    const boundary = service.renameManagedFolder({
      libraryId: library.libraryId,
      folderId: folder.folderId,
      newName: 'b'.repeat(80),
    });
    expect(boundary.relativePath).toBe('b'.repeat(80));
    service.closeAll();
  });

  it('rejects renames for unknown folders and folders missing from disk', () => {
    const temp = root();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'FolderMissing', selectedParentPath: temp });
    const folder = service.createManagedFolder({ libraryId: library.libraryId, name: 'gone' });

    expectCode(
      () => service.renameManagedFolder({ libraryId: library.libraryId, folderId: 'no-such-folder', newName: 'new' }),
      'FOLDER_NOT_FOUND',
    );

    // The directory disappeared behind the library's back.
    rmSync(path.join(library.libraryPath, 'Assets', 'gone'), { force: true, recursive: true });
    expectCode(
      () => service.renameManagedFolder({ libraryId: library.libraryId, folderId: folder.folderId, newName: 'new' }),
      'FOLDER_NOT_FOUND',
      'SOURCE_NOT_FOUND',
    );
    service.closeAll();
  });

  it('renames when only the case changes against itself', () => {
    const temp = root();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'FolderCaseChange', selectedParentPath: temp });
    const folder = service.createManagedFolder({ libraryId: library.libraryId, name: 'cases' });

    const renamed = service.renameManagedFolder({
      libraryId: library.libraryId,
      folderId: folder.folderId,
      newName: 'Cases',
    });
    expect(renamed.relativePath).toBe('Cases');
    expect(readdirSync(path.join(library.libraryPath, 'Assets'))).toContain('Cases');

    const db = database(library.libraryPath);
    try {
      const row = db.prepare(
        'SELECT relative_path, path_identity FROM managed_folders WHERE folder_id = ?',
      ).get(folder.folderId) as { relative_path: string; path_identity: string };
      expect(row.relative_path).toBe('Cases');
      expect(row.path_identity).toBe(portablePathIdentity('Cases'));
    } finally {
      db.close();
    }
    service.closeAll();
  });

  it('rewrites recorded paths for missing assets inside the renamed subtree', () => {
    const temp = root();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'FolderMissingAsset', selectedParentPath: temp });
    const folder = service.createManagedFolder({ libraryId: library.libraryId, name: 'Hold' });
    const source = path.join(temp, 'lost.png');
    writeFileSync(source, 'lost');
    const asset = importFile(service, library.libraryId, source, folder.folderId).assets[0]!;

    // The file vanishes on disk; the asset reconciles to missing.
    rmSync(path.join(library.libraryPath, 'Assets', 'Hold', 'lost.png'));
    service.refreshManagedAssets(library.libraryId);
    expect(service.listAssets({ libraryId: library.libraryId, recursive: true })
      .find((candidate) => candidate.assetId === asset.assetId)?.availability).toBe('missing');

    // The recorded path still follows the real directory so a later relink or
    // restore finds the asset where the tree actually lives.
    service.renameManagedFolder({
      libraryId: library.libraryId,
      folderId: folder.folderId,
      newName: 'Kept',
    });
    const after = service.listAssets({ libraryId: library.libraryId, recursive: true })
      .find((candidate) => candidate.assetId === asset.assetId);
    expect(after).toMatchObject({
      relativeFilePath: 'Kept/lost.png',
      availability: 'missing',
    });
    const db = database(library.libraryPath);
    try {
      const row = db.prepare(
        'SELECT relative_file_path, path_identity FROM assets WHERE asset_id = ?',
      ).get(asset.assetId) as { relative_file_path: string; path_identity: string };
      expect(row.relative_file_path).toBe('Kept/lost.png');
      expect(row.path_identity).toBe(portablePathIdentity('Kept/lost.png'));
    } finally {
      db.close();
    }
    service.closeAll();
  });

  it('restores a trashed asset into the renamed folder through the folder identity chain', () => {
    const temp = root();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'FolderTrashRestore', selectedParentPath: temp });
    const folder = service.createManagedFolder({ libraryId: library.libraryId, name: 'Before' });
    const source = path.join(temp, 'gone.png');
    writeFileSync(source, 'gone');
    const asset = importFile(service, library.libraryId, source, folder.folderId).assets[0]!;

    // Trashed assets no longer live under the folder prefix (their file sits
    // in __trash__), but the restore path resolves the destination through
    // trashed_from_folder_id -> the folder's CURRENT relative_path, so the
    // rename must not strand them.
    service.trashAssets({ libraryId: library.libraryId, assetIds: [asset.assetId] });
    service.renameManagedFolder({
      libraryId: library.libraryId,
      folderId: folder.folderId,
      newName: 'After',
    });

    const restored = service.restoreAssets({ libraryId: library.libraryId, assetIds: [asset.assetId] });
    expect(restored.restoredCount).toBe(1);
    const after = service.listAssets({ libraryId: library.libraryId, recursive: true })
      .find((candidate) => candidate.assetId === asset.assetId);
    expect(after).toMatchObject({
      relativeFilePath: 'After/gone.png',
      availability: 'available',
    });
    expect(readFileSync(path.join(library.libraryPath, 'Assets', 'After', 'gone.png'), 'utf8')).toBe('gone');
    service.closeAll();
  });
});
