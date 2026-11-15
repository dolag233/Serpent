// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { InspectorTagChip } from '../../src/renderer/InspectorTagChip';
import { ContextMenuProvider } from '../../src/renderer/context-menu';
import { LocaleProvider } from '../../src/renderer/i18n';

it('uses Command-click on macOS for filtering and keeps modifier+Shift range selection', async () => {
  const userAgent = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Macintosh');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const onSelect = vi.fn();
  const onFilter = vi.fn();
  try {
    await act(() => root.render(createElement(LocaleProvider, null,
      createElement(ContextMenuProvider, null, createElement(InspectorTagChip, {
        id: 'fixture', name: 'Fixture', showAiBadge: false, editing: false, onSelect, onFilter,
      })))));
    const label = host.querySelector('.inspector-tag-label')!;
    await act(() => label.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })));
    expect(onFilter).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
    await act(() => label.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true, shiftKey: true })));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onFilter).toHaveBeenCalledOnce();
    await act(() => label.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
    const hint = document.querySelector('.tag-filter-shortcut')!;
    expect(hint.textContent).toBe('⌘+');
    expect(hint.getAttribute('aria-label')).toBe('⌘+left mouse click');
    expect(hint.querySelector('svg')).not.toBeNull();
  } finally { await act(() => root.unmount()); host.remove(); userAgent.mockRestore(); }
});

it('prioritizes Ctrl-click filtering over selection and retains menu and keyboard filtering', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const onFilter = vi.fn();
  const onSelect = vi.fn();
  const onRemove = vi.fn();
  const render = (editing: boolean) => act(() => root.render(createElement(LocaleProvider, null,
    createElement(ContextMenuProvider, null, createElement(InspectorTagChip, { id: 'landscape', name: 'Landscape', color: 'red', source: 'human',
      showAiBadge: false, editing, onFilter, onSelect, onRemove, onRename: vi.fn(async () => true) })))));
  try {
    await render(false);
    expect(host.querySelector('.tag-chip-remove')).toBeNull();
    const chip = host.querySelector('.inspector-tag-label')!;
    await act(() => chip.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onFilter).not.toHaveBeenCalled();
    await act(() => chip.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })));
    await act(() => chip.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onFilter).toHaveBeenCalledTimes(2);
    await act(() => chip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })));
    const actions = document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    expect(actions).toHaveLength(3);
    expect(actions[0]!.textContent).toContain('Apply tag filter');
    const hint = actions[0]!.querySelector('.tag-filter-shortcut')!;
    expect(hint.textContent).toBe('Ctrl+');
    expect(hint.getAttribute('aria-label')).toBe('Ctrl+left mouse click');
    expect(hint.querySelector('svg')).not.toBeNull();
    await act(() => actions[0]!.click());
    expect(onFilter).toHaveBeenCalledTimes(3);
    await act(() => chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, ctrlKey: true })));
    expect(onFilter).toHaveBeenCalledTimes(4);
    await act(() => chip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, shiftKey: true })));
    expect(host.querySelector('.inspector-tag-rename')).toBeNull();
    await act(() => chip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    const renameInput = host.querySelector<HTMLInputElement>('.inspector-tag-rename');
    expect(renameInput).not.toBeNull();
    expect(renameInput?.selectionStart).toBe(0);
    expect(renameInput?.selectionEnd).toBe('Landscape'.length);
    expect(host.querySelector('.tag-chip-remove')).toBeNull();
    await act(() => host.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(host.querySelector('.inspector-tag-rename')).toBeNull();
    expect(host.querySelector('.tag-chip-name')?.textContent).toBe('Landscape');
    await render(true);
    await act(() => host.querySelector<HTMLButtonElement>('.tag-chip-remove')!.click());
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onFilter).toHaveBeenCalledTimes(4);
  } finally { await act(() => root.unmount()); host.remove(); }
});

it('retains Shift selection in edit mode while Ctrl-click filters', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const onSelect = vi.fn();
  const onFilter = vi.fn();
  try {
    await act(() => root.render(createElement(LocaleProvider, null,
      createElement(ContextMenuProvider, null, createElement(InspectorTagChip, {
        id: 'tag', name: 'Tag', showAiBadge: false, editing: true, selected: true,
        onSelect, onFilter,
      })))));
    const chip = host.querySelector<HTMLButtonElement>('.inspector-tag-label')!;
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    await act(() => chip.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })));
    expect(onSelect).not.toHaveBeenCalled();
    expect(onFilter).toHaveBeenCalledOnce();
    await act(() => chip.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })));
    expect(onSelect).toHaveBeenCalledOnce();
  } finally { await act(() => root.unmount()); host.remove(); }
});

it('offers clipboard actions and preserves the context selection before copying', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const onContextSelect = vi.fn();
  const onCopy = vi.fn();
  const onPaste = vi.fn();
  try {
    await act(() => root.render(createElement(LocaleProvider, null,
      createElement(ContextMenuProvider, null, createElement(InspectorTagChip, {
        id: 'tag', name: 'Tag', showAiBadge: true, source: 'ai', editing: false,
        onContextSelect, onCopy, onPaste,
      })))));
    const chip = host.querySelector('.inspector-tag-chip')!;
    await act(() => chip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
    expect(onContextSelect).toHaveBeenCalledOnce();
    const copy = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent?.includes('Copy selected tags'))!;
    expect(copy.textContent).toContain('Ctrl+C');
    await act(() => copy.click());
    expect(onCopy).toHaveBeenCalledOnce();
    await act(() => chip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
    const paste = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent?.includes('Paste tags'))!;
    expect(paste.textContent).toContain('Ctrl+V');
    await act(() => paste.click());
    expect(onPaste).toHaveBeenCalledOnce();
    expect(host.querySelector('.inspector-ai-badge')?.textContent).toBe('AI');
  } finally { await act(() => root.unmount()); host.remove(); }
});
