// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { SerpentLibraryApi } from '../../src/shared/library-api';
import { useFolderOrganizeActions } from '../../src/renderer/use-folder-organize-actions';
import { importSummaryMessage, shouldNotifyImportCompletion } from '../../src/renderer/import-summary';

vi.mock('../../src/renderer/i18n', async importOriginal => ({ ...await importOriginal<object>(), useT: () => (key: string) => key }));

it.each(['noop', 'move', 'copy'] as const)('handles %s paste without unnecessary feedback or refresh', async pasteAction => {
  const completion = { pasteAction, assets: [], importedCount: 1, skippedCount: 0, replacedCount: 0 };
  const notice = vi.fn(), error = vi.fn(), ui = vi.fn(), reload = vi.fn(async () => {});
  const api = { pasteIntoFolder: vi.fn(async () => ({ ok: true, value: completion })) } as unknown as SerpentLibraryApi;
  let actions: ReturnType<typeof useFolderOrganizeActions>;
  function Harness() {
    actions = useFolderOrganizeActions({ api, libraryId: 'lib', locale: 'en', setNotice: notice, setError: error, setUiState: ui, reloadCurrentContent: reload });
    return null;
  }
  const root = createRoot(document.createElement('div'));
  try {
    await act(() => root.render(createElement(Harness)));
    await act(() => actions.pasteIntoFolder(null));
    expect(reload).toHaveBeenCalledTimes(pasteAction === 'noop' ? 0 : 1);
    expect(notice).toHaveBeenCalledTimes(pasteAction === 'copy' ? 1 : 0);
    expect(ui).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  } finally { await act(() => root.unmount()); }
});

it('keeps source-retention warnings for a cut but omits the import summary', () => {
  const completion = { pasteAction: 'move' as const, importedCount: 2, skippedCount: 0, replacedCount: 0, sourceRetainedCount: 1 };
  expect(shouldNotifyImportCompletion(completion)).toBe(true);
  const message = importSummaryMessage(completion, 'en');
  expect(message).toContain('1');
  expect(message).not.toContain('Imported');
});
