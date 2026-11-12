// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceTabOutline } from '../../src/renderer/WorkspaceTabOutline';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keeps the panel seam at the SVG tip centers when the strip scrolls or the window resizes', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  let tabX = 120;
  let panelY = 44;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('workspace-tab')) return new DOMRect(tabX, 4, 120, 42);
    if (this.classList.contains('workspace')) return new DOMRect(20, panelY, 600, 500);
    return new DOMRect();
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(() => root.render(<div className="app-shell">
      <div className="workspace-tabs" style={{ '--workspace-tab-scoop': '18px' } as React.CSSProperties}>
        <div className="workspace-tabs-list"><div className="workspace-tab" style={{ borderTopLeftRadius: '14px' }}><WorkspaceTabOutline /></div></div>
      </div>
      <div className="workspace" />
    </div>));
    const panel = container.querySelector<HTMLElement>('.workspace')!;
    expect(panel.style.getPropertyValue('--tab-seam-hole-left')).toBe('82.5px');
    expect(panel.style.getPropertyValue('--tab-seam-hole-right')).toBe('237.5px');
    tabX -= 24;
    await act(() => { container.querySelector('.workspace-tabs-list')!.dispatchEvent(new Event('scroll')); });
    expect(panel.style.getPropertyValue('--tab-seam-hole-left')).toBe('58.5px');
    expect(panel.style.getPropertyValue('--tab-seam-hole-right')).toBe('213.5px');
    panelY = 48;
    await act(() => { window.dispatchEvent(new Event('resize')); });
    expect(container.querySelector('.workspace-tab-outline-path')!.getAttribute('d')).toContain('M -17.5 44.5');
  } finally { await act(() => root.unmount()); container.remove(); }
});
