import type { PublicError } from './protocol/errors';
import type {
  AssetSummary,
  AssetMetadataResult,
  CollectionSummary,
  LinkedFolderSummary,
  ManagedFolderSummary,
  SmartCollectionSummary,
  TagSummary,
} from './asset-types';
import type {
  ImportCompletion,
  ImportConflictPlan,
  AssetChangeEvent,
  RendererLibrarySummary,
  RendererLifecycleEvent,
  ExportProgressEvent,
  ImportProgressEvent,
} from './protocol/responses';
import type {
  NameConflictDecision,
  SuspectedDuplicateDecision,
} from './protocol/requests';

export type LibraryApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: PublicError };

export interface RelinkBatchPreviewResult {
  matchedCount: number;
  unmatchedCount: number;
  totalCount: number;
  examples: { relativeFilePath: string; matched: boolean }[];
}

export interface RelinkBatchAppliedResult {
  restoredCount: number;
  unchangedMissingCount: number;
  assets: AssetSummary[];
}

export interface ExportCompletedResult {
  exportId: string;
  libraryId: string;
  format: 'folder' | 'zip';
  fileCount: number;
  totalBytes: number;
  excludedPreviewCount: number;
  includedLinkedContent: boolean;
  durationMs: number;
}

export interface ImportCompletedResult {
  importId: string;
  libraryId: string;
  displayName: string;
}

export interface ImportValidatedResult {
  importId: string;
  libraryId: string;
  displayName: string;
}

export interface SerpentLibraryApi {
  create(input: { displayName: string }): Promise<LibraryApiResult<RendererLibrarySummary>>;
  open(): Promise<LibraryApiResult<RendererLibrarySummary>>;
  close(input: { libraryId: string }): Promise<LibraryApiResult<{ libraryId: string }>>;
  listOpen(): Promise<LibraryApiResult<RendererLibrarySummary[]>>;
  createFolder(input: {
    libraryId: string;
    parentFolderId?: string;
    name: string;
  }): Promise<LibraryApiResult<ManagedFolderSummary>>;
  listFolders(input: { libraryId: string }): Promise<LibraryApiResult<ManagedFolderSummary[]>>;
  listAssets(input: {
    libraryId: string;
    folderId?: string;
    recursive: boolean;
  }): Promise<LibraryApiResult<AssetSummary[]>>;
  importFiles(input: {
    libraryId: string;
    targetFolderId?: string;
  }): Promise<LibraryApiResult<ImportCompletion | ImportConflictPlan>>;
  importFolder(input: {
    libraryId: string;
    targetFolderId?: string;
  }): Promise<LibraryApiResult<ImportCompletion | ImportConflictPlan>>;
  resolveImport(input: {
    importId: string;
    suspectedDuplicate: SuspectedDuplicateDecision;
    nameConflict: NameConflictDecision;
  }): Promise<LibraryApiResult<ImportCompletion>>;
  abandonImport(input: { importId: string }): Promise<LibraryApiResult<{ importId: string }>>;
  refreshAssets(input: { libraryId: string }): Promise<
    LibraryApiResult<{
      changedCount: number;
      missingCount: number;
      assets: AssetSummary[];
    }>
  >;
  listLinkedFolders(input: { libraryId: string }): Promise<LibraryApiResult<LinkedFolderSummary[]>>;
  importFolderAsLinked(input: {
    libraryId: string;
    displayName?: string;
  }): Promise<LibraryApiResult<LinkedFolderSummary>>;
  relinkMissingFolder(input: {
    libraryId: string;
    folderId: string;
  }): Promise<LibraryApiResult<LinkedFolderSummary>>;
  onLifecycle(listener: (event: RendererLifecycleEvent) => void): () => void;
  onAssetsChanged(listener: (event: AssetChangeEvent) => void): () => void;
  // Tags
  listTags(input: { libraryId: string }): Promise<LibraryApiResult<TagSummary[]>>;
  createTag(input: { libraryId: string; name: string }): Promise<LibraryApiResult<TagSummary>>;
  renameTag(input: { libraryId: string; tagId: string; name: string }): Promise<LibraryApiResult<TagSummary>>;
  deleteTag(input: { libraryId: string; tagId: string }): Promise<LibraryApiResult<{ tagId: string }>>;
  assignTags(input: { libraryId: string; assetIds: string[]; tagIds: string[] }): Promise<LibraryApiResult<{ assignedCount: number }>>;
  removeTags(input: { libraryId: string; assetIds: string[]; tagIds: string[] }): Promise<LibraryApiResult<{ removedCount: number }>>;
  // Collections
  listCollections(input: { libraryId: string }): Promise<LibraryApiResult<CollectionSummary[]>>;
  createCollection(input: { libraryId: string; parentId?: string; name: string }): Promise<LibraryApiResult<CollectionSummary>>;
  updateCollection(input: { libraryId: string; collectionId: string; name?: string; description?: string; coverAssetId?: string; position?: number }): Promise<LibraryApiResult<CollectionSummary>>;
  deleteCollection(input: { libraryId: string; collectionId: string }): Promise<LibraryApiResult<{ collectionId: string }>>;
  addCollectionAssets(input: { libraryId: string; collectionId: string; assetIds: string[] }): Promise<LibraryApiResult<{ collectionId: string }>>;
  removeCollectionAssets(input: { libraryId: string; collectionId: string; assetIds: string[] }): Promise<LibraryApiResult<{ collectionId: string }>>;
  reorderCollectionAssets(input: { libraryId: string; collectionId: string; orderedAssetIds: string[] }): Promise<LibraryApiResult<{ collectionId: string }>>;
  listCollectionAssets(input: { libraryId: string; collectionId: string; recursive: boolean }): Promise<LibraryApiResult<AssetSummary[]>>;
  // Asset Metadata
  getAssetMetadata(input: { libraryId: string; assetId: string }): Promise<LibraryApiResult<AssetMetadataResult>>;
  setAssetMetadata(input: { libraryId: string; assetId: string; expectedVersion: number; label?: string; description?: string; rating?: number; favorite?: boolean; palette?: string[]; sourcePageUrl?: string }): Promise<LibraryApiResult<AssetMetadataResult>>;
  backfillAssetMetadata(input: { libraryId: string }): Promise<LibraryApiResult<{ backfilledCount: number }>>;
  // Smart Collections
  listSmartCollections(input: { libraryId: string }): Promise<LibraryApiResult<SmartCollectionSummary[]>>;
  createSmartCollection(input: { libraryId: string; name: string; queryDefinitionJson: string }): Promise<LibraryApiResult<SmartCollectionSummary>>;
  updateSmartCollection(input: { libraryId: string; collectionId: string; name?: string; queryDefinitionJson?: string; position?: number }): Promise<LibraryApiResult<SmartCollectionSummary>>;
  deleteSmartCollection(input: { libraryId: string; collectionId: string }): Promise<LibraryApiResult<{ collectionId: string }>>;
  executeSmartCollection(input: { libraryId: string; collectionId: string }): Promise<LibraryApiResult<{ items: AssetSummary[]; total: number; offset: number }>>;
  // Search
  searchAssets(input: { libraryId: string; query?: { clauses: { field: string | null; values: string[]; exclude: boolean }[] } | null; filters?: { field: 'format' | 'tag' | 'rating' | 'favorite' | 'source_url' | 'availability'; values: string[]; exclude: boolean }[]; sort?: { field: 'name' | 'modified_at' | 'created_at' | 'byte_size' | 'duration' | 'rating'; order: 'asc' | 'desc' }; limit?: number; offset?: number }): Promise<LibraryApiResult<{ items: AssetSummary[]; total: number; offset: number; snippets?: { assetId: string; text: string }[] }>>;
  // Trash / Delete
  trashAssets(input: { libraryId: string; assetIds: string[] }): Promise<LibraryApiResult<{ trashedCount: number }>>;
  restoreAssets(input: { libraryId: string; assetIds: string[]; targetFolderId?: string }): Promise<LibraryApiResult<{ restoredCount: number; assets: AssetSummary[] }>>;
  deleteAssetsPermanent(input: { libraryId: string; assetIds: string[] }): Promise<LibraryApiResult<{ deletedCount: number; skippedCount: number; skippedReasons: string[] }>>;
  listTrash(input: { libraryId: string }): Promise<LibraryApiResult<AssetSummary[]>>;
  purgeTrash(input: { libraryId: string }): Promise<LibraryApiResult<{ purgedCount: number }>>;
  // Linked delete
  deleteLinkedAssets(input: { libraryId: string; assetIds: string[]; deleteSourceFile: boolean }): Promise<LibraryApiResult<{ deletedCount: number }>>;
  // Relink
  relinkAsset(input: { libraryId: string; assetId: string }): Promise<LibraryApiResult<AssetSummary>>;
  relinkBatchPreview(input: { libraryId: string; keepMetadata: boolean }): Promise<LibraryApiResult<RelinkBatchPreviewResult>>;
  relinkBatchApply(input: { libraryId: string; keepMetadata: boolean }): Promise<LibraryApiResult<RelinkBatchAppliedResult>>;
  // Extension active context
  setActiveContext(libraryId: string | null, selectedFolderId?: string): void;
  // Export / Import
  exportLibrary(input: { libraryId: string; includeLinkedContent: boolean }): Promise<LibraryApiResult<ExportCompletedResult>>;
  importLibrary(): Promise<LibraryApiResult<ImportValidatedResult>>;
  importLibraryCopy(input: { importId: string }): Promise<LibraryApiResult<ImportCompletedResult>>;
  importLibraryOpenInPlace(input: { importId: string }): Promise<LibraryApiResult<ImportCompletedResult>>;
  onProgress(listener: (event: ExportProgressEvent | ImportProgressEvent) => void): () => void;
}
