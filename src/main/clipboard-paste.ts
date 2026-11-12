import path from 'node:path';
import { createPublicError } from '../shared/protocol/errors';
import type { WorkerCommand } from '../shared/protocol/requests';
import type { ImportCompletion, WorkerResult } from '../shared/protocol/responses';
import type { LibraryCommandBuildOutcome } from './library-request/command-outcome';
import type { FileClipboardSnapshot } from './asset-clipboard';

function pathApi(value: string) {
  return /^[a-z]:[\\/]|^\\\\/iu.test(value) ? path.win32 : path.posix;
}

function pathKey(value: string): string {
  const api = pathApi(value);
  const normalized = api.normalize(value).replaceAll('\\', '/').replace(/\/$/u, '');
  return api === path.win32 ? normalized.toLowerCase() : normalized;
}

export function clipboardPathWithin(candidate: string, folder: string): boolean {
  const source = pathKey(folder);
  const target = pathKey(candidate);
  return target === source || target.startsWith(`${source}/`);
}

export function sameClipboardParent(source: string, target: string): boolean {
  return pathKey(pathApi(source).dirname(source)) === pathKey(target);
}

export function clipboardCompletion(
  action: 'move' | 'copy' | 'noop',
  assets: ImportCompletion['assets'] = [],
  count = 0,
  skippedCount = 0,
): ImportCompletion {
  return { pasteAction: action, assets, importedCount: count, fileCount: count, assetCount: count, replacedCount: 0, skippedCount };
}

export function clipboardNoop(): LibraryCommandBuildOutcome {
  return { kind: 'result', result: { ok: true, type: 'asset.import.completed', completion: clipboardCompletion('noop') } };
}

/** Reuse catalog-aware folder moves; never re-import a managed subtree. */
export async function tryPasteCutFolders(input: {
  libraryId: string;
  targetFolderId: string | null;
  targetAbsolutePath: string;
  assetIds: string[];
  folderIds: string[];
  snapshot: FileClipboardSnapshot;
  requestWorker: (command: WorkerCommand) => Promise<WorkerResult>;
  completed?: (snapshot: FileClipboardSnapshot, assetIds: string[], folderIds: string[]) => void;
}): Promise<LibraryCommandBuildOutcome> {
  const listed = await input.requestWorker({
    type: 'folder.list', libraryId: input.libraryId, showIgnored: true,
  });
  if (!listed.ok) return { kind: 'result', result: listed };
  if (listed.type !== 'folder.list') throw new Error('Unexpected folder list response.');
  const managed = new Set(listed.folders.map(folder => folder.folderId));
  if (!input.folderIds.every(id => managed.has(id))) {
    return { kind: 'result', result: { ok: false, error: createPublicError('FOLDER_NOT_FOUND') } };
  }
  if (input.targetFolderId && !managed.has(input.targetFolderId)) {
    return { kind: 'result', result: { ok: false, error: createPublicError('INVALID_SELECTION') } };
  }
  const folderPaths = input.snapshot.paths.slice(input.assetIds.length);
  // A parent folder already carries its descendants, including selected files.
  const assetIds = input.assetIds.filter((_, index) =>
    !sameClipboardParent(input.snapshot.paths[index]!, input.targetAbsolutePath) &&
    !folderPaths.some(folder => clipboardPathWithin(input.snapshot.paths[index]!, folder)),
  );
  const folderIds = input.folderIds.filter((_, index) =>
    !sameClipboardParent(folderPaths[index]!, input.targetAbsolutePath),
  );
  const moved = folderIds.length
    ? await input.requestWorker({
      type: 'folder.move', libraryId: input.libraryId, folderIds,
      targetParentFolderId: input.targetFolderId, conflictStrategy: 'keep-both',
    })
    : { ok: true as const, type: 'folder.moved' as const, movedCount: 0, skippedCount: 0, folders: [] };
  if (!moved.ok) return { kind: 'result', result: moved };
  if (moved.type !== 'folder.moved') throw new Error('Unexpected folder move response.');
  let assets: ImportCompletion['assets'] = [];
  let count = 0;
  let skippedCount = moved.skippedCount;
  if (assetIds.length > 0) {
    const files = await input.requestWorker({
      type: 'asset.move', libraryId: input.libraryId, assetIds,
      targetFolderId: input.targetFolderId, conflictStrategy: 'keep-both',
    });
    if (!files.ok) return { kind: 'result', result: files };
    if (files.type !== 'asset.moved') throw new Error('Unexpected asset move response.');
    assets = files.assets;
    count = files.movedCount;
    skippedCount += files.skippedCount;
  }
  if (skippedCount === 0 && moved.movedCount + count > 0) {
    input.completed?.(input.snapshot, input.assetIds, input.folderIds);
  }
  const completion = clipboardCompletion(moved.movedCount + count > 0 ? 'move' : 'noop', assets, count, skippedCount);
  return { kind: 'result', result: { ok: true, type: 'asset.import.completed', completion } };
}
