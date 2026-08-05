/**
 * Minimal preload for the offscreen thumbnail page (slice E, Serpent-hnmg).
 *
 * Exposes exactly two operations to the hidden renderer window — receive one
 * render job, send one frame back — over dedicated channels. No library API,
 * no path or SQL surface: the offscreen page must not be able to reach the
 * app's data plane, only render what Main tells it to.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

import {
  OFFSCREEN_THUMBNAIL_FRAME_CHANNEL,
  OFFSCREEN_THUMBNAIL_RENDER_CHANNEL,
} from '../shared/protocol/channels';

contextBridge.exposeInMainWorld('offscreenThumbnail', {
  onRender(listener: (job: unknown) => void): () => void {
    const subscription = (_event: IpcRendererEvent, job: unknown): void => {
      listener(job);
    };
    ipcRenderer.on(OFFSCREEN_THUMBNAIL_RENDER_CHANNEL, subscription);
    return () => {
      ipcRenderer.removeListener(OFFSCREEN_THUMBNAIL_RENDER_CHANNEL, subscription);
    };
  },
  sendFrame(payload: unknown): void {
    ipcRenderer.send(OFFSCREEN_THUMBNAIL_FRAME_CHANNEL, payload);
  },
});
