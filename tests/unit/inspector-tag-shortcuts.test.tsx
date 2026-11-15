// @vitest-environment happy-dom
import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { dispatchFocusedTagClipboardCommand, useInspectorTagShortcuts } from '../../src/renderer/inspector-tag-shortcuts';
import { setShortcutRuntime } from '../../src/renderer/shortcut-runtime';
import { DEFAULT_SHORTCUT_BINDINGS } from '../../src/shared/shortcut-bindings';
import { useBrowseCommandKeyboard } from '../../src/renderer/use-browse-command-keyboard';

it('routes DOM and native menu copy/paste only to focused tags, yielding to inputs and assets', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const copy = vi.fn();
  const paste = vi.fn();
  const copyFiles = vi.fn();
  function Harness() {
    const ref = useRef<HTMLElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    useInspectorTagShortcuts(ref, copy, paste);
    useBrowseCommandKeyboard({
      enabled: true, platform: 'windows', previewOpen: false, showTrash: false,
      activeCollectionId: null, libraryOpen: true, busy: false,
      selectedAsset: undefined, selectedAssets: [], selectedAssetIds: ['asset'],
      pasteDestinationFolderId: null, diskDeleteAssetIds: [], diskDeleteFolderIds: [], searchInputRef,
      onCopyFiles: copyFiles, onPasteIntoFolder: vi.fn(), onOpenExternal: vi.fn(), onTrashManaged: vi.fn(),
      onRename: vi.fn(), onCopyFilePath: vi.fn(), onRevealInFolder: vi.fn(), onShowInLibraryFolder: vi.fn(),
      onDiskDelete: vi.fn(), onPermanentDelete: vi.fn(), onRemoveFromCurrentCollection: vi.fn(), onRefreshDisk: vi.fn(),
    });
    return <><section ref={ref} className="inspector-tags-section"><button>Tag</button><input /></section><button className="asset">Asset</button></>;
  }
  try {
    setShortcutRuntime('windows', DEFAULT_SHORTCUT_BINDINGS);
    await act(() => root.render(<Harness />));
    const tag = host.querySelector('button')!;
    tag.focus();
    tag.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(copy).toHaveBeenCalledTimes(1);
    expect(copyFiles).not.toHaveBeenCalled();
    expect(dispatchFocusedTagClipboardCommand('paste')).toBe(true);
    expect(paste).toHaveBeenCalledTimes(1);
    tag.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(paste).toHaveBeenCalledTimes(2);
    tag.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true }));
    expect(paste).toHaveBeenCalledTimes(3);
    host.querySelector('input')!.focus();
    expect(dispatchFocusedTagClipboardCommand('copy')).toBe(false);
    host.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }));
    expect(paste).toHaveBeenCalledTimes(3);
    host.querySelector<HTMLButtonElement>('.asset')!.focus();
    expect(dispatchFocusedTagClipboardCommand('paste')).toBe(false);
    host.querySelector<HTMLButtonElement>('.asset')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(copyFiles).toHaveBeenCalledWith(['asset']);
    setShortcutRuntime('mac', DEFAULT_SHORTCUT_BINDINGS);
    tag.focus();
    tag.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true, cancelable: true }));
    expect(copy).toHaveBeenCalledTimes(2);
  } finally { setShortcutRuntime('windows', DEFAULT_SHORTCUT_BINDINGS); await act(() => root.unmount()); host.remove(); }
});
