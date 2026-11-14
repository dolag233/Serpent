// @vitest-environment happy-dom
import { act, createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ContextMenuProvider } from '../../src/renderer/context-menu';
import { LocaleProvider } from '../../src/renderer/i18n';
import { InspectorTagGrid } from '../../src/renderer/InspectorTagGrid';

it('offers paste from empty tag space without intercepting text editing', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const ref = createRef<HTMLDivElement>();
  const onPaste = vi.fn();
  try {
    await act(() => root.render(createElement(LocaleProvider, null,
      createElement(ContextMenuProvider, null, createElement(InspectorTagGrid, { ref, onPaste }, createElement('input'))))));
    const inputEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    await act(() => host.querySelector('input')!.dispatchEvent(inputEvent));
    expect(inputEvent.defaultPrevented).toBe(false);
    await act(() => ref.current!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
    const item = document.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
    expect(item.textContent).toContain('Paste tags');
    expect(item.textContent).toContain('Ctrl+V');
    await act(() => item.click());
    expect(onPaste).toHaveBeenCalledOnce();
  } finally { await act(() => root.unmount()); host.remove(); }
});
