import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  LibraryService,
  LibraryServiceError,
  type ImportFailurePoint,
} from '../../src/worker/library-service';

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-import-plan-test-'));
  temporaryRoots.push(root);
  return root;
}

function expectServiceCode(operation: () => unknown, code: LibraryServiceError['code']): void {
  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(LibraryServiceError);
  expect((thrown as LibraryServiceError).code).toBe(code);
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('asset listing', () => {
  it('returns an empty list for a new library and validates folder scope', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Assets', selectedParentPath: root });

    expect(service.listAssets({ libraryId: library.libraryId, recursive: true })).toEqual([]);
    expectServiceCode(
      () => service.listAssets({ libraryId: library.libraryId, folderId: 'forged', recursive: false }),
      'FOLDER_NOT_FOUND',
    );
    service.closeAll();
  });
});

describe('pending import plans', () => {
  it('executes an unconflicted prepare immediately without returning a pending token', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'direct.png');
    writeFileSync(source, 'direct');
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Direct', selectedParentPath: root });

    const result = service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [source],
    });

    expect(result).toMatchObject({ importedCount: 1, skippedCount: 0, replacedCount: 0 });
    expect('importId' in result).toBe(false);
    expect(readFileSync(path.join(library.libraryPath, 'Assets', 'direct.png'), 'utf8')).toBe('direct');
    service.closeAll();
  });

  it('enumerates a folder hierarchy without exposing source paths', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'Source Art');
    mkdirSync(path.join(source, 'UI'), { recursive: true });
    writeFileSync(path.join(source, 'cover.png'), 'cover');
    writeFileSync(path.join(source, 'UI', 'button.svg'), '<svg/>');
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Library', selectedParentPath: root });

    const plan = service.prepareImport({
      libraryId: library.libraryId,
      sourceKind: 'folder',
      sourcePaths: [source],
    });

    expect(plan).toMatchObject({
      fileCount: 2,
      totalBytes: 11,
      suspectedDuplicateCount: 0,
      nameConflictCount: 0,
      examples: [],
    });
    expect(JSON.stringify(plan)).not.toContain(root);
    expect(JSON.stringify(plan)).not.toContain(source);
    expect(service.listAssets({ libraryId: library.libraryId, recursive: true })).toEqual([]);
    expect(readdirSync(path.join(library.libraryPath, 'Assets'))).toEqual([]);
    expect(existsSync(path.join(library.libraryPath, '.serpent', 'operations', plan.importId, 'stage'))).toBe(true);
    service.closeAll();
    expect(existsSync(path.join(library.libraryPath, '.serpent', 'operations'))).toBe(false);
  });

  it('omits operating-system metadata and common dependency/cache trees', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'Reference');
    mkdirSync(path.join(source, '.git'), { recursive: true });
    mkdirSync(path.join(source, 'node_modules', 'package'), { recursive: true });
    mkdirSync(path.join(source, 'shots'), { recursive: true });
    writeFileSync(path.join(source, '.DS_Store'), 'finder metadata');
    writeFileSync(path.join(source, 'Thumbs.db'), 'windows thumbnails');
    writeFileSync(path.join(source, '._sidecar.png'), 'resource fork');
    writeFileSync(path.join(source, '.git', 'config'), 'git data');
    writeFileSync(path.join(source, 'node_modules', 'package', 'index.js'), 'dependency');
    writeFileSync(path.join(source, 'shots', 'hero.png'), 'hero');
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'IgnoredMetadata', selectedParentPath: root });

    const completion = service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      sourceKind: 'folder',
      sourcePaths: [source],
    });

    expect(completion).toMatchObject({ importedCount: 1, skippedCount: 0 });
    expect(service.listAssets({ libraryId: library.libraryId, recursive: true })
      .map((asset) => asset.displayName)).toEqual(['hero.png']);
    service.closeAll();
  });

  it('imports existing names longer than the managed-folder display-name limit', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'Reference');
    const longFileName = `${'long-existing-file-name-'.repeat(4)}reference.jpg`;
    expect([...longFileName].length).toBeGreaterThan(80);
    mkdirSync(source);
    writeFileSync(path.join(source, longFileName), 'reference');
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Long names', selectedParentPath: root });

    const completion = service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      sourceKind: 'folder',
      sourcePaths: [source],
    });

    expect(completion).toMatchObject({ importedCount: 1, skippedCount: 0, replacedCount: 0 });
    expect(readFileSync(path.join(library.libraryPath, 'Assets', 'Reference', longFileName), 'utf8'))
      .toBe('reference');
    service.closeAll();
  });

  it.each([
    ['case variants', 'Foo.PNG', 'foo.png'],
    ['canonical Unicode variants', 'Café.png', 'Cafe\u0301.png'],
  ])('uses one portable identity for %s and preserves the replaced asset id', (_, firstName, secondName) => {
    const root = temporaryRoot();
    const firstDirectory = path.join(root, 'first');
    const secondDirectory = path.join(root, 'second');
    mkdirSync(firstDirectory);
    mkdirSync(secondDirectory);
    const firstSource = path.join(firstDirectory, firstName);
    const secondSource = path.join(secondDirectory, secondName);
    writeFileSync(firstSource, 'old');
    writeFileSync(secondSource, 'new content');
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: `Portable ${firstName}`, selectedParentPath: root });
    const initial = service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [firstSource],
    });
    expect('assets' in initial).toBe(true);
    const initialAsset = 'assets' in initial ? initial.assets[0]! : undefined;

    const plan = service.prepareImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [secondSource],
    });
    expect(plan.nameConflictCount).toBe(1);
    const replaced = service.resolveImport({
      importId: plan.importId,
      suspectedDuplicate: 'skip',
      nameConflict: 'replace',
    });

    expect(replaced.assets[0]?.assetId).toBe(initialAsset?.assetId);
    expect(service.listAssets({ libraryId: library.libraryId, recursive: true })).toHaveLength(1);
    expect(readFileSync(path.join(library.libraryPath, 'Assets', firstName), 'utf8')).toBe('new content');
    service.closeAll();
  });

  it('detects portable-identity collisions within one batch', () => {
    const root = temporaryRoot();
    const firstDirectory = path.join(root, 'first');
    const secondDirectory = path.join(root, 'second');
    mkdirSync(firstDirectory);
    mkdirSync(secondDirectory);
    const first = path.join(firstDirectory, 'Foo.png');
    const second = path.join(secondDirectory, 'foo.PNG');
    writeFileSync(first, 'one');
    writeFileSync(second, 'different');
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Batch identity', selectedParentPath: root });

    const plan = service.prepareImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [first, second],
    });
    expect(plan).toMatchObject({ nameConflictCount: 1, suspectedDuplicateCount: 0 });
    const completion = service.resolveImport({
      importId: plan.importId,
      suspectedDuplicate: 'skip',
      nameConflict: 'keep-both',
    });
    expect(completion.assets.map((asset) => asset.relativeFilePath).sort()).toEqual([
      'Foo.png',
      'foo (2).PNG',
    ]);
    service.closeAll();
  });

  it('rejects a POSIX source name containing a backslash without changing its hierarchy', () => {
    if (path.sep !== '/') return;
    const root = temporaryRoot();
    const source = path.join(root, 'literal\\segment.png');
    writeFileSync(source, 'source');
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Backslash', selectedParentPath: root });

    let thrown: unknown;
    try {
      service.prepareImport({
        libraryId: library.libraryId,
        sourceKind: 'files',
        sourcePaths: [source],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: 'INVALID_IMPORT_SOURCE', reason: 'NAME_NOT_SUPPORTED' });
    expect(readdirSync(path.join(library.libraryPath, 'Assets'))).toEqual([]);
    service.closeAll();
  });

  it.each([
    ['ASCII', `${'long-name-'.repeat(14)}asset.png`, 90],
    ['multibyte', `${'素材😀'.repeat(18)}.png`, 80],
  ])('shortens an overlong %s copy name only after the target filesystem rejects it', (_, fileName, byteLimit) => {
    const root = temporaryRoot();
    const firstDirectory = path.join(root, 'first');
    const secondDirectory = path.join(root, 'second');
    mkdirSync(firstDirectory);
    mkdirSync(secondDirectory);
    const first = path.join(firstDirectory, fileName);
    const second = path.join(secondDirectory, fileName);
    writeFileSync(first, 'old');
    writeFileSync(second, 'new content');
    const setup = new LibraryService();
    const created = setup.createLibrary({ displayName: `Long copy ${fileName.length}`, selectedParentPath: root });
    setup.prepareOrExecuteImport({
      libraryId: created.libraryId,
      sourceKind: 'files',
      sourcePaths: [first],
    });
    setup.closeAll();
    const service = new LibraryService({
      destinationLstat: (candidatePath) => {
        if (Buffer.byteLength(path.basename(candidatePath), 'utf8') > byteLimit) {
          throw Object.assign(new Error('simulated target component limit'), {
            code: 'ENAMETOOLONG',
          });
        }
        return lstatSync(candidatePath);
      },
    });
    const library = service.openLibrary(created.libraryPath);
    const plan = service.prepareImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [second],
    });
    const completion = service.resolveImport({
      importId: plan.importId,
      suspectedDuplicate: 'skip',
      nameConflict: 'keep-both',
    });
    const copyPath = completion.assets[0]!.relativeFilePath;
    expect(Buffer.byteLength(path.basename(copyPath), 'utf8')).toBeLessThanOrEqual(byteLimit);
    expect(copyPath).toMatch(/ \(2\)\.png$/u);
    expect(readFileSync(path.join(library.libraryPath, 'Assets', copyPath), 'utf8')).toBe('new content');
    service.closeAll();
  });

  it('summarizes conflicts using safe display names only', () => {
    const root = temporaryRoot();
    const firstSource = path.join(root, 'first');
    const secondSource = path.join(root, 'second');
    mkdirSync(firstSource);
    mkdirSync(secondSource);
    writeFileSync(path.join(firstSource, 'same.png'), 'same');
    writeFileSync(path.join(secondSource, 'same.png'), 'different');
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Library', selectedParentPath: root });
    writeFileSync(path.join(library.libraryPath, 'Assets', 'same.png'), 'same');

    const duplicate = service.prepareImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [path.join(firstSource, 'same.png')],
    });
    const conflict = service.prepareImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [path.join(secondSource, 'same.png')],
    });

    expect(duplicate).toMatchObject({
      suspectedDuplicateCount: 1,
      nameConflictCount: 0,
      examples: [{ displayName: 'same.png', kind: 'suspected-duplicate' }],
    });
    expect(conflict).toMatchObject({
      suspectedDuplicateCount: 0,
      nameConflictCount: 1,
      examples: [{ displayName: 'same.png', kind: 'name-conflict' }],
    });
    service.closeAll();
  });

  it('detects library-wide suspected duplicates across folders via byteSize and SHA-256', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Library', selectedParentPath: root });
    const folderA = service.createManagedFolder({
      libraryId: library.libraryId,
      name: 'folder-a',
    });
    const folderB = service.createManagedFolder({
      libraryId: library.libraryId,
      name: 'folder-b',
    });
    const sourceA = path.join(root, 'a.png');
    const sourceB = path.join(root, 'b.png');
    writeFileSync(sourceA, 'same-bytes');
    writeFileSync(sourceB, 'same-bytes');
    service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [sourceA],
      targetFolderId: folderA.folderId,
    });

    const plan = service.prepareImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [sourceB],
      targetFolderId: folderB.folderId,
    });
    expect(plan).toMatchObject({
      suspectedDuplicateCount: 1,
      nameConflictCount: 0,
      examples: [{ displayName: 'b.png', kind: 'suspected-duplicate' }],
    });
    service.closeAll();
  });

  it('rejects symlinks and invalid source shapes before creating a plan', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'Source');
    const outside = path.join(root, 'outside.png');
    mkdirSync(source);
    writeFileSync(outside, 'outside');
    symlinkSync(outside, path.join(source, 'linked.png'));
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Library', selectedParentPath: root });

    expectServiceCode(
      () => service.prepareImport({ libraryId: library.libraryId, sourceKind: 'folder', sourcePaths: [source] }),
      'INVALID_IMPORT_SOURCE',
    );
    try {
      service.prepareImport({ libraryId: library.libraryId, sourceKind: 'folder', sourcePaths: [source] });
    } catch (error) {
      expect(error).toMatchObject({ reason: 'SYMBOLIC_LINK_NOT_ALLOWED' });
    }
    expect(existsSync(path.join(library.libraryPath, '.serpent', 'operations'))).toBe(false);
    service.closeAll();
  });

  it('rejects a source replaced by a symlink after enumeration but before opening', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'source.png');
    const outside = path.join(root, 'outside.png');
    writeFileSync(source, 'source');
    writeFileSync(outside, 'outside');
    const service = new LibraryService({
      beforeSourceSnapshotOpen: (sourcePath) => {
        rmSync(sourcePath);
        symlinkSync(outside, sourcePath);
      },
    });
    const library = service.createLibrary({ displayName: 'Symlink Swap', selectedParentPath: root });

    let thrown: unknown;
    try {
      service.prepareImport({
        libraryId: library.libraryId,
        sourceKind: 'files',
        sourcePaths: [source],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      code: 'INVALID_IMPORT_SOURCE',
      reason: 'SYMBOLIC_LINK_NOT_ALLOWED',
    });
    expect(existsSync(path.join(library.libraryPath, '.serpent', 'operations'))).toBe(false);
    service.closeAll();
  });

  it('rejects same-size source content and timestamp changes after snapshot copying', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'changing.png');
    writeFileSync(source, 'AAAA');
    const service = new LibraryService({
      afterSourceSnapshotCopy: (sourcePath) => {
        writeFileSync(sourcePath, 'BBBB');
        utimesSync(sourcePath, new Date(1_000), new Date(1_000));
      },
    });
    const library = service.createLibrary({ displayName: 'Changing Source', selectedParentPath: root });

    let thrown: unknown;
    try {
      service.prepareImport({
        libraryId: library.libraryId,
        sourceKind: 'files',
        sourcePaths: [source],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      code: 'INVALID_IMPORT_SOURCE',
      reason: 'SOURCE_CHANGED',
    });
    expect(existsSync(path.join(library.libraryPath, '.serpent', 'operations'))).toBe(false);
    service.closeAll();
  });

  it('resolves from the staged snapshot after the original source changes or disappears', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'snapshot.png');
    writeFileSync(source, 'snapshot');
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Snapshot', selectedParentPath: root });
    const plan = service.prepareImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [source],
    });
    writeFileSync(source, 'changed after prepare');
    rmSync(source);

    service.resolveImport({
      importId: plan.importId,
      suspectedDuplicate: 'skip',
      nameConflict: 'keep-both',
    });

    expect(readFileSync(path.join(library.libraryPath, 'Assets', 'snapshot.png'), 'utf8')).toBe(
      'snapshot',
    );
    expect(existsSync(path.join(library.libraryPath, '.serpent', 'operations'))).toBe(false);
    service.closeAll();
  });

  it('imports the source root and nested empty folders as managed folders', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'Empty Tree');
    mkdirSync(path.join(source, 'Nested', 'Leaf'), { recursive: true });
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Folders', selectedParentPath: root });
    const plan = service.prepareImport({
      libraryId: library.libraryId,
      sourceKind: 'folder',
      sourcePaths: [source],
    });
    expect(plan.fileCount).toBe(0);

    const completion = service.resolveImport({
      importId: plan.importId,
      suspectedDuplicate: 'skip',
      nameConflict: 'keep-both',
    });

    expect(completion).toEqual({ importedCount: 0, skippedCount: 0, replacedCount: 0, assets: [] });
    expect(service.listManagedFolders(library.libraryId).map((folder) => folder.relativePath)).toEqual([
      'Empty Tree',
      'Empty Tree/Nested',
      'Empty Tree/Nested/Leaf',
    ]);
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'Empty Tree', 'Nested', 'Leaf'))).toBe(true);
    service.closeAll();
  });

  it('abandons tokens once and clears pending plans when a library closes', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'source.png');
    writeFileSync(source, 'source');
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Library', selectedParentPath: root });
    const first = service.prepareImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [source],
    });

    expect(service.abandonImport(first.importId)).toBe(first.importId);
    expect(existsSync(path.join(library.libraryPath, '.serpent', 'operations'))).toBe(false);
    expectServiceCode(() => service.abandonImport(first.importId), 'IMPORT_NOT_FOUND');
    expectServiceCode(() => service.abandonImport('forged-token'), 'IMPORT_NOT_FOUND');

    const second = service.prepareImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [source],
    });
    service.closeLibrary(library.libraryId);
    expectServiceCode(() => service.abandonImport(second.importId), 'IMPORT_NOT_FOUND');

    const reopened = service.openLibrary(library.libraryPath);
    const third = service.prepareImport({
      libraryId: reopened.libraryId,
      sourceKind: 'files',
      sourcePaths: [source],
    });
    service.closeAll();
    expectServiceCode(() => service.abandonImport(third.importId), 'IMPORT_NOT_FOUND');
  });

  it('imports a prepared file once and persists its first revision', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'source.png');
    writeFileSync(source, 'source');
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Library', selectedParentPath: root });
    const plan = service.prepareImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [source],
    });

    const completion = service.resolveImport({
      importId: plan.importId,
      suspectedDuplicate: 'skip',
      nameConflict: 'keep-both',
    });

    expect(completion).toMatchObject({ importedCount: 1, skippedCount: 0, replacedCount: 0 });
    expect(completion.assets).toHaveLength(1);
    expect(completion.assets[0]).toMatchObject({
      displayName: 'source.png',
      relativeFilePath: 'source.png',
      byteSize: 6,
      availability: 'available',
    });
    expect(readFileSync(path.join(library.libraryPath, 'Assets', 'source.png'), 'utf8')).toBe(
      'source',
    );
    expect(service.listAssets({ libraryId: library.libraryId, recursive: true })).toEqual(
      completion.assets,
    );
    expectServiceCode(
      () => service.resolveImport({
        importId: plan.importId,
        suspectedDuplicate: 'skip',
        nameConflict: 'keep-both',
      }),
      'IMPORT_NOT_FOUND',
    );
    service.closeAll();
  });

  it('applies all suspected-duplicate decisions independently', () => {
    const root = temporaryRoot();
    const originalDirectory = path.join(root, 'original');
    const incomingDirectory = path.join(root, 'incoming');
    mkdirSync(originalDirectory);
    mkdirSync(incomingDirectory);
    const originalSource = path.join(originalDirectory, 'same.png');
    const incomingSource = path.join(incomingDirectory, 'same.png');
    writeFileSync(originalSource, 'same-content');
    writeFileSync(incomingSource, 'same-content');
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Duplicates', selectedParentPath: root });
    const initial = service.prepareImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [originalSource],
    });
    const initialAsset = service.resolveImport({
      importId: initial.importId,
      suspectedDuplicate: 'skip',
      nameConflict: 'keep-both',
    }).assets[0]!;

    const skipPlan = service.prepareImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [incomingSource],
    });
    expect(skipPlan.suspectedDuplicateCount).toBe(1);
    expect(service.resolveImport({
      importId: skipPlan.importId,
      suspectedDuplicate: 'skip',
      nameConflict: 'replace',
    })).toMatchObject({ importedCount: 0, skippedCount: 1, replacedCount: 0, assets: [] });
    expect(readFileSync(path.join(library.libraryPath, 'Assets', 'same.png'), 'utf8')).toBe(
      'same-content',
    );

    const copyPlan = service.prepareImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [incomingSource],
    });
    const copy = service.resolveImport({
      importId: copyPlan.importId,
      suspectedDuplicate: 'create-copy',
      nameConflict: 'replace',
    });
    expect(copy.assets[0]?.relativeFilePath).toBe('same (2).png');
    expect(readFileSync(path.join(library.libraryPath, 'Assets', 'same (2).png'), 'utf8')).toBe(
      'same-content',
    );

    const mergePlan = service.prepareImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [incomingSource],
    });
    const merged = service.resolveImport({
      importId: mergePlan.importId,
      suspectedDuplicate: 'merge',
      nameConflict: 'keep-both',
    }).assets[0]!;
    expect(merged.assetId).toBe(initialAsset.assetId);
    expect(merged.currentRevisionId).toBe(initialAsset.currentRevisionId);
    expect(readFileSync(path.join(library.libraryPath, 'Assets', 'same.png'), 'utf8')).toBe(
      'same-content',
    );
    service.closeAll();
  });

  it('applies all name-conflict decisions independently', () => {
    const root = temporaryRoot();
    const originalDirectory = path.join(root, 'original');
    const incomingDirectory = path.join(root, 'incoming');
    mkdirSync(originalDirectory);
    mkdirSync(incomingDirectory);
    const originalSource = path.join(originalDirectory, 'same.png');
    const incomingSource = path.join(incomingDirectory, 'same.png');
    writeFileSync(originalSource, 'old');
    writeFileSync(incomingSource, 'new content');
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Conflicts', selectedParentPath: root });
    const initial = service.prepareImport({ libraryId: library.libraryId, sourceKind: 'files', sourcePaths: [originalSource] });
    const initialAsset = service.resolveImport({ importId: initial.importId, suspectedDuplicate: 'skip', nameConflict: 'keep-both' }).assets[0]!;

    const skipPlan = service.prepareImport({ libraryId: library.libraryId, sourceKind: 'files', sourcePaths: [incomingSource] });
    expect(skipPlan.nameConflictCount).toBe(1);
    expect(service.resolveImport({ importId: skipPlan.importId, suspectedDuplicate: 'merge', nameConflict: 'skip' }).skippedCount).toBe(1);

    const keepPlan = service.prepareImport({ libraryId: library.libraryId, sourceKind: 'files', sourcePaths: [incomingSource] });
    const kept = service.resolveImport({ importId: keepPlan.importId, suspectedDuplicate: 'merge', nameConflict: 'keep-both' });
    expect(kept.assets[0]?.relativeFilePath).toBe('same (2).png');

    const replacePlan = service.prepareImport({ libraryId: library.libraryId, sourceKind: 'files', sourcePaths: [incomingSource] });
    const replaced = service.resolveImport({ importId: replacePlan.importId, suspectedDuplicate: 'create-copy', nameConflict: 'replace' });
    expect(replaced).toMatchObject({ importedCount: 0, skippedCount: 0, replacedCount: 1 });
    expect(replaced.assets[0]?.assetId).toBe(initialAsset.assetId);
    expect(replaced.assets[0]?.currentRevisionId).not.toBe(initialAsset.currentRevisionId);
    expect(readFileSync(path.join(library.libraryPath, 'Assets', 'same.png'), 'utf8')).toBe('new content');
    service.closeAll();
  });

  it('rejects invalid decisions with a consumed token', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'source.png');
    writeFileSync(source, 'source');
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Decisions', selectedParentPath: root });
    const plan = service.prepareImport({ libraryId: library.libraryId, sourceKind: 'files', sourcePaths: [source] });

    expectServiceCode(
      () => service.resolveImport({ importId: plan.importId, suspectedDuplicate: 'invalid' as never, nameConflict: 'keep-both' }),
      'INVALID_IMPORT_DECISION',
    );
    expectServiceCode(
      () => service.resolveImport({ importId: plan.importId, suspectedDuplicate: 'skip', nameConflict: 'keep-both' }),
      'IMPORT_NOT_FOUND',
    );
    service.closeAll();
  });

  it.each<ImportFailurePoint>([
    'after-stage',
    'after-backup',
    'after-place',
    'before-db-commit',
  ])('rolls back disk, database, and stage after an injected %s failure', (failAt) => {
    const root = temporaryRoot();
    const originalDirectory = path.join(root, 'original');
    const incomingDirectory = path.join(root, 'incoming');
    mkdirSync(originalDirectory);
    mkdirSync(incomingDirectory);
    const originalSource = path.join(originalDirectory, 'same.png');
    const incomingSource = path.join(incomingDirectory, 'same.png');
    writeFileSync(originalSource, 'old');
    writeFileSync(incomingSource, 'incoming content');
    const setup = new LibraryService();
    const created = setup.createLibrary({ displayName: `Rollback ${failAt}`, selectedParentPath: root });
    const initialPlan = setup.prepareImport({ libraryId: created.libraryId, sourceKind: 'files', sourcePaths: [originalSource] });
    const initialAsset = setup.resolveImport({ importId: initialPlan.importId, suspectedDuplicate: 'skip', nameConflict: 'keep-both' }).assets[0]!;
    setup.closeAll();

    const service = new LibraryService({ failAt });
    const library = service.openLibrary(created.libraryPath);
    const plan = service.prepareImport({ libraryId: library.libraryId, sourceKind: 'files', sourcePaths: [incomingSource] });
    expectServiceCode(
      () => service.resolveImport({ importId: plan.importId, suspectedDuplicate: 'merge', nameConflict: 'replace' }),
      'IMPORT_APPLY_FAILED',
    );

    expect(readFileSync(path.join(library.libraryPath, 'Assets', 'same.png'), 'utf8')).toBe('old');
    expect(service.listAssets({ libraryId: library.libraryId, recursive: true })).toEqual([initialAsset]);
    expect(existsSync(path.join(library.libraryPath, '.serpent', 'operations'))).toBe(false);
    expectServiceCode(
      () => service.resolveImport({ importId: plan.importId, suspectedDuplicate: 'skip', nameConflict: 'skip' }),
      'IMPORT_NOT_FOUND',
    );
    service.closeAll();
  });

  it('keeps a committed import successful when operation cleanup is deferred', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'committed.png');
    writeFileSync(source, 'committed bytes');
    const service = new LibraryService({ failAt: 'committed-cleanup' });
    const library = service.createLibrary({ displayName: 'Committed Cleanup', selectedParentPath: root });
    const plan = service.prepareImport({ libraryId: library.libraryId, sourceKind: 'files', sourcePaths: [source] });

    const completion = service.resolveImport({
      importId: plan.importId,
      suspectedDuplicate: 'skip',
      nameConflict: 'keep-both',
    });
    expect(completion).toMatchObject({ importedCount: 1, skippedCount: 0, replacedCount: 0 });
    expect(readFileSync(path.join(library.libraryPath, 'Assets', 'committed.png'), 'utf8')).toBe('committed bytes');
    const operationPath = path.join(library.libraryPath, '.serpent', 'operations', plan.importId);
    expect(existsSync(operationPath)).toBe(true);
    service.closeAll();

    const reopened = new LibraryService();
    const recovered = reopened.openLibrary(library.libraryPath);
    expect(reopened.listAssets({ libraryId: recovered.libraryId, recursive: true })).toHaveLength(1);
    expect(readFileSync(path.join(recovered.libraryPath, 'Assets', 'committed.png'), 'utf8')).toBe('committed bytes');
    expect(existsSync(operationPath)).toBe(false);
    reopened.closeAll();
  });

  it('does not report a committed import as retryable when result listing fails', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'listed.png');
    writeFileSync(source, 'listed bytes');
    const service = new LibraryService({ failAt: 'committed-result-list' });
    const library = service.createLibrary({ displayName: 'Committed Result', selectedParentPath: root });
    const plan = service.prepareImport({ libraryId: library.libraryId, sourceKind: 'files', sourcePaths: [source] });

    expect(service.resolveImport({
      importId: plan.importId,
      suspectedDuplicate: 'skip',
      nameConflict: 'keep-both',
    })).toEqual({ importedCount: 1, skippedCount: 0, replacedCount: 0, assets: [] });
    expect(service.listAssets({ libraryId: library.libraryId, recursive: true })).toHaveLength(1);
    expectServiceCode(
      () => service.resolveImport({ importId: plan.importId, suspectedDuplicate: 'skip', nameConflict: 'keep-both' }),
      'IMPORT_NOT_FOUND',
    );
    service.closeAll();
  });

  it('reverses a partially placed multi-file batch in manifest order', () => {
    const root = temporaryRoot();
    const first = path.join(root, 'first.png');
    const second = path.join(root, 'second.png');
    writeFileSync(first, 'first');
    writeFileSync(second, 'second');
    const service = new LibraryService({ failAt: 'after-first-place' });
    const library = service.createLibrary({ displayName: 'Partial Batch', selectedParentPath: root });
    const plan = service.prepareImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [first, second],
    });

    expectServiceCode(
      () => service.resolveImport({ importId: plan.importId, suspectedDuplicate: 'skip', nameConflict: 'keep-both' }),
      'IMPORT_APPLY_FAILED',
    );
    expect(service.listAssets({ libraryId: library.libraryId, recursive: true })).toEqual([]);
    expect(readdirSync(path.join(library.libraryPath, 'Assets'))).toEqual([]);
    expect(existsSync(path.join(library.libraryPath, '.serpent', 'operations'))).toBe(false);
    service.closeAll();
  });

  it.each<ImportFailurePoint>(['crash-after-backup', 'crash-after-place'])(
    'recovers a durable applying operation on reopen after %s',
    (failAt) => {
      const root = temporaryRoot();
      const originalDirectory = path.join(root, 'original');
      const incomingDirectory = path.join(root, 'incoming');
      mkdirSync(originalDirectory);
      mkdirSync(incomingDirectory);
      const originalSource = path.join(originalDirectory, 'same.png');
      const incomingSource = path.join(incomingDirectory, 'same.png');
      writeFileSync(originalSource, 'old');
      writeFileSync(incomingSource, 'incoming content');
      const setup = new LibraryService();
      const created = setup.createLibrary({ displayName: `Crash ${failAt}`, selectedParentPath: root });
      const initialPlan = setup.prepareImport({ libraryId: created.libraryId, sourceKind: 'files', sourcePaths: [originalSource] });
      const initialAsset = setup.resolveImport({ importId: initialPlan.importId, suspectedDuplicate: 'skip', nameConflict: 'keep-both' }).assets[0]!;
      setup.closeAll();

      const crashing = new LibraryService({ failAt });
      const opened = crashing.openLibrary(created.libraryPath);
      const plan = crashing.prepareImport({ libraryId: opened.libraryId, sourceKind: 'files', sourcePaths: [incomingSource] });
      expectServiceCode(
        () => crashing.resolveImport({ importId: plan.importId, suspectedDuplicate: 'merge', nameConflict: 'replace' }),
        'IMPORT_APPLY_FAILED',
      );
      expect(existsSync(path.join(opened.libraryPath, '.serpent', 'operations', plan.importId))).toBe(true);
      crashing.closeAll();

      const recoveredService = new LibraryService();
      const recoveredLibrary = recoveredService.openLibrary(created.libraryPath);
      expect(readFileSync(path.join(recoveredLibrary.libraryPath, 'Assets', 'same.png'), 'utf8')).toBe('old');
      expect(recoveredService.listAssets({ libraryId: recoveredLibrary.libraryId, recursive: true })).toEqual([initialAsset]);
      expect(existsSync(path.join(recoveredLibrary.libraryPath, '.serpent', 'operations'))).toBe(false);
      recoveredService.closeAll();
    },
  );

  it('removes a newly placed file when recovering a crash without a backup', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'new.png');
    writeFileSync(source, 'new');
    const setup = new LibraryService();
    const created = setup.createLibrary({ displayName: 'Crash New', selectedParentPath: root });
    setup.closeAll();
    const crashing = new LibraryService({ failAt: 'crash-after-place' });
    const opened = crashing.openLibrary(created.libraryPath);
    const plan = crashing.prepareImport({ libraryId: opened.libraryId, sourceKind: 'files', sourcePaths: [source] });
    expectServiceCode(
      () => crashing.resolveImport({ importId: plan.importId, suspectedDuplicate: 'skip', nameConflict: 'keep-both' }),
      'IMPORT_APPLY_FAILED',
    );
    expect(existsSync(path.join(opened.libraryPath, 'Assets', 'new.png'))).toBe(true);
    crashing.closeAll();

    const recovered = new LibraryService();
    const library = recovered.openLibrary(created.libraryPath);
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'new.png'))).toBe(false);
    expect(recovered.listAssets({ libraryId: library.libraryId, recursive: true })).toEqual([]);
    recovered.closeAll();
  });
});

describe('managed asset refresh', () => {
  it('tracks overwrite, missing, reappearance, and stat-only revisions with a stable asset id', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'refresh.png');
    writeFileSync(source, 'first');
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Refresh', selectedParentPath: root });
    const plan = service.prepareImport({ libraryId: library.libraryId, sourceKind: 'files', sourcePaths: [source] });
    const initial = service.resolveImport({ importId: plan.importId, suspectedDuplicate: 'skip', nameConflict: 'keep-both' }).assets[0]!;
    const managedPath = path.join(library.libraryPath, 'Assets', 'refresh.png');

    writeFileSync(managedPath, 'second version');
    const overwriteTime = new Date(Date.now() + 20_000);
    utimesSync(managedPath, overwriteTime, overwriteTime);
    const overwritten = service.refreshManagedAssets(library.libraryId);
    expect(overwritten).toMatchObject({ changedCount: 1, missingCount: 0 });
    expect(overwritten.assets[0]?.assetId).toBe(initial.assetId);
    expect(overwritten.assets[0]?.currentRevisionId).not.toBe(initial.currentRevisionId);
    const overwriteRevision = overwritten.assets[0]!;

    rmSync(managedPath);
    const missing = service.refreshManagedAssets(library.libraryId);
    expect(missing).toMatchObject({ changedCount: 1, missingCount: 1 });
    expect(missing.assets[0]?.availability).toBe('missing');
    expect(service.refreshManagedAssets(library.libraryId)).toMatchObject({
      changedCount: 0,
      missingCount: 0,
    });

    writeFileSync(managedPath, 'second version');
    const acceptedTime = new Date(overwriteRevision.modifiedAt);
    utimesSync(managedPath, acceptedTime, acceptedTime);
    const reappeared = service.refreshManagedAssets(library.libraryId);
    expect(reappeared).toMatchObject({ changedCount: 1, missingCount: 0 });
    expect(reappeared.assets[0]).toMatchObject({
      assetId: initial.assetId,
      currentRevisionId: overwriteRevision.currentRevisionId,
      availability: 'available',
    });

    const statOnlyTime = new Date(acceptedTime.getTime() + 20_000);
    utimesSync(managedPath, statOnlyTime, statOnlyTime);
    const statOnly = service.refreshManagedAssets(library.libraryId);
    expect(statOnly).toMatchObject({ changedCount: 1, missingCount: 0 });
    expect(statOnly.assets[0]?.assetId).toBe(initial.assetId);
    expect(statOnly.assets[0]?.currentRevisionId).not.toBe(overwriteRevision.currentRevisionId);
    service.closeAll();
  });

  it.each([
    ['EACCES', 'PERMISSION_DENIED'],
    ['EIO', 'IO_ERROR'],
  ] as const)('propagates %s stat failures with a safe reason instead of marking missing', (code, reason) => {
    const root = temporaryRoot();
    const source = path.join(root, `refresh-${code}.png`);
    writeFileSync(source, 'first');
    let rejectStats = false;
    const service = new LibraryService({
      assetLstat: (assetPath) => {
        if (rejectStats) throw Object.assign(new Error(`Injected ${code}`), { code });
        return lstatSync(assetPath);
      },
    });
    const library = service.createLibrary({ displayName: `Refresh ${code}`, selectedParentPath: root });
    const plan = service.prepareImport({ libraryId: library.libraryId, sourceKind: 'files', sourcePaths: [source] });
    const initial = service.resolveImport({ importId: plan.importId, suspectedDuplicate: 'skip', nameConflict: 'keep-both' }).assets[0]!;
    rejectStats = true;

    let thrown: unknown;
    try {
      service.refreshManagedAssets(library.libraryId);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(LibraryServiceError);
    expect(thrown).toMatchObject({ code: 'IMPORT_APPLY_FAILED', reason });
    rejectStats = false;
    expect(service.listAssets({ libraryId: library.libraryId, recursive: true })[0]).toMatchObject({
      assetId: initial.assetId,
      availability: 'available',
    });
    service.closeAll();
  });

  it('treats ENOTDIR from asset stat as missing', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'refresh-enotdir.png');
    writeFileSync(source, 'first');
    let missing = false;
    const service = new LibraryService({
      assetLstat: (assetPath) => {
        if (missing) throw Object.assign(new Error('Injected ENOTDIR'), { code: 'ENOTDIR' });
        return lstatSync(assetPath);
      },
    });
    const library = service.createLibrary({ displayName: 'Refresh ENOTDIR', selectedParentPath: root });
    const plan = service.prepareImport({ libraryId: library.libraryId, sourceKind: 'files', sourcePaths: [source] });
    service.resolveImport({ importId: plan.importId, suspectedDuplicate: 'skip', nameConflict: 'keep-both' });
    missing = true;

    expect(service.refreshManagedAssets(library.libraryId)).toMatchObject({
      changedCount: 1,
      missingCount: 1,
      assets: [{ availability: 'missing' }],
    });
    service.closeAll();
  });
});
