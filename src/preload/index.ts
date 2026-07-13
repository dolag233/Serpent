import { contextBridge, ipcRenderer } from 'electron';

import type { LibraryApiResult, LinkedAssetDeleteResult, PreviewResolution, SerpentLibraryApi } from '../shared/library-api';
import type { AssetSummary, AssetMetadataResult, CollectionSummary, LinkedFolderSummary, ManagedFolderSummary, SearchScope, SmartCollectionSummary, TagSummary } from '../shared/asset-types';
import {
  ASSET_CHANGE_CHANNEL,
  THUMBNAIL_CHANNEL,
  ACTIVE_CONTEXT_CHANNEL,
  LIBRARY_LIFECYCLE_CHANNEL,
  LIBRARY_REQUEST_CHANNEL,
  PROGRESS_CHANNEL,
  AI_PROGRESS_CHANNEL,
  AI_COMPLETED_CHANNEL,
  AI_CLEARED_CHANNEL,
} from '../shared/protocol/channels';
import type { RendererRequest } from '../shared/protocol/requests';
import {
  parseRendererResult,
  parseRendererLifecycleEvent,
  parseThumbnailEvent,
  parseAiProgressEvent,
  parseAiAnalysisCompletedEvent,
  parseAiContentClearedEvent,
  type RendererLibrarySummary,
  type RendererLifecycleEvent,
  type RendererResult,
  type ImportCompletion,
  type ImportConflictPlan,
  type AssetChangeEvent,
  parseAssetChangeEvent,
  type ExportProgressEvent,
  parseExportProgressEvent,
  type ImportProgressEvent,
  parseImportProgressEvent,
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

  async executeSmartCollection({ libraryId, collectionId, limit, offset }: { libraryId: string; collectionId: string; limit?: number; offset?: number }): Promise<LibraryApiResult<{ items: AssetSummary[]; total: number; offset: number }>> {
    const result = await request({ type: 'smart-collection.execute.request', libraryId, collectionId, limit, offset });
    if (!result.ok) return failure(result);
    if (result.type !== 'smart-collection.executed') throw new Error('Unexpected execute-smart-collection response.');
    return { ok: true, value: { items: result.items, total: result.total, offset: result.offset } };
  },

  async searchAssets({ libraryId, query, filters, scope, sort, limit, offset }: { libraryId: string; query?: { clauses: { field: string | null; values: string[]; exclude: boolean }[] } | null; filters?: { field: 'format' | 'tag' | 'rating' | 'favorite' | 'source_url' | 'availability'; values: string[]; exclude: boolean }[]; scope?: SearchScope; sort?: { field: 'name' | 'modified_at' | 'created_at' | 'byte_size' | 'duration' | 'rating'; order: 'asc' | 'desc' }; limit?: number; offset?: number }): Promise<LibraryApiResult<{ items: AssetSummary[]; total: number; offset: number; snippets?: { assetId: string; text: string }[] }>> {
    const result = await request({ type: 'asset.search.request', libraryId, query: query ?? null, filters, scope, sort, limit, offset });
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

  async deleteLinkedAssets({ libraryId, assetIds, deleteSourceFile }: { libraryId: string; assetIds: string[]; deleteSourceFile: boolean }): Promise<LibraryApiResult<LinkedAssetDeleteResult>> {
    const result = await request({ type: 'asset.delete-linked.request', libraryId, assetIds, deleteSourceFile });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.deleted-linked') throw new Error('Unexpected delete-linked response.');
    return {
      ok: true,
      value: {
        deletedCount: result.deletedCount,
        failedCount: result.failedCount,
        failures: result.failures,
      },
    };
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

  async exportLibrary({ libraryId, includeLinkedContent, format }: { libraryId: string; includeLinkedContent: boolean; format: 'folder' | 'zip' }) {
    const result = await request({ type: 'library.export.request', libraryId, includeLinkedContent, format });
    if (!result.ok) return failure(result);
    if (result.type !== 'library.exported') throw new Error('Unexpected export response.');
    return { ok: true as const, value: result };
  },

  async cancelLibraryExport({ exportId }: { exportId: string }) {
    const result = await request({ type: 'library.export.cancel.request', exportId });
    if (!result.ok) return failure(result);
    if (result.type !== 'library.closed') throw new Error('Unexpected export-cancel response.');
    return { ok: true as const, value: { exportId } };
  },

  async importLibrary() {
    const result = await request({ type: 'library.import.request' });
    if (!result.ok) return failure(result);
    if (result.type !== 'library.import-validated') throw new Error('Unexpected import-validate response.');
    return { ok: true as const, value: result };
  },

  async importLibraryZip() {
    const result = await request({ type: 'library.import-zip.request' });
    if (!result.ok) return failure(result);
    if (result.type !== 'library.imported') throw new Error('Unexpected import-zip response.');
    return { ok: true as const, value: result };
  },

  async cancelLibraryImport({ importId }: { importId: string }) {
    const result = await request({ type: 'library.import.cancel.request', importId });
    if (!result.ok) return failure(result);
    if (result.type !== 'library.closed') throw new Error('Unexpected import-cancel response.');
    return { ok: true as const, value: { importId } };
  },

  async importLibraryCopy({ importId }: { importId: string }) {
    const result = await request({ type: 'library.import.copy.request', importId });
    if (!result.ok) return failure(result);
    if (result.type !== 'library.imported') throw new Error('Unexpected import response.');
    return { ok: true as const, value: result };
  },

  async importLibraryOpenInPlace({ importId }: { importId: string }) {
    const result = await request({ type: 'library.import.open-in-place.request', importId });
    if (!result.ok) return failure(result);
    if (result.type !== 'library.imported') throw new Error('Unexpected import response.');
    return { ok: true as const, value: result };
  },

  onProgress(listener: (event: ExportProgressEvent | ImportProgressEvent) => void) {
    const subscription = (_event: Electron.IpcRendererEvent, input: unknown) => {
      try {
        listener(parseExportProgressEvent(input));
        return;
      } catch {
        // Try import progress.
      }
      try {
        listener(parseImportProgressEvent(input));
      } catch {
        // Not a progress event.
      }
    };
    ipcRenderer.on(PROGRESS_CHANNEL, subscription);
    return () => ipcRenderer.removeListener(PROGRESS_CHANNEL, subscription);
  },

  async getAiConfig(): Promise<LibraryApiResult<{
    provider: 'openai' | 'gemini' | 'anthropic' | null;
    model: string | null;
    hasKey: boolean;
    enabledFields: { label: boolean; description: boolean; tags: boolean; structuredMetadata: boolean };
    language: string;
    autoAnalyzeEnabled: boolean;
    disclaimerAccepted: boolean;
  }>> {
    const result = await request({ type: 'ai.config.get.request' });
    if (!result.ok) return failure(result);
    if (result.type !== 'ai.config.got') throw new Error('Unexpected ai-config response.');
    return { ok: true, value: result };
  },

  async setAiConfig(input: {
    provider: 'openai' | 'gemini' | 'anthropic';
    model: string;
    apiKey?: string;
    enabledFields?: { label: boolean; description: boolean; tags: boolean; structuredMetadata: boolean };
    language?: string;
    autoAnalyzeEnabled: boolean;
    disclaimerAccepted: boolean;
  }): Promise<LibraryApiResult<void>> {
    const result = await request({ type: 'ai.config.set.request', ...input });
    if (!result.ok) return failure(result);
    if (result.type !== 'ai.config.saved') throw new Error('Unexpected ai-config-save response.');
    return { ok: true, value: undefined };
  },

  async analyzeAsset(input: {
    libraryId: string;
    assetId: string;
  }): Promise<LibraryApiResult<{
    assetId: string;
    generatedFields: { label?: string; description?: string; tags?: string[]; structuredMetadata?: Record<string, unknown> };
    modelVersion: string;
  } | { assetId: string; reason: string }>> {
    const result = await request({ type: 'asset.analyze.request', libraryId: input.libraryId, assetId: input.assetId });
    if (!result.ok) return failure(result);
    if (result.type === 'asset.analyzed' || result.type === 'asset.analyze-unsupported') return { ok: true, value: result };
    throw new Error('Unexpected analyze response.');
  },

  async requestThumbnail({ libraryId, assetId }: { libraryId: string; assetId: string }): Promise<LibraryApiResult<{ assetId: string; artifactId: string }>> {
    const result = await request({ type: 'asset.thumbnail.request', libraryId, assetId });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.thumbnail.generated') throw new Error('Unexpected thumbnail response.');
    return { ok: true, value: { assetId: result.assetId, artifactId: result.artifactId } };
  },

  async requestPreview({ libraryId, assetId, mode }: { libraryId: string; assetId: string; mode: 'client' | 'fullscreen' }): Promise<LibraryApiResult<PreviewResolution>> {
    const result = await request({ type: 'asset.preview.request', libraryId, assetId, mode });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.preview.resolved') throw new Error('Unexpected preview response.');
    return {
      ok: true,
      value: {
        assetId: result.assetId,
        mediaType: result.mediaType,
        status: result.status,
        kind: result.kind,
        ...(result.url ? { url: result.url } : {}),
        ...(result.posterUrl ? { posterUrl: result.posterUrl } : {}),
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
      },
    };
  },

  async closePreview({ libraryId, assetId }: { libraryId: string; assetId: string }): Promise<LibraryApiResult<void>> {
    const result = await request({ type: 'asset.close-preview.request', libraryId, assetId });
    if (!result.ok) return failure(result);
    return { ok: true, value: undefined };
  },

  async reportPreviewError({ libraryId, assetId, errorCode, detail }: { libraryId: string; assetId: string; errorCode: string; detail?: string }): Promise<LibraryApiResult<void>> {
    const result = await request({ type: 'asset.preview-error.report', libraryId, assetId, errorCode, detail });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.preview-error.recorded') throw new Error('Unexpected preview-error response.');
    return { ok: true, value: undefined };
  },

  async openExternal({ libraryId, assetId }: { libraryId: string; assetId: string }): Promise<LibraryApiResult<void>> {
    const result = await request({ type: 'asset.open-external.request', libraryId, assetId });
    if (!result.ok) return failure(result);
    return { ok: true, value: undefined };
  },

  async retryArtifact({ libraryId, assetId, kind }: { libraryId: string; assetId: string; kind: 'thumbnail' | 'webm_proxy' }): Promise<LibraryApiResult<{ assetId: string; kind: string }>> {
    const result = await request({ type: 'asset.retry-artifact.request', libraryId, assetId, kind });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.retry-artifact.started') throw new Error('Unexpected retry-artifact response.');
    return { ok: true, value: { assetId: result.assetId, kind: result.kind } };
  },

  // AI test-connection
  async testAiConnection({ provider, model, apiKey }: { provider: 'openai' | 'gemini' | 'anthropic'; model: string; apiKey: string }): Promise<LibraryApiResult<{ success: boolean; errorKind?: string; reason?: string }>> {
    const result = await request({ type: 'ai.test-connection.request', provider, model, apiKey });
    if (!result.ok) return failure(result);
    if (result.type !== 'ai.test-connection.result') throw new Error('Unexpected test-connection response.');
    return { ok: true, value: { success: result.success, errorKind: result.errorKind, reason: result.reason } };
  },

  // AI clear-content
  async clearAiContent({ libraryId, scope, confirm }: { libraryId: string; scope: { kind: 'asset' | 'selection' | 'folder' | 'library'; assetIds?: string[]; folderId?: string }; confirm: boolean }): Promise<LibraryApiResult<{ clearedCount: number }>> {
    const result = await request({ type: 'ai.clear-content.request', libraryId, scope, confirm });
    if (!result.ok) return failure(result);
    if (result.type !== 'ai.content.cleared') throw new Error('Unexpected clear-content response.');
    return { ok: true, value: { clearedCount: result.clearedCount } };
  },

  // AI job queue
  async pauseAiJobs({ libraryId, jobIds }: { libraryId: string; jobIds?: string[] }): Promise<LibraryApiResult<{ pausedCount: number }>> {
    const result = await request({ type: 'ai.pause-jobs.request', libraryId, jobIds });
    if (!result.ok) return failure(result);
    if (result.type !== 'ai.jobs.paused') throw new Error('Unexpected pause-jobs response.');
    return { ok: true, value: { pausedCount: result.pausedCount } };
  },

  async resumeAiJobs({ libraryId, jobIds }: { libraryId: string; jobIds?: string[] }): Promise<LibraryApiResult<{ resumedCount: number }>> {
    const result = await request({ type: 'ai.resume-jobs.request', libraryId, jobIds });
    if (!result.ok) return failure(result);
    if (result.type !== 'ai.jobs.resumed') throw new Error('Unexpected resume-jobs response.');
    return { ok: true, value: { resumedCount: result.resumedCount } };
  },

  async cancelAiJobs({ libraryId, jobIds }: { libraryId: string; jobIds?: string[] }): Promise<LibraryApiResult<{ cancelledCount: number }>> {
    const result = await request({ type: 'ai.cancel-jobs.request', libraryId, jobIds });
    if (!result.ok) return failure(result);
    if (result.type !== 'ai.jobs.cancelled') throw new Error('Unexpected cancel-jobs response.');
    return { ok: true, value: { cancelledCount: result.cancelledCount } };
  },

  async retryAiJobs({ libraryId, jobIds }: { libraryId: string; jobIds: string[] }): Promise<LibraryApiResult<{ retriedCount: number }>> {
    const result = await request({ type: 'ai.retry-jobs.request', libraryId, jobIds });
    if (!result.ok) return failure(result);
    if (result.type !== 'ai.jobs.retried') throw new Error('Unexpected retry-jobs response.');
    return { ok: true, value: { retriedCount: result.retriedCount } };
  },

  // AI events
  onAiProgress(listener: (event: { type: 'ai.progress'; libraryId: string; queued: number; running: number; succeeded: number; failed: number }) => void) {
    const subscription = (_event: Electron.IpcRendererEvent, input: unknown) => {
      try {
        listener(parseAiProgressEvent(input));
      } catch {
        // Ignore malformed events.
      }
    };
    ipcRenderer.on(AI_PROGRESS_CHANNEL, subscription);
    return () => ipcRenderer.removeListener(AI_PROGRESS_CHANNEL, subscription);
  },

  onAiCompleted(listener: (event: { type: 'ai.analysis.completed'; libraryId: string; assetId: string; fieldCount: number; tagCount: number }) => void) {
    const subscription = (_event: Electron.IpcRendererEvent, input: unknown) => {
      try {
        listener(parseAiAnalysisCompletedEvent(input));
      } catch {
        // Ignore malformed events.
      }
    };
    ipcRenderer.on(AI_COMPLETED_CHANNEL, subscription);
    return () => ipcRenderer.removeListener(AI_COMPLETED_CHANNEL, subscription);
  },

  onAiCleared(listener: (event: { type: 'ai.content.cleared'; libraryId: string; affectedAssetCount: number }) => void) {
    const subscription = (_event: Electron.IpcRendererEvent, input: unknown) => {
      try {
        listener(parseAiContentClearedEvent(input));
      } catch {
        // Ignore malformed events.
      }
    };
    ipcRenderer.on(AI_CLEARED_CHANNEL, subscription);
    return () => ipcRenderer.removeListener(AI_CLEARED_CHANNEL, subscription);
  },

  onThumbnailEvent(listener: (event: { type: 'asset.thumbnail.ready' | 'asset.thumbnail.failed'; libraryId: string; assetId: string; artifactId?: string; errorCode?: string; reason?: string }) => void) {
    const subscription = (_event: Electron.IpcRendererEvent, input: unknown) => {
      try {
        listener(parseThumbnailEvent(input));
      } catch {
        // Ignore malformed thumbnail events.
      }
    };
    ipcRenderer.on(THUMBNAIL_CHANNEL, subscription);
    return () => ipcRenderer.removeListener(THUMBNAIL_CHANNEL, subscription);
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
