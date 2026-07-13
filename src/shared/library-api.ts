import type { PublicError, PublicErrorReason } from './protocol/errors';
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

export interface LinkedAssetDeleteResult {
  deletedCount: number;
  failedCount: number;
  failures: Array<{ assetId: string; reason: PublicErrorReason }>;
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

export interface PreviewResolution {
  assetId: string;
  mediaType: 'image' | 'video' | 'other';
  status: 'ready' | 'pending' | 'failed' | 'missing';
  kind: 'thumbnail' | 'webm_proxy';
  url?: string;
  posterUrl?: string;
  errorCode?: string;
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
  deleteLinkedAssets(input: { libraryId: string; assetIds: string[]; deleteSourceFile: boolean }): Promise<LibraryApiResult<LinkedAssetDeleteResult>>;
  // Relink
  relinkAsset(input: { libraryId: string; assetId: string }): Promise<LibraryApiResult<AssetSummary>>;
  relinkBatchPreview(input: { libraryId: string; keepMetadata: boolean }): Promise<LibraryApiResult<RelinkBatchPreviewResult>>;
  relinkBatchApply(input: { libraryId: string; keepMetadata: boolean }): Promise<LibraryApiResult<RelinkBatchAppliedResult>>;
  // Extension active context
  setActiveContext(libraryId: string | null, selectedFolderId?: string): void;
  // Export / Import
  exportLibrary(input: { libraryId: string; includeLinkedContent: boolean; format: 'folder' | 'zip' }): Promise<LibraryApiResult<ExportCompletedResult>>;
  cancelLibraryExport(input: { exportId: string }): Promise<LibraryApiResult<{ exportId: string }>>;
  importLibrary(): Promise<LibraryApiResult<ImportValidatedResult>>;
  importLibraryZip(): Promise<LibraryApiResult<ImportCompletedResult>>;
  cancelLibraryImport(input: { importId: string }): Promise<LibraryApiResult<{ importId: string }>>;
  importLibraryCopy(input: { importId: string }): Promise<LibraryApiResult<ImportCompletedResult>>;
  importLibraryOpenInPlace(input: { importId: string }): Promise<LibraryApiResult<ImportCompletedResult>>;
  onProgress(listener: (event: ExportProgressEvent | ImportProgressEvent) => void): () => void;
  // AI
  getAiConfig(): Promise<LibraryApiResult<{
    provider: 'openai' | 'gemini' | 'anthropic' | null;
    model: string | null;
    hasKey: boolean;
    enabledFields: { label: boolean; description: boolean; tags: boolean; structuredMetadata: boolean };
    language: string;
    autoAnalyzeEnabled: boolean;
    disclaimerAccepted: boolean;
  }>>;
  setAiConfig(input: {
    provider: 'openai' | 'gemini' | 'anthropic';
    model: string;
    apiKey?: string;
    enabledFields?: { label: boolean; description: boolean; tags: boolean; structuredMetadata: boolean };
    language?: string;
    autoAnalyzeEnabled: boolean;
    disclaimerAccepted: boolean;
  }): Promise<LibraryApiResult<void>>;
  analyzeAsset(input: {
    libraryId: string;
    assetId: string;
  }): Promise<LibraryApiResult<
    | { assetId: string; generatedFields: { label?: string; description?: string; tags?: string[]; structuredMetadata?: Record<string, unknown> }; modelVersion: string }
    | { assetId: string; reason: string }
  >>;
  // Thumbnail & Preview
  requestThumbnail(input: { libraryId: string; assetId: string }): Promise<LibraryApiResult<{ assetId: string; artifactId: string }>>;
  requestPreview(input: { libraryId: string; assetId: string; mode: 'client' | 'fullscreen' }): Promise<LibraryApiResult<PreviewResolution>>;
  closePreview(input: { libraryId: string; assetId: string }): Promise<LibraryApiResult<void>>;
  reportPreviewError(input: { libraryId: string; assetId: string; errorCode: string; detail?: string }): Promise<LibraryApiResult<void>>;
  openExternal(input: { libraryId: string; assetId: string }): Promise<LibraryApiResult<void>>;
  retryArtifact(input: { libraryId: string; assetId: string; kind: 'thumbnail' | 'webm_proxy' }): Promise<LibraryApiResult<{ assetId: string; kind: string }>>;
  onThumbnailEvent(listener: (event: { type: 'asset.thumbnail.ready' | 'asset.thumbnail.failed'; libraryId: string; assetId: string; artifactId?: string; errorCode?: string; reason?: string }) => void): () => void;
  // AI extended
  testAiConnection(input: { provider: 'openai' | 'gemini' | 'anthropic'; model: string; apiKey: string }): Promise<LibraryApiResult<{ success: boolean; errorKind?: string; reason?: string }>>;
  clearAiContent(input: { libraryId: string; scope: { kind: 'asset' | 'selection' | 'folder' | 'library'; assetIds?: string[]; folderId?: string }; confirm: boolean }): Promise<LibraryApiResult<{ clearedCount: number }>>;
  pauseAiJobs(input: { libraryId: string; jobIds?: string[] }): Promise<LibraryApiResult<{ pausedCount: number }>>;
  resumeAiJobs(input: { libraryId: string; jobIds?: string[] }): Promise<LibraryApiResult<{ resumedCount: number }>>;
  cancelAiJobs(input: { libraryId: string; jobIds?: string[] }): Promise<LibraryApiResult<{ cancelledCount: number }>>;
  retryAiJobs(input: { libraryId: string; jobIds: string[] }): Promise<LibraryApiResult<{ retriedCount: number }>>;
  onAiProgress(listener: (event: { type: 'ai.progress'; libraryId: string; queued: number; running: number; succeeded: number; failed: number }) => void): () => void;
  onAiCompleted(listener: (event: { type: 'ai.analysis.completed'; libraryId: string; assetId: string; fieldCount: number; tagCount: number }) => void): () => void;
  onAiCleared(listener: (event: { type: 'ai.content.cleared'; libraryId: string; affectedAssetCount: number }) => void): () => void;
}
