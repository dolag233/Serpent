import { contextBridge, ipcRenderer } from 'electron';

import type { LibraryApiResult, SerpentLibraryApi } from '../shared/library-api';
import type { AssetSummary, AssetMetadataResult, CollectionSummary, LinkedFolderSummary, ManagedFolderSummary, SmartCollectionSummary, TagSummary } from '../shared/asset-types';
import {
  ASSET_CHANGE_CHANNEL,
  ACTIVE_CONTEXT_CHANNEL,
  LIBRARY_LIFECYCLE_CHANNEL,
  LIBRARY_REQUEST_CHANNEL,
} from '../shared/protocol/channels';
import type { RendererRequest } from '../shared/protocol/requests';
import {
  parseRendererResult,
  parseRendererLifecycleEvent,
  type RendererLibrarySummary,
  type RendererLifecycleEvent,
  type RendererResult,
  type ImportCompletion,
  type ImportConflictPlan,
  type AssetChangeEvent,
  parseAssetChangeEvent,
} from '../shared/protocol/responses';
import type {
  NameConflictDecision,
  SuspectedDuplicateDecision,
} from '../shared/protocol/requests';

async function request(command: RendererRequest): Promise<RendererResult> {
  return parseRendererResult(await ipcRenderer.invoke(LIBRARY_REQUEST_CHANNEL, command));
}

function failure(result: Extract<RendererResult, { ok: false }>): LibraryApiResult<never> {
  return { ok: false, error: result.error };
}

const library: SerpentLibraryApi = Object.freeze({
  async create({
    displayName,
  }: {
    displayName: string;
  }): Promise<LibraryApiResult<RendererLibrarySummary>> {
    const result = await request({ type: 'library.create.request', displayName });
    if (!result.ok) return failure(result);
    if (result.type !== 'library.opened') throw new Error('Unexpected create-library response.');
    return { ok: true as const, value: result.library };
  },

  async open(): Promise<LibraryApiResult<RendererLibrarySummary>> {
    const result = await request({ type: 'library.open.request' });
    if (!result.ok) return failure(result);
    if (result.type !== 'library.opened') throw new Error('Unexpected open-library response.');
    return { ok: true as const, value: result.library };
  },

  async close({
    libraryId,
  }: {
    libraryId: string;
  }): Promise<LibraryApiResult<{ libraryId: string }>> {
    const result = await request({ type: 'library.close.request', libraryId });
    if (!result.ok) return failure(result);
    if (result.type !== 'library.closed') throw new Error('Unexpected close-library response.');
    return { ok: true as const, value: { libraryId: result.libraryId } };
  },

  async listOpen(): Promise<LibraryApiResult<RendererLibrarySummary[]>> {
    const result = await request({ type: 'library.list.request' });
    if (!result.ok) return failure(result);
    if (result.type !== 'library.list') throw new Error('Unexpected list-libraries response.');
    return { ok: true as const, value: result.libraries };
  },

  async createFolder(input: {
    libraryId: string;
    parentFolderId?: string;
    name: string;
  }): Promise<LibraryApiResult<ManagedFolderSummary>> {
    const result = await request({ type: 'folder.create.request', ...input });
    if (!result.ok) return failure(result);
    if (result.type !== 'folder.created') throw new Error('Unexpected create-folder response.');
    return { ok: true, value: result.folder };
  },

  async listFolders({ libraryId }: { libraryId: string }): Promise<LibraryApiResult<ManagedFolderSummary[]>> {
    const result = await request({ type: 'folder.list.request', libraryId });
    if (!result.ok) return failure(result);
    if (result.type !== 'folder.list') throw new Error('Unexpected list-folders response.');
    return { ok: true, value: result.folders };
  },

  async listAssets(input: {
    libraryId: string;
    folderId?: string;
    recursive: boolean;
  }): Promise<LibraryApiResult<AssetSummary[]>> {
    const result = await request({ type: 'asset.list.request', ...input });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.list') throw new Error('Unexpected list-assets response.');
    return { ok: true, value: result.assets };
  },

  async importFiles(input: {
    libraryId: string;
    targetFolderId?: string;
  }): Promise<LibraryApiResult<ImportCompletion | ImportConflictPlan>> {
    return importRequest({ type: 'asset.import-files.request', ...input });
  },

  async importFolder(input: {
    libraryId: string;
    targetFolderId?: string;
  }): Promise<LibraryApiResult<ImportCompletion | ImportConflictPlan>> {
    return importRequest({ type: 'asset.import-folder.request', ...input });
  },

  async resolveImport(input: {
    importId: string;
    suspectedDuplicate: SuspectedDuplicateDecision;
    nameConflict: NameConflictDecision;
  }): Promise<LibraryApiResult<ImportCompletion>> {
    const result = await request({ type: 'asset.import.resolve', ...input });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.import.completed') throw new Error('Unexpected resolve-import response.');
    return { ok: true, value: result.completion };
  },

  async abandonImport({ importId }: { importId: string }) {
    const result = await request({ type: 'asset.import.abandon', importId });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.import.abandoned') throw new Error('Unexpected abandon-import response.');
    return { ok: true as const, value: { importId: result.importId } };
  },

  async refreshAssets({ libraryId }: { libraryId: string }) {
    const result = await request({ type: 'asset.refresh.request', libraryId });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.refreshed') throw new Error('Unexpected refresh-assets response.');
    return {
      ok: true as const,
      value: {
        changedCount: result.changedCount,
        missingCount: result.missingCount,
        assets: result.assets,
      },
    };
  },

  async listLinkedFolders({ libraryId }: { libraryId: string }): Promise<LibraryApiResult<LinkedFolderSummary[]>> {
    const result = await request({ type: 'linked-folder.list.request', libraryId });
    if (!result.ok) return failure(result);
    if (result.type !== 'linked-folder.list') throw new Error('Unexpected list-linked-folders response.');
    return { ok: true, value: result.folders };
  },

  async importFolderAsLinked({
    libraryId,
    displayName,
  }: {
    libraryId: string;
    displayName?: string;
  }): Promise<LibraryApiResult<LinkedFolderSummary>> {
    const result = await request({ type: 'asset.import-linked.request', libraryId, displayName });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.import-linked.completed') throw new Error('Unexpected import-linked-folder response.');
    return { ok: true, value: result.linkedFolder };
  },

  async relinkMissingFolder({
    libraryId,
    folderId,
  }: {
    libraryId: string;
    folderId: string;
  }): Promise<LibraryApiResult<LinkedFolderSummary>> {
    const result = await request({ type: 'linked-folder.relink.request', libraryId, folderId });
    if (!result.ok) return failure(result);
    if (result.type !== 'linked-folder.relinked') throw new Error('Unexpected relink-folder response.');
    return { ok: true, value: result.linkedFolder };
  },

  async listTags({ libraryId }: { libraryId: string }): Promise<LibraryApiResult<TagSummary[]>> {
    const result = await request({ type: 'tag.list.request', libraryId });
    if (!result.ok) return failure(result);
    if (result.type !== 'tag.list') throw new Error('Unexpected list-tags response.');
    return { ok: true, value: result.tags };
  },

  async createTag({ libraryId, name }: { libraryId: string; name: string }): Promise<LibraryApiResult<TagSummary>> {
    const result = await request({ type: 'tag.create.request', libraryId, name });
    if (!result.ok) return failure(result);
    if (result.type !== 'tag.created') throw new Error('Unexpected create-tag response.');
    return { ok: true, value: result.tag };
  },

  async renameTag({ libraryId, tagId, name }: { libraryId: string; tagId: string; name: string }): Promise<LibraryApiResult<TagSummary>> {
    const result = await request({ type: 'tag.rename.request', libraryId, tagId, name });
    if (!result.ok) return failure(result);
    if (result.type !== 'tag.renamed') throw new Error('Unexpected rename-tag response.');
    return { ok: true, value: result.tag };
  },

  async deleteTag({ libraryId, tagId }: { libraryId: string; tagId: string }): Promise<LibraryApiResult<{ tagId: string }>> {
    const result = await request({ type: 'tag.delete.request', libraryId, tagId });
    if (!result.ok) return failure(result);
    if (result.type !== 'tag.deleted') throw new Error('Unexpected delete-tag response.');
    return { ok: true, value: { tagId: result.tagId } };
  },

  async assignTags({ libraryId, assetIds, tagIds }: { libraryId: string; assetIds: string[]; tagIds: string[] }): Promise<LibraryApiResult<{ assignedCount: number }>> {
    const result = await request({ type: 'tag.assign.request', libraryId, assetIds, tagIds });
    if (!result.ok) return failure(result);
    if (result.type !== 'tag.assigned') throw new Error('Unexpected assign-tags response.');
    return { ok: true, value: { assignedCount: result.assignedCount } };
  },

  async removeTags({ libraryId, assetIds, tagIds }: { libraryId: string; assetIds: string[]; tagIds: string[] }): Promise<LibraryApiResult<{ removedCount: number }>> {
    const result = await request({ type: 'tag.remove.request', libraryId, assetIds, tagIds });
    if (!result.ok) return failure(result);
    if (result.type !== 'tag.removed') throw new Error('Unexpected remove-tags response.');
    return { ok: true, value: { removedCount: result.removedCount } };
  },

  async listCollections({ libraryId }: { libraryId: string }): Promise<LibraryApiResult<CollectionSummary[]>> {
    const result = await request({ type: 'collection.list.request', libraryId });
    if (!result.ok) return failure(result);
    if (result.type !== 'collection.list') throw new Error('Unexpected list-collections response.');
    return { ok: true, value: result.collections };
  },

  async createCollection({ libraryId, parentId, name }: { libraryId: string; parentId?: string; name: string }): Promise<LibraryApiResult<CollectionSummary>> {
    const result = await request({ type: 'collection.create.request', libraryId, parentId, name });
    if (!result.ok) return failure(result);
    if (result.type !== 'collection.created') throw new Error('Unexpected create-collection response.');
    return { ok: true, value: result.collection };
  },

  async updateCollection({ libraryId, collectionId, name, description, coverAssetId, position }: { libraryId: string; collectionId: string; name?: string; description?: string; coverAssetId?: string; position?: number }): Promise<LibraryApiResult<CollectionSummary>> {
    const result = await request({ type: 'collection.update.request', libraryId, collectionId, name, description, coverAssetId, position });
    if (!result.ok) return failure(result);
    if (result.type !== 'collection.updated') throw new Error('Unexpected update-collection response.');
    return { ok: true, value: result.collection };
  },

  async deleteCollection({ libraryId, collectionId }: { libraryId: string; collectionId: string }): Promise<LibraryApiResult<{ collectionId: string }>> {
    const result = await request({ type: 'collection.delete.request', libraryId, collectionId });
    if (!result.ok) return failure(result);
    if (result.type !== 'collection.deleted') throw new Error('Unexpected delete-collection response.');
    return { ok: true, value: { collectionId: result.collectionId } };
  },

  async addCollectionAssets({ libraryId, collectionId, assetIds }: { libraryId: string; collectionId: string; assetIds: string[] }): Promise<LibraryApiResult<{ collectionId: string }>> {
    const result = await request({ type: 'collection.assets.add.request', libraryId, collectionId, assetIds });
    if (!result.ok) return failure(result);
    if (result.type !== 'collection.assets.added') throw new Error('Unexpected add-collection-assets response.');
    return { ok: true, value: { collectionId: result.collectionId } };
  },

  async removeCollectionAssets({ libraryId, collectionId, assetIds }: { libraryId: string; collectionId: string; assetIds: string[] }): Promise<LibraryApiResult<{ collectionId: string }>> {
    const result = await request({ type: 'collection.assets.remove.request', libraryId, collectionId, assetIds });
    if (!result.ok) return failure(result);
    if (result.type !== 'collection.assets.removed') throw new Error('Unexpected remove-collection-assets response.');
    return { ok: true, value: { collectionId: result.collectionId } };
  },

  async reorderCollectionAssets({ libraryId, collectionId, orderedAssetIds }: { libraryId: string; collectionId: string; orderedAssetIds: string[] }): Promise<LibraryApiResult<{ collectionId: string }>> {
    const result = await request({ type: 'collection.assets.reorder.request', libraryId, collectionId, orderedAssetIds });
    if (!result.ok) return failure(result);
    if (result.type !== 'collection.assets.reordered') throw new Error('Unexpected reorder-collection-assets response.');
    return { ok: true, value: { collectionId: result.collectionId } };
  },

  async listCollectionAssets({ libraryId, collectionId, recursive }: { libraryId: string; collectionId: string; recursive: boolean }): Promise<LibraryApiResult<AssetSummary[]>> {
    const result = await request({ type: 'collection.assets.list.request', libraryId, collectionId, recursive });
    if (!result.ok) return failure(result);
    if (result.type !== 'collection.assets.list') throw new Error('Unexpected list-collection-assets response.');
    return { ok: true, value: result.assets };
  },

  async getAssetMetadata({ libraryId, assetId }: { libraryId: string; assetId: string }): Promise<LibraryApiResult<AssetMetadataResult>> {
    const result = await request({ type: 'asset.metadata.get.request', libraryId, assetId });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.metadata.got') throw new Error('Unexpected get-metadata response.');
    return { ok: true, value: result.metadata };
  },

  async setAssetMetadata({ libraryId, assetId, expectedVersion, label, description, rating, favorite, palette, sourcePageUrl }: { libraryId: string; assetId: string; expectedVersion: number; label?: string; description?: string; rating?: number; favorite?: boolean; palette?: string[]; sourcePageUrl?: string }): Promise<LibraryApiResult<AssetMetadataResult>> {
    const result = await request({ type: 'asset.metadata.set.request', libraryId, assetId, expectedVersion, label, description, rating, favorite, palette, sourcePageUrl });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.metadata.updated') throw new Error('Unexpected set-metadata response.');
    return { ok: true, value: result.metadata };
  },

  async backfillAssetMetadata({ libraryId }: { libraryId: string }): Promise<LibraryApiResult<{ backfilledCount: number }>> {
    const result = await request({ type: 'asset.metadata.backfill.request', libraryId });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.metadata.backfilled') throw new Error('Unexpected backfill-metadata response.');
    return { ok: true, value: { backfilledCount: result.backfilledCount } };
  },

  async listSmartCollections({ libraryId }: { libraryId: string }): Promise<LibraryApiResult<SmartCollectionSummary[]>> {
    const result = await request({ type: 'smart-collection.list.request', libraryId });
    if (!result.ok) return failure(result);
    if (result.type !== 'smart-collection.list') throw new Error('Unexpected list-smart-collections response.');
    return { ok: true, value: result.collections };
  },

  async createSmartCollection({ libraryId, name, queryDefinitionJson }: { libraryId: string; name: string; queryDefinitionJson: string }): Promise<LibraryApiResult<SmartCollectionSummary>> {
    const result = await request({ type: 'smart-collection.create.request', libraryId, name, queryDefinitionJson });
    if (!result.ok) return failure(result);
    if (result.type !== 'smart-collection.created') throw new Error('Unexpected create-smart-collection response.');
    return { ok: true, value: result.collection };
  },

  async updateSmartCollection({ libraryId, collectionId, name, queryDefinitionJson, position }: { libraryId: string; collectionId: string; name?: string; queryDefinitionJson?: string; position?: number }): Promise<LibraryApiResult<SmartCollectionSummary>> {
    const result = await request({ type: 'smart-collection.update.request', libraryId, collectionId, name, queryDefinitionJson, position });
    if (!result.ok) return failure(result);
    if (result.type !== 'smart-collection.updated') throw new Error('Unexpected update-smart-collection response.');
    return { ok: true, value: result.collection };
  },

  async deleteSmartCollection({ libraryId, collectionId }: { libraryId: string; collectionId: string }): Promise<LibraryApiResult<{ collectionId: string }>> {
    const result = await request({ type: 'smart-collection.delete.request', libraryId, collectionId });
    if (!result.ok) return failure(result);
    if (result.type !== 'smart-collection.deleted') throw new Error('Unexpected delete-smart-collection response.');
    return { ok: true, value: { collectionId: result.collectionId } };
  },

  async executeSmartCollection({ libraryId, collectionId }: { libraryId: string; collectionId: string }): Promise<LibraryApiResult<{ items: AssetSummary[]; total: number; offset: number }>> {
    const result = await request({ type: 'smart-collection.execute.request', libraryId, collectionId });
    if (!result.ok) return failure(result);
    if (result.type !== 'smart-collection.executed') throw new Error('Unexpected execute-smart-collection response.');
    return { ok: true, value: { items: result.items, total: result.total, offset: result.offset } };
  },

  async searchAssets({ libraryId, query, filters, sort, limit, offset }: { libraryId: string; query?: { clauses: { field: string | null; values: string[]; exclude: boolean }[] } | null; filters?: { field: 'format' | 'tag' | 'rating' | 'favorite' | 'source_url' | 'availability'; values: string[]; exclude: boolean }[]; sort?: { field: 'name' | 'modified_at' | 'created_at' | 'byte_size' | 'duration' | 'rating'; order: 'asc' | 'desc' }; limit?: number; offset?: number }): Promise<LibraryApiResult<{ items: AssetSummary[]; total: number; offset: number; snippets?: { assetId: string; text: string }[] }>> {
    const result = await request({ type: 'asset.search.request', libraryId, query: query ?? null, filters, sort, limit, offset });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.search.result') throw new Error('Unexpected search-assets response.');
    return { ok: true, value: { items: result.items, total: result.total, offset: result.offset, snippets: result.snippets } };
  },

  async trashAssets({ libraryId, assetIds }: { libraryId: string; assetIds: string[] }): Promise<LibraryApiResult<{ trashedCount: number }>> {
    const result = await request({ type: 'asset.trash.request', libraryId, assetIds });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.trashed') throw new Error('Unexpected trash response.');
    return { ok: true, value: { trashedCount: result.trashedCount } };
  },

  async restoreAssets({ libraryId, assetIds, targetFolderId }: { libraryId: string; assetIds: string[]; targetFolderId?: string }): Promise<LibraryApiResult<{ restoredCount: number; assets: AssetSummary[] }>> {
    const result = await request({ type: 'asset.restore.request', libraryId, assetIds, targetFolderId });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.restored') throw new Error('Unexpected restore response.');
    return { ok: true, value: { restoredCount: result.restoredCount, assets: result.assets } };
  },

  async deleteAssetsPermanent({ libraryId, assetIds }: { libraryId: string; assetIds: string[] }): Promise<LibraryApiResult<{ deletedCount: number; skippedCount: number; skippedReasons: string[] }>> {
    const result = await request({ type: 'asset.delete-permanent.request', libraryId, assetIds });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.deleted-permanent') throw new Error('Unexpected delete-permanent response.');
    return { ok: true, value: { deletedCount: result.deletedCount, skippedCount: result.skippedCount, skippedReasons: result.skippedReasons } };
  },

  async listTrash({ libraryId }: { libraryId: string }): Promise<LibraryApiResult<AssetSummary[]>> {
    const result = await request({ type: 'trash.list.request', libraryId });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.list-trash') throw new Error('Unexpected list-trash response.');
    return { ok: true, value: result.assets };
  },

  async purgeTrash({ libraryId }: { libraryId: string }): Promise<LibraryApiResult<{ purgedCount: number }>> {
    const result = await request({ type: 'trash.purge.request', libraryId });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.purge-trash') throw new Error('Unexpected purge-trash response.');
    return { ok: true, value: { purgedCount: result.purgedCount } };
  },

  async deleteLinkedAssets({ libraryId, assetIds, deleteSourceFile }: { libraryId: string; assetIds: string[]; deleteSourceFile: boolean }): Promise<LibraryApiResult<{ deletedCount: number }>> {
    const result = await request({ type: 'asset.delete-linked.request', libraryId, assetIds, deleteSourceFile });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.deleted-linked') throw new Error('Unexpected delete-linked response.');
    return { ok: true, value: { deletedCount: result.deletedCount } };
  },

  async relinkAsset({ libraryId, assetId }: { libraryId: string; assetId: string }): Promise<LibraryApiResult<AssetSummary>> {
    const result = await request({ type: 'asset.relink.request', libraryId, assetId });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.relinked') throw new Error('Unexpected relink response.');
    return { ok: true, value: result.asset };
  },

  async relinkBatchPreview({ libraryId, keepMetadata }: { libraryId: string; keepMetadata: boolean }) {
    const result = await request({ type: 'asset.relink-batch.request', libraryId, keepMetadata });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.relink-batch.preview') throw new Error('Unexpected relink-batch-preview response.');
    return { ok: true as const, value: { matchedCount: result.matchedCount, unmatchedCount: result.unmatchedCount, totalCount: result.totalCount, examples: result.examples } };
  },

  async relinkBatchApply({ libraryId, keepMetadata }: { libraryId: string; keepMetadata: boolean }) {
    const result = await request({ type: 'asset.relink-batch.apply.request', libraryId, keepMetadata });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.relink-batch.applied') throw new Error('Unexpected relink-batch-apply response.');
    return { ok: true as const, value: { restoredCount: result.restoredCount, unchangedMissingCount: result.unchangedMissingCount, assets: result.assets } };
  },

  setActiveContext(libraryId: string | null, selectedFolderId?: string): void {
    ipcRenderer.send(ACTIVE_CONTEXT_CHANNEL, { libraryId, selectedFolderId });
  },

  onLifecycle(listener: (event: RendererLifecycleEvent) => void) {
    const subscription = (_event: Electron.IpcRendererEvent, input: unknown) => {
      listener(parseRendererLifecycleEvent(input));
    };
    ipcRenderer.on(LIBRARY_LIFECYCLE_CHANNEL, subscription);
    return () => ipcRenderer.removeListener(LIBRARY_LIFECYCLE_CHANNEL, subscription);
  },

  onAssetsChanged(listener: (event: AssetChangeEvent) => void) {
    const subscription = (_event: Electron.IpcRendererEvent, input: unknown) => {
      listener(parseAssetChangeEvent(input));
    };
    ipcRenderer.on(ASSET_CHANGE_CHANNEL, subscription);
    return () => ipcRenderer.removeListener(ASSET_CHANGE_CHANNEL, subscription);
  },
});

async function importRequest(
  command: Extract<RendererRequest, { type: 'asset.import-files.request' | 'asset.import-folder.request' }>,
): Promise<LibraryApiResult<ImportCompletion | ImportConflictPlan>> {
  const result = await request(command);
  if (!result.ok) return failure(result);
  if (result.type === 'asset.import.completed') return { ok: true, value: result.completion };
  if (result.type === 'asset.import.conflicts') return { ok: true, value: result.plan };
  throw new Error('Unexpected prepare-import response.');
}

contextBridge.exposeInMainWorld('serpent', Object.freeze({ library }));
