import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { opendir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { afterEach, expect, it, vi } from 'vitest';

import { executeAutomationReadOnlyWorkerCommand } from '../../src/worker/automation-readonly-command-executor';
import { LibraryService, openConfiguredDatabase } from '../../src/worker/library-service';
import { LinkedDirectoryIndex } from '../../src/worker/linked-directory-index';

const roots: string[] = [];
const services: LibraryService[] = [];
const databases: Array<ReturnType<typeof openConfiguredDatabase>> = [];

function setup(options: ConstructorParameters<typeof LibraryService>[0] = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-directory-index-'));
  roots.push(root);
  const sourceRoot = path.join(root, 'source');
  mkdirSync(path.join(sourceRoot, 'empty', 'nested'), { recursive: true });
  writeFileSync(path.join(sourceRoot, 'sample.txt'), 'fixture');
  const service = new LibraryService({ observerFactory: () => ({ close() {} }), ...options });
  services.push(service);
  const library = service.createLibrary({ displayName: 'DirectoryIndex', selectedParentPath: root });
  const linked = service.importFolderAsLinked({ libraryId: library.libraryId, sourceRootPath: sourceRoot });
  return { root, sourceRoot, service, library, linked };
}

function indexFor(libraryPath: string) {
  const database = openConfiguredDatabase(path.join(libraryPath, '.serpent', 'library.db'));
  databases.push(database);
  return { index: new LinkedDirectoryIndex(() => database), database };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) database.close();
  for (const service of services.splice(0)) service.closeAll();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('persists empty directories and reads them after source loss and library reopen', async () => {
  const { root, sourceRoot, service, library, linked } = setup();
  renameSync(sourceRoot, path.join(root, 'unavailable'));
  const summary = await service.getLibraryNavigationSummaryAsync({ libraryId: library.libraryId });
  expect(summary.linkedFolders.map((folder) => folder.relativePath)).toEqual(['', 'empty', 'empty/nested']);
  expect(service.listFolderBrowseEntries({ libraryId: library.libraryId, parentFolderId: linked.folderId }).map((entry) => entry.name)).toEqual(['empty']);
  service.closeAll();
  service.openLibrary(library.libraryPath);
  expect(service.listLinkedFolders(library.libraryId).map((folder) => folder.relativePath)).toEqual(['', 'empty', 'empty/nested']);
});

it('does not make navigation or source lookup wait on a stalled directory scan', async () => {
  let begin!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => { begin = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let block = true;
  const { sourceRoot, service, library } = setup({
    sourceDirectoryOpener: async (...args: Parameters<typeof opendir>) => {
      if (block && String(args[0]).endsWith('source')) {
        block = false;
        begin();
        await gate;
      }
      return opendir(...args);
    },
  });
  mkdirSync(path.join(sourceRoot, 'new-empty'));
  const scan = service.runOpenBackgroundReconciliation(library.libraryId);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await entered;
    const result = await Promise.race([
      service.getLibraryNavigationSummaryAsync({ libraryId: library.libraryId }),
      new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error('navigation waited on scan')), 2_000); }),
    ]);
    expect(result.linkedFolders.some((folder) => folder.relativePath === 'empty/nested')).toBe(true);
    expect(result.linkedFolders.some((folder) => folder.relativePath === 'new-empty')).toBe(false);
    const asset = service.listAssets({ libraryId: library.libraryId, recursive: true })[0]!;
    expect(service.resolveAssetPath(library.libraryId, asset.assetId)).toBe(path.join(sourceRoot, 'sample.txt'));
  } finally {
    clearTimeout(deadline);
    release();
    await scan;
  }
  expect(service.listLinkedFolders(library.libraryId).some((folder) => folder.relativePath === 'new-empty')).toBe(true);
});

it('invalidates asset counts only for a root whose membership changed', () => {
  const trace: string[] = [];
  const { root, service, library, linked } = setup({ onDbStatement: (sql) => trace.push(sql) });
  const second = path.join(root, 'second');
  mkdirSync(second);
  writeFileSync(path.join(second, 'sample.txt'), 'fixture');
  service.importFolderAsLinked({ libraryId: library.libraryId, sourceRootPath: second });
  service.listLinkedFolders(library.libraryId);
  const { database } = indexFor(library.libraryPath);
  database.prepare("UPDATE assets SET availability = 'missing' WHERE linked_folder_id = ?").run(linked.folderId);
  trace.length = 0;
  service.listLinkedFolders(library.libraryId);
  expect(trace.filter((sql) => /SELECT a\.relative_file_path\s+FROM assets a\s+WHERE a\.linked_folder_id/u.test(sql))).toHaveLength(1);
});

it('does not publish a failed source scan over the last complete structure', async () => {
  const diagnostics: string[] = [];
  const { service, library } = setup({
    sourceDirectoryOpener: async () => { throw Object.assign(new Error('fixture denied'), { code: 'EACCES' }); },
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic.scope),
  });
  await service.runOpenBackgroundReconciliation(library.libraryId);
  expect(service.listLinkedFolders(library.libraryId).map((folder) => folder.relativePath)).toEqual(['', 'empty', 'empty/nested']);
  expect(diagnostics).toContain('open.refresh-managed-assets');
});

it('does not share an old library instance build after close and reopen', async () => {
  const { service, library } = setup();
  const old = service.getLibraryNavigationSummaryAsync({ libraryId: library.libraryId });
  const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' });
  service.closeAll();
  service.openLibrary(library.libraryPath);
  await rejected;
  const current = await service.getLibraryNavigationSummaryAsync({ libraryId: library.libraryId });
  expect(current.linkedFolders).toHaveLength(3);
});

it('does not cache a navigation build whose structure version changed halfway through', async () => {
  const { service, library, linked } = setup();
  const original = service.listTags.bind(service);
  vi.spyOn(service, 'listTags').mockImplementationOnce((libraryId) => {
    service.createLinkedFolderDirectory({ libraryId, linkedFolderId: linked.folderId, relativePath: '', name: 'new' });
    return original(libraryId);
  });
  const old = await service.getLibraryNavigationSummaryAsync({ libraryId: library.libraryId });
  expect(old.linkedFolders.some((folder) => folder.relativePath === 'new')).toBe(false);
  const current = await service.getLibraryNavigationSummaryAsync({ libraryId: library.libraryId });
  expect(current.linkedFolders.some((folder) => folder.relativePath === 'new')).toBe(true);
});

it('keeps the complete snapshot on cancellation and reclaims staged rows on the next scan', async () => {
  const { library, linked } = setup();
  const { index, database } = indexFor(library.libraryPath);
  let calls = 0;
  await expect(index.publish(linked.folderId, Array.from({ length: 1_000 }, (_, n) => `new-${n}`), index.version(linked.folderId), async () => {
    calls += 1;
    if (calls >= 2) throw new Error('cancelled');
  })).rejects.toThrow('cancelled');
  expect(index.paths(linked.folderId)).toEqual(['empty', 'empty/nested']);
  expect((database.prepare('SELECT COUNT(*) AS n FROM linked_directory_entries').get() as { n: number }).n).toBeGreaterThan(2);
  await index.publish(linked.folderId, ['empty', 'empty/nested'], index.version(linked.folderId), async () => {});
  expect(database.prepare('SELECT COUNT(*) AS n FROM linked_directory_entries').get()).toEqual({ n: 2 });
});

it('fences stale scan publication after an in-app directory mutation', async () => {
  const { library, linked } = setup();
  const { index } = indexFor(library.libraryPath);
  const version = index.version(linked.folderId);
  let calls = 0;
  expect(await index.publish(linked.folderId, ['stale'], version, async () => {
    calls += 1;
    if (calls === 2) index.add(linked.folderId, 'created');
  })).toBe(false);
  expect(index.paths(linked.folderId)).toEqual(['created', 'empty', 'empty/nested']);
});

it('shares a cold navigation build for 4,100 directories without rescanning the disk', async () => {
  const { library, linked, service } = setup();
  const { index } = indexFor(library.libraryPath);
  index.replace(linked.folderId, Array.from({ length: 4_100 }, (_, n) => `empty-${n}`));
  const spy = vi.spyOn(service, 'listLinkedFolders');
  const started = performance.now();
  const summaries = await Promise.all([
    service.getLibraryNavigationSummaryAsync({ libraryId: library.libraryId }),
    service.getLibraryNavigationSummaryAsync({ libraryId: library.libraryId }),
  ]);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(summaries[0]).toBe(summaries[1]);
  expect(summaries[0].linkedFolders).toHaveLength(4_101);
  console.log('linked directory indexed cold pair:', JSON.stringify({ directories: 4_100, durationMs: Math.round(performance.now() - started) }));
});


it('lets the newest started scan publish after an older scan finishes', async () => {
  const { library, linked } = setup();
  const { index } = indexFor(library.libraryPath);
  const older = index.beginScan(linked.folderId);
  const newer = index.beginScan(linked.folderId);
  expect(await index.publish(linked.folderId, ['old'], older, async () => {})).toBe(false);
  expect(await index.publish(linked.folderId, ['new'], newer, async () => {})).toBe(true);
  expect(index.paths(linked.folderId)).toEqual(['new']);
});

it('scans existing empty directories when relinking without watcher events', async () => {
  const { root, service, library, linked } = setup();
  const replacement = path.join(root, 'replacement');
  mkdirSync(path.join(replacement, 'replacement-empty', 'child'), { recursive: true });
  await service.relinkMissingFolderAsync({ libraryId: library.libraryId, folderId: linked.folderId, newRootPath: replacement });
  const entries = await service.listFolderBrowseEntriesAsync({ libraryId: library.libraryId, parentFolderId: linked.folderId });
  expect(entries.map((entry) => entry.name)).toEqual(['replacement-empty']);
  expect(entries[0]!.childFolderCount).toBe(1);
});

it('uses paged asset reads and parent-indexed directories for a cold direct folder browse', async () => {
  const trace: string[] = [];
  const { library, linked, service } = setup({ onDbStatement: (sql) => trace.push(sql) });
  trace.length = 0;
  const entries = await service.listFolderBrowseEntriesAsync({ libraryId: library.libraryId, parentFolderId: linked.folderId });
  expect(entries.map((entry) => entry.name)).toEqual(['empty']);
  expect(entries[0]!.childFolderCount).toBe(1);
  const assets = trace.filter((sql) => /SELECT a\.relative_file_path\s+FROM assets a/u.test(sql));
  expect(assets.length).toBeGreaterThan(0);
  expect(assets.every((sql) => /LIMIT/u.test(sql))).toBe(true);
  expect(trace.some((sql) => /entry.parent_identity =/u.test(sql))).toBe(true);
  expect(trace.some((sql) => /SELECT relative_path FROM linked_directory_entries/u.test(sql))).toBe(false);
});


it('does not clean the newer scan staging while a superseded publisher exits', async () => {
  const { library, linked } = setup();
  const { index, database } = indexFor(library.libraryPath);
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const staged = new Promise<void>((resolve) => { entered = resolve; });
  let newer!: Promise<boolean>;
  let olderCalls = 0;
  let newerCalls = 0;
  const older = index.beginScan(linked.folderId);
  expect(await index.publish(linked.folderId, ['old'], older, async () => {
    olderCalls += 1;
    if (olderCalls !== 2) return;
    const token = index.beginScan(linked.folderId);
    newer = index.publish(linked.folderId, Array.from({ length: 600 }, (_, n) => `new-${n}`), token, async () => {
      newerCalls += 1;
      if (newerCalls === 2) { entered(); await gate; }
    });
    await staged;
  })).toBe(false);
  release();
  expect(await newer).toBe(true);
  expect(index.paths(linked.folderId)).toHaveLength(600);
  expect(database.prepare('SELECT COUNT(*) AS n FROM linked_directory_entries').get()).toEqual({ n: 600 });
});


it('uses the paged projection for automation linked-folder lists without changing catalog state', async () => {
  const trace: string[] = [];
  const { library, service } = setup({ onDbStatement: (sql) => trace.push(sql) });
  const sequence = service.getChangeSequence(library.libraryId);
  trace.length = 0;
  const result = await executeAutomationReadOnlyWorkerCommand(service, { type: 'linked-folder.list', libraryId: library.libraryId });
  expect(result).toMatchObject({ ok: true, type: 'linked-folder.list', folders: [{ relativePath: '' }, { relativePath: 'empty' }, { relativePath: 'empty/nested' }] });
  const reads = trace.filter((sql) => /SELECT a\.relative_file_path\s+FROM assets a/u.test(sql));
  expect(reads.length).toBeGreaterThan(0);
  expect(reads.every((sql) => /LIMIT/u.test(sql))).toBe(true);
  expect(service.getChangeSequence(library.libraryId)).toBe(sequence);
});
