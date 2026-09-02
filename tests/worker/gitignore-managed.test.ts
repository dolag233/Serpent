import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService, openConfiguredDatabase } from '../../src/worker/library-service';
import { importNoConflict } from './import-no-conflict';

const roots: string[] = [];
const services: LibraryService[] = [];

function temporaryRoot(): string {
  const value = mkdtempSync(path.join(tmpdir(), 'serpent-gitignore-managed-'));
  roots.push(value);
  return value;
}

function newService(): LibraryService {
  const service = new LibraryService();
  services.push(service);
  return service;
}

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('managed ignore configuration', () => {
  it('writes every managed ignore action to .serpentignore and survives reopening', () => {
    const root = temporaryRoot();
    const service = newService();
    const library = service.createLibrary({
      displayName: 'Managed ignore rules',
      selectedParentPath: root,
    });
    const folder = service.createManagedFolder({
      libraryId: library.libraryId,
      name: 'renders',
    });
    const source = path.join(root, 'preview.txt');
    writeFileSync(source, 'preview');
    const imported = importNoConflict(service, library.libraryId, source, folder.folderId);
    const asset = imported.assets[0]!;

    service.setIgnore({
      libraryId: library.libraryId,
      locationKind: 'managed',
      relativePath: 'txt',
      pathKind: 'extension',
      ignored: true,
    });
    service.setIgnore({
      libraryId: library.libraryId,
      locationKind: 'managed',
      relativePath: folder.relativePath,
      pathKind: 'folder',
      ignored: true,
    });
    service.setIgnore({
      libraryId: library.libraryId,
      locationKind: 'managed',
      relativePath: asset.relativeFilePath,
      pathKind: 'asset',
      ignored: true,
    });

    const ignorePath = path.join(library.libraryPath, '.serpentignore');
    expect(existsSync(ignorePath)).toBe(true);
    const ignoreText = readFileSync(ignorePath, 'utf8');
    expect(ignoreText).toBe(
      '*.txt\nAssets/renders/\nAssets/renders/preview.txt\n',
    );
    expect(service.listIgnoredPaths(library.libraryId)).toEqual([]);
    expect(service.listAssets({ libraryId: library.libraryId, recursive: true })).toEqual([]);

    service.setIgnore({
      libraryId: library.libraryId,
      locationKind: 'managed',
      relativePath: 'txt',
      pathKind: 'extension',
      ignored: false,
    });
    expect(readFileSync(ignorePath, 'utf8')).toContain('!*.txt\n');

    service.closeAll();
    const reopened = newService();
    reopened.openLibrary(library.libraryPath);
    expect(reopened.getGitignore(library.libraryId).content).toContain('Assets/renders/');
    expect(reopened.listAssets({ libraryId: library.libraryId, recursive: true })).toEqual([]);
  });

  it('filters new files during discovery instead of waiting for a database row', () => {
    const root = temporaryRoot();
    const service = newService();
    const library = service.createLibrary({
      displayName: 'Discovery ignore rules',
      selectedParentPath: root,
    });

    service.setGitignore({ libraryId: library.libraryId, content: 'renders/**/*.png\n' });
    const ignoredDirectory = path.join(library.libraryPath, 'Assets', 'renders', 'day');
    const visibleDirectory = path.join(library.libraryPath, 'Assets', 'renders', 'day', 'notes');
    // The ignore file is intentionally saved before these files exist.  The
    // next refresh must apply its rules while enumerating the new entries.
    expect(existsSync(ignoredDirectory)).toBe(false);
    expect(existsSync(visibleDirectory)).toBe(false);
    mkdirSync(visibleDirectory, { recursive: true });
    writeFileSync(path.join(library.libraryPath, 'Assets', 'renders', 'day', 'preview.png'), 'png');
    writeFileSync(path.join(library.libraryPath, 'Assets', 'renders', 'day', 'notes', 'readme.txt'), 'text');

    service.refreshManagedAssets(library.libraryId);
    expect(service.listAssets({ libraryId: library.libraryId, recursive: true })
      .map((asset) => asset.relativeFilePath)).toEqual(['renders/day/notes/readme.txt']);

    // Editing the file directly (including deleting a rule) must clear the
    // materialized snapshot as well as update the in-memory matcher.
    service.setGitignore({ libraryId: library.libraryId, content: '*.txt\n' });
    expect(service.listAssets({ libraryId: library.libraryId, recursive: true })).toEqual([]);
    service.setGitignore({ libraryId: library.libraryId, content: '' });
    expect(service.listAssets({ libraryId: library.libraryId, recursive: true })
      .map((asset) => asset.relativeFilePath)).toEqual(['renders/day/notes/readme.txt']);
  });

  it('promotes legacy managed database ignores without revealing them on reopen', () => {
    const root = temporaryRoot();
    const service = newService();
    const library = service.createLibrary({
      displayName: 'Legacy ignore rules',
      selectedParentPath: root,
    });
    const source = path.join(root, 'legacy.txt');
    writeFileSync(source, 'legacy');
    const asset = importNoConflict(service, library.libraryId, source).assets[0]!;
    service.closeAll();

    const databasePath = path.join(library.libraryPath, '.serpent', 'library.db');
    const database = openConfiguredDatabase(databasePath);
    try {
      database.prepare(
        `INSERT INTO explicit_ignored_paths
          (location_kind, linked_folder_id, relative_path, path_kind, ignored_at)
         VALUES ('managed', '', ?, 'asset', ?)`,
      ).run(asset.relativeFilePath, new Date().toISOString());
    } finally {
      database.close();
    }

    const reopened = newService();
    reopened.openLibrary(library.libraryPath);
    expect(readFileSync(path.join(library.libraryPath, '.serpentignore'), 'utf8'))
      .toContain(`Assets/${asset.relativeFilePath}`);
    expect(reopened.listAssets({ libraryId: library.libraryId, recursive: true })).toEqual([]);
  });
});
