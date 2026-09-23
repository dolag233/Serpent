import { ipcRenderer } from 'electron';
import { expect, test, vi } from 'vitest';

import { appUpdate } from '../../src/preload/bridge/app-update';
import {
  APP_UPDATE_CANCEL_CHANNEL,
  APP_UPDATE_CHECK_CHANNEL,
  APP_UPDATE_INSTALL_CHANNEL,
  APP_UPDATE_PROGRESS_CHANNEL,
} from '../../src/shared/protocol/channels';

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: vi.fn(),
    send: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

test('appUpdate check and install go through the owned IPC channels', async () => {
  vi.mocked(ipcRenderer.invoke).mockResolvedValue({ ok: true, status: 'up-to-date' });
  await appUpdate.checkForUpdates();
  await appUpdate.downloadAndInstall();
  appUpdate.cancelDownload();
  expect(ipcRenderer.invoke).toHaveBeenCalledWith(APP_UPDATE_CHECK_CHANNEL);
  expect(ipcRenderer.invoke).toHaveBeenCalledWith(APP_UPDATE_INSTALL_CHANNEL);
  expect(ipcRenderer.send).toHaveBeenCalledWith(APP_UPDATE_CANCEL_CHANNEL);
});

test('appUpdate progress subscription uses the progress channel', () => {
  const unsubscribe = appUpdate.onDownloadProgress(() => undefined);
  expect(ipcRenderer.on).toHaveBeenCalledWith(
    APP_UPDATE_PROGRESS_CHANNEL,
    expect.any(Function),
  );
  unsubscribe();
  expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
    APP_UPDATE_PROGRESS_CHANNEL,
    expect.any(Function),
  );
});
