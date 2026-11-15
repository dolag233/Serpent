// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { copyTagNames, parseTagClipboardText, readTagNames, useInspectorTagClipboard } from '../../src/renderer/use-inspector-tag-clipboard';

it('parses copied tag names without blank or duplicate lines', () => {
  expect(parseTagClipboardText('Landscape\r\nPortrait\nlandscape\n\n')).toEqual(['Landscape', 'Portrait']);
});

it('round-trips selected names through the clipboard', async () => {
  let text = '';
  const writeText = vi.fn(async (value: string) => { text = value; });
  const readText = vi.fn(async () => text);
  await copyTagNames(['Landscape', 'Portrait'], { writeText });
  expect(writeText).toHaveBeenCalledWith('Landscape\nPortrait');
  expect(await readTagNames({ readText })).toEqual(['Landscape', 'Portrait']);
});

it('supports range selection and clears selection when the asset changes', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let selection: ReturnType<typeof useInspectorTagClipboard> | undefined;
  const tags = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  function Harness({ assetId }: { assetId: string }) {
    selection = useInspectorTagClipboard(assetId, tags);
    return null;
  }
  try {
    await act(() => root.render(<Harness assetId="first" />));
    await act(() => selection?.select('a', { toggle: false, range: false }));
    await act(() => selection?.select('c', { toggle: false, range: true }));
    expect(selection?.selectedNames).toEqual(['A', 'B', 'C']);
    await act(() => root.render(<Harness assetId="second" />));
    expect(selection?.selectedNames).toEqual([]);
  } finally { await act(() => root.unmount()); host.remove(); }
});

it('replaces selection by marquee and toggles individual tags off', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let selection: ReturnType<typeof useInspectorTagClipboard> | undefined;
  const tags = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  function Harness() {
    selection = useInspectorTagClipboard('asset', tags);
    return null;
  }
  try {
    await act(() => root.render(<Harness />));
    await act(() => selection?.select('a', { toggle: false, range: false }));
    await act(() => selection?.marquee(['a', 'b', 'c'], ['a'], { ctrlKey: false, metaKey: false, shiftKey: false }));
    expect(selection?.selectedNames).toEqual(['A', 'B', 'C']);
    await act(() => selection?.select('b', { toggle: true, range: false }));
    expect(selection?.selectedNames).toEqual(['A', 'C']);
    await act(() => selection?.marquee(['b'], ['a', 'c'], { ctrlKey: false, metaKey: false, shiftKey: false }));
    expect(selection?.selectedNames).toEqual(['B']);
  } finally { await act(() => root.unmount()); host.remove(); }
});

it('does not copy a selected tag after it is removed from the editor', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let selection: ReturnType<typeof useInspectorTagClipboard> | undefined;
  const tags = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  function Harness({ removed }: { removed: string[] }) {
    selection = useInspectorTagClipboard('asset', tags.filter(tag => !removed.includes(tag.id)));
    return null;
  }
  try {
    await act(() => root.render(<Harness removed={[]} />));
    await act(() => selection?.select('a', { toggle: false, range: false }));
    await act(() => selection?.select('b', { toggle: true, range: false }));
    expect(selection?.selectedNames).toEqual(['A', 'B']);
    await act(() => root.render(<Harness removed={['a']} />));
    expect(selection?.selectedNames).toEqual(['B']);
  } finally { await act(() => root.unmount()); host.remove(); }
});
