import { describe, expect, it } from 'vitest';
import { AssetClipboard, completeFileClipboardMove } from '../../src/main/asset-clipboard';

describe('asset clipboard identity', () => {
  it('retains a copied batch across pastes and consumes a successfully moved cut', () => {
    const clipboard = new AssetClipboard();
    const snapshot = { paths: ['C:\\a.txt', 'C:\\b.txt'], operation: 'cut' as const, sequence: 10 };
    clipboard.remember('library', ['a', 'b'], snapshot, 'cut');
    expect(clipboard.read(snapshot)?.assetIds).toEqual(['a', 'b']);
    clipboard.completed({ type: 'asset.move', libraryId: 'library', assetIds: ['a', 'b'], targetFolderId: null });
    expect(clipboard.read(snapshot)).toBeNull();
  });

  it('invalidates identity when Explorer recopies the same paths or replaces the clipboard', () => {
    const clipboard = new AssetClipboard();
    const snapshot = { paths: ['C:\\a.txt'], operation: 'copy' as const, sequence: 10 };
    clipboard.remember('library', ['a'], snapshot, 'copy');
    expect(clipboard.read({ ...snapshot, sequence: 11 })).toBeNull();
    expect(clipboard.read(snapshot)).toBeNull();
  });
});

it('retains skipped cut files on the clipboard and never overwrites newer clipboard data', () => {
  const snapshot = { paths: ['C:\\moved.txt', 'C:\\skipped.txt'], operation: 'cut' as const, sequence: 12 };
  const writes: string[][] = [];
  let cleared = false;
  const deps = { read: () => snapshot, exists: (file: string) => file.endsWith('skipped.txt'), write: (paths: string[]) => { writes.push(paths); return true; }, clear: () => { cleared = true; } };
  completeFileClipboardMove(snapshot, deps);
  expect(writes).toEqual([['C:\\skipped.txt']]);
  expect(cleared).toBe(false);
  completeFileClipboardMove(snapshot, { ...deps, read: () => ({ ...snapshot, sequence: 13 }) });
  expect(writes).toHaveLength(1);
  completeFileClipboardMove(snapshot, { ...deps, exists: () => false });
  expect(cleared).toBe(true);
});

it('keeps a cut selection while another application temporarily holds the native clipboard lock', () => {
  const clipboard = new AssetClipboard();
  const snapshot = { paths: ['C:\\source.png'], operation: 'cut' as const, sequence: 10 };
  clipboard.remember('lib', ['asset'], snapshot, 'cut');
  expect(clipboard.read({ paths: [], operation: 'copy', unavailable: true })?.assetIds).toEqual(['asset']);
  expect(clipboard.read(snapshot)?.assetIds).toEqual(['asset']);
  expect(clipboard.read({ paths: [], operation: 'copy', sequence: 11 })).toBeNull();
});
