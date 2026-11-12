import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LibraryService } from '../../src/worker/library-service';
import { isImportCompletion, isImportConflictPlan } from '../../src/shared/import-outcome';

describe('clipboard copy and cut import', () => {
  let root: string;
  let service: LibraryService;
  let libraryId: string;
  let libraryPath: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'serpent-clipboard-import-'));
    service = new LibraryService();
    const library = service.createLibrary({ selectedParentPath: root, displayName: 'Clipboard' });
    libraryId = library.libraryId;
    libraryPath = library.libraryPath;
  });
  afterEach(() => { service.closeAll(); rmSync(root, { recursive: true, force: true }); });
  function sources() {
    const paths = ['one.txt', 'two.txt'].map(name => path.join(root, name));
    paths.forEach((file, index) => writeFileSync(file, `content-${index}`));
    return paths;
  }

  it('imports every copied file and retains all sources', () => {
    const paths = sources();
    const result = service.prepareOrExecuteImport({ libraryId, sourcePaths: paths, sourceKind: 'files', createImageSequence: false });
    expect(isImportCompletion(result)).toBe(true);
    expect('importedCount' in result && result.importedCount).toBe(2);
    expect(paths.every(existsSync)).toBe(true);
  });

  it('moves every cut source only after the destination is committed', async () => {
    const paths = sources();
    const result = await service.prepareOrExecuteImportCancellable({ libraryId, sourcePaths: paths, sourceKind: 'files', moveSourceFiles: true, createImageSequence: false });
    expect(isImportCompletion(result)).toBe(true);
    expect('importedCount' in result && result.importedCount).toBe(2);
    expect(paths.some(existsSync)).toBe(false);
    expect(readFileSync(path.join(libraryPath, 'Assets', 'one.txt'), 'utf8')).toBe('content-0');
  });

  it('preserves skipped duplicates, and cancellation never deletes the source', () => {
    const paths = sources();
    service.prepareOrExecuteImport({ libraryId, sourcePaths: paths, sourceKind: 'files' });
    const plan = service.prepareImport({ libraryId, sourcePaths: paths, sourceKind: 'files', moveSourceFiles: true });
    service.abandonImport(plan.importId);
    expect(paths.every(existsSync)).toBe(true);
    const retry = service.prepareOrExecuteImport({ libraryId, sourcePaths: paths, sourceKind: 'files', moveSourceFiles: true });
    expect(isImportConflictPlan(retry)).toBe(true);
    if (!isImportConflictPlan(retry)) throw new Error("Expected conflict plan");
    const result = service.resolveImport({ importId: retry.importId, suspectedDuplicate: 'skip', nameConflict: 'skip' });
    expect(result.pasteAction).toBe('move');
    expect(result.skippedCount).toBe(2);
    expect(paths.every(existsSync)).toBe(true);
  });

  it('retains a source changed while the conflict dialog was open', () => {
    const paths = sources();
    const plan = service.prepareImport({ libraryId, sourcePaths: paths, sourceKind: 'files', moveSourceFiles: true });
    writeFileSync(paths[0]!, 'new content after staging');
    const result = service.resolveImport({ importId: plan.importId, suspectedDuplicate: 'create-copy', nameConflict: 'keep-both' });
    expect(result.pasteAction).toBe('move');
    expect(result.sourceRetainedCount).toBe(1);
    expect(readFileSync(paths[0]!, 'utf8')).toBe('new content after staging');
    expect(existsSync(paths[1]!)).toBe(false);
  });

  it('preserves all sources if placement fails before commit', () => {
    service.closeAll();
    service = new LibraryService({ failAt: 'after-first-place' });
    const library = service.createLibrary({ selectedParentPath: root, displayName: 'Failure' });
    libraryId = library.libraryId;
    const paths = sources();
    const plan = service.prepareImport({ libraryId, sourcePaths: paths, sourceKind: 'files', moveSourceFiles: true });
    expect(() => service.resolveImport({ importId: plan.importId, suspectedDuplicate: 'create-copy', nameConflict: 'keep-both' })).toThrow();
    expect(paths.every(existsSync)).toBe(true);
  });

  it('supports cut imports into linked folders', () => {
    const paths = sources();
    const linkedRoot = path.join(root, 'linked');
    mkdirSync(linkedRoot);
    const linked = service.importFolderAsLinked({ libraryId, sourceRootPath: linkedRoot });
    const result = service.prepareOrExecuteImport({ libraryId, targetFolderId: linked.folderId, sourcePaths: paths, sourceKind: 'files', moveSourceFiles: true });
    expect(isImportCompletion(result)).toBe(true);
    expect(paths.some(existsSync)).toBe(false);
    expect(readFileSync(path.join(linkedRoot, 'two.txt'), 'utf8')).toBe('content-1');
  });
  it('moves linked source files and removes their old index records after copying', async () => {
    const sourceRoot = path.join(root, 'linked-source');
    mkdirSync(sourceRoot);
    writeFileSync(path.join(sourceRoot, 'linked.txt'), 'linked-content');
    const linked = service.importFolderAsLinked({ libraryId, sourceRootPath: sourceRoot });
    const source = service.listAssets({ libraryId, folderId: linked.folderId, recursive: true })[0]!;
    const target = service.createManagedFolder({ libraryId, name: 'Target' });
    const moved = await service.moveAssetsIncludingLinked({ libraryId, assetIds: [source.assetId], targetFolderId: target.folderId });
    expect(moved.movedCount).toBe(1);
    expect(existsSync(path.join(sourceRoot, 'linked.txt'))).toBe(false);
    expect(service.listAssets({ libraryId, folderId: linked.folderId, recursive: true })).toEqual([]);
    expect(readFileSync(path.join(libraryPath, 'Assets', 'Target', 'linked.txt'), 'utf8')).toBe('linked-content');
  });

  it('copies a mixed selection of linked and managed files', () => {
    const sourceRoot = path.join(root, 'linked-source');
    mkdirSync(sourceRoot);
    writeFileSync(path.join(sourceRoot, 'linked.txt'), 'linked-content');
    const linked = service.importFolderAsLinked({ libraryId, sourceRootPath: sourceRoot });
    const external = sources()[0]!;
    const imported = service.prepareOrExecuteImport({ libraryId, sourcePaths: [external], sourceKind: 'files' });
    if (!isImportCompletion(imported)) throw new Error('Expected completion');
    const linkedAsset = service.listAssets({ libraryId, folderId: linked.folderId, recursive: true })[0]!;
    const target = service.createManagedFolder({ libraryId, name: 'Target' });
    const copied = service.copyAssetsIncludingLinked({ libraryId, assetIds: [imported.assets[0]!.assetId, linkedAsset.assetId], targetFolderId: target.folderId });
    expect(copied.copiedCount).toBe(2);
    expect(copied.assets).toHaveLength(2);
    expect(existsSync(path.join(sourceRoot, 'linked.txt'))).toBe(true);
  });

});
