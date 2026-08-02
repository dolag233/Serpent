// Generated from src/automation/command-registry.ts.
// Keep this file in sync with AUTOMATION_API_VERSION and the public Registry.
export {};

declare global {
  const AUTOMATION_API_VERSION: 1;

  type SerpentAutomationCommandId =
    | 'library.create'
    | 'file.import'
    | 'library.inspect'
    | 'library.change-sequence'
    | 'execution.status'
    | 'ui.notify'
    | 'folder.list'
    | 'linked-folder.list'
    | 'asset.list'
    | 'asset.metadata.get'
    | 'asset.ai-content.get'
    | 'asset.metadata.set'
    | 'asset.extracted-metadata.get'
    | 'asset.search'
    | 'asset.rating.set'
    | 'asset.paths.copy'
    | 'asset.trash'
    | 'asset.content.replace'
    | 'asset.content.stage'
    | 'asset.content.replace-batch'
    | 'asset.content.read'
    | 'asset.move'
    | 'asset.rename-file'
    | 'asset.rename-files'
    | 'asset.list-trash'
    | 'asset.restore-if-original-vacant'
    | 'asset.palette.aggregate-recent'
    | 'tag.list'
    | 'tag.create'
    | 'tag.assign'
    | 'tag.remove'
    | 'folder.create'
    | 'collection.list'
    | 'collection.create'
    | 'collection.assets.add'
    | 'collection.assets.remove'
    | 'collection.assets.memberships'
    | 'smart-collection.list'
    | 'media.jobs.list'
    | 'ai.jobs.status'
    | 'ai.enqueue';

  interface SerpentPage<T> {
    readonly items: readonly T[];
    readonly total: number;
    readonly offset: number;
    readonly limit: number;
    readonly hasMore: boolean;
  }

  interface SerpentAsset {
    readonly id: string;
    readonly name: string;
    /** Stable file-content revision; metadata edits do not change it. */
    readonly currentRevisionId: string;
    readonly rating: number;
    readonly favorite: boolean;
    readonly locationKind: 'managed' | 'linked';
    readonly folderId: string | null;
  }

  interface SerpentAssetMetadata {
    readonly assetId: string;
    readonly description: string | null;
    readonly rating: number;
    readonly favorite: boolean;
    readonly palette: string | null;
    readonly automaticPalette: readonly { readonly hex: string; readonly ratio: number }[];
    readonly effectivePalette: readonly string[];
    readonly paletteSource: 'manual' | 'automatic' | null;
    readonly sourcePageUrl: string | null;
    readonly author: string | null;
    readonly tags: readonly { readonly id: string; readonly name: string; readonly source: 'user' | 'ai' }[];
    readonly entityVersion: number;
    readonly updatedAt: string;
  }

  interface SerpentAiContent {
    readonly assetId: string;
    readonly description: string | null;
    readonly tags: readonly string[];
    readonly rating: number | null;
    readonly modelVersion: string | null;
  }

  interface SerpentLibrary {
    readonly libraryId: string;
    readonly displayName: string;
  }

  interface SerpentImportResult {
    readonly status: 'conflicts' | 'completed';
    readonly plan?: {
      readonly importId: string;
      readonly fileCount: number;
      readonly totalBytes: number;
      readonly suspectedDuplicateCount: number;
      readonly libraryDuplicateCount: number;
      readonly nameConflictCount: number;
    };
    readonly completion?: {
      readonly importedCount: number;
      readonly fileCount: number;
      readonly assetCount: number;
      readonly skippedCount: number;
      readonly replacedCount: number;
      readonly assets: readonly SerpentAsset[];
    };
  }

  interface SerpentAutomationApi {
    readonly library: {
      inspect(): Promise<SerpentLibrary>;
      changeSequence(): Promise<{ readonly changeSequence: number }>;
      create(input: {
        readonly displayName: string;
        readonly selectedParentPath: string;
        readonly idempotencyKey?: string;
      }): Promise<SerpentLibrary>;
    };
    readonly files: {
      import(input: {
        readonly sourceKind: 'files' | 'folder';
        readonly sourcePaths: readonly string[];
        readonly targetFolderId?: string;
        readonly imageSequenceFps?: number;
        readonly expandImageSequences?: boolean;
        readonly idempotencyKey?: string;
      }): Promise<SerpentImportResult>;
    };
    readonly folders: {
      list(input?: { readonly limit?: number; readonly offset?: number }): Promise<SerpentPage<{
        readonly id: string;
        readonly parentId: string | null;
        readonly name: string;
      }>>;
      create(name: string, parentFolderId?: string | null): Promise<{
        readonly id: string;
        readonly parentId: string | null;
        readonly name: string;
      }>;
    };
    readonly linkedFolders: {
      list(input?: { readonly limit?: number; readonly offset?: number }): Promise<SerpentPage<{
        readonly id: string;
        readonly name: string;
        readonly status: 'available' | 'offline';
        readonly assetCount: number;
      }>>;
    };
    readonly assets: {
      search(input: { readonly query: string | null; readonly limit?: number; readonly offset?: number }): Promise<SerpentPage<SerpentAsset>>;
      list(input?: { readonly folderId?: string; readonly recursive?: boolean; readonly limit?: number; readonly offset?: number }): Promise<SerpentPage<SerpentAsset>>;
      getMetadata(assetId: string): Promise<SerpentAssetMetadata>;
      getAiContent(assetId: string): Promise<SerpentAiContent>;
      readContent(assetId: string, options?: { readonly maxBytes?: number }): Promise<{
        readonly assetId: string;
        readonly revisionId: string;
        readonly byteSize: number;
        readonly dataBase64: string;
        readonly truncated: boolean;
        readonly mimeType: string | null;
      }>;
      replaceContent(assetId: string, dataBase64: string, options?: {
        readonly expectedRevisionId?: string;
        readonly mimeHint?: string;
      }): Promise<{ readonly assetId: string; readonly revisionId: string; readonly byteSize: number }>;
      stageContent(assetId: string, dataBase64: string, options?: {
        readonly stagingToken?: string;
        readonly complete?: boolean;
      }): Promise<{
        readonly stagingToken: string;
        readonly assetId: string;
        readonly byteSize: number;
        readonly complete: boolean;
      }>;
      replaceContentBatch(items: readonly (
        | { readonly assetId: string; readonly dataBase64: string; readonly expectedRevisionId: string }
        | { readonly assetId: string; readonly stagingToken: string; readonly expectedRevisionId: string }
      )[]): Promise<{
        readonly operationId: string;
        readonly items: readonly { readonly assetId: string; readonly revisionId: string; readonly byteSize: number }[];
      }>;
      /** expectedVersion is the metadata-row optimistic-concurrency token, not a file revision. */
      setMetadata(input: { readonly assetId: string; readonly expectedVersion: number; readonly description?: string | null; readonly rating?: 0 | 1 | 2 | 3 | 4 | 5; readonly favorite?: boolean; readonly sourcePageUrl?: string | null; readonly author?: string | null }): Promise<SerpentAssetMetadata>;
      getExtractedMetadata(assetId: string): Promise<unknown>;
      setRating(assetIds: readonly string[], rating: 0 | 1 | 2 | 3 | 4 | 5): Promise<unknown>;
      copyFilePaths(assetIds: readonly string[]): Promise<{ readonly copiedCount: number }>;
      moveToTrash(assetIds: readonly string[]): Promise<{ readonly trashedCount: number; readonly operationId: string }>;
      moveToFolder(assetIds: readonly string[], targetFolderId: string | null, options?: { readonly conflictStrategy?: 'keep-both' | 'replace' | 'skip' }): Promise<{ readonly movedCount: number; readonly skippedCount: number; readonly operationId: string | null }>;
      renameFile(assetId: string, newBaseName: string): Promise<unknown>;
      renameFiles(items: readonly { readonly assetId: string; readonly newBaseName: string }[]): Promise<unknown>;
    };
    readonly tags: {
      list(input?: { readonly limit?: number; readonly offset?: number }): Promise<SerpentPage<unknown>>;
      create(name: string): Promise<unknown>;
      assign(assetIds: readonly string[], tagIds: readonly string[]): Promise<unknown>;
      remove(assetIds: readonly string[], tagIds: readonly string[]): Promise<unknown>;
    };
    readonly collections: {
      list(input?: { readonly limit?: number; readonly offset?: number }): Promise<SerpentPage<unknown>>;
      getMemberships(assetIds: readonly string[], input?: { readonly limit?: number; readonly offset?: number }): Promise<SerpentPage<unknown>>;
      create(name: string, parentId?: string | null): Promise<unknown>;
      addAssets(collectionId: string, assetIds: readonly string[]): Promise<unknown>;
      removeAssets(collectionId: string, assetIds: readonly string[]): Promise<unknown>;
    };
    readonly smartCollections: {
      list(input?: { readonly limit?: number; readonly offset?: number }): Promise<SerpentPage<unknown>>;
    };
    readonly jobs: {
      readonly media: { list(input?: { readonly limit?: number; readonly offset?: number }): Promise<unknown> };
      readonly ai: {
        status(input?: { readonly jobIds?: readonly string[]; readonly limit?: number; readonly offset?: number }): Promise<unknown>;
        enqueue(input?: { readonly assetIds?: readonly string[]; readonly folderId?: string; readonly resumePaused?: boolean }): Promise<unknown>;
      };
    };
    readonly trash: {
      list(input?: { readonly limit?: number; readonly offset?: number }): Promise<SerpentPage<SerpentAsset>>;
      restoreIfOriginalVacant(assetIds: readonly string[]): Promise<unknown>;
    };
    readonly palettes: {
      mostFrequent(input?: { readonly days?: number; readonly limit?: number }): Promise<unknown>;
    };
    readonly ui: {
      notify(input: {
        readonly severity: 'info' | 'warning' | 'error';
        readonly message: string;
        readonly mode?: 'toast' | 'dialog';
        readonly title?: string;
      }): Promise<{
        readonly shown: true;
        readonly mode: 'toast' | 'dialog';
        readonly severity: 'info' | 'warning' | 'error';
      }>;
    };
  }

  const serpent: SerpentAutomationApi;
}
