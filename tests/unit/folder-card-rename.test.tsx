// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { FolderCard } from '../../src/renderer/FolderCard';
import { LocaleProvider } from '../../src/renderer/i18n';
import type { FolderBrowseEntry } from '../../src/shared/asset-types';
import { startInlineFolderRename } from '../../src/renderer/inline-folder-edit';

it('edits the folder name on the card with focus, Enter/Escape and error feedback', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const commit = vi.fn();
  const cancel = vi.fn();
  const open = vi.fn();
  const entry: FolderBrowseEntry = {
    folderId: 'deep-folder', parentFolderId: 'collapsed-parent', name: 'Deep folder', relativePath: 'parent/deep',
    locationKind: 'managed', status: 'available', directAssetCount: 0, recursiveAssetCount: 0, childFolderCount: 0, coverArtifactIds: [], coverAssetIds: [],
  };
  const rename = startInlineFolderRename(entry.folderId, entry.name);
  if (rename.kind !== 'rename') throw new Error('Expected rename state');
  try {
    await act(() => root.render(<LocaleProvider initialPreference="en"><FolderCard
      entry={entry} libraryId="library" selected rename={rename}
      onClick={vi.fn()} onMouseDown={vi.fn()} onContextMenu={vi.fn()} onDoubleClick={open}
      onRenameCommit={commit} onRenameCancel={cancel}
    /></LocaleProvider>));
    const input = container.querySelector('input')!;
    expect(document.activeElement).toBe(input);
    expect(input.selectionEnd).toBe(entry.name.length);
    await act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(commit).toHaveBeenCalledOnce();
    await act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(cancel).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
  } finally { await act(() => root.unmount()); container.remove(); }
});

it('starts inline rename only when the folder name is double-clicked', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const open = vi.fn();
  const rename = vi.fn();
  const entry: FolderBrowseEntry = {
    folderId: 'folder', parentFolderId: null, name: 'Materials', relativePath: 'Materials',
    locationKind: 'managed', status: 'available', directAssetCount: 0, recursiveAssetCount: 0, childFolderCount: 0, coverArtifactIds: [], coverAssetIds: [],
  };
  try {
    await act(() => root.render(<LocaleProvider initialPreference="en"><FolderCard
      entry={entry} libraryId="library" selected={false}
      onClick={vi.fn()} onMouseDown={vi.fn()} onContextMenu={vi.fn()}
      onDoubleClick={open} onRenameRequest={rename}
    /></LocaleProvider>));
    await act(() => container.querySelector('.folder-card-name')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(rename).toHaveBeenCalledWith('folder', 'Materials');
    expect(open).not.toHaveBeenCalled();
    await act(() => container.querySelector('.folder-card-cover')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(open).toHaveBeenCalledWith('folder');
  } finally { await act(() => root.unmount()); container.remove(); }
});
