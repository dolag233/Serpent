import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import { isImportConflictPlan } from '../../src/shared/import-outcome';
import type { ImportConflictPlan } from '../../src/shared/protocol/responses';

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-dest-index-test-'));
  temporaryRoots.push(root);
  return root;
}

function prepareConflict(
  service: LibraryService,
  input: Parameters<LibraryService['prepareImport']>[0],
): ImportConflictPlan {
  const value = service.prepareImport(input);
  if (!isImportConflictPlan(value)) {
    throw new Error('expected import conflict plan');
  }
  return value;
}

// Windows releases file handles (WAL/SHM sidecars, antivirus scans) slightly
// after closeAll(), which can make the immediate recursive cleanup fail with
// EPERM. Retry briefly; on CI (Linux) the first attempt always succeeds.
function removeRootWithRetry(root: string): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      rmSync(root, { force: true, recursive: true });
      return;
    } catch (error) {
      if (attempt >= 5 || (error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    }
  }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) removeRootWithRetry(root);
});

/**
 * Regular imports resolve destinations through the DB-backed index with a
 * per-miss disk fallback (DiskFallbackDestinationIndex). These tests pin the
 * behavior that fallback exists to protect: conflicts against indexed assets
 * AND against on-disk orphans the index has not absorbed must both surface,
 * because the apply phase's rename would silently overwrite an orphan that
 * prepare failed to detect.
 */
describe('regular import destination lookups', () => {
  it('flags a name conflict against an indexed asset and keeps both files', () => {
    const root = temporaryRoot();
    const firstRoot = path.join(root, 'source', 'first');
    const secondRoot = path.join(root, 'source', 'second');
    mkdirSync(firstRoot, { recursive: true });
    mkdirSync(secondRoot, { recursive: true });
    // Same destination basename across two imports: the second one must hit
    // the DB-backed index even though it comes from a different source path.
    const first = path.join(firstRoot, 'alpha.png');
    const second = path.join(secondRoot, 'alpha.png');
    writeFileSync(first, 'original alpha bytes');
    writeFileSync(second, 'replacement bytes with a different length');
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Indexed conflict', selectedParentPath: root });
    const assetsPath = path.join(library.libraryPath, 'Assets');

    const firstCompletion = service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [first],
    });
    expect(firstCompletion).toMatchObject({ importedCount: 1, skippedCount: 0 });

    // Second import targets the same destination name with different content:
    // the DB-backed index must classify it as a name conflict, and keep-both
    // must preserve the original file instead of overwriting it.
    const plan = prepareConflict(service, {
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [second],
    });
    expect(plan.nameConflictCount).toBe(1);
    const completion = service.resolveImport({
      importId: plan.importId,
      suspectedDuplicate: 'skip',
      nameConflict: 'keep-both',
    });
    expect(completion.importedCount).toBe(1);

    const placed = readdirSync(assetsPath);
    expect(placed).toHaveLength(2);
    expect(placed).toContain('alpha.png');
    expect(readFileSync(path.join(assetsPath, 'alpha.png'), 'utf8')).toBe('original alpha bytes');
    service.closeAll();
  });

  it('still flags a conflict against an on-disk orphan the index has not absorbed', () => {
    const root = temporaryRoot();
    const sourceRoot = path.join(root, 'source');
    mkdirSync(sourceRoot);
    const seed = path.join(sourceRoot, 'seed.png');
    writeFileSync(seed, 'seed');
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Orphan conflict', selectedParentPath: root });
    const assetsPath = path.join(library.libraryPath, 'Assets');

    service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [seed],
    });

    // Simulate an on-disk destination the DB index does not know about (an
    // external watcher ingest still in flight): write directly into Assets.
    const orphanContent = 'orphan bytes written externally';
    writeFileSync(path.join(assetsPath, 'orphan.png'), orphanContent);

    const incoming = path.join(sourceRoot, 'orphan.png');
    writeFileSync(incoming, 'incoming bytes that would clobber the orphan');
    const plan = prepareConflict(service, {
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [incoming],
    });
    expect(plan.nameConflictCount).toBe(1);

    const completion = service.resolveImport({
      importId: plan.importId,
      suspectedDuplicate: 'skip',
      nameConflict: 'keep-both',
    });
    expect(completion.importedCount).toBe(1);

    // The orphan must have survived: keep-both places the incoming copy under
    // a new name and the original orphan content stays untouched.
    const placed = readdirSync(assetsPath);
    expect(placed).toHaveLength(3);
    expect(readFileSync(path.join(assetsPath, 'orphan.png'), 'utf8')).toBe(orphanContent);
    service.closeAll();
  });

  it('detects conflicts for case-variant names through the portable identity index', () => {
    const root = temporaryRoot();
    const sourceRoot = path.join(root, 'source');
    mkdirSync(sourceRoot);
    const original = path.join(sourceRoot, 'Photo.png');
    writeFileSync(original, 'capitalized original');
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Case variant', selectedParentPath: root });
    const assetsPath = path.join(library.libraryPath, 'Assets');

    service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [original],
    });

    const variant = path.join(sourceRoot, 'photo.png');
    writeFileSync(variant, 'lowercase variant bytes');
    const plan = prepareConflict(service, {
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [variant],
    });
    // portablePathIdentity normalizes case, so the DB-backed index — not the
    // filesystem probe — must be what surfaces this conflict on every
    // platform, including case-sensitive ones.
    expect(plan.nameConflictCount).toBe(1);
    const completion = service.resolveImport({
      importId: plan.importId,
      suspectedDuplicate: 'skip',
      nameConflict: 'keep-both',
    });
    expect(completion.importedCount).toBe(1);
    expect(readdirSync(assetsPath).some((name) => name === 'Photo.png')).toBe(true);
    service.closeAll();
  });
});
