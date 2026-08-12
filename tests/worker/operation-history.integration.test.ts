import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import type { WorkerCommand } from '../../src/shared/protocol/requests';
import type { WorkerResult } from '../../src/shared/protocol/responses';
import { executeBoundedWriteWorkerCommand } from '../../src/worker/bounded-write-command';
import { LibraryService } from '../../src/worker/library-service';

const temporaryRoots: string[] = [];
const services: LibraryService[] = [];
const require = createRequire(import.meta.url);

interface TestDatabaseConnection {
  close(): void;
  prepare(source: string): {
    run(...parameters: unknown[]): { changes: number };
  };
}

const TestDatabase = require('better-sqlite3') as new (filename: string) => TestDatabaseConnection;

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-operation-history-test-'));
  temporaryRoots.push(root);
  return root;
}

function createLibraryWithAsset(): {
  service: LibraryService;
  libraryId: string;
  libraryPath: string;
  assetId: string;
} {
  const service = new LibraryService();
  services.push(service);
  const library = service.createLibrary({ displayName: 'History', selectedParentPath: temporaryRoot() });
  const managedFolder = service.createManagedFolder({ libraryId: library.libraryId, name: 'Assets' });
  const assetId = randomUUID();
  const revisionId = randomUUID();
  const filename = 'history-test.png';
  const assetDirectory = path.join(library.libraryPath, 'Assets', managedFolder.relativePath);
  mkdirSync(assetDirectory, { recursive: true });
  writeFileSync(path.join(assetDirectory, filename), 'history test');

  const database = new TestDatabase(path.join(library.libraryPath, '.serpent', 'library.db'));
  const now = new Date().toISOString();
  try {
    database.prepare(
      `INSERT INTO assets (asset_id, location_kind, managed_folder_id, linked_folder_id,
        relative_file_path, current_revision_id, availability, path_identity, created_at, updated_at)
       VALUES (?, 'managed', ?, NULL, ?, NULL, 'available', ?, ?, ?)`,
    ).run(
      assetId,
      managedFolder.folderId,
      `${managedFolder.relativePath}/${filename}`,
      `${managedFolder.relativePath}/${filename}`,
      now,
      now,
    );
    database.prepare(
      `INSERT INTO revisions (revision_id, asset_id, parent_revision_id, byte_size,
        modified_at, original_filename, origin, accepted_at)
       VALUES (?, ?, NULL, ?, ?, ?, 'import', ?)`,
    ).run(revisionId, assetId, 12, now, filename, now);
    database.prepare(
      'UPDATE assets SET current_revision_id = ?, updated_at = ? WHERE asset_id = ?',
    ).run(revisionId, now, assetId);
  } finally {
    database.close();
  }

  return {
    service,
    libraryId: library.libraryId,
    libraryPath: library.libraryPath,
    assetId,
  };
}

type BoundedWorkerCommand = WorkerCommand & { libraryId: string };

async function runBounded(
  service: LibraryService,
  command: BoundedWorkerCommand,
): Promise<Extract<WorkerResult, { ok: true }>> {
  const result = await service.runBoundedWrite(command.libraryId, () =>
    executeBoundedWriteWorkerCommand(service, command, {
      source: 'desktop',
      sourceReference: null,
    }),
  );
  if (!result || !result.ok) throw new Error(`Unexpected bounded command result for ${command.type}`);
  return result;
}

function historyEntryId(result: Extract<WorkerResult, { ok: true }>): string {
  const id = (result as { historyEntryId?: unknown }).historyEntryId;
  if (typeof id !== 'string') throw new Error('Expected a durable history receipt.');
  return id;
}

async function undo(service: LibraryService, libraryId: string, entryId: string): Promise<void> {
  const result = await service.undoOperationHistory({
    libraryId,
    expectedHistoryEntryId: entryId,
  });
  expect(result.historyEntryId).toBe(entryId);
  expect(result.direction).toBe('undo');
}

async function redo(service: LibraryService, libraryId: string, entryId: string): Promise<void> {
  const result = await service.redoOperationHistory({
    libraryId,
    expectedHistoryEntryId: entryId,
  });
  expect(result.historyEntryId).toBe(entryId);
  expect(result.direction).toBe('redo');
}

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('durable operation history', () => {
  it('round-trips asset metadata through undo and redo', async () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();
    const updated = await runBounded(service, {
      type: 'asset.metadata.set',
      libraryId,
      assetId,
      expectedVersion: 0,
      description: 'updated by history',
      favorite: true,
    });
    const entryId = historyEntryId(updated);

    await undo(service, libraryId, entryId);
    expect(service.getAssetMetadata({ libraryId, assetId })).toMatchObject({
      assetId,
      description: null,
      favorite: false,
      entityVersion: 0,
    });

    await redo(service, libraryId, entryId);
    expect(service.getAssetMetadata({ libraryId, assetId })).toMatchObject({
      assetId,
      description: 'updated by history',
      favorite: true,
      entityVersion: 1,
    });
  });

  it('persists the history stack across a complete library close and reopen', async () => {
    const { service, libraryId, libraryPath, assetId } = createLibraryWithAsset();
    const updated = await runBounded(service, {
      type: 'asset.metadata.set',
      libraryId,
      assetId,
      expectedVersion: 0,
      description: 'survives restart',
    });
    const entryId = historyEntryId(updated);

    service.closeLibrary(libraryId);
    expect(service.openLibrary(libraryPath).libraryId).toBe(libraryId);
    expect(service.getOperationHistoryStatus(libraryId).undoTop?.historyEntryId).toBe(entryId);

    await undo(service, libraryId, entryId);
    expect(service.getAssetMetadata({ libraryId, assetId })).toMatchObject({
      description: null,
      entityVersion: 0,
    });
  });

  it('round-trips a folder and keeps the redo branch visible', async () => {
    const { service, libraryId } = createLibraryWithAsset();
    const created = await runBounded(service, {
      type: 'folder.create',
      libraryId,
      name: 'History Folder',
    });
    const entryId = historyEntryId(created);
    const folderId = (created as Extract<WorkerResult, { ok: true; type: 'folder.created' }>).folder.folderId;

    expect(service.getManagedFolderHistorySnapshot({ libraryId, folderIds: [folderId] })).toHaveLength(1);
    await undo(service, libraryId, entryId);
    expect(service.getManagedFolderHistorySnapshot({ libraryId, folderIds: [folderId], allowMissing: true })).toEqual([]);
    expect(service.getOperationHistoryStatus(libraryId).redoTop?.historyEntryId).toBe(entryId);

    await redo(service, libraryId, entryId);
    expect(service.getManagedFolderHistorySnapshot({ libraryId, folderIds: [folderId] })).toHaveLength(1);
  });

  it('keeps asset restore redoable across repeated undo/redo cycles', async () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();
    const trashed = service.trashAssets({
      libraryId,
      assetIds: [assetId],
    });
    service.recordOperationHistory({
      libraryId,
      source: 'desktop',
      sourceReference: null,
      commandId: 'asset.trash',
      labelKey: 'history.asset.trash',
      labelArgs: { count: trashed.trashedCount },
      affectedCount: trashed.trashedCount,
      affectedEntities: [assetId],
      forwardRecipe: { kind: 'asset-trash', version: 1, payload: { assetIds: [assetId] } },
      inverseRecipe: { kind: 'asset-trash-undo', version: 1, payload: { operationId: trashed.operationId } },
    });
    const restoredAssets = service.restoreAssets({
      libraryId,
      assetIds: [assetId],
    });
    const restored = service.recordOperationHistory({
      libraryId,
      source: 'desktop',
      sourceReference: null,
      commandId: 'asset.restore',
      labelKey: 'history.asset.restore',
      labelArgs: { count: restoredAssets.restoredCount },
      affectedCount: restoredAssets.restoredCount,
      affectedEntities: [assetId],
      forwardRecipe: { kind: 'asset-restore', version: 1, payload: { assetIds: [assetId] } },
      inverseRecipe: { kind: 'asset-trash', version: 1, payload: { assetIds: [assetId] } },
    });
    const restoreEntryId = restored.historyEntryId;

    expect(service.listTrash(libraryId).map((asset) => asset.assetId)).not.toContain(assetId);
    await undo(service, libraryId, restoreEntryId);
    expect(service.listTrash(libraryId).map((asset) => asset.assetId)).toContain(assetId);
    await redo(service, libraryId, restoreEntryId);
    expect(service.listTrash(libraryId).map((asset) => asset.assetId)).not.toContain(assetId);

    // A second cycle proves the forward recipe was kept as asset-restore;
    // it must not point at the one-shot trash operation created by undo.
    await undo(service, libraryId, restoreEntryId);
    await redo(service, libraryId, restoreEntryId);
    expect(service.listTrash(libraryId).map((asset) => asset.assetId)).not.toContain(assetId);
  });

  it('round-trips tag creation and assignment as separate linear entries', async () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();
    const created = await runBounded(service, {
      type: 'tag.create',
      libraryId,
      name: 'History Tag',
    });
    const tagId = (created as Extract<WorkerResult, { ok: true; type: 'tag.created' }>).tag.tagId;
    const createEntryId = historyEntryId(created);
    const assigned = await runBounded(service, {
      type: 'tag.assign',
      libraryId,
      assetIds: [assetId],
      tagIds: [tagId],
    });
    const assignEntryId = historyEntryId(assigned);

    await undo(service, libraryId, assignEntryId);
    expect(service.getHumanTagRelations({ libraryId, assetIds: [assetId], tagIds: [tagId] })).toEqual([]);
    await undo(service, libraryId, createEntryId);
    expect(service.getTagHistorySnapshot({ libraryId, tagIds: [tagId], allowMissing: true })).toEqual([]);

    await redo(service, libraryId, createEntryId);
    await redo(service, libraryId, assignEntryId);
    expect(service.getHumanTagRelations({ libraryId, assetIds: [assetId], tagIds: [tagId] })).toEqual([
      { assetId, tagId },
    ]);
  });

  it('round-trips a tag merge and restores the original human relations', async () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();
    const first = await runBounded(service, {
      type: 'tag.create',
      libraryId,
      name: 'Merge Source A',
    });
    const second = await runBounded(service, {
      type: 'tag.create',
      libraryId,
      name: 'Merge Source B',
    });
    const firstTagId = (first as Extract<WorkerResult, { ok: true; type: 'tag.created' }>).tag.tagId;
    const secondTagId = (second as Extract<WorkerResult, { ok: true; type: 'tag.created' }>).tag.tagId;
    await runBounded(service, {
      type: 'tag.assign',
      libraryId,
      assetIds: [assetId],
      tagIds: [firstTagId, secondTagId],
    });

    const merged = await runBounded(service, {
      type: 'tag.merge',
      libraryId,
      sourceTagIds: [firstTagId, secondTagId],
      name: 'Merged Tag',
    });
    const mergedTagId = (merged as Extract<WorkerResult, { ok: true; type: 'tag.merged' }>).tag.tagId;
    const entryId = historyEntryId(merged);
    expect(service.getTagHistorySnapshot({ libraryId, tagIds: [mergedTagId] })).toHaveLength(1);
    expect(service.getTagHistorySnapshot({
      libraryId,
      tagIds: [firstTagId, secondTagId],
      allowMissing: true,
    })).toEqual([]);

    await undo(service, libraryId, entryId);
    expect(service.getTagHistorySnapshot({ libraryId, tagIds: [mergedTagId], allowMissing: true })).toEqual([]);
    const restoredHumanRelations = service.getHumanTagRelations({
      libraryId,
      assetIds: [assetId],
      tagIds: [firstTagId, secondTagId],
    });
    expect(restoredHumanRelations).toHaveLength(2);
    expect(restoredHumanRelations).toEqual(expect.arrayContaining([
      { assetId, tagId: firstTagId },
      { assetId, tagId: secondTagId },
    ]));

    await redo(service, libraryId, entryId);
    expect(service.getTagHistorySnapshot({ libraryId, tagIds: [mergedTagId] })).toHaveLength(1);
    expect(service.getHumanTagRelations({ libraryId, assetIds: [assetId], tagIds: [mergedTagId] })).toEqual([
      { assetId, tagId: mergedTagId },
    ]);
  });

  it('round-trips collection membership and smart collection snapshots', async () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();
    const collectionResult = await runBounded(service, {
      type: 'collection.create',
      libraryId,
      name: 'History Board',
    });
    const collectionId = (collectionResult as Extract<WorkerResult, { ok: true; type: 'collection.created' }>).collection.collectionId;
    const collectionEntryId = historyEntryId(collectionResult);
    const membershipResult = await runBounded(service, {
      type: 'collection.assets.add',
      libraryId,
      collectionId,
      assetIds: [assetId],
    });
    const membershipEntryId = historyEntryId(membershipResult);

    await undo(service, libraryId, membershipEntryId);
    expect(service.getCollectionAssetMemberships({ libraryId, collectionId, assetIds: [assetId] })).toEqual([]);
    await redo(service, libraryId, membershipEntryId);
    expect(service.getCollectionAssetMemberships({ libraryId, collectionId, assetIds: [assetId] })).toEqual([assetId]);

    await undo(service, libraryId, membershipEntryId);
    await undo(service, libraryId, collectionEntryId);
    expect(service.getCollectionHistorySnapshot({ libraryId, collectionIds: [collectionId], allowMissing: true })).toEqual([]);

    const smartResult = await runBounded(service, {
      type: 'smart-collection.create',
      libraryId,
      name: 'History Smart Board',
      queryDefinitionJson: JSON.stringify({ search: { clauses: [] } }),
    });
    const smartId = (smartResult as Extract<WorkerResult, { ok: true; type: 'smart-collection.created' }>).collection.collectionId;
    const smartEntryId = historyEntryId(smartResult);
    await undo(service, libraryId, smartEntryId);
    expect(service.getSmartCollectionHistorySnapshot({ libraryId, collectionIds: [smartId], allowMissing: true })).toEqual([]);
    await redo(service, libraryId, smartEntryId);
    expect(service.getSmartCollectionHistorySnapshot({ libraryId, collectionIds: [smartId] })).toHaveLength(1);
  });

  it('does not expose undo or redo across an irreversible delete barrier', async () => {
    const { service, libraryId } = createLibraryWithAsset();
    const created = await runBounded(service, {
      type: 'folder.create',
      libraryId,
      name: 'Before Barrier',
    });
    const entryId = historyEntryId(created);
    await undo(service, libraryId, entryId);
    expect(service.getOperationHistoryStatus(libraryId).redoTop?.historyEntryId).toBe(entryId);

    service.recordOperationHistoryBarrier({
      libraryId,
      commandId: 'asset.delete-permanent',
      labelKey: 'history.asset.delete-permanent',
      reason: 'test-permanent-delete',
      affectedCount: 1,
      source: 'desktop',
      sourceReference: null,
    });

    expect(service.getOperationHistoryStatus(libraryId)).toMatchObject({
      undoTop: null,
      redoTop: null,
      transitionInProgress: false,
    });
  });

  it('marks a history entry stale instead of overwriting an unrelated metadata change', async () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();
    const updated = await runBounded(service, {
      type: 'asset.metadata.set',
      libraryId,
      assetId,
      expectedVersion: 0,
      description: 'history value',
    });
    const entryId = historyEntryId(updated);

    service.setAssetMetadata({
      libraryId,
      assetId,
      expectedVersion: 1,
      description: 'external value',
    });

    await expect(service.undoOperationHistory({
      libraryId,
      expectedHistoryEntryId: entryId,
    })).rejects.toMatchObject({ code: 'HISTORY_STALE' });
    expect(service.getOperationHistoryStatus(libraryId)).toMatchObject({
      undoTop: null,
      redoTop: null,
      staleTop: { historyEntryId: entryId, staleCode: 'VERSION_CONFLICT' },
      transitionInProgress: false,
    });
    expect(service.getAssetMetadata({ libraryId, assetId })).toMatchObject({
      description: 'external value',
      entityVersion: 2,
    });
  });
});
