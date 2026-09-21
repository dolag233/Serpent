import { ipcRenderer } from 'electron';

import {
  parseAppUpdateCheckResult,
  parseAppUpdateInstallResult,
  parseAppUpdateProgress,
  type AppUpdateProgress,
  type SerpentAppUpdateApi,
} from '../../shared/app-update';
import {
  APP_UPDATE_CANCEL_CHANNEL,
  APP_UPDATE_CHECK_CHANNEL,
  APP_UPDATE_INSTALL_CHANNEL,
  APP_UPDATE_PROGRESS_CHANNEL,
} from '../../shared/protocol/channels';

export const appUpdate: SerpentAppUpdateApi = Object.freeze({
  async checkForUpdates() {
    return parseAppUpdateCheckResult(
      await ipcRenderer.invoke(APP_UPDATE_CHECK_CHANNEL),
    );
  },
  async downloadAndInstall() {
    return parseAppUpdateInstallResult(
      await ipcRenderer.invoke(APP_UPDATE_INSTALL_CHANNEL),
    );
  },
  cancelDownload() {
    ipcRenderer.send(APP_UPDATE_CANCEL_CHANNEL);
  },
  onDownloadProgress(listener: (progress: AppUpdateProgress) => void) {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      const progress = parseAppUpdateProgress(payload);
      if (progress !== null) listener(progress);
    };
    ipcRenderer.on(APP_UPDATE_PROGRESS_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(APP_UPDATE_PROGRESS_CHANNEL, handler);
    };
  },
});
