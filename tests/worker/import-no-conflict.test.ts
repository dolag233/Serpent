import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import { importNoConflict } from './import-no-conflict';

const roots: string[] = [];
const services: LibraryService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('importNoConflict helper (Serpent-op48 / library dedup)', () => {
  it('imports two same-byte files under different names as two assets', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-import-helper-'));
    roots.push(root);
    const service = new LibraryService();
    services.push(service);
    const library = service.createLibrary({
      displayName: 'Helper Dedup',
      selectedParentPath: root,
    });

    const a = path.join(root, 'a.png');
    const b = path.join(root, 'b.png');
    writeFileSync(a, 'identical-bytes');
    writeFileSync(b, 'identical-bytes');

    const first = importNoConflict(service, library.libraryId, a);
    const second = importNoConflict(service, library.libraryId, b);

    expect(first.importedCount).toBe(1);
    expect(second.importedCount).toBe(1);
    expect(first.assets[0]!.assetId).not.toBe(second.assets[0]!.assetId);

    const assets = service.listAssets({
      libraryId: library.libraryId,
      recursive: true,
    });
    expect(assets).toHaveLength(2);
    expect(
      existsSync(path.join(library.libraryPath, 'Assets', 'a.png')),
    ).toBe(true);
    expect(
      existsSync(path.join(library.libraryPath, 'Assets', 'b.png')),
    ).toBe(true);
  });
});
