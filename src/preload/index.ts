import { contextBridge, ipcRenderer, webUtils } from 'electron';

import type { AiJobStatus, LibraryApiResult, LinkedAssetDeleteResult, MediaJobStatus, PreviewResolution, SerpentLibraryApi } from '../shared/library-api';
import type { RecentLibraryEntry } from '../shared/recent-libraries';
import type { AiApiFormat } from '../shared/ai-endpoints';
import type { AiReliabilitySettings } from '../shared/ai-reliability';
import { searchQuerySchema } from '../shared/asset-types';
import type { AiSearchPlan, AssetSummary, AssetMetadataResult, ExtractedMetadataResult, CollectionSummary, FilterClause, FolderBrowseEntry, LinkedFolderRule, LinkedFolderSummary, ManagedFolderSummary, SearchQuery, SearchScope, SmartCollectionSummary, TagCooccurrenceGraph, TagSummary, TrashedFolderSummary } from '../shared/asset-types';
import {
  ASSET_CHANGE_CHANNEL,
  EXTENSION_SAVE_COMPLETED_CHANNEL,
  THUMBNAIL_CHANNEL,
  ACTIVE_CONTEXT_CHANNEL,
  APP_LOCALE_CHANNEL,
  LIBRARY_LIFECYCLE_CHANNEL,
  LIBRARY_REQUEST_CHANNEL,
  PROGRESS_CHANNEL,
  AI_PROGRESS_CHANNEL,
  AI_COMPLETED_CHANNEL,
  AI_CLEARED_CHANNEL,
  OPEN_EXTERNAL_URL_CHANNEL,
  REVEAL_APP_LOG_CHANNEL,
  SHOW_EDIT_CONTEXT_MENU_CHANNEL,
  SHELL_SWIPE_CHANNEL,
  WINDOW_FOCUS_CHANNEL,
  INVERT_SELECTION_CHANNEL,
  COPY_SELECTION_CHANNEL,
  NATIVE_EDIT_COPY_CHANNEL,
  WINDOW_CONTROL_CHANNEL,
  WINDOW_MAXIMIZED_CHANNEL,
} from '../shared/protocol/channels';
import {
  parseOpenExternalUrlResult,
  type RevealAppLogResult,
  type SerpentShellApi,
  type ShellSwipeDirection,
} from '../shared/external-url';
import { parseShowEditContextMenuResult } from '../shared/edit-context-menu';
import {
  parseWindowControlResult,
  parseWindowMaximizedStateEvent,
  type WindowControlAction,
} from '../shared/window-controls';
import type { RendererRequest } from '../shared/protocol/requests';
import type { PublicErrorReason } from '../shared/protocol/errors';
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
  type ExtensionSaveCompletedEvent,
  parseExtensionSaveCompletedEvent,
  type ExportProgressEvent,
  parseExportProgressEvent,
  type ImportProgressEvent,
  parseImportProgressEvent,
  type TagOperationSkip,
} from '../shared/protocol/responses';
import type {
  NameConflictDecision,
  SuspectedDuplicateDecision,
} from '../shared/protocol/requests';
import { createPublicError } from '../shared/protocol/errors';
import { resolveDroppedFilePaths } from './dropped-files';
import { extractWebMediaDrop } from './web-media-drop';

const e2eEnabled = process.env.SERPENT_E2E === '1';
if (e2eEnabled) {
  const e2eLocale = process.env.SERPENT_E2E_LOCALE === 'en' ? 'en' : 'zh-CN';
  (globalThis as { __SERPENT_E2E_LOCALE__?: string }).__SERPENT_E2E_LOCALE__ =
    e2eLocale;
  // Default dark so system-theme preference stays visually stable in CI.
  const e2eTheme = process.env.SERPENT_E2E_THEME === 'light' ? 'light' : 'dark';
  (globalThis as { __SERPENT_E2E_THEME__?: string }).__SERPENT_E2E_THEME__ =
    e2eTheme;
}

const requestCounts = new Map<RendererRequest['type'], number>();

async function request(command: RendererRequest): Promise<RendererResult> {
  if (e2eEnabled) {
    requestCounts.set(command.type, (requestCounts.get(command.type) ?? 0) + 1);
  }
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

  async listRecent(): Promise<LibraryApiResult<RecentLibraryEntry[]>> {
    const result = await request({ type: 'library.list-recent.request' });
    if (!result.ok) return failure(result);
    if (result.type !== 'library.recent-list') throw new Error('Unexpected list-recent-libraries response.');
    return { ok: true as const, value: result.libraries };
  },

  async openRecent({ path }: { path: string }): Promise<LibraryApiResult<RendererLibrarySummary>> {
    const result = await request({ type: 'library.open-recent.request', libraryPath: path });
    if (!result.ok) return failure(result);
    if (result.type !== 'library.opened') throw new Error('Unexpected open-recent-library response.');
    return { ok: true as const, value: result.library };
  },

  async forgetRecent({ path }: { path: string }): Promise<LibraryApiResult<{ path: string }>> {
    const result = await request({ type: 'library.forget-recent.request', libraryPath: path });
    if (!result.ok) return failure(result);
    if (result.type !== 'library.forgotten') {
      throw new Error('Unexpected forget-recent-library response.');
    }
    return { ok: true as const, value: { path: result.libraryPath } };
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

  async deleteLibraryFromDisk({
    libraryId,
  }: {
    libraryId: string;
  }): Promise<LibraryApiResult<{ libraryId: string; displayName: string }>> {
    const result = await request({ type: 'library.delete-from-disk.request', libraryId });
    if (!result.ok) return failure(result);
    if (result.type !== 'library.deleted') {
      throw new Error('Unexpected delete-library response.');
    }
    return {
      ok: true as const,
      value: { libraryId: result.libraryId, displayName: result.displayName },
    };
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

  async renameFolder(input: {
    libraryId: string;
    folderId: string;
    newName: string;
  }): Promise<LibraryApiResult<ManagedFolderSummary>> {
    const result = await request({ type: 'folder.rename.request', ...input });
    if (!result.ok) return failure(result);
    if (result.type !== 'folder.renamed') throw new Error('Unexpected rename-folder response.');
    return { ok: true, value: result.folder };
  },

  async copyFolder({ libraryId, folderId }: { libraryId: string; folderId: string }): Promise<LibraryApiResult<void>> {
    const result = await request({ type: 'folder.copy.request', libraryId, folderId });
    if (!result.ok) return failure(result);
    return { ok: true, value: undefined };
  },

  async pasteIntoFolder(input: {
    libraryId: string;
    folderId: string;
  }): Promise<LibraryApiResult<ImportCompletion | ImportConflictPlan>> {
    return importRequest({ type: 'folder.paste.request', ...input });
  },

  async cloneFolder(input: {
    libraryId: string;
    folderId: string;
  }): Promise<
    LibraryApiResult<{
      folder: ManagedFolderSummary;
      clonedFolderCount: number;
      clonedAssetCount: number;
    }>
  > {
    const result = await request({ type: 'folder.clone.request', ...input });
    if (!result.ok) return failure(result);
    if (result.type !== 'folder.cloned') throw new Error('Unexpected clone-folder response.');
    return {
      ok: true,
      value: {
        folder: result.folder,
        clonedFolderCount: result.clonedFolderCount,
        clonedAssetCount: result.clonedAssetCount,
      },
    };
  },

  async moveFolders(input: {
    libraryId: string;
    folderIds: string[];
    targetParentFolderId: string | null;
    conflictStrategy?: 'keep-both' | 'skip';
  }): Promise<
    LibraryApiResult<{
      movedCount: number;
      skippedCount: number;
      folders: ManagedFolderSummary[];
    }>
  > {
    const result = await request({
      type: 'folder.move.request',
      libraryId: input.libraryId,
      folderIds: input.folderIds,
      targetParentFolderId: input.targetParentFolderId,
      conflictStrategy: input.conflictStrategy ?? 'keep-both',
    });
    if (!result.ok) return failure(result);
    if (result.type !== 'folder.moved') throw new Error('Unexpected move-folders response.');
    return {
      ok: true,
      value: {
        movedCount: result.movedCount,
        skippedCount: result.skippedCount,
        folders: result.folders,
      },
    };
  },

  async listFolders({ libraryId }: { libraryId: string }): Promise<LibraryApiResult<ManagedFolderSummary[]>> {
    const result = await request({ type: 'folder.list.request', libraryId });
    if (!result.ok) return failure(result);
    if (result.type !== 'folder.list') throw new Error('Unexpected list-folders response.');
    return { ok: true, value: result.folders };
  },

  async listFolderBrowseEntries(input: {
    libraryId: string;
    parentFolderId: string | null;
  }): Promise<LibraryApiResult<FolderBrowseEntry[]>> {
    const result = await request({
      type: 'folder.browse-entries.request',
      libraryId: input.libraryId,
      parentFolderId: input.parentFolderId,
    });
    if (!result.ok) return failure(result);
    if (result.type !== 'folder.browse-entries') {
      throw new Error('Unexpected list-folder-browse-entries response.');
    }
    return { ok: true, value: result.entries };
  },

  async trashFolder(input: {
    libraryId: string;
    folderId: string;
  }) {
    const result = await request({ type: 'folder.trash.request', ...input });
    if (!result.ok) return failure(result);
    if (result.type !== 'folder.trashed') throw new Error('Unexpected trash-folder response.');
    return {
      ok: true as const,
      value: {
        folderId: result.folderId,
        trashedAssetCount: result.trashedAssetCount,
        removedFolderCount: result.removedFolderCount,
      },
    };
  },

  async deleteFolderFromDisk(input: {
    libraryId: string;
    folderId: string;
  }) {
    const result = await request({ type: 'folder.delete-from-disk.request', ...input });
    if (!result.ok) return failure(result);
    if (result.type !== 'folder.deleted-from-disk') {
      throw new Error('Unexpected delete-folder-from-disk response.');
    }
    return {
      ok: true as const,
      value: {
        folderId: result.folderId,
        deletedAssetCount: result.deletedAssetCount,
        removedFolderCount: result.removedFolderCount,
      },
    };
  },

  async removeLinkedFolder(input: {
    libraryId: string;
    folderId: string;
  }) {
    const result = await request({ type: 'linked-folder.remove.request', ...input });
    if (!result.ok) return failure(result);
    if (result.type !== 'linked-folder.removed') {
      throw new Error('Unexpected remove-linked-folder response.');
    }
    return {
      ok: true as const,
      value: {
        folderId: result.folderId,
        removedAssetCount: result.removedAssetCount,
      },
    };
  },

  async deleteLinkedFolderSubtree(input: {
    libraryId: string;
    linkedFolderId: string;
    relativePath: string;
    deleteFromDisk: boolean;
  }) {
    const result = await request({
      type: 'linked-folder.delete-subtree.request',
      ...input,
    });
    if (!result.ok) return failure(result);
    if (result.type !== 'linked-folder.subtree-deleted') {
      throw new Error('Unexpected delete-linked-folder-subtree response.');
    }
    return {
      ok: true as const,
      value: {
        linkedFolderId: result.linkedFolderId,
        relativePath: result.relativePath,
        deletedAssetCount: result.deletedAssetCount,
        failedCount: result.failedCount,
      },
    };
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

  async importDropped(input: {
    libraryId: string;
    targetFolderId?: string;
    targetCollectionId?: string;
    files: File[];
    html?: string;
    uriList?: string;
  }): Promise<LibraryApiResult<ImportCompletion | ImportConflictPlan>> {
    // Native File handles always win. Browser drags can include text/html
    // beside Files; the secondary metadata must never turn a local import into
    // a network request.
    if (input.files.length === 0) {
      try {
        const extracted = extractWebMediaDrop({
          html: input.html ?? '',
          uriList: input.uriList ?? '',
        });
        return importRequest({
          type: 'asset.import-web.request',
          libraryId: input.libraryId,
          targetFolderId: input.targetFolderId,
          targetCollectionId: input.targetCollectionId,
          ...extracted,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        const parserFailure = message === 'WEB_MEDIA_URL_INVALID' || message === 'WEB_MEDIA_DROP_TOO_LARGE'
          ? message
          : 'WEB_MEDIA_NOT_FOUND';
        const result = await request({
          type: 'asset.import-web-invalid.report',
          libraryId: input.libraryId,
          failure: parserFailure,
        });
        return result.ok
          ? { ok: false, error: createPublicError(parserFailure) }
          : failure(result);
      }
    }
    try {
      const sourcePaths = resolveDroppedFilePaths(input.files, (file) => webUtils.getPathForFile(file));
      return importRequest({
        type: 'asset.import-drop.request',
        libraryId: input.libraryId,
        targetFolderId: input.targetFolderId,
        targetCollectionId: input.targetCollectionId,
        sourcePaths,
      });
    } catch {
      // Main owns persistent diagnostics. Report only the semantic failure;
      // no File object or attempted path crosses back to Renderer.
      const result = await request({ type: 'asset.import-drop-invalid.report', libraryId: input.libraryId });
      return result.ok
        ? { ok: false, error: createPublicError('INVALID_DROP_SELECTION') }
        : failure(result);
    }
  },

  async pasteClipboardImage(input: {
    libraryId: string;
    targetFolderId?: string;
    targetCollectionId?: string;
  }): Promise<LibraryApiResult<ImportCompletion | ImportConflictPlan>> {
    return importRequest({ type: 'asset.import-clipboard.request', ...input });
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

  async getLinkedFolderRules({ libraryId, folderId }: { libraryId: string; folderId: string }) {
    const result = await request({ type: 'linked-folder.rules.get.request', libraryId, folderId });
    if (!result.ok) return failure(result);
    if (result.type !== 'linked-folder.rules') throw new Error('Unexpected linked-folder-rules response.');
    return { ok: true as const, value: result.rules };
  },

  async setLinkedFolderRules({ libraryId, folderId, rules }: { libraryId: string; folderId: string; rules: LinkedFolderRule[] }) {
    const result = await request({ type: 'linked-folder.rules.set.request', libraryId, folderId, rules });
    if (!result.ok) return failure(result);
    if (result.type !== 'linked-folder.rules.updated') throw new Error('Unexpected linked-folder-rules-updated response.');
    return { ok: true as const, value: { rules: result.rules, hiddenCount: result.hiddenCount, restoredCount: result.restoredCount } };
  },

  async copyAssetsToLinkedFolder({ libraryId, folderId, assetIds, conflictStrategy }: { libraryId: string; folderId: string; assetIds: string[]; conflictStrategy: 'keep-both' | 'replace' | 'skip' }) {
    const result = await request({ type: 'linked-folder.assets.copy.request', libraryId, folderId, assetIds, conflictStrategy });
    if (!result.ok) return failure(result);
    if (result.type !== 'linked-folder.assets.copied') throw new Error('Unexpected linked-folder-assets-copied response.');
    return { ok: true as const, value: { copiedCount: result.copiedCount, skippedCount: result.skippedCount, assets: result.assets } };
  },

  async convertLinkedFolderToManaged({ libraryId, folderId, targetFolderId }: { libraryId: string; folderId: string; targetFolderId?: string }) {
    const result = await request({ type: 'linked-folder.convert.request', libraryId, folderId, targetFolderId });
    if (!result.ok) return failure(result);
    if (result.type !== 'linked-folder.converted') throw new Error('Unexpected linked-folder-converted response.');
    return { ok: true as const, value: { managedFolderId: result.managedFolderId, convertedCount: result.convertedCount, assets: result.assets } };
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

  async deleteTags({ libraryId, tagIds }: { libraryId: string; tagIds: string[] }): Promise<LibraryApiResult<{ deletedTagIds: string[] }>> {
    const result = await request({ type: 'tag.delete-many.request', libraryId, tagIds });
    if (!result.ok) return failure(result);
    if (result.type !== 'tag.deleted-many') throw new Error('Unexpected delete-tags response.');
    return { ok: true, value: { deletedTagIds: result.deletedTagIds } };
  },

  async mergeTags({ libraryId, sourceTagIds, name }: { libraryId: string; sourceTagIds: string[]; name: string }): Promise<LibraryApiResult<TagSummary>> {
    const result = await request({ type: 'tag.merge.request', libraryId, sourceTagIds, name });
    if (!result.ok) return failure(result);
    if (result.type !== 'tag.merged') throw new Error('Unexpected merge-tags response.');
    return { ok: true, value: result.tag };
  },

  async getTagCooccurrenceGraph({ libraryId, minWeight, maxNodes, maxEdges }: { libraryId: string; minWeight?: number; maxNodes?: number; maxEdges?: number }): Promise<LibraryApiResult<TagCooccurrenceGraph>> {
    const result = await request({ type: 'tag.cooccurrence.request', libraryId, minWeight, maxNodes, maxEdges });
    if (!result.ok) return failure(result);
    if (result.type !== 'tag.cooccurrence') throw new Error('Unexpected tag-cooccurrence response.');
    return { ok: true, value: result.graph };
  },

  async assignTags({ libraryId, assetIds, tagIds }: { libraryId: string; assetIds: string[]; tagIds: string[] }): Promise<LibraryApiResult<{ assignedCount: number; skipped: TagOperationSkip[] }>> {
    const result = await request({ type: 'tag.assign.request', libraryId, assetIds, tagIds });
    if (!result.ok) return failure(result);
    if (result.type !== 'tag.assigned') throw new Error('Unexpected assign-tags response.');
    return { ok: true, value: { assignedCount: result.assignedCount, skipped: result.skipped } };
  },

  async removeTags({ libraryId, assetIds, tagIds }: { libraryId: string; assetIds: string[]; tagIds: string[] }): Promise<LibraryApiResult<{ removedCount: number; skipped: TagOperationSkip[] }>> {
    const result = await request({ type: 'tag.remove.request', libraryId, assetIds, tagIds });
    if (!result.ok) return failure(result);
    if (result.type !== 'tag.removed') throw new Error('Unexpected remove-tags response.');
    return { ok: true, value: { removedCount: result.removedCount, skipped: result.skipped } };
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

  async updateCollection({ libraryId, collectionId, name, description, coverAssetId, position }: { libraryId: string; collectionId: string; name?: string; description?: string | null; coverAssetId?: string | null; position?: number }): Promise<LibraryApiResult<CollectionSummary>> {
    const result = await request({ type: 'collection.update.request', libraryId, collectionId, name, description, coverAssetId, position });
    if (!result.ok) return failure(result);
    if (result.type !== 'collection.updated') throw new Error('Unexpected update-collection response.');
    return { ok: true, value: result.collection };
  },

  async reorderCollections({ libraryId, orderedCollectionIds }: { libraryId: string; orderedCollectionIds: string[] }): Promise<LibraryApiResult<{ orderedCollectionIds: string[] }>> {
    const result = await request({ type: 'collection.reorder.request', libraryId, orderedCollectionIds });
    if (!result.ok) return failure(result);
    if (result.type !== 'collection.reordered') throw new Error('Unexpected reorder-collections response.');
    return { ok: true, value: { orderedCollectionIds: result.orderedCollectionIds } };
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

  async listAssetCollectionMemberships({ libraryId, assetIds }: { libraryId: string; assetIds: string[] }): Promise<LibraryApiResult<Array<{ assetId: string; collectionId: string }>>> {
    const result = await request({ type: 'collection.assets.memberships.request', libraryId, assetIds });
    if (!result.ok) return failure(result);
    if (result.type !== 'collection.assets.memberships') throw new Error('Unexpected list-asset-collection-memberships response.');
    return { ok: true, value: result.memberships };
  },

  async getAssetMetadata({ libraryId, assetId }: { libraryId: string; assetId: string }): Promise<LibraryApiResult<AssetMetadataResult>> {
    const result = await request({ type: 'asset.metadata.get.request', libraryId, assetId });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.metadata.got') throw new Error('Unexpected get-metadata response.');
    return { ok: true, value: result.metadata };
  },

  async getExtractedMetadata({ libraryId, assetId }: { libraryId: string; assetId: string }): Promise<LibraryApiResult<ExtractedMetadataResult>> {
    const result = await request({ type: 'asset.extracted-metadata.get.request', libraryId, assetId });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.extracted-metadata.got') throw new Error('Unexpected get-extracted-metadata response.');
    return { ok: true, value: result.result };
  },

  async setAssetMetadata({ libraryId, assetId, expectedVersion, description, rating, favorite, palette, sourcePageUrl, author }: { libraryId: string; assetId: string; expectedVersion: number; description?: string; rating?: number; favorite?: boolean; palette?: string[]; sourcePageUrl?: string; author?: string }): Promise<LibraryApiResult<AssetMetadataResult>> {
    const result = await request({ type: 'asset.metadata.set.request', libraryId, assetId, expectedVersion, description, rating, favorite, palette, sourcePageUrl, author });
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

  async setAssetsRating({ libraryId, assetIds, rating }: { libraryId: string; assetIds: string[]; rating: number }): Promise<LibraryApiResult<{ updatedCount: number; skipped: TagOperationSkip[] }>> {
    const result = await request({ type: 'asset.rating.set.request', libraryId, assetIds, rating });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.rating.updated') throw new Error('Unexpected set-assets-rating response.');
    return { ok: true, value: { updatedCount: result.updatedCount, skipped: result.skipped } };
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

  async searchAssets({ libraryId, query, filters, scope, sort, limit, offset }: { libraryId: string; query?: SearchQuery | null; filters?: FilterClause[]; scope?: SearchScope; sort?: { field: 'name' | 'modified_at' | 'created_at' | 'byte_size' | 'long_edge' | 'duration' | 'rating' | 'color' | 'author'; order: 'asc' | 'desc' }; limit?: number; offset?: number }): Promise<LibraryApiResult<{ items: AssetSummary[]; total: number; offset: number; snippets?: { assetId: string; text: string }[] }>> {
    const parsedQuery = searchQuerySchema.safeParse(query ?? null);
    if (!parsedQuery.success) {
      return { ok: false, error: createPublicError('INVALID_SEARCH_QUERY') };
    }
    const result = await request({ type: 'asset.search.request', libraryId, query: parsedQuery.data, filters, scope, sort, limit, offset });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.search.result') throw new Error('Unexpected search-assets response.');
    return { ok: true, value: { items: result.items, total: result.total, offset: result.offset, snippets: result.snippets } };
  },

  async planAiSearch({ naturalQuery }: { naturalQuery: string }): Promise<LibraryApiResult<{ plan: AiSearchPlan; apiFormat: AiApiFormat; model: string }>> {
    const result = await request({ type: 'ai.search-plan.request', naturalQuery });
    if (!result.ok) return failure(result);
    if (result.type !== 'ai.search-plan.result') throw new Error('Unexpected AI search-plan response.');
    return { ok: true, value: { plan: result.plan, apiFormat: result.apiFormat, model: result.model } };
  },

  async trashAssets({ libraryId, assetIds }: { libraryId: string; assetIds: string[] }): Promise<LibraryApiResult<{ trashedCount: number }>> {
    const result = await request({ type: 'asset.trash.request', libraryId, assetIds });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.trashed') throw new Error('Unexpected trash response.');
    return { ok: true, value: { trashedCount: result.trashedCount } };
  },

  async restoreAssets({ libraryId, assetIds, targetFolderId, conflictStrategy }: { libraryId: string; assetIds: string[]; targetFolderId?: string | null; conflictStrategy?: 'keep-both' | 'replace' | 'skip' }): Promise<LibraryApiResult<{ restoredCount: number; assets: AssetSummary[] }>> {
    const result = await request({ type: 'asset.restore.request', libraryId, assetIds, targetFolderId, conflictStrategy });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.restored') throw new Error('Unexpected restore response.');
    return { ok: true, value: { restoredCount: result.restoredCount, assets: result.assets } };
  },
  async moveAssets({ libraryId, assetIds, targetFolderId, conflictStrategy }: { libraryId: string; assetIds: string[]; targetFolderId: string | null; conflictStrategy?: 'keep-both' | 'replace' | 'skip' }): Promise<LibraryApiResult<{ movedCount: number; skippedCount: number; operationId: string | null; assets: AssetSummary[] }>> {
    const result = await request({ type: 'asset.move.request', libraryId, assetIds, targetFolderId, conflictStrategy });
    if (!result.ok) return result;
    if (result.type !== 'asset.moved') throw new Error('Unexpected move-assets response.');
    return { ok: true, value: { movedCount: result.movedCount, skippedCount: result.skippedCount, operationId: result.operationId, assets: result.assets } };
  },
  async undoMoveAssets({ libraryId, operationId, conflictStrategy }: { libraryId: string; operationId: string; conflictStrategy?: 'error' | 'keep-both' | 'replace' | 'skip' }): Promise<LibraryApiResult<{ undoneCount: number; skippedCount: number; assets: AssetSummary[] }>> {
    const result = await request({ type: 'asset.move-undo.request', libraryId, operationId, conflictStrategy });
    if (!result.ok) return result;
    if (result.type !== 'asset.move-undone') throw new Error('Unexpected undo-move response.');
    return { ok: true, value: { undoneCount: result.undoneCount, skippedCount: result.skippedCount, assets: result.assets } };
  },
  async copyAssets({ libraryId, assetIds, targetFolderId, conflictStrategy }: { libraryId: string; assetIds: string[]; targetFolderId: string | null; conflictStrategy?: 'keep-both' | 'replace' | 'skip' }): Promise<LibraryApiResult<{ copiedCount: number; skippedCount: number; operationId: string | null; assets: AssetSummary[] }>> {
    const result = await request({ type: 'asset.copy.request', libraryId, assetIds, targetFolderId, conflictStrategy });
    if (!result.ok) return result;
    if (result.type !== 'asset.copied') throw new Error('Unexpected copy-assets response.');
    return { ok: true, value: { copiedCount: result.copiedCount, skippedCount: result.skippedCount, operationId: result.operationId, assets: result.assets } };
  },
  async undoCopyAssets({ libraryId, operationId, conflictStrategy }: { libraryId: string; operationId: string; conflictStrategy?: 'error' | 'keep-both' | 'replace' | 'skip' }): Promise<LibraryApiResult<{ undoneCount: number; skippedCount: number; assets: AssetSummary[] }>> {
    const result = await request({ type: 'asset.copy-undo.request', libraryId, operationId, conflictStrategy });
    if (!result.ok) return result;
    if (result.type !== 'asset.copy-undone') throw new Error('Unexpected undo-copy response.');
    return { ok: true, value: { undoneCount: result.undoneCount, skippedCount: result.skippedCount, assets: result.assets } };
  },

  async renameAssetFile({ libraryId, assetId, newBaseName }: { libraryId: string; assetId: string; newBaseName: string }): Promise<LibraryApiResult<AssetSummary>> {
    const result = await request({ type: 'asset.rename-file.request', libraryId, assetId, newBaseName });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.file-renamed') throw new Error('Unexpected rename-asset-file response.');
    return { ok: true, value: result.asset };
  },

  async readTextAsset({ libraryId, assetId, maxBytes }: { libraryId: string; assetId: string; maxBytes?: number }) {
    const result = await request({ type: 'asset.text.read.request', libraryId, assetId, maxBytes });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.text.read') throw new Error('Unexpected text-read response.');
    return {
      ok: true as const,
      value: {
        assetId: result.assetId,
        revisionId: result.revisionId,
        content: result.content,
        truncated: result.truncated,
        byteSize: result.byteSize,
        lineCount: result.lineCount,
        editable: result.editable,
        mimeType: result.mimeType,
      },
    };
  },

  async saveTextAsset({ libraryId, assetId, content, expectedRevisionId, createRevision }: { libraryId: string; assetId: string; content: string; expectedRevisionId?: string; createRevision?: boolean }) {
    const result = await request({ type: 'asset.text.save.request', libraryId, assetId, content, expectedRevisionId, createRevision });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.text.saved') throw new Error('Unexpected text-save response.');
    return {
      ok: true as const,
      value: {
        asset: result.asset,
        revisionId: result.revisionId,
        byteSize: result.byteSize,
        lineCount: result.lineCount,
      },
    };
  },

  async deleteAssetsPermanent({ libraryId, assetIds }: { libraryId: string; assetIds: string[] }): Promise<LibraryApiResult<{ deletedCount: number; skippedCount: number; skippedReasons: Array<{ assetId: string; reason: PublicErrorReason }> }>> {
    const result = await request({ type: 'asset.delete-permanent.request', libraryId, assetIds });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.deleted-permanent') throw new Error('Unexpected delete-permanent response.');
    return { ok: true, value: { deletedCount: result.deletedCount, skippedCount: result.skippedCount, skippedReasons: result.skippedReasons } };
  },

  async deleteAssetsFromDisk({ libraryId, assetIds }: { libraryId: string; assetIds: string[] }): Promise<LibraryApiResult<{ deletedCount: number }>> {
    const result = await request({ type: 'asset.delete-from-disk.request', libraryId, assetIds });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.deleted-from-disk') throw new Error('Unexpected delete-from-disk response.');
    return { ok: true, value: { deletedCount: result.deletedCount } };
  },

  async listTrash({ libraryId }: { libraryId: string }): Promise<LibraryApiResult<AssetSummary[]>> {
    const result = await request({ type: 'trash.list.request', libraryId });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.list-trash') throw new Error('Unexpected list-trash response.');
    return { ok: true, value: result.assets };
  },

  async listTrashedFolders({ libraryId }: { libraryId: string }): Promise<LibraryApiResult<TrashedFolderSummary[]>> {
    const result = await request({ type: 'trash.list-folders.request', libraryId });
    if (!result.ok) return failure(result);
    if (result.type !== 'folder.list-trashed') throw new Error('Unexpected list-trashed-folders response.');
    return { ok: true, value: result.folders };
  },

  async restoreTrashedManagedFolder({
    libraryId,
    tombstoneId,
  }: {
    libraryId: string;
    tombstoneId: string;
  }): Promise<LibraryApiResult<{
    restoredFolderCount: number;
    restoredAssetCount: number;
    folders: ManagedFolderSummary[];
  }>> {
    const result = await request({
      type: 'trash.restore-folder.request',
      libraryId,
      tombstoneId,
    });
    if (!result.ok) return failure(result);
    if (result.type !== 'folder.restored-trashed') {
      throw new Error('Unexpected restore-trashed-folder response.');
    }
    return {
      ok: true,
      value: {
        restoredFolderCount: result.restoredFolderCount,
        restoredAssetCount: result.restoredAssetCount,
        folders: result.folders,
      },
    };
  },

  async purgeTrash({ libraryId }: { libraryId: string }): Promise<LibraryApiResult<{ purgedCount: number; skippedCount: number; failures: Array<{ assetId: string; reason: PublicErrorReason }> }>> {
    const result = await request({ type: 'trash.purge.request', libraryId });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.purge-trash') throw new Error('Unexpected purge-trash response.');
    return { ok: true, value: { purgedCount: result.purgedCount, skippedCount: result.skippedCount, failures: result.failures } };
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

  async relinkAsset({ libraryId, assetId }: { libraryId: string; assetId: string }): Promise<LibraryApiResult<import('../shared/library-api').RelinkAssetResult>> {
    const result = await request({ type: 'asset.relink.request', libraryId, assetId });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.relinked') throw new Error('Unexpected relink response.');
    return {
      ok: true,
      value: {
        asset: result.asset,
        batchFollowUpRoot: result.batchFollowUpRoot,
      },
    };
  },

  async relinkBatchPreview({ libraryId, keepMetadata }: { libraryId: string; keepMetadata: boolean }) {
    const result = await request({ type: 'asset.relink-batch.request', libraryId, keepMetadata });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.relink-batch.preview') throw new Error('Unexpected relink-batch-preview response.');
    return { ok: true as const, value: { previewId: result.previewId, matchedCount: result.matchedCount, unmatchedCount: result.unmatchedCount, totalCount: result.totalCount, examples: result.examples } };
  },

  async relinkBatchPreviewAtRoot({
    libraryId,
    newRootPath,
    keepMetadata,
  }: {
    libraryId: string;
    newRootPath: string;
    keepMetadata: boolean;
  }) {
    const result = await request({
      type: 'asset.relink-batch.preview-at-root.request',
      libraryId,
      newRootPath,
      keepMetadata,
    });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.relink-batch.preview') throw new Error('Unexpected relink-batch-preview response.');
    return {
      ok: true as const,
      value: {
        previewId: result.previewId,
        matchedCount: result.matchedCount,
        unmatchedCount: result.unmatchedCount,
        totalCount: result.totalCount,
        examples: result.examples,
      },
    };
  },

  async relinkBatchApply({ libraryId, previewId, keepMetadata }: { libraryId: string; previewId: string; keepMetadata: boolean }) {
    const result = await request({ type: 'asset.relink-batch.apply.request', libraryId, previewId, keepMetadata });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.relink-batch.applied') throw new Error('Unexpected relink-batch-apply response.');
    return { ok: true as const, value: { restoredCount: result.restoredCount, unchangedMissingCount: result.unchangedMissingCount, assets: result.assets } };
  },

  async cancelRelinkBatch({ libraryId, previewId }: { libraryId: string; previewId: string }) {
    const result = await request({ type: 'asset.relink-batch.cancel.request', libraryId, previewId });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.relink-batch.cancelled') throw new Error('Unexpected relink-batch-cancel response.');
    return { ok: true as const, value: { previewId: result.previewId } };
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

  onExtensionSaveCompleted(listener: (event: ExtensionSaveCompletedEvent) => void) {
    const subscription = (_event: Electron.IpcRendererEvent, input: unknown) => {
      listener(parseExtensionSaveCompletedEvent(input));
    };
    ipcRenderer.on(EXTENSION_SAVE_COMPLETED_CHANNEL, subscription);
    return () =>
      ipcRenderer.removeListener(EXTENSION_SAVE_COMPLETED_CHANNEL, subscription);
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
    };
    languages: Array<'zh-CN' | 'en' | 'ja' | 'ko'>;
    concurrencyLimit: number;
    maxAnalysisImageEdgePx: number;
    reliabilitySettings: AiReliabilitySettings;
    autoAnalyzeEnabled: boolean;
    disclaimerAccepted: boolean;
  }>> {
    const result = await request({ type: 'ai.config.get.request' });
    if (!result.ok) return failure(result);
    if (result.type !== 'ai.config.got') throw new Error('Unexpected ai-config response.');
    return { ok: true, value: result };
  },

  async setAiConfig(input: {
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
    };
    languages?: Array<'zh-CN' | 'en' | 'ja' | 'ko'>;
    concurrencyLimit?: number;
    maxAnalysisImageEdgePx?: number;
    reliabilitySettings?: AiReliabilitySettings;
    autoAnalyzeEnabled: boolean;
    disclaimerAccepted: boolean;
  }): Promise<LibraryApiResult<void>> {
    const result = await request({ type: 'ai.config.set.request', ...input });
    if (!result.ok) return failure(result);
    if (result.type !== 'ai.config.saved') throw new Error('Unexpected ai-config-save response.');
    return { ok: true, value: undefined };
  },

  async getAiContent(input: {
    libraryId: string;
    assetId: string;
  }): Promise<LibraryApiResult<{
    assetId: string;
    description: string | null;
    tags: string[];
    rating: number | null;
    modelVersion: string | null;
  }>> {
    const result = await request({
      type: 'ai.content.get.request',
      libraryId: input.libraryId,
      assetId: input.assetId,
    });
    if (!result.ok) return failure(result);
    if (result.type !== 'ai.content.got') throw new Error('Unexpected ai-content response.');
    return { ok: true, value: result };
  },

  async analyzeAsset(input: {
    libraryId: string;
    assetId: string;
  }): Promise<LibraryApiResult<
    | {
        assetId: string;
        generatedFields: {
          description?: string;
          tags?: string[];
          rating?: number;
        };
        modelVersion: string;
      }
    | { assetId: string; reason: string }
    | { assetId: string; queued: true; enqueued: number }
  >> {
    const result = await request({ type: 'asset.analyze.request', libraryId: input.libraryId, assetId: input.assetId });
    if (!result.ok) return failure(result);
    if (result.type === 'asset.analyze-queued') {
      return {
        ok: true,
        value: {
          assetId: result.assetId,
          queued: true,
          enqueued: result.enqueued,
        },
      };
    }
    if (result.type === 'asset.analyzed' || result.type === 'asset.analyze-unsupported') return { ok: true, value: result };
    throw new Error('Unexpected analyze response.');
  },

  async analyzeAssets(input: {
    libraryId: string;
    assetIds: string[];
  }): Promise<LibraryApiResult<{
    assetIds: string[];
    jobIds: string[];
    skippedAssetIds: string[];
    enqueued: number;
  }>> {
    const result = await request({
      type: 'assets.analyze.request',
      libraryId: input.libraryId,
      assetIds: input.assetIds,
    });
    if (!result.ok) return failure(result);
    if (result.type !== 'assets.analyze-queued') {
      throw new Error('Unexpected batch analyze response.');
    }
    return {
      ok: true,
      value: {
        assetIds: result.assetIds,
        jobIds: result.jobIds,
        skippedAssetIds: result.skippedAssetIds,
        enqueued: result.enqueued,
      },
    };
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
        ...(result.playbackMode ? { playbackMode: result.playbackMode } : {}),
        ...(result.sourceMimeType ? { sourceMimeType: result.sourceMimeType } : {}),
        ...(result.sourceContainer ? { sourceContainer: result.sourceContainer } : {}),
        ...(result.sourceCodecs ? { sourceCodecs: result.sourceCodecs } : {}),
        ...(result.playbackToken ? { playbackToken: result.playbackToken } : {}),
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

  async openWith({ libraryId, assetId }: { libraryId: string; assetId: string }): Promise<LibraryApiResult<void>> {
    const result = await request({ type: 'asset.open-with.request', libraryId, assetId });
    if (!result.ok) return failure(result);
    return { ok: true, value: undefined };
  },

  async revealInFolder({ libraryId, assetId }: { libraryId: string; assetId: string }): Promise<LibraryApiResult<void>> {
    const result = await request({ type: 'asset.reveal-in-folder.request', libraryId, assetId });
    if (!result.ok) return failure(result);
    return { ok: true, value: undefined };
  },

  async copyFilePath({ libraryId, assetId }: { libraryId: string; assetId: string }): Promise<LibraryApiResult<void>> {
    const result = await request({ type: 'asset.copy-file-path.request', libraryId, assetId });
    if (!result.ok) return failure(result);
    return { ok: true, value: undefined };
  },

  async copyAssetFiles({
    libraryId,
    assetIds,
  }: {
    libraryId: string;
    assetIds: string[];
  }): Promise<LibraryApiResult<void>> {
    const result = await request({
      type: 'asset.copy-files.request',
      libraryId,
      assetIds,
    });
    if (!result.ok) return failure(result);
    return { ok: true, value: undefined };
  },

  async openFolderInFileManager({ libraryId, folderId }: { libraryId: string; folderId: string }): Promise<LibraryApiResult<void>> {
    const result = await request({ type: 'folder.open-in-file-manager.request', libraryId, folderId });
    if (!result.ok) return failure(result);
    return { ok: true, value: undefined };
  },

  async openFolderWith({ libraryId, folderId }: { libraryId: string; folderId: string }): Promise<LibraryApiResult<void>> {
    const result = await request({ type: 'folder.open-with.request', libraryId, folderId });
    if (!result.ok) return failure(result);
    return { ok: true, value: undefined };
  },

  async copyFolderPath({ libraryId, folderId }: { libraryId: string; folderId: string }): Promise<LibraryApiResult<void>> {
    const result = await request({ type: 'folder.copy-path.request', libraryId, folderId });
    if (!result.ok) return failure(result);
    return { ok: true, value: undefined };
  },

  async retryArtifact({ libraryId, assetId, kind }: { libraryId: string; assetId: string; kind: 'thumbnail' | 'webm_proxy' }): Promise<LibraryApiResult<{ assetId: string; kind: string }>> {
    const result = await request({ type: 'asset.retry-artifact.request', libraryId, assetId, kind });
    if (!result.ok) return failure(result);
    if (result.type !== 'asset.retry-artifact.started') throw new Error('Unexpected retry-artifact response.');
    return { ok: true, value: { assetId: result.assetId, kind: result.kind } };
  },

  async listMediaJobs({ libraryId }: { libraryId: string }): Promise<LibraryApiResult<MediaJobStatus>> {
    const result = await request({ type: 'media.list-jobs.request', libraryId });
    if (!result.ok) return failure(result);
    if (result.type !== 'media.jobs.listed') throw new Error('Unexpected media list-jobs response.');
    const { queued, running, succeeded, failed, paused, cancelled, jobs } = result;
    return { ok: true, value: { queued, running, succeeded, failed, paused, cancelled, jobs } };
  },

  async pauseMediaJobs({ libraryId, jobIds }: { libraryId: string; jobIds?: string[] }): Promise<LibraryApiResult<{ pausedCount: number }>> {
    const result = await request({ type: 'media.pause-jobs.request', libraryId, jobIds });
    if (!result.ok) return failure(result);
    if (result.type !== 'media.jobs.paused') throw new Error('Unexpected media pause-jobs response.');
    return { ok: true, value: { pausedCount: result.pausedCount } };
  },

  async resumeMediaJobs({ libraryId, jobIds }: { libraryId: string; jobIds?: string[] }): Promise<LibraryApiResult<{ resumedCount: number }>> {
    const result = await request({ type: 'media.resume-jobs.request', libraryId, jobIds });
    if (!result.ok) return failure(result);
    if (result.type !== 'media.jobs.resumed') throw new Error('Unexpected media resume-jobs response.');
    return { ok: true, value: { resumedCount: result.resumedCount } };
  },

  async cancelMediaJobs({ libraryId, jobIds }: { libraryId: string; jobIds?: string[] }): Promise<LibraryApiResult<{ cancelledCount: number }>> {
    const result = await request({ type: 'media.cancel-jobs.request', libraryId, jobIds });
    if (!result.ok) return failure(result);
    if (result.type !== 'media.jobs.cancelled') throw new Error('Unexpected media cancel-jobs response.');
    return { ok: true, value: { cancelledCount: result.cancelledCount } };
  },

  async retryMediaJobs({ libraryId, jobIds }: { libraryId: string; jobIds: string[] }): Promise<LibraryApiResult<{ retriedCount: number }>> {
    const result = await request({ type: 'media.retry-jobs.request', libraryId, jobIds });
    if (!result.ok) return failure(result);
    if (result.type !== 'media.jobs.retried') throw new Error('Unexpected media retry-jobs response.');
    return { ok: true, value: { retriedCount: result.retriedCount } };
  },

  // AI test-connection
  async testAiConnection({
    apiFormat,
    model,
    apiKey,
    baseUrl,
  }: {
    apiFormat: AiApiFormat;
    model: string;
    apiKey?: string;
    baseUrl?: string;
  }): Promise<LibraryApiResult<{ success: boolean; errorKind?: string; reason?: string }>> {
    const result = await request({
      type: 'ai.test-connection.request',
      apiFormat,
      model,
      ...(apiKey?.trim() ? { apiKey: apiKey.trim() } : {}),
      ...(baseUrl?.trim() ? { baseUrl: baseUrl.trim() } : {}),
    });
    if (!result.ok) return failure(result);
    if (result.type !== 'ai.test-connection.result') throw new Error('Unexpected test-connection response.');
    return { ok: true, value: { success: result.success, errorKind: result.errorKind, reason: result.reason } };
  },

  async listAiModels({
    apiFormat,
    apiKey,
    baseUrl,
  }: {
    apiFormat: AiApiFormat;
    apiKey?: string;
    baseUrl?: string;
  }): Promise<LibraryApiResult<{ models: string[]; errorKind?: string; reason?: string }>> {
    const result = await request({
      type: 'ai.list-models.request',
      apiFormat,
      ...(apiKey?.trim() ? { apiKey: apiKey.trim() } : {}),
      ...(baseUrl?.trim() ? { baseUrl: baseUrl.trim() } : {}),
    });
    if (!result.ok) return failure(result);
    if (result.type !== 'ai.list-models.result') throw new Error('Unexpected list-models response.');
    return {
      ok: true,
      value: {
        models: result.models,
        errorKind: result.errorKind,
        reason: result.reason,
      },
    };
  },

  // AI clear-content
  async clearAiContent({ libraryId, scope, confirm, fields }: { libraryId: string; scope: { kind: 'asset' | 'selection' | 'folder' | 'library'; assetIds?: string[]; folderId?: string }; confirm: boolean; fields?: Array<'description' | 'rating' | 'tags'> }): Promise<LibraryApiResult<{ clearedCount: number }>> {
    const result = await request({
      type: 'ai.clear-content.request',
      libraryId,
      scope,
      confirm,
      ...(fields ? { fields } : {}),
    });
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

  async getAiJobStatus({
    libraryId,
    jobIds,
  }: {
    libraryId: string;
    jobIds?: string[];
  }): Promise<LibraryApiResult<AiJobStatus>> {
    const result = await request({
      type: 'ai.status.request',
      libraryId,
      ...(jobIds ? { jobIds } : {}),
    });
    if (!result.ok) return failure(result);
    if (result.type !== 'ai.jobs.status') throw new Error('Unexpected AI status response.');
    const { queued, running, succeeded, failed, paused, cancelled, jobs } = result;
    return { ok: true, value: { queued, running, succeeded, failed, paused, cancelled, jobs } };
  },

  // AI events
  onAiProgress(listener: (event: {
    type: 'ai.progress';
    libraryId: string;
    queued: number;
    running: number;
    succeeded: number;
    failed: number;
  }) => void) {
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

  onAiCleared(listener: (event: { type: 'ai.content.cleared'; libraryId: string; affectedAssetCount: number; affectedAssetIds: string[] }) => void) {
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
  command: Extract<RendererRequest, {
    type:
      | 'asset.import-files.request'
      | 'asset.import-folder.request'
      | 'asset.import-drop.request'
      | 'asset.import-web.request'
      | 'asset.import-clipboard.request'
      | 'folder.paste.request';
  }>,
): Promise<LibraryApiResult<ImportCompletion | ImportConflictPlan>> {
  const result = await request(command);
  if (!result.ok) return failure(result);
  if (result.type === 'asset.import.completed') return { ok: true, value: result.completion };
  if (result.type === 'asset.import.conflicts') return { ok: true, value: result.plan };
  if (result.type === 'extension.asset-saved') {
    return {
      ok: true,
      value: { importedCount: 1, skippedCount: 0, replacedCount: 0, assets: [result.asset] },
    };
  }
  throw new Error('Unexpected prepare-import response.');
}

const e2eDiagnostics = Object.freeze({
  getRequestCount(type: RendererRequest['type']): number {
    return requestCounts.get(type) ?? 0;
  },
});

function parseRevealAppLogResult(input: unknown): RevealAppLogResult {
  if (
    typeof input === 'object' &&
    input !== null &&
    'ok' in input &&
    (input as { ok: unknown }).ok === true
  ) {
    return { ok: true };
  }
  const code =
    typeof input === 'object' &&
    input !== null &&
    'code' in input &&
    typeof (input as { code: unknown }).code === 'string'
      ? (input as { code: string }).code
      : 'shell_failure';
  if (
    code === 'unauthorized_sender' ||
    code === 'log_missing' ||
    code === 'shell_failure'
  ) {
    return { ok: false, code };
  }
  return { ok: false, code: 'shell_failure' };
}

const shell: SerpentShellApi = Object.freeze({
  async openExternalUrl(url: string) {
    const result: unknown = await ipcRenderer.invoke(OPEN_EXTERNAL_URL_CHANNEL, { url });
    return parseOpenExternalUrlResult(result);
  },
  async revealAppLog() {
    const result: unknown = await ipcRenderer.invoke(REVEAL_APP_LOG_CHANNEL);
    return parseRevealAppLogResult(result);
  },
  setAppLocale(locale: 'zh-CN' | 'en'): void {
    ipcRenderer.send(APP_LOCALE_CHANNEL, { locale });
  },
  async showEditContextMenu(point: { x: number; y: number }) {
    const result: unknown = await ipcRenderer.invoke(
      SHOW_EDIT_CONTEXT_MENU_CHANNEL,
      point,
    );
    return parseShowEditContextMenuResult(result);
  },
  async windowControl(action: WindowControlAction) {
    const result: unknown = await ipcRenderer.invoke(WINDOW_CONTROL_CHANNEL, {
      action,
    });
    return parseWindowControlResult(result);
  },
  onWindowMaximizedChanged(listener: (maximized: boolean) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, input: unknown) => {
      const parsed = parseWindowMaximizedStateEvent(input);
      if (parsed) listener(parsed.maximized);
    };
    ipcRenderer.on(WINDOW_MAXIMIZED_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(WINDOW_MAXIMIZED_CHANNEL, handler);
    };
  },
  onSwipe(listener: (direction: ShellSwipeDirection) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, direction: unknown) => {
      if (
        direction === 'left' ||
        direction === 'right' ||
        direction === 'up' ||
        direction === 'down'
      ) {
        listener(direction);
      }
    };
    ipcRenderer.on(SHELL_SWIPE_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(SHELL_SWIPE_CHANNEL, handler);
    };
  },
  onWindowFocusChanged(listener: (focused: boolean) => void) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: unknown,
    ) => {
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'focused' in payload &&
        typeof (payload as { focused: unknown }).focused === 'boolean'
      ) {
        listener((payload as { focused: boolean }).focused);
      }
    };
    ipcRenderer.on(WINDOW_FOCUS_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(WINDOW_FOCUS_CHANNEL, handler);
    };
  },
  onInvertSelection(listener: () => void): () => void {
    const handler = () => {
      listener();
    };
    ipcRenderer.on(INVERT_SELECTION_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(INVERT_SELECTION_CHANNEL, handler);
    };
  },
  onCopySelection(listener: () => void): () => void {
    const handler = () => {
      listener();
    };
    ipcRenderer.on(COPY_SELECTION_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(COPY_SELECTION_CHANNEL, handler);
    };
  },
  async nativeEditCopy(): Promise<void> {
    await ipcRenderer.invoke(NATIVE_EDIT_COPY_CHANNEL);
  },
});

contextBridge.exposeInMainWorld(
  'serpent',
  Object.freeze({
    library,
    shell,
    ...(e2eEnabled ? { e2e: e2eDiagnostics } : {}),
  }),
);
