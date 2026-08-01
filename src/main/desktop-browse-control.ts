import type { WebContents } from 'electron';

import {
  desktopBrowseActionSchema,
  desktopBrowseResultSchema,
  type DesktopBrowseAction,
  type DesktopBrowseState,
  type DesktopBrowseResult,
} from '../shared/desktop-control';
import {
  DESKTOP_AUTOMATION_BROWSE_CHANNEL,
} from '../shared/protocol/channels';

type PendingRequest = {
  resolve: (result: DesktopBrowseResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

type DesktopBrowseIntent =
  | Omit<Extract<DesktopBrowseAction, { type: 'get-state' }>, 'requestId'>
  | Omit<Extract<DesktopBrowseAction, { type: 'open-folder' }>, 'requestId'>
  | Omit<Extract<DesktopBrowseAction, { type: 'set-discovery' }>, 'requestId'>
  | Omit<Extract<DesktopBrowseAction, { type: 'reveal-asset' }>, 'requestId'>
  | Omit<Extract<DesktopBrowseAction, { type: 'open-viewer' }>, 'requestId'>
  | Omit<Extract<DesktopBrowseAction, { type: 'close-viewer' }>, 'requestId'>
  | Omit<Extract<DesktopBrowseAction, { type: 'navigate-viewer' }>, 'requestId'>;

export interface DesktopBrowseControl {
  getState(libraryId: string): Promise<DesktopBrowseState>;
  openFolder(libraryId: string, folderId: string | null): Promise<DesktopBrowseState>;
  setDiscovery(
    libraryId: string,
    input: Omit<Extract<DesktopBrowseAction, { type: 'set-discovery' }>, 'type' | 'requestId' | 'libraryId'>,
  ): Promise<DesktopBrowseState>;
  revealAsset(
    libraryId: string,
    assetId: string,
    position: Extract<DesktopBrowseAction, { type: 'reveal-asset' }>['position'],
  ): Promise<Extract<DesktopBrowseResult, { type: 'reveal-applied' }>>;
  openViewer(
    libraryId: string,
    assetId: string,
  ): Promise<DesktopBrowseState>;
  closeViewer(libraryId: string): Promise<DesktopBrowseState>;
  navigateViewer(
    libraryId: string,
    direction: Extract<DesktopBrowseAction, { type: 'navigate-viewer' }>['direction'],
  ): Promise<DesktopBrowseState>;
  handleResult(sender: WebContents, payload: unknown): void;
  close(): void;
}

function stateFromResult(result: DesktopBrowseResult): DesktopBrowseState {
  if (!result.ok) {
    throw new Error(`${result.code}: ${result.message}`);
  }
  return result.state;
}

export function createDesktopBrowseControl(options: {
  getWebContents: () => WebContents | null;
  timeoutMs?: number;
}): DesktopBrowseControl {
  const pending = new Map<string, PendingRequest>();
  let nextRequestId = 0;
  const timeoutMs = options.timeoutMs ?? 10_000;

  function request(
    action: DesktopBrowseIntent,
  ): Promise<DesktopBrowseResult> {
    const webContents = options.getWebContents();
    if (webContents === null || webContents.isDestroyed()) {
      return Promise.reject(new Error('DESKTOP_BROWSE_UNAVAILABLE: Desktop window is unavailable.'));
    }
    const requestId = `desktop-browse-${++nextRequestId}`;
    const fullAction = desktopBrowseActionSchema.parse({ ...action, requestId });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error('DESKTOP_BROWSE_UNAVAILABLE: Desktop browse request timed out.'));
      }, timeoutMs);
      timer.unref?.();
      pending.set(requestId, {
        resolve,
        timer,
      });
      try {
        webContents.send(DESKTOP_AUTOMATION_BROWSE_CHANNEL, fullAction);
      } catch (error) {
        clearTimeout(timer);
        pending.delete(requestId);
        reject(error);
      }
    });
  }

  return {
    async getState(libraryId) {
      return stateFromResult(await request({ type: 'get-state', libraryId }));
    },
    async openFolder(libraryId, folderId) {
      return stateFromResult(await request({ type: 'open-folder', libraryId, folderId }));
    },
    async setDiscovery(libraryId, input) {
      return stateFromResult(await request({ type: 'set-discovery', libraryId, ...input }));
    },
    async revealAsset(libraryId, assetId, position) {
      const result = await request({
        type: 'reveal-asset',
        libraryId,
        assetId,
        position,
      });
      if (!result.ok) {
        throw new Error(`${result.code}: ${result.message}`);
      }
      if (result.type !== 'reveal-applied') {
        throw new Error('DESKTOP_BROWSE_UNAVAILABLE: Invalid reveal response.');
      }
      return result;
    },
    async openViewer(libraryId, assetId) {
      return stateFromResult(await request({
        type: 'open-viewer',
        libraryId,
        assetId,
      }));
    },
    async closeViewer(libraryId) {
      return stateFromResult(await request({
        type: 'close-viewer',
        libraryId,
      }));
    },
    async navigateViewer(libraryId, direction) {
      return stateFromResult(await request({
        type: 'navigate-viewer',
        libraryId,
        direction,
      }));
    },
    handleResult(sender, payload) {
      const webContents = options.getWebContents();
      if (webContents === null || sender !== webContents) return;
      const parsed = desktopBrowseResultSchema.safeParse(payload);
      if (!parsed.success) return;
      const entry = pending.get(parsed.data.requestId);
      if (entry === undefined) return;
      pending.delete(parsed.data.requestId);
      clearTimeout(entry.timer);
      entry.resolve(parsed.data);
    },
    close() {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
      }
      pending.clear();
    },
  };
}
