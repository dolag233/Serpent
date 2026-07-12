import type { PublicError } from './protocol/errors';
import type { AssetSummary, ManagedFolderSummary } from './asset-types';
import type {
  ImportCompletion,
  ImportConflictPlan,
  AssetChangeEvent,
  RendererLibrarySummary,
  RendererLifecycleEvent,
} from './protocol/responses';
import type {
  NameConflictDecision,
  SuspectedDuplicateDecision,
} from './protocol/requests';

export type LibraryApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: PublicError };

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
  onLifecycle(listener: (event: RendererLifecycleEvent) => void): () => void;
  onAssetsChanged(listener: (event: AssetChangeEvent) => void): () => void;
}
