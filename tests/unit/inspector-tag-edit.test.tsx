// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useInspectorTagEdit } from '../../src/renderer/use-inspector-tag-edit';

it('stages removal, cancels without persistence and saves only on confirmation', async () => {
  const root = createRoot(document.createElement('div'));
  const remove = vi.fn(async () => {});
  let editor: ReturnType<typeof useInspectorTagEdit>;
  function Harness({ selection }: { selection: string }) {
    editor = useInspectorTagEdit(selection, remove);
    return null;
  }
  try {
    await act(() => root.render(createElement(Harness, { selection: 'first' })));
    await act(() => editor.begin());
    await act(() => editor.remove('tag-one'));
    expect(editor!.removed).toEqual(['tag-one']);
    expect(remove).not.toHaveBeenCalled();
    await act(() => editor.cancel());
    expect(editor!.removed).toEqual([]);
    expect(editor!.active).toBe(false);
    expect(remove).not.toHaveBeenCalled();
    await act(() => editor.begin());
    await act(() => { editor.remove('tag-one'); editor.remove('tag-two'); });
    await act(() => editor.commit());
    expect(remove.mock.calls).toEqual([['tag-one'], ['tag-two']]);
    expect(editor!.active).toBe(false);
    await act(() => editor.begin());
    await act(() => editor.remove('tag-three'));
    await act(() => root.render(createElement(Harness, { selection: 'second' })));
    expect(editor!.active).toBe(false);
    expect(editor!.removed).toEqual([]);
    expect(remove).toHaveBeenCalledTimes(2);
  } finally { await act(() => root.unmount()); }
});
