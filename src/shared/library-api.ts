import type { PublicError, PublicErrorReason } from './protocol/errors';
import type { LibraryNavigationSummary } from './library-navigation';

/** Serpent-xffq：WebDAV 服务端能力探测结果。 */
export interface SyncCapabilities {
  auth: 'none' | 'basic' | 'digest';
  supportsContentTransfer: boolean;
  supportsDepthInfinity: boolean;
  supportsEtagIfMatch: boolean;
  supportsMove: boolean;
  supportsLock: boolean;
  quotaBytes?: number;
  usedBytes?: number;
  maxUploadBytes?: number;
}

/** Serpent-xffq：同步差异/结果汇总。 */
export interface SyncReport {
  libraryDirectory: string;
  newLocal: number;
  newRemote: number;
  uploads: number;
  downloads: number;
  conflicts: number;
  remoteDeletes: number;
  localRecycles: number;
}

import type {
  AssetSummary,
  BrowseGeometryBlock,
  BrowseLayoutEntry,
  AiSearchPlan,
  AssetMetadataResult,
  ExtractedMetadataResult,
  CollectionSummary,
  FilterClause,
  FolderBrowseEntry,
  IgnoredPath,
  LinkedFolderDirectoryMutation,
  LinkedFolderRule,
  LinkedFolderSummary,
  ManagedFolderSummary,
  SearchScope,
  SmartCollectionSummary,
  TagSummary,
  TagCooccurrenceGraph,
  TrashedFolderSummary,
  SearchQuery,
} from './asset-types';
import type {
  ImportCompletion,
  ImportConflictPlan,
  ImageSequenceImportOffer,
  EagleImportResult,
  BillfishImportResult,
  AssetChangeEvent,
  ExtensionSaveCompletedEvent,
  LibraryChangedEvent,
  HistoryStatus,
  RendererLibrarySummary,
  MissingAssetRecoveryProbe,
  RendererLifecycleEvent,
  ExportProgressEvent,
  ImportProgressEvent,
  SyncProgressEvent,
  MediaJob,
  AiJob,
  TagOperationSkip,
} from './protocol/responses';
import type {
  NameConflictDecision,
  SuspectedDuplicateDecision,
} from './protocol/requests';
import type { RecentLibraryEntry } from './recent-libraries';
import type { AiApiFormat } from './ai-endpoints';
import type { AiReliabilitySettings } from './ai-reliability';
import type { FbxConversionResult } from './fbx-conversion';
import type { ModelCompanionAsset } from './model-companions';
import type { PluginJobRecord } from '../plugins/plugin-jobs';

export type LibraryApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: PublicError };

export interface RelinkAssetResult {
  asset: AssetSummary;
  batchFollowUpRoot: string;
}

export interface RelinkBatchPreviewResult {
  previewId: string;
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
  mediaType: 'image' | 'video' | 'audio' | 'text' | 'model' | 'document' | 'other';
  status: 'ready' | 'pending' | 'failed' | 'missing';
  kind: 'thumbnail' | 'webm_proxy' | 'audio_proxy';
  url?: string;
  posterUrl?: string;
  errorCode?: string;
  playbackMode?: 'source' | 'proxy';
  sourceMimeType?: string;
  sourceContainer?: 'mp4' | 'mov' | 'webm';
  sourceCodecs?: string[];
  playbackToken?: string;
  /** EXR subimages/parts exposed by OpenImageIO; absent for other formats. */
  exrPlanes?: Array<{ index: number; label: string }>;
  selectedExrPlane?: number;
  colorSpace?: PreviewColorSpace;
  /** The first source response used an inferred color; a later poll may replace it with embedded metadata. */
  colorSpacePending?: boolean;
}

export interface PreviewColorSpace {
  id: string;
  label: string;
  source: 'embedded' | 'metadata' | 'inferred';
  isLinear: boolean;
  metadataName?: string;
  options: Array<{ id: string; label: string; isLinear: boolean }>;
}

export interface MediaJobStatus {
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  paused: number;
  cancelled: number;
  jobs: MediaJob[];
}

export interface AiJobStatus {
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  paused: number;
  cancelled: number;
  jobs: AiJob[];
}

/** Plugin-owned background jobs from the shared `jobs` table (PLUGIN-008). */
export interface PluginJobStatus {
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  paused: number;
  cancelled: number;
  interrupted: number;
  jobs: PluginJobRecord[];
}

export interface SerpentLibraryApi {
  create(input: { displayName: string }): Promise<LibraryApiResult<RendererLibrarySummary>>;
  open(): Promise<LibraryApiResult<RendererLibrarySummary>>;
  /** Reveal a Main-owned recovery report without exposing its filesystem path. */
  revealRecoveryReport(input: { libraryId: string }): Promise<LibraryApiResult<void>>;
  /** Check only known source/trash locations for a selected missing asset. */
  probeMissingAssetRecovery(input: {
    libraryId: string;
    assetId: string;
  }): Promise<LibraryApiResult<MissingAssetRecoveryProbe>>;
  /** Convert and open an Eagle library as a new Serpent library. */
  inspectEagle(): Promise<LibraryApiResult<{ displayName: string }>>;
  cancelInspectEagle(): Promise<LibraryApiResult<void>>;
  openEagle(input: { displayName: string }): Promise<LibraryApiResult<RendererLibrarySummary>>;
  /** Convert and open a Billfish library as a new Serpent library. */
  inspectBillfish(): Promise<LibraryApiResult<{ displayName: string }>>;
  cancelInspectBillfish(): Promise<LibraryApiResult<void>>;
  openBillfish(input: { displayName: string }): Promise<LibraryApiResult<RendererLibrarySummary>>;
  listRecent(): Promise<LibraryApiResult<RecentLibraryEntry[]>>;
  openRecent(input: { path: string }): Promise<LibraryApiResult<RendererLibrarySummary>>;
  /** Remove a path from the recent list without deleting disk (Serpent-ucx). */
  forgetRecent(input: { path: string }): Promise<LibraryApiResult<{ path: string }>>;
  close(input: { libraryId: string }): Promise<LibraryApiResult<{ libraryId: string }>>;
  rename(input: { libraryId: string; displayName: string }): Promise<LibraryApiResult<RendererLibrarySummary>>;
  /** Close then permanently delete the library root on disk (Serpent-9i8). */
  deleteLibraryFromDisk(input: {
    libraryId: string;
  }): Promise<LibraryApiResult<{ libraryId: string; displayName: string }>>;
  listOpen(): Promise<LibraryApiResult<RendererLibrarySummary[]>>;
  getOperationHistoryStatus(input: { libraryId: string }): Promise<LibraryApiResult<HistoryStatus>>;
  undoOperationHistory(input: { libraryId: string; expectedHistoryEntryId: string }): Promise<LibraryApiResult<HistoryStatus>>;
  redoOperationHistory(input: { libraryId: string; expectedHistoryEntryId: string }): Promise<LibraryApiResult<HistoryStatus>>;
  createFolder(input: {
    libraryId: string;
    parentFolderId?: string;
    name: string;
  }): Promise<LibraryApiResult<ManagedFolderSummary & { historyEntryId?: string }>>;
  renameFolder(input: {
    libraryId: string;
    folderId: string;
    newName: string;
  }): Promise<LibraryApiResult<ManagedFolderSummary & { historyEntryId?: string }>>;
  /** Create a physical directory inside a linked-folder root or virtual child. */
  createLinkedFolderDirectory(input: {
    libraryId: string;
    linkedFolderId: string;
    relativePath: string;
    name: string;
  }): Promise<LibraryApiResult<LinkedFolderDirectoryMutation>>;
  /** Rename a physical linked-folder root or virtual child directory. */
  renameLinkedFolderDirectory(input: {
    libraryId: string;
    linkedFolderId: string;
    relativePath: string;
    newName: string;
  }): Promise<LibraryApiResult<LinkedFolderDirectoryMutation>>;
  /** OS file clipboard copy (Finder/Explorer interoperable). */
  copyFolder(input: {
    libraryId: string;
    folderId: string;
  }): Promise<LibraryApiResult<void>>;
  /** Paste OS clipboard files/folders into a managed folder. */
  pasteIntoFolder(input: {
    libraryId: string;
    folderId?: string | null;
  }): Promise<LibraryApiResult<ImportCompletion | ImportConflictPlan | ImageSequenceImportOffer>>;
  /** Duplicate managed folder subtree as a sibling. */
  cloneFolder(input: {
    libraryId: string;
    folderId: string;
  }): Promise<
    LibraryApiResult<{
      folder: ManagedFolderSummary;
      clonedFolderCount: number;
      clonedAssetCount: number;
    }>
  >;
  /** Reparent managed folders under a new parent. */
  moveFolders(input: {
    libraryId: string;
    folderIds: string[];
    targetParentFolderId: string | null;
    conflictStrategy?: 'keep-both' | 'skip';
  }): Promise<
    LibraryApiResult<{
      movedCount: number;
      skippedCount: number;
      folders: ManagedFolderSummary[];
      historyEntryId?: string;
    }>
  >;
  listFolders(input: { libraryId: string; showIgnored?: boolean }): Promise<LibraryApiResult<ManagedFolderSummary[]>>;
  listFolderBrowseEntries(input: {
    libraryId: string;
    parentFolderId: string | null;
    showIgnored?: boolean;
  }): Promise<LibraryApiResult<FolderBrowseEntry[]>>;
  trashFolder(input: {
    libraryId: string;
    folderId: string;
  }): Promise<
    LibraryApiResult<{
      folderId: string;
      trashedAssetCount: number;
      removedFolderCount: number;
      historyEntryId?: string;
    }>
  >;
  trashSelection(input: {
    libraryId: string;
    assetIds: string[];
    folderIds: string[];
  }): Promise<LibraryApiResult<{
    trashedAssetCount: number;
    trashedFolderCount: number;
    removedFolderCount: number;
    historyEntryId: string;
  }>>;
  deleteFolderFromDisk(input: {
    libraryId: string;
    folderId: string;
  }): Promise<
    LibraryApiResult<{
      folderId: string;
      deletedAssetCount: number;
      removedFolderCount: number;
    }>
  >;
  removeLinkedFolder(input: {
    libraryId: string;
    folderId: string;
  }): Promise<LibraryApiResult<{ folderId: string; removedAssetCount: number }>>;
  deleteLinkedFolderSubtree(input: {
    libraryId: string;
    linkedFolderId: string;
    relativePath: string;
    deleteFromDisk: boolean;
  }): Promise<
    LibraryApiResult<{
      linkedFolderId: string;
      relativePath: string;
      deletedAssetCount: number;
      failedCount: number;
    }>
  >;
  listAssets(input: {
    libraryId: string;
    folderId?: string;
    recursive: boolean;
    showIgnored?: boolean;
  }): Promise<LibraryApiResult<AssetSummary[]>>;
  createImageSequence(input: {
    libraryId: string;
    assetIds: string[];
    fps: number;
  }): Promise<LibraryApiResult<AssetSummary>>;
  dissolveImageSequence(input: {
    libraryId: string;
    sequenceId: string;
  }): Promise<LibraryApiResult<{ sequenceId: string }>>;
  dissolveImageSequences(input: {
    libraryId: string;
    sequenceIds: string[];
  }): Promise<LibraryApiResult<{ sequenceIds: string[] }>>;
  setImageSequenceFps(input: {
    libraryId: string;
    sequenceId: string;
    fps: number;
  }): Promise<LibraryApiResult<{ sequenceId: string; fps: number }>>;
  importFiles(input: {
    libraryId: string;
    targetFolderId?: string;
    autoDetectImageSequences?: boolean;
  }): Promise<LibraryApiResult<ImportCompletion | ImportConflictPlan | ImageSequenceImportOffer>>;
  importFolder(input: {
    libraryId: string;
    targetFolderId?: string;
    autoDetectImageSequences?: boolean;
  }): Promise<LibraryApiResult<ImportCompletion | ImportConflictPlan>>;
  importEagleLibrary(input: {
    libraryId: string;
  }): Promise<LibraryApiResult<EagleImportResult>>;
  importBillfishLibrary(input: {
    libraryId: string;
  }): Promise<LibraryApiResult<BillfishImportResult>>;
  importDropped(input: {
    libraryId: string;
    targetFolderId?: string;
    targetCollectionId?: string;
    files: File[];
    html?: string;
    uriList?: string;
    autoDetectImageSequences?: boolean;
  }): Promise<LibraryApiResult<ImportCompletion | ImportConflictPlan | ImageSequenceImportOffer>>;
  /** Resolve native dropped File handles to managed asset ids without exposing paths. */
  resolveManagedAssetDrop(input: {
    libraryId: string;
    files: File[];
  }): Promise<LibraryApiResult<{ assetIds: string[] }>>;
  pasteClipboardImage(input: {
    libraryId: string;
    targetFolderId?: string;
    targetCollectionId?: string;
  }): Promise<LibraryApiResult<ImportCompletion | ImportConflictPlan>>;
  confirmImageSequenceImport(input: {
    libraryId: string;
    offerId: string;
    action: 'import-sequence' | 'import-selected';
    sequenceIndex?: number;
    firstFrame?: number;
    lastFrame?: number;
    fps?: number;
    applyToRest?: boolean;
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
  getLinkedFolderRules(input: { libraryId: string; folderId: string }): Promise<LibraryApiResult<LinkedFolderRule[]>>;
  setLinkedFolderRules(input: { libraryId: string; folderId: string; rules: LinkedFolderRule[] }): Promise<LibraryApiResult<{ rules: LinkedFolderRule[]; hiddenCount: number; restoredCount: number }>>;
  listIgnoredPaths(input: { libraryId: string }): Promise<LibraryApiResult<IgnoredPath[]>>;
  getGitignore(input: { libraryId: string }): Promise<LibraryApiResult<{ content: string }>>;
  setGitignore(input: { libraryId: string; content: string }): Promise<LibraryApiResult<{ content: string }>>;
  setIgnore(input: { libraryId: string; locationKind: 'managed' | 'linked'; linkedFolderId?: string | null; relativePath: string; pathKind: 'asset' | 'folder' | 'extension'; ignored: boolean }): Promise<LibraryApiResult<{ ignored: boolean; path: IgnoredPath }>>;
  copyAssetsToLinkedFolder(input: { libraryId: string; folderId: string; relativePath?: string; assetIds: string[]; conflictStrategy: 'keep-both' | 'replace' | 'skip' }): Promise<LibraryApiResult<{ copiedCount: number; skippedCount: number; assets: AssetSummary[] }>>;
  convertLinkedFolderToManaged(input: { libraryId: string; folderId: string; targetFolderId?: string }): Promise<LibraryApiResult<{ managedFolderId: string; convertedCount: number; assets: AssetSummary[] }>>;
  onLifecycle(listener: (event: RendererLifecycleEvent) => void): () => void;
  onAssetsChanged(listener: (event: AssetChangeEvent) => void): () => void;
  onLibraryChanged(listener: (event: LibraryChangedEvent) => void): () => void;
  onExtensionSaveCompleted(
    listener: (event: ExtensionSaveCompletedEvent) => void,
  ): () => void;
  // Tags
  listTags(input: { libraryId: string }): Promise<LibraryApiResult<TagSummary[]>>;
  createTag(input: { libraryId: string; name: string }): Promise<LibraryApiResult<TagSummary & { historyEntryId?: string }>>;
  renameTag(input: { libraryId: string; tagId: string; name: string }): Promise<LibraryApiResult<TagSummary & { historyEntryId?: string }>>;
  deleteTag(input: { libraryId: string; tagId: string }): Promise<LibraryApiResult<{ tagId: string; historyEntryId?: string }>>;
  deleteTags(input: { libraryId: string; tagIds: string[] }): Promise<LibraryApiResult<{ deletedTagIds: string[]; historyEntryId?: string }>>;
  mergeTags(input: { libraryId: string; sourceTagIds: string[]; name: string }): Promise<LibraryApiResult<TagSummary & { historyEntryId?: string }>>;
  getTagCooccurrenceGraph(input: { libraryId: string; minWeight?: number; maxNodes?: number; maxEdges?: number }): Promise<LibraryApiResult<TagCooccurrenceGraph>>;
  assignTags(input: { libraryId: string; assetIds: string[]; tagIds: string[] }): Promise<LibraryApiResult<{ assignedCount: number; skipped: TagOperationSkip[]; historyEntryId?: string }>>;
  removeTags(input: { libraryId: string; assetIds: string[]; tagIds: string[] }): Promise<LibraryApiResult<{ removedCount: number; skipped: TagOperationSkip[]; historyEntryId?: string }>>;
  // Collections
  listCollections(input: { libraryId: string }): Promise<LibraryApiResult<CollectionSummary[]>>;
  createCollection(input: { libraryId: string; parentId?: string; name: string }): Promise<LibraryApiResult<CollectionSummary & { historyEntryId?: string }>>;
  updateCollection(input: { libraryId: string; collectionId: string; name?: string; description?: string | null; coverAssetId?: string | null; position?: number }): Promise<LibraryApiResult<CollectionSummary & { historyEntryId?: string }>>;
  reorderCollections(input: { libraryId: string; orderedCollectionIds: string[] }): Promise<LibraryApiResult<{ orderedCollectionIds: string[]; historyEntryId?: string }>>;
  deleteCollection(input: { libraryId: string; collectionId: string }): Promise<LibraryApiResult<{ collectionId: string; historyEntryId?: string }>>;
  addCollectionAssets(input: { libraryId: string; collectionId: string; assetIds: string[] }): Promise<LibraryApiResult<{ collectionId: string; historyEntryId?: string }>>;
  removeCollectionAssets(input: { libraryId: string; collectionId: string; assetIds: string[] }): Promise<LibraryApiResult<{ collectionId: string; historyEntryId?: string }>>;
  reorderCollectionAssets(input: { libraryId: string; collectionId: string; orderedAssetIds: string[] }): Promise<LibraryApiResult<{ collectionId: string; historyEntryId?: string }>>;
  listCollectionAssets(input: { libraryId: string; collectionId: string; recursive: boolean }): Promise<LibraryApiResult<AssetSummary[]>>;
  listAssetCollectionMemberships(input: { libraryId: string; assetIds: string[] }): Promise<LibraryApiResult<Array<{ assetId: string; collectionId: string }>>>;
  // Asset Metadata
  getAssetMetadata(input: { libraryId: string; assetId: string }): Promise<LibraryApiResult<AssetMetadataResult>>;
  getExtractedMetadata(input: { libraryId: string; assetId: string }): Promise<LibraryApiResult<ExtractedMetadataResult>>;
  setAssetColorSpaceOverride(input: { libraryId: string; assetId: string; colorSpace: string | null }): Promise<LibraryApiResult<{ assetId: string; colorSpaceOverride: string | null }>>;
  setAssetMetadata(input: { libraryId: string; assetId: string; expectedVersion: number; description?: string; rating?: number; favorite?: boolean; palette?: string[]; sourcePageUrl?: string; author?: string }): Promise<LibraryApiResult<AssetMetadataResult & { historyEntryId?: string }>>;
  setAssetsRating(input: { libraryId: string; assetIds: string[]; rating: number }): Promise<LibraryApiResult<{ updatedCount: number; skipped: TagOperationSkip[]; historyEntryId?: string }>>;
  backfillAssetMetadata(input: { libraryId: string }): Promise<LibraryApiResult<{ backfilledCount: number }>>;
  // Smart Collections
  listSmartCollections(input: { libraryId: string }): Promise<LibraryApiResult<SmartCollectionSummary[]>>;
  createSmartCollection(input: { libraryId: string; name: string; queryDefinitionJson: string }): Promise<LibraryApiResult<SmartCollectionSummary & { historyEntryId?: string }>>;
  updateSmartCollection(input: { libraryId: string; collectionId: string; name?: string; queryDefinitionJson?: string; position?: number }): Promise<LibraryApiResult<SmartCollectionSummary & { historyEntryId?: string }>>;
  deleteSmartCollection(input: { libraryId: string; collectionId: string }): Promise<LibraryApiResult<{ collectionId: string; historyEntryId?: string }>>;
  executeSmartCollection(input: { libraryId: string; collectionId: string; scopeMode?: boolean; idsOnly?: boolean; layoutOnly?: boolean; limit?: number; offset?: number }): Promise<LibraryApiResult<{ items: AssetSummary[]; total: number; offset: number; assetIds?: string[]; layout?: BrowseLayoutEntry[] }>>;
  // Search
  searchAssets(input: { libraryId: string; query?: SearchQuery | null; filters?: FilterClause[]; scope?: SearchScope; sort?: { field: 'name' | 'modified_at' | 'created_at' | 'byte_size' | 'long_edge' | 'duration' | 'rating' | 'color' | 'author'; order: 'asc' | 'desc' }; scopeMode?: boolean; idsOnly?: boolean; layoutOnly?: boolean; limit?: number; offset?: number; showIgnored?: boolean }): Promise<LibraryApiResult<{ items: AssetSummary[]; total: number; offset: number; snippets?: { assetId: string; text: string }[]; assetIds?: string[]; layout?: BrowseLayoutEntry[] }>>;
  openBrowseSession(input: { libraryId: string; query: SearchQuery | null; filters?: FilterClause[]; scope?: SearchScope; sort?: { field: 'name' | 'modified_at' | 'created_at' | 'byte_size' | 'long_edge' | 'duration' | 'rating' | 'color' | 'author'; order: 'asc' | 'desc' }; smartCollectionId?: string; limit?: number; showIgnored?: boolean }): Promise<LibraryApiResult<{ sessionId: string; libraryGeneration: number; changeSequence: number; queryFingerprint: string; items: AssetSummary[]; total: number; offset: number; snippets?: { assetId: string; text: string }[] }>>;
  fetchBrowseSessionPage(input: { libraryId: string; sessionId: string; limit?: number; offset?: number }): Promise<LibraryApiResult<{ sessionId: string; changeSequence: number; items: AssetSummary[]; total: number; offset: number; snippets?: { assetId: string; text: string }[] } | { stale: true; sessionId: string; reason: 'library-generation' | 'change-sequence' | 'missing' }>>;
  fetchBrowseSessionGeometry(input: { libraryId: string; sessionId: string; startIndex: number; limit?: number }): Promise<LibraryApiResult<BrowseGeometryBlock | { stale: true; sessionId: string; reason: 'library-generation' | 'change-sequence' | 'missing' }>>;
  fetchBrowseSessionAssetIds(input: { libraryId: string; sessionId: string }): Promise<LibraryApiResult<string[] | { stale: true; sessionId: string; reason: 'library-generation' | 'change-sequence' | 'missing' }>>;
  closeBrowseSession(input: { libraryId: string; sessionId: string }): Promise<LibraryApiResult<{ sessionId: string }>>;
  fetchLibraryNavigationSummary(input: { libraryId: string; showIgnored?: boolean; includeTrashedFolders?: boolean }): Promise<LibraryApiResult<LibraryNavigationSummary>>;
  planAiSearch(input: { naturalQuery: string }): Promise<LibraryApiResult<{ plan: AiSearchPlan; apiFormat: AiApiFormat; model: string }>>;
  // Trash / Delete
  trashAssets(input: { libraryId: string; assetIds: string[] }): Promise<LibraryApiResult<{ trashedCount: number; historyEntryId?: string }>>;
  restoreAssets(input: { libraryId: string; assetIds: string[]; targetFolderId?: string | null; conflictStrategy?: 'keep-both' | 'replace' | 'skip' }): Promise<LibraryApiResult<{ restoredCount: number; assets: AssetSummary[]; historyEntryId?: string }>>;
  previewRestoreAssets(input: { libraryId: string; assetIds: string[]; targetFolderId?: string | null }): Promise<LibraryApiResult<{ hasNameConflicts: boolean }>>;
  moveAssets(input: { libraryId: string; assetIds: string[]; targetFolderId: string | null; conflictStrategy?: 'keep-both' | 'replace' | 'skip' }): Promise<LibraryApiResult<{ movedCount: number; skippedCount: number; operationId: string | null; assets: AssetSummary[]; historyEntryId?: string }>>;
  undoMoveAssets(input: { libraryId: string; operationId: string; conflictStrategy?: 'error' | 'keep-both' | 'replace' | 'skip' }): Promise<LibraryApiResult<{ undoneCount: number; skippedCount: number; assets: AssetSummary[] }>>;
  copyAssets(input: { libraryId: string; assetIds: string[]; targetFolderId: string | null; conflictStrategy?: 'keep-both' | 'replace' | 'skip' }): Promise<LibraryApiResult<{ copiedCount: number; skippedCount: number; operationId: string | null; assets: AssetSummary[]; historyEntryId?: string }>>;
  undoCopyAssets(input: { libraryId: string; operationId: string; conflictStrategy?: 'error' | 'keep-both' | 'replace' | 'skip' }): Promise<LibraryApiResult<{ undoneCount: number; skippedCount: number; assets: AssetSummary[] }>>;
  renameAssetFile(input: { libraryId: string; assetId: string; newBaseName?: string; newFileName?: string }): Promise<LibraryApiResult<AssetSummary & { historyEntryId?: string }>>;
  readTextAsset(input: { libraryId: string; assetId: string; maxBytes?: number }): Promise<LibraryApiResult<{
    assetId: string;
    revisionId: string;
    content: string;
    truncated: boolean;
    byteSize: number;
    lineCount: number;
    editable: boolean;
    mimeType: string;
  }>>;
  saveTextAsset(input: {
    libraryId: string;
    assetId: string;
    content: string;
    expectedRevisionId?: string;
    createRevision?: boolean;
  }): Promise<LibraryApiResult<{
    asset: AssetSummary;
    revisionId: string;
    byteSize: number;
    lineCount: number;
  }>>;
  deleteAssetsPermanent(input: { libraryId: string; assetIds: string[] }): Promise<LibraryApiResult<{ deletedCount: number; skippedCount: number; skippedReasons: Array<{ assetId: string; reason: PublicErrorReason }> }>>;
  deleteAssetsFromDisk(input: { libraryId: string; assetIds: string[] }): Promise<LibraryApiResult<{ deletedCount: number }>>;
  listTrash(input: { libraryId: string }): Promise<LibraryApiResult<AssetSummary[]>>;
  listTrashedFolders(input: { libraryId: string }): Promise<LibraryApiResult<TrashedFolderSummary[]>>;
  restoreTrashedManagedFolder(input: {
    libraryId: string;
    tombstoneId: string;
  }): Promise<LibraryApiResult<{
    restoredFolderCount: number;
    restoredAssetCount: number;
    folders: ManagedFolderSummary[];
    historyEntryId?: string;
  }>>;
  purgeTrash(input: { libraryId: string }): Promise<LibraryApiResult<{ purgedCount: number; skippedCount: number; failures: Array<{ assetId: string; reason: PublicErrorReason }> }>>;
  // Linked delete
  deleteLinkedAssets(input: { libraryId: string; assetIds: string[]; deleteSourceFile: boolean }): Promise<LibraryApiResult<LinkedAssetDeleteResult>>;
  // Relink
  relinkAsset(input: { libraryId: string; assetId: string }): Promise<LibraryApiResult<RelinkAssetResult>>;
  relinkBatchPreview(input: { libraryId: string; keepMetadata: boolean }): Promise<LibraryApiResult<RelinkBatchPreviewResult>>;
  relinkBatchPreviewAtRoot(input: {
    libraryId: string;
    newRootPath: string;
    keepMetadata: boolean;
  }): Promise<LibraryApiResult<RelinkBatchPreviewResult>>;
  relinkBatchApply(input: { libraryId: string; previewId: string; keepMetadata: boolean }): Promise<LibraryApiResult<RelinkBatchAppliedResult>>;
  cancelRelinkBatch(input: { libraryId: string; previewId: string }): Promise<LibraryApiResult<{ previewId: string }>>;
  // Extension active context
  setActiveContext(libraryId: string | null, selectedFolderId?: string): void;
  // Export / Import
  exportLibrary(input: { libraryId: string; libraryName?: string; includeLinkedContent: boolean; format: 'folder' | 'zip' }): Promise<LibraryApiResult<ExportCompletedResult>>;
  cancelLibraryExport(input: { exportId: string }): Promise<LibraryApiResult<{ exportId: string }>>;
  importLibrary(): Promise<LibraryApiResult<ImportValidatedResult>>;
  importLibraryZip(): Promise<LibraryApiResult<ImportCompletedResult>>;
  cancelLibraryImport(input: { importId: string }): Promise<LibraryApiResult<{ importId: string }>>;
  importLibraryCopy(input: { importId: string }): Promise<LibraryApiResult<ImportCompletedResult>>;
  importLibraryOpenInPlace(input: { importId: string }): Promise<LibraryApiResult<ImportCompletedResult>>;
  onProgress(listener: (event: ExportProgressEvent | ImportProgressEvent | SyncProgressEvent) => void): () => void;
  // AI
  getAiConfig(): Promise<LibraryApiResult<{
    apiFormat: AiApiFormat | null;
    model: string | null;
    baseUrl: string;
    hasKey: boolean;
    enabledFields: { description: boolean; tags: boolean; rating: boolean };
    analysisSettings: {
      forceExistingTags: boolean;
      maxTags: number;
      maxDescriptionCharsZh: number;
      maxDescriptionWordsEn: number;
      outputStyle: 'normal' | 'concise' | 'rigorous';
      ratingRubric: string;
      customDescriptionPrompt: string;
      customTagPrompt: string;
    };
    languages: Array<'zh-CN' | 'en' | 'ja' | 'ko'>;
    concurrencyLimit: number;
    maxAnalysisImageEdgePx: number;
    reliabilitySettings: AiReliabilitySettings;
    autoAnalyzeEnabled: boolean;
    disclaimerAccepted: boolean;
  }>>;
  setAiConfig(input: {
    apiFormat: AiApiFormat;
    model: string;
    baseUrl?: string;
    apiKey?: string;
    enabledFields?: { description: boolean; tags: boolean; rating: boolean };
    analysisSettings?: {
      forceExistingTags: boolean;
      maxTags: number;
      maxDescriptionCharsZh: number;
      maxDescriptionWordsEn: number;
      outputStyle: 'normal' | 'concise' | 'rigorous';
      ratingRubric: string;
      customDescriptionPrompt: string;
      customTagPrompt: string;
    };
    languages?: Array<'zh-CN' | 'en' | 'ja' | 'ko'>;
    concurrencyLimit?: number;
    maxAnalysisImageEdgePx?: number;
    reliabilitySettings?: AiReliabilitySettings;
    autoAnalyzeEnabled: boolean;
    disclaimerAccepted: boolean;
  }): Promise<LibraryApiResult<void>>;
  getAiContent(input: {
    libraryId: string;
    assetId: string;
  }): Promise<LibraryApiResult<{
    assetId: string;
    description: string | null;
    tags: string[];
    rating: number | null;
    modelVersion: string | null;
  }>>;
  analyzeAsset(input: {
    libraryId: string;
    assetId: string;
  }): Promise<LibraryApiResult<
    | { assetId: string; generatedFields: { description?: string; tags?: string[]; rating?: number }; modelVersion: string }
    | { assetId: string; reason: string }
    | { assetId: string; queued: true; enqueued: number }
  >>;
  analyzeAssets(input: {
    libraryId: string;
    assetIds: string[];
  }): Promise<LibraryApiResult<{
    assetIds: string[];
    jobIds: string[];
    skippedAssetIds: string[];
    enqueued: number;
  }>>;
  // Thumbnail & Preview
  // 多选菜单「AI分析未分析项」：返回选中里没有任何 AI 生成数据的资产。
  pendingAiAssets(input: {
    libraryId: string;
    assetIds: string[];
  }): Promise<LibraryApiResult<{ assetIds: string[] }>>;
  // artifactId is absent for model assets: no Worker raster generator exists
  // for them (Serpent-fu2i), so the no-op result carries no artifact.
  requestThumbnail(input: { libraryId: string; assetId: string }): Promise<LibraryApiResult<{ assetId: string; artifactId?: string }>>;
  /** Serpent-visible-window: queue-jump + header-probe the viewport assets. */
  reportVisibleWindow(input: { libraryId: string; assetIds: string[] }): Promise<void>;
  /** Serpent-xffq: 同步服务器列表（全局，Main 持有；密码不回传）。 */
  syncListServers(): Promise<LibraryApiResult<Array<{ id: string; baseUrl: string; username?: string; hasPassword: boolean; allowInsecureTls: boolean }>>>;
  /** Serpent-xffq: 保存/新增同步服务器（密码经 Main safeStorage 加密）。 */
  syncSaveServer(input: { id?: string; baseUrl: string; username?: string; password?: string; allowInsecureTls?: boolean }): Promise<LibraryApiResult<{ id: string }>>;
  /** Serpent-xffq: 删除同步服务器。 */
  syncDeleteServer(input: { id: string }): Promise<LibraryApiResult<{ id: string }>>;
  /** Serpent-xffq: 保存库绑定（服务器 + 可选同步文件夹名，默认库名；enabled=自动同步开关）。 */
  syncSaveBinding(input: { libraryId: string; serverId: string; directoryName?: string; enabled?: boolean }): Promise<LibraryApiResult<void>>;
  /** Serpent-xffq: 读取库绑定。 */
  syncGetBinding(input: { libraryId: string }): Promise<LibraryApiResult<{ serverId: string; directoryName?: string; lastSyncedAt?: string; enabled?: boolean } | null>>;
  /** Serpent-xffq: 对指定服务器做连接能力探测（不触碰库）。 */
  syncProbe(input: { serverId: string }): Promise<LibraryApiResult<SyncCapabilities>>;
  /** Serpent-xffq: 列出服务器上可打开的同步库（读远端 manifest）。 */
  syncListRemoteLibraries(input: { serverId: string }): Promise<LibraryApiResult<Array<{ libraryId: string; displayName: string; directoryName: string }>>>;
  /** Serpent-xffq: 从服务器拉取远端库并创建本地库（Main 选择保存位置）。 */
  syncOpenRemoteLibrary(input: { serverId: string; libraryId: string; displayName: string; directoryName: string }): Promise<LibraryApiResult<RendererLibrarySummary>>;
  /** Serpent-xffq: 首次同步差异预览（不写任何内容）。 */
  syncPreview(input: { libraryId: string; serverId: string; directoryName?: string }): Promise<LibraryApiResult<SyncReport>>;
  /** Serpent-xffq: 执行完整双向同步。 */
  syncRun(input: { libraryId: string; serverId: string; directoryName?: string }): Promise<LibraryApiResult<{ report: SyncReport; conflicts: Array<{ syncId: string; conflictCopyPath: string }> }>>;
  requestPreview(input: { libraryId: string; assetId: string; mode: 'client' | 'fullscreen'; intent?: 'viewer' | 'hover' | 'proxy-fallback'; exrPlane?: number; colorSpace?: string }): Promise<LibraryApiResult<PreviewResolution>>;
  closePreview(input: { libraryId: string; assetId: string }): Promise<LibraryApiResult<void>>;
  // 3D viewer (slice C, Serpent-qvc6): companion-texture index for model
  // previews. Only library-relative paths + ids; no absolute paths.
  resolveModelCompanions(input: { libraryId: string; assetId: string }): Promise<LibraryApiResult<ModelCompanionAsset[]>>;
  /** FBX→GLB conversion; `failed` results carry a typed error code for fallback routing. */
  convertModelFbx(input: { libraryId: string; assetId: string }): Promise<LibraryApiResult<FbxConversionResult>>;
  reportPreviewError(input: { libraryId: string; assetId: string; errorCode: string; detail?: string }): Promise<LibraryApiResult<void>>;
  openExternal(input: { libraryId: string; assetId: string }): Promise<LibraryApiResult<void>>;
  /** Open asset with a user-chosen application (macOS picker / Windows Open With). */
  openWith(input: { libraryId: string; assetId: string }): Promise<LibraryApiResult<void>>;
  revealInFolder(input: { libraryId: string; assetId: string }): Promise<LibraryApiResult<void>>;
  copyFilePath(input: { libraryId: string; assetId: string }): Promise<LibraryApiResult<void>>;
  /** OS file clipboard copy for one or more assets (Finder/Explorer interoperable). */
  copyAssetFiles(input: {
    libraryId: string;
    assetIds: string[];
  }): Promise<LibraryApiResult<void>>;
  /** Start an OS-native file drag from the current dragstart event. */
  startAssetDrag(input: {
    libraryId: string;
    assetIds: string[];
  }): void;
  // Folder shell actions (REQ-MENU-006): folder id only crosses the bridge;
  // the absolute path is resolved by the Worker and consumed by Main.
  openFolderInFileManager(input: { libraryId: string; folderId: string }): Promise<LibraryApiResult<void>>;
  openFolderWith(input: { libraryId: string; folderId: string }): Promise<LibraryApiResult<void>>;
  copyFolderPath(input: { libraryId: string; folderId: string }): Promise<LibraryApiResult<void>>;
  retryArtifact(input: { libraryId: string; assetId: string; kind: 'thumbnail' | 'webm_proxy' | 'audio_proxy' }): Promise<LibraryApiResult<{ assetId: string; kind: string }>>;
  listMediaJobs(input: { libraryId: string }): Promise<LibraryApiResult<MediaJobStatus>>;
  pauseMediaJobs(input: { libraryId: string; jobIds?: string[] }): Promise<LibraryApiResult<{ pausedCount: number }>>;
  resumeMediaJobs(input: { libraryId: string; jobIds?: string[] }): Promise<LibraryApiResult<{ resumedCount: number }>>;
  cancelMediaJobs(input: { libraryId: string; jobIds?: string[] }): Promise<LibraryApiResult<{ cancelledCount: number }>>;
  retryMediaJobs(input: { libraryId: string; jobIds: string[] }): Promise<LibraryApiResult<{ retriedCount: number }>>;
  listPluginJobs(input: { libraryId: string }): Promise<LibraryApiResult<PluginJobStatus>>;
  onThumbnailEvent(listener: (event: { type: 'asset.thumbnail.ready' | 'asset.thumbnail.failed' | 'asset.dimensions.ready' | 'asset.derived.ready'; libraryId: string; assetId: string; artifactId?: string; errorCode?: string; reason?: string; width?: number; height?: number; durationMs?: number; kind?: 'extract_metadata' | 'extract_palette' | 'generate_contact_sheet' | 'generate_webm_proxy' | 'generate_audio_proxy' }) => void): () => void;
  // AI extended
  testAiConnection(input: {
    apiFormat: AiApiFormat;
    model: string;
    apiKey?: string;
    baseUrl?: string;
  }): Promise<LibraryApiResult<{ success: boolean; errorKind?: string; reason?: string }>>;
  listAiModels(input: {
    apiFormat: AiApiFormat;
    apiKey?: string;
    baseUrl?: string;
  }): Promise<LibraryApiResult<{ models: string[]; errorKind?: string; reason?: string }>>;
  clearAiContent(input: { libraryId: string; scope: { kind: 'asset' | 'selection' | 'folder' | 'library'; assetIds?: string[]; folderId?: string }; confirm: boolean; fields?: Array<'description' | 'rating' | 'tags'> }): Promise<LibraryApiResult<{ clearedCount: number }>>;
  pauseAiJobs(input: { libraryId: string; jobIds?: string[] }): Promise<LibraryApiResult<{ pausedCount: number }>>;
  resumeAiJobs(input: { libraryId: string; jobIds?: string[] }): Promise<LibraryApiResult<{ resumedCount: number }>>;
  cancelAiJobs(input: { libraryId: string; jobIds?: string[] }): Promise<LibraryApiResult<{ cancelledCount: number }>>;
  retryAiJobs(input: { libraryId: string; jobIds: string[] }): Promise<LibraryApiResult<{ retriedCount: number }>>;
  getAiJobStatus(input: {
    libraryId: string;
    jobIds?: string[];
  }): Promise<LibraryApiResult<AiJobStatus>>;
  onAiProgress(listener: (event: {
    type: 'ai.progress';
    libraryId: string;
    queued: number;
    running: number;
    succeeded: number;
    failed: number;
  }) => void): () => void;
  onAiCompleted(listener: (event: { type: 'ai.analysis.completed'; libraryId: string; assetId: string; fieldCount: number; tagCount: number }) => void): () => void;
  onAiCleared(listener: (event: { type: 'ai.content.cleared'; libraryId: string; affectedAssetCount: number; affectedAssetIds: string[] }) => void): () => void;
}
