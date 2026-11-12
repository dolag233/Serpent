import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { LibraryService } from '../../src/worker/library-service';
import { importNoConflict } from './import-no-conflict';
import { tryPasteCutFolders } from '../../src/main/clipboard-paste';
import type { WorkerCommand } from '../../src/shared/protocol/requests';
import type { WorkerResult } from '../../src/shared/protocol/responses';

it('cuts nested managed folders and loose files without losing identities, tags or metadata', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-folder-cut-'));
  const service = new LibraryService();
  try {
    const library = service.createLibrary({ selectedParentPath: root, displayName: 'Cut' });
    const libraryId = library.libraryId;
    const parent = service.createManagedFolder({ libraryId, name: 'Parent' });
    const child = service.createManagedFolder({ libraryId, name: 'Child', parentFolderId: parent.folderId });
    const empty = service.createManagedFolder({ libraryId, name: 'Empty' });
    const target = service.createManagedFolder({ libraryId, name: 'Target' });
    const file = path.join(root, 'leaf.txt'), loose = path.join(root, 'loose.txt');
    writeFileSync(file, 'nested-content'); writeFileSync(loose, 'loose-content');
    const nestedAsset = importNoConflict(service, libraryId, file, child.folderId).assets[0]!;
    const looseAsset = importNoConflict(service, libraryId, loose).assets[0]!;
    const tag = service.createTag({ libraryId, name: 'Preserved' });
    service.assignTags({ libraryId, assetIds: [nestedAsset.assetId], tagIds: [tag.tagId] });
    service.setAssetMetadata({ libraryId, assetId: nestedAsset.assetId, expectedVersion: 0, description: 'keep description' });
    const requestWorker = async (command: WorkerCommand): Promise<WorkerResult> => {
      switch (command.type) {
        case 'folder.list': return { ok: true, type: 'folder.list', folders: service.listManagedFolders(libraryId, true) };
        case 'folder.move': return { ok: true, type: 'folder.moved', ...service.moveManagedFolders(command) };
        case 'asset.move': return { ok: true, type: 'asset.moved', ...await service.moveAssetsIncludingLinked(command) };
        default: throw new Error(`Unexpected ${command.type}`);
      }
    };
    const folderIds = [parent.folderId, child.folderId, empty.folderId];
    const assetIds = [nestedAsset.assetId, looseAsset.assetId];
    const snapshot = { operation: 'cut' as const, paths: [
      ...assetIds.map(id => service.resolveAssetPath(libraryId, id)),
      ...folderIds.map(id => service.resolveFolderPath(libraryId, id)),
    ] };
    const completed = vi.fn();
    const result = await tryPasteCutFolders({ libraryId, targetFolderId: target.folderId, targetAbsolutePath: service.resolveFolderPath(libraryId, target.folderId), assetIds, folderIds, snapshot, requestWorker, completed });
    expect(result).toMatchObject({ result: { completion: { pasteAction: 'move', importedCount: 1 } } });
    const assets = service.listAssets({ libraryId, folderId: target.folderId, recursive: true });
    expect(assets).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: nestedAsset.assetId, relativeFilePath: 'Target/Parent/Child/leaf.txt' }),
      expect.objectContaining({ assetId: looseAsset.assetId, relativeFilePath: 'Target/loose.txt' }),
    ]));
    expect(service.listManagedFolders(libraryId).find(item => item.folderId === child.folderId)?.parentFolderId).toBe(parent.folderId);
    expect(service.listTags(libraryId).find(item => item.tagId === tag.tagId)?.assetCount).toBe(1);
    expect(service.getAssetMetadata({ libraryId, assetId: nestedAsset.assetId }).description).toBe('keep description');
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'Parent'))).toBe(false);
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'Target', 'Empty'))).toBe(true);
    expect(readFileSync(service.resolveAssetPath(libraryId, nestedAsset.assetId), 'utf8')).toBe('nested-content');
    expect(completed).toHaveBeenCalledOnce();
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }); }
});
