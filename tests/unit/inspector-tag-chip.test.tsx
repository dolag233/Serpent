// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { InspectorTagChip } from '../../src/renderer/InspectorTagChip';
import { ContextMenuProvider } from '../../src/renderer/context-menu';
import { LocaleProvider } from '../../src/renderer/i18n';

it('hides removal until editing and filters only with a modifier click', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const onFilter = vi.fn();
  const onRemove = vi.fn();
  const render = (editing: boolean) => act(() => root.render(createElement(LocaleProvider, null,
    createElement(ContextMenuProvider, null, createElement(InspectorTagChip, { id: 'landscape', name: 'Landscape', color: 'red', source: 'human',
      showAiBadge: false, editing, onFilter, onRemove, onRename: vi.fn(async () => true) })))));
  try {
    await render(false);
    expect(host.querySelector('.tag-chip-remove')).toBeNull();
    const chip = host.querySelector('.inspector-tag-label')!;
    await act(() => chip.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onFilter).not.toHaveBeenCalled();
    await act(() => chip.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })));
    await act(() => chip.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })));
    expect(onFilter).toHaveBeenCalledTimes(2);
    await act(() => chip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })));
    const actions = document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    expect(actions).toHaveLength(3);
    expect(actions[0]!.textContent).toContain('Ctrl');
    await act(() => actions[0]!.click());
    expect(onFilter).toHaveBeenCalledTimes(3);
    await act(() => chip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(host.querySelector('.inspector-tag-rename')).not.toBeNull();
    expect(host.querySelector('.tag-chip-remove')).toBeNull();
    await act(() => host.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(host.querySelector('.inspector-tag-rename')).toBeNull();
    expect(host.querySelector('.tag-chip-name')?.textContent).toBe('Landscape');
    await render(true);
    await act(() => host.querySelector<HTMLButtonElement>('.tag-chip-remove')!.click());
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onFilter).toHaveBeenCalledTimes(3);
  } finally { await act(() => root.unmount()); host.remove(); }
});
