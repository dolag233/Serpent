import { describe, expect, it, vi } from 'vitest';

import { WindowRouter, type RoutedWindow } from '../../src/main/window-router';

function createWindow(id: number): RoutedWindow & { send: ReturnType<typeof vi.fn>; destroy(): void } {
  let destroyed = false;
  const send = vi.fn();
  return {
    id,
    webContents: { send },
    send,
    isDestroyed: () => destroyed,
    destroy: () => { destroyed = true; },
  };
}

describe('WindowRouter', () => {
  it('authorizes only registered WebContents identities', () => {
    const router = new WindowRouter();
    const window = createWindow(1);
    router.register(window);

    expect(router.windowForSender(window.webContents)).toBe(window);
    expect(router.windowForSender({ send: window.send })).toBeUndefined();
    expect(router.windowForSender(undefined)).toBeUndefined();
  });

  it('routes library events only to windows with the matching context', () => {
    const router = new WindowRouter();
    const first = createWindow(1);
    const second = createWindow(2);
    const idle = createWindow(3);
    router.register(first);
    router.register(second);
    router.register(idle);
    router.setContext(first.id, { libraryId: 'library-a', selectedFolderId: 'folder-a' });
    router.setContext(second.id, { libraryId: 'library-b' });

    expect(router.publishToLibrary('library-a', 'asset-change', { libraryId: 'library-a' })).toBe(1);
    expect(first.send).toHaveBeenCalledOnce();
    expect(second.send).not.toHaveBeenCalled();
    expect(idle.send).not.toHaveBeenCalled();
  });

  it('keeps a shared library open until its final window reference is gone', () => {
    const router = new WindowRouter();
    const first = createWindow(1);
    const second = createWindow(2);
    router.register(first);
    router.register(second);
    router.setContext(first.id, { libraryId: 'shared' });
    router.setContext(second.id, { libraryId: 'shared' });

    expect(router.isLastReference(first.id, 'shared')).toBe(false);
    router.clearLibrary(first.id);
    expect(router.isLastReference(second.id, 'shared')).toBe(true);
  });

  it('removes sender authority and returns the closed window context', () => {
    const router = new WindowRouter();
    const window = createWindow(1);
    router.register(window);
    router.setContext(window.id, { libraryId: 'library-a' });

    expect(router.unregister(window.id)).toEqual({ libraryId: 'library-a' });
    expect(router.windowForSender(window.webContents)).toBeUndefined();
    expect(router.context(window.id)).toBeUndefined();
  });
});
