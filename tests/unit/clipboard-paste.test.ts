import { afterEach, expect, it, vi } from 'vitest';
import { assetClipboard, completeInternalClipboardMove } from '../../src/main/asset-clipboard';
import { clipboardPathWithin, sameClipboardParent, tryPasteCutFolders } from '../../src/main/clipboard-paste';
import { tryBuildIngestionCommand, type IngestionCommandRuntime } from '../../src/main/library-request/ingestion';

afterEach(() => assetClipboard.read({ paths: [], operation: 'copy', sequence: -1 }));

it('compares native paths without confusing sibling names with descendants', () => {
  expect(sameClipboardParent('E:\\Library\\Folder\\a.png', 'e:\\library\\folder\\')).toBe(true);
  expect(sameClipboardParent('\\\\Server\\Share\\a.png', '\\\\server\\share')).toBe(true);
  expect(clipboardPathWithin('E:\\Library\\Folder2', 'E:\\Library\\Folder')).toBe(false);
  expect(clipboardPathWithin('E:\\Library\\Folder\\Child', 'e:\\library\\folder')).toBe(true);
});

it.each([false, true])('silently ignores a same-parent cut, internal=%s, preserving the clipboard', async internal => {
  const snapshot = { paths: ['E:\\Library\\Assets\\a.txt'], operation: 'cut' as const, sequence: 1 };
  if (internal) assetClipboard.remember('lib', ['a'], snapshot, 'cut');
  const requestWorker = vi.fn(async () => ({ ok: true, type: 'folder.path', folderId: 'serpent:library-root', absolutePath: 'e:\\library\\assets' }));
  const completed = vi.fn();
  const result = await tryBuildIngestionCommand({ type: 'folder.paste.request', libraryId: 'lib' }, {
    readFileClipboard: () => snapshot, isUnpackagedE2e: () => false, e2eEnv: () => undefined,
    requestWorker, onCutPasteCompleted: completed, logError: vi.fn(),
  } as unknown as IngestionCommandRuntime);
  expect(result).toMatchObject({ kind: 'result', result: { ok: true, completion: { pasteAction: 'noop' } } });
  expect(requestWorker).toHaveBeenCalledTimes(1);
  expect(completed).not.toHaveBeenCalled();
  if (internal) expect(assetClipboard.read(snapshot)?.assetIds).toEqual(['a']);
});

it('moves folders before loose files, and a selected parent carries selected descendants only once', async () => {
  const snapshot = { paths: ['E:\\Assets\\Parent\\Child\\a.txt', 'E:\\Assets\\b.txt', 'E:\\Assets\\Parent', 'E:\\Assets\\Parent\\Child'], operation: 'cut' as const };
  const completed = vi.fn();
  const requestWorker = vi.fn(async command => {
    if (command.type === 'folder.list') return { ok: true, type: 'folder.list', folders: [{ folderId: 'parent' }, { folderId: 'child' }, { folderId: 'target' }] };
    if (command.type === 'folder.move') return { ok: true, type: 'folder.moved', folders: [], movedCount: 1, skippedCount: 0 };
    return { ok: true, type: 'asset.moved', assets: [], movedCount: 1, skippedCount: 0 };
  });
  const result = await tryPasteCutFolders({ libraryId: 'lib', targetFolderId: 'target', targetAbsolutePath: 'E:\\Assets\\Target', assetIds: ['contained', 'loose'], folderIds: ['parent', 'child'], snapshot, requestWorker: requestWorker as IngestionCommandRuntime['requestWorker'], completed });
  expect(requestWorker.mock.calls.map(([command]) => command.type)).toEqual(['folder.list', 'folder.move', 'asset.move']);
  expect(requestWorker).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'asset.move', assetIds: ['loose'] }));
  expect(result).toMatchObject({ result: { completion: { pasteAction: 'move' } } });
  expect(completed).toHaveBeenCalledWith(snapshot, ['contained', 'loose'], ['parent', 'child']);
});

it('silently ignores dropping a folder into itself or its descendant', async () => {
  const snapshot = { paths: ['E:\\Assets\\Parent'], operation: 'cut' as const };
  assetClipboard.remember('lib', [], snapshot, 'cut', ['parent']);
  const requestWorker = vi.fn(async () => ({ ok: true, type: 'folder.path', folderId: 'child', absolutePath: 'E:\\Assets\\Parent\\Child' }));
  const result = await tryBuildIngestionCommand({ type: 'folder.paste.request', libraryId: 'lib', folderId: 'child' }, {
    readFileClipboard: () => snapshot, isUnpackagedE2e: () => false, e2eEnv: () => undefined, requestWorker, logError: vi.fn(),
  } as unknown as IngestionCommandRuntime);
  expect(result).toMatchObject({ result: { completion: { pasteAction: 'noop' } } });
  expect(requestWorker).toHaveBeenCalledTimes(1);
});

it('consumes both folder and asset cut state without clearing a newly replaced clipboard', () => {
  const snapshot = { paths: ['E:\\a.txt', 'E:\\Folder'], operation: 'cut' as const, sequence: 2 };
  const clear = vi.fn();
  assetClipboard.remember('lib', ['a'], snapshot, 'cut', ['folder']);
  completeInternalClipboardMove(snapshot, ['a'], ['folder'], { read: () => ({ ...snapshot, sequence: 3 }), clear });
  expect(clear).not.toHaveBeenCalled();
  assetClipboard.remember('lib', ['a'], snapshot, 'cut', ['folder']);
  completeInternalClipboardMove(snapshot, ['a'], ['folder'], { read: () => snapshot, clear });
  expect(clear).toHaveBeenCalledOnce();
  expect(assetClipboard.read(snapshot)).toBeNull();
});


it('normalizes the root-folder menu destination to the move API root', async () => {
  const snapshot = { paths: ['E:\\Assets\\Folder\\a.txt'], operation: 'cut' as const };
  assetClipboard.remember('lib', ['a'], snapshot, 'cut');
  const result = await tryBuildIngestionCommand({ type: 'folder.paste.request', libraryId: 'lib', folderId: 'serpent:library-root' }, {
    readFileClipboard: () => snapshot, isUnpackagedE2e: () => false, e2eEnv: () => undefined,
    requestWorker: async () => ({ ok: true, type: 'folder.path', folderId: 'serpent:library-root', absolutePath: 'E:\\Assets' }), logError: vi.fn(),
  } as unknown as IngestionCommandRuntime);
  expect(result).toMatchObject({ kind: 'command', command: { type: 'asset.move', targetFolderId: null } });
});
