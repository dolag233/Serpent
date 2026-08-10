import { describe, expect, it } from 'vitest';

import {
  CriticalConfirmationWindowManager,
  criticalConfirmationPageUrl,
  criticalConfirmationWindowOptions,
  type CriticalConfirmationIpcHost,
  type CriticalConfirmationWindowLike,
} from '../../src/main/critical-confirmation-window';

const payload = {
  title: '确认危险操作',
  heading: '从磁盘删除这个资源库？',
  message: '资源库“测试库”及其 Serpent 管理的目录将被永久删除。',
  detail: '此操作无法撤销。关联文件夹的源目录不会被删除。',
  cancelLabel: '取消',
  confirmLabel: '从磁盘删除',
};

class FakeIpcMain implements CriticalConfirmationIpcHost {
  readonly handlers = new Map<string, (event: { sender: { id: number } }, input?: unknown) => unknown>();

  handle(channel: string, listener: (event: { sender: { id: number } }, input?: unknown) => unknown): void {
    this.handlers.set(channel, listener);
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }

  async invoke(channel: string, window: FakeWindow, input?: unknown): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (handler === undefined) throw new Error(`Missing handler ${channel}`);
    return handler({ sender: { id: window.webContents.id } }, input);
  }
}

class FakeWindow implements CriticalConfirmationWindowLike {
  static nextId = 1;
  readonly id = FakeWindow.nextId++;
  readonly webContents = {
    id: this.id + 10_000,
    isDestroyed: () => this.destroyed,
    setWindowOpenHandler: () => undefined,
    on: () => undefined,
    executeJavaScript: async () => 260,
  };
  readonly listeners = new Map<string, Set<() => void>>();
  destroyed = false;
  shown = false;
  focused = false;
  loadedUrl: string | undefined;
  sizedTo: { width: number; height: number } | undefined;

  setSize(width: number, height: number): void {
    this.sizedTo = { width, height };
  }

  loadURL(url: string): Promise<void> {
    this.loadedUrl = url;
    return Promise.resolve();
  }

  show(): void { this.shown = true; }
  focus(): void { this.focused = true; }
  close(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('closed');
  }
  isDestroyed(): boolean { return this.destroyed; }

  on(event: 'closed' | 'ready-to-show', listener: () => void): void {
    const current = this.listeners.get(event) ?? new Set<() => void>();
    current.add(listener);
    this.listeners.set(event, current);
  }

  once(event: 'ready-to-show', listener: () => void): void {
    const wrapped = () => {
      this.removeListener(event, wrapped);
      listener();
    };
    this.on(event, wrapped);
  }

  removeListener(event: 'closed' | 'ready-to-show', listener: () => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: 'closed' | 'ready-to-show'): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener();
  }
}

function managerFixture() {
  const ipcMain = new FakeIpcMain();
  const windows: FakeWindow[] = [];
  const parent = new FakeWindow();
  const manager = new CriticalConfirmationWindowManager({
    getParentWindow: () => parent,
    createWindow: () => {
      const window = new FakeWindow();
      windows.push(window);
      return window;
    },
    ipcMain,
    preloadPath: '/tmp/critical-confirmation.js',
  });
  return { manager, ipcMain, parent, windows };
}

describe('Critical confirmation window', () => {
  it('uses an owned modal with a narrow preload and renders a data page', async () => {
    const { manager, windows } = managerFixture();
    const pending = manager.request(payload);
    const window = windows[0]!;
    window.emit('ready-to-show');

    expect(window.shown).toBe(true);
    expect(window.focused).toBe(true);
    expect(window.loadedUrl).toBe(criticalConfirmationPageUrl());
    const options = criticalConfirmationWindowOptions({
      parent: window,
      preloadPath: '/tmp/critical-confirmation.js',
    });
    expect(options).toMatchObject({
      modal: true,
      show: false,
      resizable: false,
      skipTaskbar: true,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        preload: '/tmp/critical-confirmation.js',
      },
    });
    expect(decodeURIComponent(criticalConfirmationPageUrl())).toContain('critical-heading');
    expect(decodeURIComponent(criticalConfirmationPageUrl())).not.toContain('Critical confirmation');

    manager.dispose();
    void pending;
  });

  it('returns the validated decision and rejects forged or invalid senders', async () => {
    const { manager, ipcMain, windows } = managerFixture();
    const pending = manager.request(payload);
    const window = windows[0]!;
    const forged = new FakeWindow();
    const getChannel = 'serpent:critical-confirmation:get';
    const decideChannel = 'serpent:critical-confirmation:decide';

    await expect(ipcMain.invoke(getChannel, forged)).rejects.toThrow();
    await expect(ipcMain.invoke(decideChannel, forged, 'confirm')).resolves.toBe(false);
    await expect(ipcMain.invoke(decideChannel, window, 'invalid')).resolves.toBe(false);
    await expect(ipcMain.invoke(decideChannel, window, 'confirm')).resolves.toBe(true);
    await expect(pending).resolves.toBe(true);
  });

  it('cancels on child/parent close and serializes queued critical requests', async () => {
    const { manager, parent, windows } = managerFixture();
    const first = manager.request(payload);
    const second = manager.request({ ...payload, heading: '第二个操作' });
    expect(windows).toHaveLength(1);

    windows[0]!.emit('closed');
    await expect(first).resolves.toBe(false);
    await Promise.resolve();
    expect(windows).toHaveLength(2);
    parent.close();
    await expect(second).resolves.toBe(false);
  });
});
