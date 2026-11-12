// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useViewerChromeIdle } from '../../src/renderer/use-viewer-chrome-idle';

it('hides fullscreen chrome after one second, ignores stationary media events and wakes on mouse movement', async () => {
  vi.useFakeTimers();
  let fullscreen: Element | null = null;
  const original = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen });
  const root = createRoot(document.createElement('div'));
  let chrome: ReturnType<typeof useViewerChromeIdle>;
  function Harness() { chrome = useViewerChromeIdle(undefined, true); return null; }
  try {
    await act(() => root.render(createElement(Harness)));
    await act(() => vi.advanceTimersByTime(1_000));
    expect(chrome!.idle).toBe(false);
    fullscreen = document.createElement('section');
    await act(() => document.dispatchEvent(new Event('fullscreenchange')));
    await act(() => vi.advanceTimersByTime(999));
    expect(chrome!.idle).toBe(false);
    await act(() => window.dispatchEvent(Object.assign(new Event('pointermove'), { movementX: 0, movementY: 0, clientX: 10, clientY: 10 })));
    await act(() => vi.advanceTimersByTime(1));
    expect(chrome!.idle).toBe(true);
    await act(() => window.dispatchEvent(Object.assign(new Event('pointermove'), { movementX: 20, movementY: 0, clientX: 30, clientY: 10 })));
    expect(chrome!.idle).toBe(false);
    await act(() => vi.advanceTimersByTime(1_000));
    expect(chrome!.idle).toBe(true);
    fullscreen = null;
    await act(() => document.dispatchEvent(new Event('fullscreenchange')));
    expect(chrome!.idle).toBe(false);
    await act(() => vi.advanceTimersByTime(1_000));
    expect(chrome!.idle).toBe(false);
  } finally { await act(() => root.unmount()); if (original) Object.defineProperty(document, 'fullscreenElement', original);
    else Reflect.deleteProperty(document, 'fullscreenElement');
    vi.restoreAllMocks(); vi.useRealTimers(); }
});
